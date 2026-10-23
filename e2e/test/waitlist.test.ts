import { describe, expect, it } from 'vitest'
import { waitlistVerdict } from '../src/waitlist.ts'

const joined = 'You’re on the list.'

describe('the waitlist oracle (B44.1)', () => {
  it('passes one row for the address joined twice, none for the honeypot, and a 401 CSV', () => {
    expect(waitlistVerdict({ said: [joined, joined], probeRows: 1, botRows: 0, csvStatus: 401 }).pass).toBe(true)
  })

  it('fails a duplicate row, a stored bot, an open CSV and a page that never said so', () => {
    const v = waitlistVerdict({ said: [joined, ''], probeRows: 2, botRows: 1, csvStatus: 200 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('join 2 on /marketing read ""')
    expect(v.detail).toContain('2 rows for the address joined twice')
    expect(v.detail).toContain('1 rows for the honeypot')
    expect(v.detail).toContain('answered a stranger 200, not 401')
  })
})
