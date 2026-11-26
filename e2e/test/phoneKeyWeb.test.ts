import { describe, expect, it } from 'vitest'
import { type EnrolSeen, type LostSeen, type PhoneSeen, enrolVerdict, lostPhoneVerdict, phoneKeyWebVerdict } from '../src/phoneKeyWeb.ts'

const right: PhoneSeen = { line: true, buttons: 0, posts: [], status: 'pending', loosenLine: true, rulesSaved: [500_000], daily: 500_000 }

describe('the phone-key-web oracle (B55.2)', () => {
  it('passes the phone line, no button, nothing sent and the approval still pending', () => {
    expect(phoneKeyWebVerdict(right).pass).toBe(true)
  })

  it('fails an Approve button and an unsigned decision sent from the web', () => {
    const v = phoneKeyWebVerdict({ ...right, line: false, buttons: 2, posts: ['/api/agents/approvals/apr_1/approve'], status: 'approved' })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('shows 2 Approve or Decline button(s)')
    expect(v.detail).toContain('the page sent /api/agents/approvals/apr_1/approve')
    expect(v.detail).toContain('the approval is approved on Lens, not pending')
  })

  it('fails a raised limit sent from the web, or a lowered one Lens does not hold (B55.14)', () => {
    const v = phoneKeyWebVerdict({ ...right, loosenLine: false, rulesSaved: [2_000_000, 500_000], daily: 2_000_000 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('raising the daily limit did not say')
    expect(v.detail).toContain('the page saved daily limits [2000000, 500000]')
    expect(v.detail).toContain('the daily limit on Lens is 2000000 µLXC')
  })
})

const joined: EnrolSeen = { shown: '482913', held: '482913', added: true, passkeys: 1, asked: true, letIn: true, phoneStatus: 'approved' }

describe('the phone-key-web enrolment oracle (B55.3)', () => {
  it('passes a browser let in with the code Lens holds, and a second phone let in from it', () => {
    expect(enrolVerdict(joined).pass).toBe(true)
  })

  it('fails a code Lens does not hold and a phone left waiting', () => {
    const v = enrolVerdict({ ...joined, held: '000000', phoneStatus: 'waiting' })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('the page showed code "482913" while Lens holds "000000"')
    expect(v.detail).toContain('is waiting on Lens, not approved')
  })
})

const recovered: LostSeen = { liveAfterLockout: 0, lockdown: true, card: true, phoneAnswer: 403, afterPhone: 'pending', lifted: true, recovered: 1, newCode: true, approved: true, status: 'approved' }

describe('the phone-key-web lost-phone oracle (B28.68)', () => {
  it('passes a locked-out phone refused and a recovered passkey approving', () => {
    expect(lostPhoneVerdict(recovered).pass).toBe(true)
  })

  it('fails a locked-out phone that still approves, and no passkey got back', () => {
    const v = lostPhoneVerdict({ ...recovered, liveAfterLockout: 2, phoneAnswer: 200, afterPhone: 'approved', recovered: 0, newCode: false, approved: false })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('Lens holds 2 live key(s), not none')
    expect(v.detail).toContain("the locked-out phone's signature on the waiting approval must be refused 403; Lens answered 200")
    expect(v.detail).toContain('Lens holds 0 live passkey(s), not the new one')
  })

  it('names what the lockout came to when it stops part-way (STUB_BREAK=lockdown-keeps-key)', () => {
    const v = lostPhoneVerdict({ ...recovered, liveAfterLockout: 1, phoneAnswer: 200, afterPhone: 'approved', recovered: -1, newCode: false, approved: false, why: 'locator.fill: Timeout 30000ms exceeded.' })
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('the lost phone could not be locked out and replaced: after Lost your phone? Lens holds 1 live key(s), not none; ' +
      "the locked-out phone's signature on the waiting approval must be refused 403; Lens answered 200; after the locked-out phone signed, the approval is approved, not pending; " +
      'locator.fill: Timeout 30000ms exceeded.')
  })
})
