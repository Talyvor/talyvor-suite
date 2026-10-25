// B40.32 — speech through Lens (talyvor-lens B40.10), on an agent's own key, once a run, on a workspace of its own.
//
// The owner funds an agent and issues it a key. The agent sends the run's recorded clip to /v1/audio/transcriptions and a
// sentence to /v1/audio/speech. Each must leave exactly one charge on the agent's statement, at the catalog's price: the
// clip's length at nova-3's per_minute, the sentence's characters at aura-2's per_1m_chars. On a Lens without
// LENS_DEEPGRAM_API_KEY both routes must say speech is not configured, and the statement must gain nothing.

import { readFile } from 'node:fs/promises'
import { fail } from './bank.ts'
import { chargeOf, complete } from './code.ts'
import { type AgentLine, refusalOf } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { VOICE_CLIP } from './voiceChat.ts'

interface SpeechModel { id: string; per_minute?: number; per_1m_chars?: number }

const FUND_ULXC = 1_000_000
const TRANSCRIBE_MODEL = 'nova-3'
const SPEAK_MODEL = 'aura-2'
const SENTENCE = `Your agent has spent four pounds today. ${RUN_SALT}`
/** How far the provider's own measure of the clip may sit from its header's: Deepgram reports the length it decoded. */
const HEARD_SLACK_S = 0.05
const CHARGED_WITHIN_MS = 30_000
const NOT_CONFIGURED = /speech is not configured/

/** A WAV's length in seconds, from its fmt chunk's byte rate and its data chunk's size. */
export function wavSeconds(wav: Buffer): number {
  let rate = 0
  for (let i = 12; i + 8 <= wav.length; i += 8 + wav.readUInt32LE(i + 4) + (wav.readUInt32LE(i + 4) & 1)) {
    const id = wav.toString('latin1', i, i + 4)
    if (id === 'fmt ') rate = wav.readUInt32LE(i + 16)
    if (id === 'data' && rate > 0) return wav.readUInt32LE(i + 4) / rate
  }
  throw new Error('the clip is not a WAV with a fmt chunk before its data')
}

/** talyvor-lens economy.ChargeULXC: dollars to µLXC, rounded at a millionth of a µLXC first so float noise never adds one. */
const chargeULXC = (usd: number, usdPerLXC: number) => Math.ceil(Math.round((usd / usdPerLXC) * 1e12) / 1e6)

export function speechThroughLens(): Scenario {
  return {
    id: 'speech-through-lens',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B40.10', 'B40.32'],
    title: "an agent's recorded clip transcribed and a sentence spoken through Lens on its own key are one charge each on its statement, " +
      "at the catalog's per-minute and per-character prices; on a Lens without speech, both say it is not configured and nothing is charged",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Speaker ${RUN_SALT}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'speech-through-lens' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      await lens.fundAgent(user, agent.id, FUND_ULXC)
      const clip = await readFile(VOICE_CLIP)
      const form = new FormData()
      form.append('file', new Blob([clip], { type: 'audio/wav' }), 'voice-sentence.wav')
      form.append('model', TRANSCRIBE_MODEL)
      const multipart = new Response(form)
      const transcribe = async () => lens.upload(k.value.key, '/v1/audio/transcriptions', new Uint8Array(await multipart.clone().arrayBuffer()),
        multipart.headers.get('content-type') ?? '', 60_000)
      const speak = () => lens.raw(k.value.key, 'POST', '/v1/audio/speech', JSON.stringify({ model: SPEAK_MODEL, input: SENTENCE }), 'application/json')

      // One call, and what it left on the statement once its charge is complete (or, refused, after a moment).
      const charged = async (what: string, send: () => Promise<{ status: number; text: string }>) => {
        const before = await lens.agentLines(user, agent.id)
        const got = await send()
        const said = got.status === 200 ? `${got.status} (${got.text.length} chars)` : `${got.status} ${refusalOf(got.text)}`
        let after: AgentLine[] = before
        for (const t0 = Date.now(); Date.now() - t0 < (got.status === 200 ? CHARGED_WITHIN_MS : 3_000);) {
          after = await lens.agentLines(user, agent.id)
          if (complete(before, after)) break
          await new Promise((r) => setTimeout(r, 1_000))
        }
        const fresh = after.filter((l) => !before.some((b) => b.entry_id === l.entry_id))
        ctx.evidence.push({ note: `${what}: ${said}; the agent's statement took ${fresh.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'}` })
        return { got, before, after, fresh }
      }

      const heard = await charged(`${agent.name} sends the ${clip.length}-byte clip to /v1/audio/transcriptions`, transcribe)
      if (heard.got.status === 503 && NOT_CONFIGURED.test(heard.got.text)) {
        const spoken = await charged(`${agent.name} sends a sentence to /v1/audio/speech`, speak)
        const wrong: string[] = []
        if (spoken.got.status !== 503 || !NOT_CONFIGURED.test(spoken.got.text)) wrong.push(`/v1/audio/speech answered ${spoken.got.status} ${refusalOf(spoken.got.text)}, not that speech is not configured`)
        for (const [route, c] of [['transcriptions', heard], ['speech', spoken]] as const) {
          if (c.fresh.length > 0) wrong.push(`refused as not configured, /v1/audio/${route} still wrote ${c.fresh.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')} on the agent's statement`)
        }
        if (wrong.length > 0) return fail(wrong.join('; '))
        return { pass: true, detail: "speech is not configured on this Lens: both /v1/audio routes say so and the agent's statement gained nothing" }
      }

      const models = (await lens.catalog(user)) as unknown as SpeechModel[]
      const perMinute = models.find((m) => m.id === TRANSCRIBE_MODEL)?.per_minute ?? 0
      const perChars = models.find((m) => m.id === SPEAK_MODEL)?.per_1m_chars ?? 0
      if (!(perMinute > 0 && perChars > 0)) {
        return fail(`the catalog prices ${TRANSCRIBE_MODEL} at ${perMinute} a minute and ${SPEAK_MODEL} at ${perChars} per 1M characters`)
      }
      const usdPerLXC = await lens.usdPerLXC()
      const wrong: string[] = []
      if (heard.got.status !== 200) wrong.push(`/v1/audio/transcriptions answered ${heard.got.status} ${refusalOf(heard.got.text)}`)
      const seconds = wavSeconds(clip)
      const [lo, hi] = [seconds - HEARD_SLACK_S, seconds + HEARD_SLACK_S].map((s) => chargeULXC((s / 60) * perMinute, usdPerLXC))
      const t = chargeOf(heard.before, heard.after)
      const heardULXC = 'why' in t ? 0 : t.charged
      if ('why' in t) wrong.push(`the transcription: ${t.why}`)
      else if (heardULXC < lo || heardULXC > hi) wrong.push(`the ${seconds.toFixed(3)} s clip was charged ${t.charged} µLXC; at ${perMinute} a minute it is ${lo}–${hi}`)

      const spoken = await charged(`${agent.name} sends a ${[...SENTENCE].length}-character sentence to /v1/audio/speech`, speak)
      if (spoken.got.status !== 200) wrong.push(`/v1/audio/speech answered ${spoken.got.status} ${refusalOf(spoken.got.text)}`)
      const price = chargeULXC(([...SENTENCE].length * perChars) / 1e6, usdPerLXC)
      const s = chargeOf(spoken.before, spoken.after)
      if ('why' in s) wrong.push(`the speech: ${s.why}`)
      else if (s.charged !== price) wrong.push(`the ${[...SENTENCE].length}-character sentence was charged ${s.charged} µLXC; at ${perChars} per 1M characters it is ${price}`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `one charge each on ${agent.name}'s statement: the ${seconds.toFixed(3)} s clip ${heardULXC} µLXC ` +
        `(${lo}–${hi} at ${perMinute}/min) and the sentence ${price} µLXC at ${perChars}/1M chars` }
    },
  }
}
