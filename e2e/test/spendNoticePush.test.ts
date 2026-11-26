import { describe, expect, it } from 'vitest'
import { type PushShown, pushUntilShown } from '../src/bank.ts'

// B17.536 — spend-notice-push FAILed for user 33 on 25 and 26 Nov with nothing shown for 30 seconds, and the same push
// showed at once on the retry: the DevTools delivery was dropped. A dropped push is delivered again until it shows.

const notice: PushShown = { title: 'You paid Bistro £25.00 (33)', body: 'Paid from your own account.', url: '/money/spending#notice-ntc_e2e_33', actions: [] }
const nothing: PushShown = { permission: 'granted', shown: [] }

describe('pushUntilShown', () => {
  it('delivers a dropped push again and reads the notification it then shows', async () => {
    let delivered = 0
    const got = await pushUntilShown(async () => { delivered++ }, async () => (delivered >= 2 ? notice : nothing), 1_000, 10)
    expect(got).toEqual({ ...notice, deliveries: 2 })
  })

  it('still reports nothing shown when the worker never shows it', async () => {
    let delivered = 0
    const got = await pushUntilShown(async () => { delivered++ }, async (ms) => { await new Promise((ok) => setTimeout(ok, ms)); return nothing }, 300, 100)
    expect(got.actions).toBeUndefined()
    expect(got.deliveries).toBe(delivered)
    expect(delivered).toBeGreaterThan(1)
  })
})
