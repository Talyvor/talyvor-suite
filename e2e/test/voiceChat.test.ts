import { describe, expect, it } from 'vitest'
import { type VoiceSeen, voiceVerdict } from '../src/voiceChat.ts'

// B40.12 — the voice-chat-pay verdict: it passes only on a read-back naming the payee and amount, an approval card, no
// account number, a voice request needing approval, a speech route that answered or said it is not configured, and no
// payment on the ledger.

const PASSING: VoiceSeen = {
  payee: 'Nightly Voice Payee x1',
  readback: 'I’ve prepared a payment of £1.50 to Nightly Voice Payee x1. Nothing is paid until you approve it with your passkey.',
  approveCard: true,
  pageText: 'Chat … Nightly Voice Payee x1 £1.50',
  voiceRequest: { status: 201, client: 'voice', decisions: ['needs_approval'] },
  speech: { status: 503, contentType: 'application/json', error: 'speech is not configured on this Lens' },
  paymentsToPayee: 0,
}

describe('voice-chat-pay (B40.12)', () => {
  it('passes on what the feature promises, and fails on a payment made without a passkey or an account number shown', () => {
    expect(voiceVerdict(PASSING).pass).toBe(true)
    expect(voiceVerdict({ ...PASSING, paymentsToPayee: 1 }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, pageText: 'account 12345678' }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, voiceRequest: { status: 201, client: 'chat', decisions: ['auto'] } }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, speech: { status: 502, contentType: 'application/json', error: 'Lens could not answer just now' } }).pass).toBe(false)
  })
})
