import { describe, expect, it } from 'vitest'
import { type CardSeen, paymentCardVerdict } from '../src/chatPaymentCard.ts'

const shown: CardSeen = {
  card: { payee: true, amount: true, reference: true, rule: true, approve: true, decline: true },
  text: 'Nightly Chat Card Joinery £120.00 Reference: Nightly chat card Asks for approval: over £100.00 a payment. (limits.per_payment) Approve 1 payment with a passkey Decline',
  payments: 0,
  accountMinor: 0,
  paidItems: 0,
  declined: 'Declined. Nothing was paid (£120.00 to Nightly Chat Card Joinery).',
  paymentsAfter: 0,
}

describe('the prepared payment card oracle (B45.34)', () => {
  it('passes a card with all five fields, nothing paid before approval, and Decline paying nothing', () => {
    expect(paymentCardVerdict(shown).pass).toBe(true)
  })

  it('fails a card missing the rule, and a payment on the ledger before approval', () => {
    const v = paymentCardVerdict({ ...shown, card: { ...shown.card, rule: false }, payments: 1 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('does not show the rule that asked for approval (limits.per_payment)')
    expect(v.detail).toContain('before approval the ledger holds 1 payment(s) to the payee')
  })
})
