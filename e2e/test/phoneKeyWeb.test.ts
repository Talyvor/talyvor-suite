import { describe, expect, it } from 'vitest'
import { type EnrolSeen, type PhoneSeen, enrolVerdict, phoneKeyWebVerdict } from '../src/phoneKeyWeb.ts'

const right: PhoneSeen = { line: true, buttons: 0, posts: [], status: 'pending' }

describe('the phone-key-web oracle (B55.2)', () => {
  it('passes the phone line, no button, nothing sent and the approval still pending', () => {
    expect(phoneKeyWebVerdict(right).pass).toBe(true)
  })

  it('fails an Approve button and an unsigned decision sent from the web', () => {
    const v = phoneKeyWebVerdict({ ...right, line: false, buttons: 2, posts: ['/api/agents/approvals/apr_1/approve'], status: 'approved' })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('shows 2 Approve or Deny button(s)')
    expect(v.detail).toContain('the page sent /api/agents/approvals/apr_1/approve')
    expect(v.detail).toContain('the approval is approved on Lens, not pending')
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
