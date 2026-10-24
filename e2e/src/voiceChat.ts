// B40.12 — talking to Talyvor in Chat. Once a run, on a workspace of its own: the owner saves a payee on Lens's API, then
// in Chat types "pay <payee> £1.50 for the nightly invoice" and must read back the payee and £1.50, see the approval card,
// and never see the payee's account number. The same payment prepared as if said aloud (the BFF's voice route) must come
// back from Lens as a voice request needing approval. Nothing is approved, so the ledger must hold no payment to the payee —
// read back from Lens, never judged by a status code. The speech route must answer either audio or Lens's "speech is not
// configured" sentence; which one is in the detail.
// B45.27 — and "Hey Taly": with speech configured, a stand-in for the browser's on-device recogniser is put in the page; Hey
// Taly turned on must listen on the device, stop while the tab is hidden and listen again once it is back, and "Hey Taly, pay
// <payee> £1.50 …" must land in the box unsent and, sent, end in the same read-back and approval card, never a payment.
// Without speech it must not be offered.

import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const AMOUNT_MINOR = 150
const ACCOUNT_NUMBER = '12345678'

/** What the person saw in Chat and what Lens holds afterwards. */
export interface VoiceSeen {
  payee: string
  readback: string
  approveCard: boolean
  pageText: string
  voiceRequest: { status: number; client?: string; decisions?: string[] }
  speech: { status: number; contentType: string; error: string }
  paymentsToPayee: number
  /** B45.27 — what Hey Taly did in the page. */
  heyTaly: HeyTalySeen
}

export interface HeyTalySeen {
  offered: boolean
  onDevice: boolean
  /** Recognisers listening while the tab was hidden, and once it was back in view. */
  whileHidden: number
  whenBack: number
  /** The words after "Hey Taly" landed in the box, and nothing was prepared before the run sent them. */
  landed: boolean
  unsentFirst: boolean
  readback: string
  approveCard: boolean
}

export function voiceVerdict(seen: VoiceSeen): Verdict {
  const wrong: string[] = []
  const want = `£1.50 to ${seen.payee}`
  if (!seen.readback.includes(want) || !seen.readback.includes('Nothing is paid until you approve it with your passkey')) {
    wrong.push(`Chat read back "${seen.readback}", not the payee and amount (${want}) and that nothing is paid until a passkey approves it`)
  }
  if (!seen.approveCard) wrong.push('Chat showed no approval card for the prepared payment')
  if (seen.pageText.includes(ACCOUNT_NUMBER)) wrong.push('Chat showed the payee’s account number')
  const v = seen.voiceRequest
  if (v.status !== 201 && v.status !== 200) wrong.push(`preparing the payment as voice answered ${v.status}`)
  else if (v.client !== 'voice' || !(v.decisions ?? []).every((d) => d === 'needs_approval') || (v.decisions ?? []).length !== 1) {
    wrong.push(`Lens prepared the voice payment as client "${v.client}" with decisions ${JSON.stringify(v.decisions)}, not one needs_approval from "voice"`)
  }
  const spoke = seen.speech.status === 200 && seen.speech.contentType.startsWith('audio/')
  const unconfigured = seen.speech.status === 503 && seen.speech.error.includes('speech is not configured')
  if (!spoke && !unconfigured) wrong.push(`the speech route answered ${seen.speech.status} ${seen.speech.contentType} "${seen.speech.error}", neither audio nor "speech is not configured"`)
  const h = seen.heyTaly
  if (!spoke && h.offered) wrong.push('Chat offers Hey Taly though speech is not configured')
  if (spoke) {
    if (!h.offered) wrong.push('Chat does not offer Hey Taly though speech is configured and the browser recognises on the device')
    else {
      if (!h.onDevice) wrong.push('Hey Taly listened without asking the recogniser to stay on the device')
      if (h.whileHidden !== 0) wrong.push(`Hey Taly kept ${h.whileHidden} recognisers listening while the tab was hidden`)
      if (h.whenBack !== 1) wrong.push(`Hey Taly had ${h.whenBack} recognisers listening once the tab was back, not 1`)
      if (!h.landed || !h.unsentFirst) wrong.push('what was said after “Hey Taly” did not land in the box unsent')
      if (!h.readback.includes(want) || !h.readback.includes('passkey') || !h.approveCard) {
        wrong.push(`"Hey Taly, pay …" read back "${h.readback}"${h.approveCard ? '' : ' with no approval card'}, not ${want} awaiting a passkey`)
      }
    }
  }
  if (seen.paymentsToPayee !== 0) wrong.push(`Lens holds ${seen.paymentsToPayee} payments to the payee though nothing was approved`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return {
    pass: true,
    detail: `Chat read back "${seen.readback}" with the approval card and no account number; the voice request is one needs_approval from "voice"; ` +
      `no payment to the payee on the ledger; speech ${spoke ? 'answered audio' : 'is not configured on this Lens'}; ` +
      (spoke ? `Hey Taly listened on the device, stopped while hidden, and read back "${h.readback}"` : 'Hey Taly is not offered'),
  }
}

/** Stands in for the browser's on-device recogniser: it says it can listen on the device and keeps who is listening. */
function fakeRecogniser() {
  const live: { processLocally: boolean; onresult: ((e: unknown) => void) | null }[] = []
  class Recogniser {
    static available = async () => 'available'
    lang = ''
    continuous = false
    interimResults = true
    processLocally = false
    onresult: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    start() {
      live.push(this)
    }
    abort() {
      const i = live.indexOf(this)
      if (i >= 0) live.splice(i, 1)
    }
  }
  const hear = (words: string) => live[0]?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: words }], { isFinal: true })] })
  Object.assign(window, { SpeechRecognition: Recogniser, heyTalyTest: { live, hear } })
}

const HEY_TALY_WAIT_MS = 10_000

async function sayHeyTaly(page: Page, payee: string): Promise<HeyTalySeen> {
  const seen: HeyTalySeen = { offered: false, onDevice: false, whileHidden: -1, whenBack: -1, landed: false, unsentFirst: false, readback: '', approveCard: false }
  await page.addInitScript(fakeRecogniser)
  await page.reload()
  const toggle = page.getByTestId('hey-taly')
  seen.offered = await toggle.waitFor({ timeout: HEY_TALY_WAIT_MS }).then(() => true, () => false)
  if (!seen.offered) return seen
  type Test = { heyTalyTest: { live: { processLocally: boolean }[]; hear: (w: string) => void } }
  const listening = () => page.evaluate(() => (window as unknown as Test).heyTalyTest.live.length)
  const showTab = (state: string) => page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
  await toggle.click()
  await page.waitForFunction(() => (window as unknown as Test).heyTalyTest.live.length === 1, undefined, { timeout: TIMEOUT_MS }).catch(() => undefined)
  seen.onDevice = await page.evaluate(() => (window as unknown as Test).heyTalyTest.live[0]?.processLocally === true)
  await showTab('hidden')
  await page.waitForTimeout(1_000)
  seen.whileHidden = await listening()
  await showTab('visible')
  await page.waitForFunction(() => (window as unknown as Test).heyTalyTest.live.length > 0, undefined, { timeout: TIMEOUT_MS }).catch(() => undefined)
  seen.whenBack = await listening()
  const words = `pay ${payee} £1.50 for the nightly invoice`
  await page.evaluate((words) => (window as unknown as Test).heyTalyTest.hear(words), `Hey Taly, ${words}`)
  // What was said lands in the box, unsent, as a recording does; the run sends it.
  const box = page.locator('#chat-message')
  seen.landed = await page.waitForFunction((w) => document.querySelector<HTMLTextAreaElement>('#chat-message')?.value === w, words, { timeout: TIMEOUT_MS }).then(() => true, () => false)
  seen.unsentFirst = (await page.getByTestId('chat-pay-readback').count()) === 0
  await box.press('Enter')
  const line = page.getByTestId('chat-pay-readback').last()
  await line.waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
  seen.readback = ((await line.textContent().catch(() => '')) ?? '').trim()
  seen.approveCard = await page.getByTestId('approve-card').last().isVisible().catch(() => false)
  return seen
}

export function voiceChatPay(): Scenario {
  return {
    id: 'voice-chat-pay',
    owner: 'talyvor-suite',
    own: true,
    items: ['B40.12', 'B45.27'],
    feature: 'Chat',
    title: 'a payment asked for in Chat is prepared, read back with the payee and amount and no account number, and a voice request needs approval; nothing is paid without a passkey',
    run: async (ctx) => {
      const payee = `Nightly Voice Payee ${RUN_SALT}`
      const saved = await call<{ id: string }>(ctx, 'POST', '/v1/money/payees', { name: payee, country: 'GB', sort_code: '040004', account_number: ACCOUNT_NUMBER })
      ctx.evidence.push({ note: 'the owner saves a GBP payee', answer: said(saved) })
      if (saved.status !== 201 || saved.value?.id === undefined) return fail(`saving a payee answered ${said(saved)}`)
      const payeeID = saved.value.id

      const page = await ctx.app.tab('/chat')
      let readback = ''
      let approveCard = false
      let pageText = ''
      let voiceRequest: VoiceSeen['voiceRequest'] = { status: 0 }
      let speech: VoiceSeen['speech'] = { status: 0, contentType: '', error: '' }
      let heyTaly: HeyTalySeen = { offered: false, onDevice: false, whileHidden: -1, whenBack: -1, landed: false, unsentFirst: false, readback: '', approveCard: false }
      try {
        const box = page.getByPlaceholder('Ask anything')
        await box.waitFor({ timeout: TIMEOUT_MS })
        await box.fill(`pay ${payee} £1.50 for the nightly invoice`)
        await box.press('Enter')
        const line = page.getByTestId('chat-pay-readback')
        await line.waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        readback = ((await line.textContent().catch(() => '')) ?? '').trim()
        approveCard = await page.getByTestId('approve-card').first().isVisible().catch(() => false)
        pageText = (await page.locator('body').textContent().catch(() => '')) ?? ''
        ctx.evidence.push({ note: 'the owner types the payment into Chat', answer: readback })

        voiceRequest = await page.evaluate(async ({ payeeID, minor, key }) => {
          const r = await fetch('/api/money/payment-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify({ voice: true, items: [{ payee_id: payeeID, currency: 'GBP', amount_minor: minor, reference: 'Nightly voice' }] }),
          })
          const body = (await r.json().catch(() => ({}))) as { client?: string; items?: { decision: string }[] }
          return { status: r.status, client: body.client, decisions: (body.items ?? []).map((i) => i.decision) }
        }, { payeeID, minor: AMOUNT_MINOR, key: `voice-${RUN_SALT}-${Date.now().toString(36)}` })
        ctx.evidence.push({ note: 'the same payment prepared as said aloud', answer: JSON.stringify(voiceRequest) })

        speech = await page.evaluate(async () => {
          const r = await fetch('/api/chat/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'Hello.' }) })
          const contentType = r.headers.get('Content-Type') ?? ''
          const error = contentType.includes('json') ? (((await r.json().catch(() => ({}))) as { error?: string }).error ?? '') : ''
          return { status: r.status, contentType, error }
        })
        ctx.evidence.push({ note: 'Chat asks for an answer read aloud', answer: JSON.stringify(speech) })

        heyTaly = await sayHeyTaly(page, payee)
        ctx.evidence.push({ note: 'Hey Taly turned on, the tab hidden and shown, then “Hey Taly, pay …” said', answer: JSON.stringify(heyTaly) })
      } finally {
        await page.close().catch(() => undefined)
      }

      const payments = await call<{ payments: { payee_id: string }[] | null }>(ctx, 'GET', '/v1/money/payments')
      ctx.evidence.push({ note: 'Lens’s payments out afterwards', answer: said(payments) })
      if (payments.status !== 200 || payments.value === undefined) return fail(`reading the payments answered ${said(payments)}`)
      const paymentsToPayee = (payments.value.payments ?? []).filter((p) => p.payee_id === payeeID).length
      return voiceVerdict({ payee, readback, approveCard, pageText, voiceRequest, speech, paymentsToPayee, heyTaly })
    },
  }
}

// B47.3 — Chat's microphone end to end. The run's browser hears fixtures/voice-sentence.wav as its microphone (run.ts), and
// the page is asked whether speech is configured the way Chat asks it (an empty POST: Lens answers 503 before reading the
// form when it is not). Not configured: the microphone must not show. Configured: tap, the clip is recorded, tap, and the
// words must land in the composer and stay there, not sent.

/** What the run's fake microphone says: "Please show me the balance of my wallet." (macOS `say`, 16 kHz 16-bit WAV). */
export const VOICE_CLIP = fileURLToPath(new URL('../fixtures/voice-sentence.wav', import.meta.url))
/** Words of the clip any transcription of it holds. */
export const CLIP_WORDS = ['balance', 'wallet'] as const
/** Long enough for the clip (1.9 s) to play through at least once whatever moment recording starts in its loop. */
const RECORD_MS = 4_500
const SETTLE_MS = 3_000

export interface MicSeen {
  /** What the empty transcription POST answered: 503 is "speech is not configured". */
  probe: number
  micShown: boolean
  composer: string
  note: string
  /** Turns the person sent that say what the clip says, before the tap and after the transcript landed. */
  sentBefore: number
  sentAfter: number
}

const heard = (text: string) => {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ')
  return CLIP_WORDS.every((w) => words.includes(w))
}

export function micVerdict(seen: MicSeen): Verdict {
  if (seen.probe === 503) {
    if (seen.micShown) return fail('Chat shows the microphone though the server says speech is not configured (the transcription route answered 503)')
    return { pass: true, detail: 'speech is not configured on this server (503), and Chat shows no microphone' }
  }
  if (!seen.micShown) return fail(`Chat shows no microphone though the transcription route answered ${seen.probe}, not 503`)
  const wrong: string[] = []
  if (!heard(seen.composer)) {
    wrong.push(`after recording the clip the composer holds "${seen.composer}", not the words ${CLIP_WORDS.join(' and ')}${seen.note === '' ? '' : ` (Chat said "${seen.note}")`}`)
  }
  if (seen.sentAfter !== seen.sentBefore) wrong.push('the transcript was sent without the person pressing Send')
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `speech is configured (${seen.probe} to an empty recording); the clip landed in the composer as "${seen.composer}", unsent` }
}

export function voiceChatMic(): Scenario {
  return {
    id: 'voice-chat-mic',
    owner: 'talyvor-suite',
    items: ['B47.1'],
    feature: 'Chat',
    title: 'Chat’s microphone shows only when speech is configured, and a recorded clip lands in the composer as text, unsent',
    run: async (ctx) => {
      const page = await ctx.app.tab('/chat')
      const seen: MicSeen = { probe: 0, micShown: false, composer: '', note: '', sentBefore: 0, sentAfter: 0 }
      try {
        const box = page.locator('#chat-message')
        await box.waitFor({ timeout: TIMEOUT_MS })
        seen.probe = await page.evaluate(async () => (await fetch('/api/chat/voice/transcriptions', { method: 'POST' })).status)
        ctx.evidence.push({ note: 'an empty recording to the transcription route, as Chat asks whether speech is configured', answer: String(seen.probe) })
        const mic = page.getByTestId('chat-mic')
        if (seen.probe === 503) {
          // The page asked the same question when it opened; by now its answer is in.
          await page.waitForTimeout(SETTLE_MS)
          seen.micShown = await mic.isVisible()
          return micVerdict(seen)
        }
        seen.micShown = await mic.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        if (!seen.micShown) return micVerdict(seen)
        const sent = () => page.getByTestId('turn-user').evaluateAll((els, words) =>
          els.filter((e) => words.every((w) => (e.textContent ?? '').toLowerCase().includes(w))).length, [...CLIP_WORDS])
        seen.sentBefore = await sent()
        await mic.click()
        await page.getByTestId('voice-recording').waitFor({ timeout: TIMEOUT_MS })
        await page.waitForTimeout(RECORD_MS)
        await mic.click()
        // Back to idle: the microphone reads "Talk" and can be tapped again (or is gone, if speech went off meanwhile).
        await page.waitForFunction(() => {
          const b = document.querySelector<HTMLButtonElement>('[data-testid="chat-mic"]')
          return b === null || (b.getAttribute('aria-label') === 'Talk' && !b.disabled)
        }, undefined, { timeout: TIMEOUT_MS })
        await page.waitForTimeout(SETTLE_MS)
        seen.composer = (await box.inputValue()).trim()
        seen.note = ((await page.getByTestId('voice-note').textContent({ timeout: 1_000 }).catch(() => '')) ?? '').trim()
        seen.sentAfter = await sent()
        ctx.evidence.push({ note: 'the clip recorded with the microphone, then the composer', answer: JSON.stringify({ composer: seen.composer, note: seen.note }) })
        return micVerdict(seen)
      } finally {
        await page.close().catch(() => undefined)
      }
    },
  }
}
