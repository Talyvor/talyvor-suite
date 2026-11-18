import { describe, expect, it } from 'vitest'
import type { StatementRow } from '../src/bank.ts'
import type { AgentLine } from '../src/lens.ts'
import { WORDS, statementPagingVerdict } from '../src/statementPaging.ts'

// statement-paging's 107 lines as Lens posts them on the agent's account (newest first), and Agent Wallets' Statement
// as B28.51 draws it: the newest 100, then all 107, then the two withdrawals.
const made = [...Array.from({ length: 105 }, () => ({ kind: 'fund', amount_ulxc: 10_000 })), { kind: 'withdraw', amount_ulxc: -3_000 }, { kind: 'withdraw', amount_ulxc: -4_000 }]
let balance = 0
const oldestFirst: AgentLine[] = made.map((m, i) => {
  balance += m.amount_ulxc
  return { entry_id: `ent_${i}`, kind: m.kind, amount_ulxc: m.amount_ulxc, counterparty: 'workspace', balance_after_ulxc: balance, at: '2026-11-09T04:00:00Z' }
})
const lines = [...oldestFirst].reverse()
const row = (l: AgentLine): StatementRow => ({ what: WORDS[l.kind], amount: `${l.amount_ulxc > 0 ? '+' : '−'}${Math.abs(l.amount_ulxc) / 1e6} LXC`, balance: `${l.balance_after_ulxc / 1e6} LXC` })
const all = lines.map(row)
const filtered = lines.filter((l) => l.kind === 'withdraw').map(row)

describe('statement-paging', () => {
  it('passes when page 2 continues below page 1 and the filter leaves only the withdrawals', () => {
    const v = statementPagingVerdict(made, lines, { first: all.slice(0, 100), all, filtered })
    expect(v.detail).toContain('the Statement shows 100, then all 107')
    expect(v.pass).toBe(true)
  })

  // B17.484 — the screen draws balances to the cent, so the withdrawal leaving 1.043 LXC reads as the 1.04 LXC an
  // earlier funding left: the same balance on two different lines is not a line shown twice.
  it('passes when the screen rounds a withdrawal’s balance onto a funding’s', () => {
    const cents = (l: AgentLine): StatementRow => ({ ...row(l), amount: `${l.amount_ulxc > 0 ? '+' : '−'}${(Math.abs(l.amount_ulxc) / 1e6).toFixed(2)} LXC`, balance: `${(l.balance_after_ulxc / 1e6).toFixed(2)} LXC` })
    const drawn = lines.map(cents)
    expect(drawn[0].balance).toBe(drawn[3].balance)
    const v = statementPagingVerdict(made, lines, { first: drawn.slice(0, 100), all: drawn, filtered: lines.filter((l) => l.kind === 'withdraw').map(cents) })
    expect(v.detail).not.toContain('a line is shown twice')
    expect(v.pass).toBe(true)
  })

  it('fails when Show older lines shows page 1 again', () => {
    const again = [...all.slice(0, 100), ...all.slice(0, 7)]
    const v = statementPagingVerdict(made, lines, { first: all.slice(0, 100), all: again, filtered })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('a line is shown twice')
  })

  it('fails when the filter leaves other kinds', () => {
    const v = statementPagingVerdict(made, lines, { first: all.slice(0, 100), all, filtered: all.slice(1, 3) })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('still shows "Funded by the workspace"')
  })
})
