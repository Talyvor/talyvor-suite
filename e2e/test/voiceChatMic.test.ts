import { describe, expect, it } from 'vitest'
import { type MicSeen, micVerdict } from '../src/voiceChat.ts'

// B47.3 — the voice-chat-mic verdict: with speech off the microphone must be hidden; with it on, the clip's words must land
// in the composer and not be sent.

const OFF: MicSeen = { probe: 503, micShown: false, composer: '', note: '', sentBefore: 0, sentAfter: 0 }
const ON: MicSeen = { probe: 400, micShown: true, composer: 'Please show me the balance of my wallet.', note: '', sentBefore: 0, sentAfter: 0 }

describe('voice-chat-mic (B47.3)', () => {
  it('passes in either state the server is in, and fails on a microphone shown while speech is off', () => {
    expect(micVerdict(OFF).pass).toBe(true)
    expect(micVerdict(ON).pass).toBe(true)
    expect(micVerdict({ ...OFF, micShown: true }).pass).toBe(false)
  })

  it('fails when speech is on and the microphone is missing, the words never land, or they are sent', () => {
    expect(micVerdict({ ...ON, micShown: false }).pass).toBe(false)
    expect(micVerdict({ ...ON, composer: '', note: 'Couldn’t hear that. Try again.' }).pass).toBe(false)
    expect(micVerdict({ ...ON, sentAfter: 1 }).pass).toBe(false)
  })
})
