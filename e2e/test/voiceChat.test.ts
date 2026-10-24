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
  heyTaly: { offered: false, onDevice: false, whileHidden: -1, whenBack: -1, landed: false, unsentFirst: false, readback: '', approveCard: false },
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

describe('voice-chat-pay: Hey Taly (B45.27)', () => {
  const SPOKE = { status: 200, contentType: 'audio/mpeg', error: '' }
  const HEARD = { offered: true, onDevice: true, whileHidden: 0, whenBack: 1, landed: true, unsentFirst: true, readback: PASSING.readback, approveCard: true }
  it('passes only when Hey Taly listens on the device, never while the tab is hidden, and ends in a read-back awaiting a passkey', () => {
    expect(voiceVerdict({ ...PASSING, speech: SPOKE, heyTaly: HEARD }).pass).toBe(true)
    expect(voiceVerdict({ ...PASSING, speech: SPOKE, heyTaly: { ...HEARD, whileHidden: 1 } }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, speech: SPOKE, heyTaly: { ...HEARD, onDevice: false } }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, speech: SPOKE, heyTaly: { ...HEARD, readback: '', approveCard: false } }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, speech: SPOKE, heyTaly: { ...HEARD, unsentFirst: false } }).pass).toBe(false)
    expect(voiceVerdict({ ...PASSING, heyTaly: HEARD }).pass).toBe(false)
  })
})
