import { describe, expect, it } from 'vitest'
import { type WalletSeen, walletVerdict } from '../src/agentWallet.ts'

const sandbox: WalletSeen = {
  lens: { balance: '0.00 USDC', mode: 'TEST', payInto: '0xmadeup' },
  text: 'Wallet Wallet agent holds 0.00 USDC. Add money Wallet agent’s wallet has no details to pay into yet. Send',
  copy: false,
  approval: true,
  payments: 0,
  paidItems: 0,
  paymentsAfter: 0,
}

describe('the agent wallet oracle (B46.9)', () => {
  it('passes the sandbox wallet with Lens’s balance, nothing to copy, and Send waiting for approval with nothing paid', () => {
    expect(walletVerdict(sandbox).pass).toBe(true)
  })

  it('fails a sandbox wallet showing its made-up address, and a payment on the ledger before approval', () => {
    const v = walletVerdict({ ...sandbox, text: `${sandbox.text} 0xmadeup`, copy: true, payments: 1 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('the sandbox wallet offers something to copy')
    expect(v.detail).toContain('shows its made-up 0xmadeup')
    expect(v.detail).toContain('before approval the ledger holds 1 payment(s) to the payee')
  })
})
