import { type SafeToSpendFigure } from './agentBankApi'
import { type Fiat, Lxc, fiatText } from './money'

// B41.5 — Lens's safe-to-spend figure (B41.105) as a person reads it: the balance, less this month's scheduled payments,
// bills due and payments waiting for approval. Home shows the company's; Chat answers "How much can <agent> spend?".

/** One amount in its own currency: LXC in µLXC, GBP, EUR and USD in minor units. A figure may be negative. */
export function SafeAmount({ currency, amount }: { currency: string; amount: number }) {
  if (currency === 'LXC') return <Lxc ulxc={amount} />
  return (
    <span className="whitespace-nowrap font-figure">
      {amount < 0 ? '-' : ''}
      {fiatText(Math.abs(amount) / 100, currency as Fiat)}
    </span>
  )
}

/** What the figure is made of, in one line. */
export function SafeBreakdown({ figure: f }: { figure: SafeToSpendFigure }) {
  const a = (n: number) => <SafeAmount currency={f.currency} amount={n} />
  return (
    <>
      {a(f.balance)} held, less {a(f.scheduled)} scheduled, {a(f.bills_due)} in bills due and {a(f.pending_approvals)} waiting for approval
    </>
  )
}
