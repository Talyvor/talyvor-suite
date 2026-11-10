import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, CardHeader, Input, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Note, dayAfter, monthPeriod, readFailure, saveFile } from './AgentBank'
import { AgentBankError, agentBankApi, formatMinor, refusalText, type Agent, type CurrencyAccount, type MoneyStatementLine } from './agentBankApi'
import { formatWhen } from './format'
import { Lxc } from './money'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'

// B56.15 — Statements for the dollar, pound, euro and USDC accounts (Lens B56.14), beside each agent's credit statement:
// a period's opening, money in, money out and balance, every posting to the account, and Download CSV. And, under an
// agent's credit statement, what it put on the company's marketplace bill, which moves no balance of its own.

/** "Company · USD", "Research · EUR": the tab and the header of a currency account's statement. An agent the book does
 *  not list reads "Agent". */
export function accountTitle(a: CurrencyAccount, agents: readonly Agent[]): string {
  const owner = a.purpose === 'agent' && a.agent_id ? (agents.find((x) => x.id === a.agent_id)?.name ?? 'Agent') : 'Company'
  return `${owner} · ${a.currency}`
}

const KIND_WORDS: Record<string, string> = {
  payment_in: 'Paid in',
  payment_out: 'Paid out',
  invoice_payment: 'Invoice paid',
  mandate_pull: 'Collected under a mandate',
  card_charge: 'Card payment',
  payout: 'Paid out',
  return: 'Returned',
  test_money: 'Paid in',
}

/** What a line was, in words: its kind, then who it was from or to. */
function lineWhat(l: MoneyStatementLine): string {
  const kind = KIND_WORDS[l.kind] ?? `${l.kind.charAt(0).toUpperCase()}${l.kind.slice(1).replace(/_/g, ' ')}`
  const who = l.counterparty.startsWith('workspace:') ? 'the company' : l.counterparty
  return [who ? `${kind} · ${who}` : kind, l.memo].filter(Boolean).join(' · ')
}

export function AccountStatement({ account, title }: { account: CurrencyAccount; title: string }) {
  const [period, setPeriod] = useState(() => monthPeriod('this'))
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.through) && period.from <= period.through
  const to = valid ? dayAfter(period.through) : ''
  const st = useQuery({
    queryKey: ['money-account-statement', account.id, period.from, to],
    queryFn: () => agentBankApi.accountStatement(account.id, period.from, to),
    enabled: valid,
  })
  const get = useMutation({
    mutationFn: async () => {
      const name = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-statement-${period.from}-to-${period.through}.csv`
      saveFile(name, await agentBankApi.accountStatementFile(account.id, period.from, to))
      return name
    },
  })
  const money = (minor: number) => formatMinor(minor, account.currency)
  const lines = st.data?.lines ?? []
  return (
    <Card>
      <CardHeader aside={<WorkspaceLabel capability={CURRENCY_ACCOUNT} />}>{title}</CardHeader>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-gutter py-3">
        <Button type="button" onClick={() => setPeriod(monthPeriod('this'))}>
          This month
        </Button>
        <Button type="button" onClick={() => setPeriod(monthPeriod('last'))}>
          Last month
        </Button>
        <Input
          type="date"
          aria-label={`First day of ${title}’s statement`}
          className="w-40 font-figure"
          value={period.from}
          onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
        />
        <span className="text-caption text-muted">to</span>
        <Input
          type="date"
          aria-label={`Last day of ${title}’s statement`}
          className="w-40 font-figure"
          value={period.through}
          onChange={(e) => setPeriod((p) => ({ ...p, through: e.target.value }))}
        />
        <Button type="button" variant="primary" disabled={!valid || get.isPending} onClick={() => get.mutate()}>
          {get.isPending ? 'Preparing…' : 'Download CSV'}
        </Button>
      </div>
      {!valid ? (
        <div className="px-gutter py-3">
          <Note ok={false}>Choose a first day on or before the last day.</Note>
        </div>
      ) : st.isError ? (
        <p className="px-gutter py-3 text-body text-muted">
          {st.error instanceof AgentBankError && st.error.status < 500 && st.error.sentence
            ? refusalText(st.error)
            : readFailure(st.error, 'This account’s statement')}
        </p>
      ) : st.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 border-b border-rule px-gutter py-3 wide:grid-cols-4" data-testid="account-statement-band">
            {[
              ['Opening', money(st.data.opening_minor)],
              ['Money in', money(st.data.in_minor)],
              ['Money out', `${st.data.out_minor > 0 ? '−' : ''}${money(st.data.out_minor)}`],
              ['Balance', money(st.data.closing_minor)],
            ].map(([label, figure]) => (
              <div key={label}>
                <dt className="text-caption text-muted">{label}</dt>
                <dd className="font-figure text-body text-ink">{figure}</dd>
              </div>
            ))}
          </dl>
          {lines.length === 0 ? (
            <p className="px-gutter py-3 text-body text-muted">
              Nothing moved in this account in this period. Payments in on{' '}
              <Link className={`text-ink ${inlineLink}`} to="/money/invoices">
                Invoices
              </Link>{' '}
              and out on{' '}
              <Link className={`text-ink ${inlineLink}`} to="/money/pay">
                Pay
              </Link>{' '}
              show here.
            </p>
          ) : (
            <table className="w-full text-body" data-testid="account-statement">
              <thead>
                <tr className="text-left text-caption text-muted">
                  <th className="px-gutter py-2 font-normal">When</th>
                  <th className="py-2 font-normal">What</th>
                  <th className="py-2 text-right font-normal">Amount</th>
                  <th className="px-gutter py-2 text-right font-normal">Balance</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.entry_id}-${l.line}`} className="border-t border-rule text-ink">
                    <td className="px-gutter py-2 font-figure text-caption text-muted">{formatWhen(l.at)}</td>
                    <td className="py-2">{lineWhat(l)}</td>
                    <td className="whitespace-nowrap py-2 text-right font-figure">
                      {l.amount_minor > 0 ? '+' : '−'}
                      {money(Math.abs(l.amount_minor))}
                    </td>
                    <td className="whitespace-nowrap px-gutter py-2 text-right font-figure">{money(l.balance_after_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {get.isSuccess ? (
        <div className="border-t border-rule px-gutter py-3">
          <Note ok>Saved {get.data}.</Note>
        </div>
      ) : null}
      {get.isError ? (
        <div className="border-t border-rule px-gutter py-3">
          <Note ok={false}>
            {get.error instanceof AgentBankError && get.error.status < 500 ? refusalText(get.error) : readFailure(get.error, 'The statement')}
          </Note>
        </div>
      ) : null}
    </Card>
  )
}

/** What an agent put on the company's marketplace bill this month: each line says so, and none moves its balance. */
export function MarketplaceBill({ agent }: { agent: Agent }) {
  const period = monthPeriod('this')
  const to = dayAfter(period.through)
  const bill = useQuery({
    queryKey: ['agent-marketplace-bill', agent.id, period.from, to],
    queryFn: () => agentBankApi.marketplaceBill(agent.id, period.from, to),
  })
  if (bill.isError) return <p className="text-body text-muted">{readFailure(bill.error, 'What this agent put on the marketplace bill')}</p>
  const lines = bill.data?.marketplace_bill ?? []
  if (lines.length === 0) return null
  return (
    <Card>
      <CardHeader>On the marketplace bill this month</CardHeader>
      <table className="w-full text-body" data-testid="marketplace-bill-lines">
        <tbody>
          {lines.map((l) => (
            <tr key={l.use_id} className="border-t border-rule text-ink first:border-t-0">
              <td className="px-gutter py-2 font-figure text-caption text-muted">{formatWhen(l.at)}</td>
              <td className="py-2">{[l.memo, l.label].filter(Boolean).join(' · ')}</td>
              <td className="px-gutter py-2 text-right font-figure">
                <Lxc ulxc={l.amount_ulxc} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
