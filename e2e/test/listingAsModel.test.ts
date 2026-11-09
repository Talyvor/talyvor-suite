import { describe, expect, it } from 'vitest'
import { listingAsModelFaults } from '../src/listingAsModel.ts'

const line = (use: string) => ({ use_id: use, listing_id: 'lst_1', title: 'Agent', price_ulxc: 50_000_000 })

describe('B41.208 market-listing-as-model', () => {
  it('passes two billed calls that are one use each on the bill, and fails an unbilled streamed call', () => {
    const plain = { how: 'plain' as const, status: 200, charge: 'billed', uses: 1 }
    expect(listingAsModelFaults([plain, { how: 'streamed', status: 200, charge: 'billed', uses: 2 }], [line('u1'), line('u2')], 50_000_000)).toEqual([])
    expect(listingAsModelFaults([plain, { how: 'streamed', status: 200, charge: null, uses: 1 }], [line('u1')], 50_000_000)).toEqual([
      'the streamed answer\'s X-Talyvor-Listing-Charge is null, not "billed"',
      'after the streamed call the buyer\'s bill holds 1 uses of the listing, not 2',
    ])
    expect(listingAsModelFaults([{ ...plain, uses: 2 }], [line('u1'), { ...line('u2'), price_ulxc: 0 }], 50_000_000)).toEqual([
      'after the plain call the buyer\'s bill holds 2 uses of the listing, not 1',
      `the bill's uses should each be billed at 50000000 µLXC; these are not: ${JSON.stringify([{ ...line('u2'), price_ulxc: 0 }])}`,
    ])
  })
})
