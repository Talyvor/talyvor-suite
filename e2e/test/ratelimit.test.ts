import { describe, expect, it } from 'vitest'
import type { BurstAnswer } from '../src/lens.ts'
import { counterOf, raisedLimitFaults, redisDownFaults, refusalFaults } from '../src/ratelimit.ts'

const served: BurstAnswer = { status: 200, retryAfter: null, remaining: '7', text: '{"id":"ws"}' }
const refused: BurstAnswer = { status: 429, retryAfter: '1', remaining: '0', text: '{"error":"rate limit exceeded","limit_type":"second","retry_after_seconds":1}' }

describe('B28.288 rate-limits-hold', () => {
  it('passes a refusal that says when to come back, and names each one that does not, and a burst answered neither way', () => {
    expect(refusalFaults([served, refused, refused])).toEqual([])
    expect(refusalFaults([served, refused, { ...refused, retryAfter: null }, { ...refused, retryAfter: '0', text: '{"error":"rate limit exceeded"}' }, { status: 502, retryAfter: null, remaining: null, text: '' }]))
      .toEqual(['1 of the 3 refusals carried no Retry-After', '1 of the 3 refusals carried Retry-After "0", not a whole number of seconds of at least 1',
        '1 of the 3 refusals named no limit_type (the window it hit)', '1 of the 3 refusals said retry_after_seconds undefined against Retry-After 0',
        'the burst was answered 502 ×1, neither served nor refused 429'])
  })
})

describe('B39.35 workspace-limits-raised', () => {
  const thousand = Array.from({ length: 1000 }, () => served)
  const minute: BurstAnswer = { ...refused, retryAfter: '41', text: '{"error":"rate limit exceeded","limit_type":"minute","retry_after_seconds":41}' }
  it("passes the raised workspace's 1,001st served and the other's refused for the minute, and names each way that fails", () => {
    expect(raisedLimitFaults({ first: thousand, last: served }, { first: thousand, last: minute })).toEqual([])
    expect(raisedLimitFaults({ first: thousand, last: minute }, { first: [...thousand.slice(1), refused], last: served })).toEqual([
      '1 of the default workspace\'s first 1,000 reads, under 100 a second, were not served; the first: 429 (second) "' + refused.text + '"',
      'the raised workspace\'s 1,001st read in the minute answered 429 (minute) "' + minute.text + '": its 5,000 a minute is not applied',
      "the default workspace's 1,001st read in the minute answered 200, not 429: raising one workspace raised another",
    ])
    expect(raisedLimitFaults({ first: thousand, last: served }, { first: thousand, last: refused }))
      .toEqual(['the default workspace\'s 1,001st read was refused for the window "second", not "minute"'])
  })
})

describe('B28.288 rate-limits-redis-down', () => {
  const page = '# HELP lens_rate_limit_redis_errors_total x\n# TYPE lens_rate_limit_redis_errors_total counter\nlens_rate_limit_redis_errors_total 351\nlens_rate_limit_redis_errors_total_other 9\n'
  it('reads the counter off the metrics page, and null when it is not there', () => {
    expect(counterOf(page, 'lens_rate_limit_redis_errors_total')).toBe(351)
    expect(counterOf('lens_up{a="b"} 1\nlens_up{a="c"} 2\n', 'lens_up')).toBe(3)
    expect(counterOf('lens_up 1\n', 'lens_rate_limit_redis_errors_total')).toBeNull()
  })
  it('passes a limiter that refuses and counts with Redis gone, and names one that fails open or counts nothing', () => {
    const burst = [...Array.from({ length: 100 }, () => served), ...Array.from({ length: 50 }, () => refused)]
    expect(redisDownFaults(burst, 0, 351)).toEqual([])
    expect(redisDownFaults(Array.from({ length: 150 }, () => served), 0, 0)).toEqual([
      'with Redis gone, 150 reads of the workspace on one token were none of them refused (150 served): the limiter fails open',
      'lens_rate_limit_redis_errors_total rose by 0 over 150 reads with Redis gone, not at least one a read: the outage would not alert',
    ])
    expect(redisDownFaults(burst, null, null)).toEqual(['the admin key\'s /metrics carried no lens_rate_limit_redis_errors_total before Redis went'])
  })
})
