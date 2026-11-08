import { describe, expect, it } from 'vitest'
import { type PhoneSeen, phoneKeyWebVerdict } from '../src/phoneKeyWeb.ts'

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
