import { describe, expect, it } from 'vitest'
import { type DeviceKeysSeen, deviceKeysVerdict } from '../src/deviceKeys.ts'

// B40.31 — the device-keys-bff verdict passes only when every route answered in Lens's words, never on a BFF 404 or 502.

const PASSING: DeviceKeysSeen = {
  challenge: { status: 200, body: { challenge: 'ch_1' } },
  register: { status: 400, body: { error: 'devicekey: the device key is not valid: attestation' } },
  list: { status: 200, body: { devices: [] } },
  revoke: { status: 404, body: { error: 'economy: no such device key in this workspace' } },
}

describe('device-keys-bff (B40.31)', () => {
  it('passes on Lens’s answers, and fails when a route never reached Lens', () => {
    expect(deviceKeysVerdict(PASSING).pass).toBe(true)
    expect(deviceKeysVerdict({ ...PASSING, challenge: { status: 404, body: {} } }).pass).toBe(false)
    expect(deviceKeysVerdict({ ...PASSING, register: { status: 400, body: { error: 'invalid JSON body' } } }).pass).toBe(false)
    expect(deviceKeysVerdict({ ...PASSING, revoke: { status: 404, body: { error: 'not found' } } }).pass).toBe(false)
    expect(deviceKeysVerdict({ ...PASSING, list: { status: 200, body: { devices: [{ id: 'dk_1' }] } } }).pass).toBe(false)
  })
})
