// B40.12 — talking to Talyvor in Chat. Once a run, on a workspace of its own: the owner saves a payee on Lens's API, then
// in Chat types "pay <payee> £1.50 for the nightly invoice" and must read back the payee and £1.50, see the approval card,
// and never see the payee's account number. The same payment prepared as if said aloud (the BFF's voice route) must come
// back from Lens as a voice request needing approval. Nothing is approved, so the ledger must hold no payment to the payee —
// read back from Lens, never judged by a status code. The speech route must answer either audio or Lens's "speech is not
// configured" sentence; which one is in the detail.

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
  if (seen.paymentsToPayee !== 0) wrong.push(`Lens holds ${seen.paymentsToPayee} payments to the payee though nothing was approved`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return {
    pass: true,
    detail: `Chat read back "${seen.readback}" with the approval card and no account number; the voice request is one needs_approval from "voice"; ` +
      `no payment to the payee on the ledger; speech ${spoke ? 'answered audio' : 'is not configured on this Lens'}`,
  }
}

export function voiceChatPay(): Scenario {
  return {
    id: 'voice-chat-pay',
    owner: 'talyvor-suite',
    own: true,
    items: ['B40.12'],
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
      } finally {
        await page.close().catch(() => undefined)
      }

      const payments = await call<{ payments: { payee_id: string }[] | null }>(ctx, 'GET', '/v1/money/payments')
      ctx.evidence.push({ note: 'Lens’s payments out afterwards', answer: said(payments) })
      if (payments.status !== 200 || payments.value === undefined) return fail(`reading the payments answered ${said(payments)}`)
      const paymentsToPayee = (payments.value.payments ?? []).filter((p) => p.payee_id === payeeID).length
      return voiceVerdict({ payee, readback, approveCard, pageText, voiceRequest, speech, paymentsToPayee })
    },
  }
}
