// B40.31 — the phone app's device keys through the BFF, once a run, on a workspace of its own. The app talks only to the BFF,
// so each route must reach Lens and come back in Lens's words: a registration challenge is issued; a key with no real
// attestation is refused with Lens's "the device key is not valid", not a BFF 404 or 502; the list answers and holds no key,
// since nothing was registered; revoking a key that does not exist is Lens's "no such device key". A real phone's key needs
// the Secure Enclave and App Attest, which a test browser has not got (that is B40.18).

import { fail } from './bank.ts'
import type { Scenario, Verdict } from './scenarios.ts'

const TIMEOUT_MS = 30_000

interface Answer {
  status: number
  body: { challenge?: string; error?: string; devices?: unknown[] | null }
}

/** What each of the four routes answered. */
export interface DeviceKeysSeen {
  challenge: Answer
  register: Answer
  list: Answer
  revoke: Answer
}

export function deviceKeysVerdict(seen: DeviceKeysSeen): Verdict {
  const wrong: string[] = []
  const said = (a: Answer) => `${a.status} ${JSON.stringify(a.body)}`
  if (seen.challenge.status !== 200 || !seen.challenge.body.challenge) wrong.push(`the registration challenge answered ${said(seen.challenge)}`)
  if (seen.register.status !== 400 || !(seen.register.body.error ?? '').includes('the device key is not valid')) {
    wrong.push(`registering a key with no real attestation answered ${said(seen.register)}, not Lens's 400 "the device key is not valid"`)
  }
  if (seen.list.status !== 200 || (seen.list.body.devices ?? []).length !== 0) wrong.push(`the device list answered ${said(seen.list)}, not 200 with no key`)
  if (seen.revoke.status !== 404 || !(seen.revoke.body.error ?? '').includes('no such device key')) {
    wrong.push(`revoking a key that does not exist answered ${said(seen.revoke)}, not Lens's 404 "no such device key"`)
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: 'challenge issued; a key with no attestation refused in Lens’s words; the list empty; an unknown key’s revoke 404 from Lens' }
}

export function deviceKeysThroughBFF(): Scenario {
  return {
    id: 'device-keys-bff',
    owner: 'talyvor-suite',
    own: true,
    items: ['B40.31'],
    feature: 'Agent Wallets',
    title: 'the phone app’s device-key routes reach Lens through the BFF: a challenge, a refused registration in Lens’s words, the list and a revoke',
    run: async (ctx) => {
      const page = await ctx.app.tab('/')
      let seen: DeviceKeysSeen
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_MS })
        seen = await page.evaluate(async () => {
          const ask = async (method: string, path: string, body?: unknown) => {
            const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
            return { status: r.status, body: (await r.json().catch(() => ({}))) as Answer['body'] }
          }
          const challenge = await ask('POST', '/api/money/devices/challenge')
          const register = await ask('POST', '/api/money/devices', {
            platform: 'ios', name: 'Nightly test phone', public_key: 'AAAA', challenge: challenge.body.challenge ?? '', signature: 'AAAA', attestation: 'AAAA',
          })
          const list = await ask('GET', '/api/money/devices')
          const revoke = await ask('POST', '/api/money/devices/dk_nightly_none/revoke')
          return { challenge, register, list, revoke }
        })
      } finally {
        await page.close().catch(() => undefined)
      }
      ctx.evidence.push({ note: 'the four device-key routes through the BFF', answer: JSON.stringify(seen) })
      return deviceKeysVerdict(seen)
    },
  }
}
