import { describe, expect, it } from 'vitest'
import { verifies } from '../src/trackWebhooks.ts'

// B39.23 — the receiver's check is the Standard Webhooks one: the spec's own example (standard-webhooks, svix's tests) verifies,
// and the same message under another secret, another body or a v2 tag does not.
describe('verifies', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
  const ts = '1614265330'
  const body = '{"test": 2432232314}'
  const sig = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='

  it('takes the spec example, also among other signatures, and nothing else', () => {
    expect(verifies(secret, id, ts, body, sig)).toBe(true)
    expect(verifies(secret, id, ts, body, `v1,bm90IGl0 ${sig}`)).toBe(true)
    expect(verifies('whsec_' + Buffer.from('another key').toString('base64'), id, ts, body, sig)).toBe(false)
    expect(verifies(secret, id, ts, body + ' ', sig)).toBe(false)
    expect(verifies(secret, id, ts, body, sig.replace('v1,', 'v2,'))).toBe(false)
  })
})
