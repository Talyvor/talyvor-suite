import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketApi, MarketError } from '../areas/marketplace/marketApi'
import { roomsApi } from '../areas/rooms/roomsApi'

// B58.1 — a marketplace use, a licence and a room's run that Lens answers 202 {"status":"pending_approval"} (B58.2)
// reject with the approval they wait on and Lens's sentence; none resolves as if it had been paid.
describe('a held answer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects every holdable marketplace and room call with its approval', async () => {
    const message = "economy: payment of 3 LXC is above the agent's approval amount. Approval apr_x must be approved before it is sent"
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ status: 'pending_approval', approval_id: 'apr_x', amount_ulxc: 3_000_000, message }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    for (const call of [
      marketApi.use('lst_1', { model: 'gpt-5', input: 'hi', variables: {} }),
      marketApi.license('lst_1', 'off_1', 0, 'key-1'),
      roomsApi.run('room_1', { target: 'lst_1', input: 'hi', variables: {}, model: 'gpt-5', pay: 'room' }),
    ]) {
      const err = await call.then(() => null, (e: unknown) => e)
      expect(err).toBeInstanceOf(MarketError)
      expect(err).toMatchObject({ status: 202, approvalID: 'apr_x', sentence: message })
    }
  })
})
