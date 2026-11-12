import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CardHeader, Logo, inlineLink } from '@talyvor/ui'
import { Button, Card as PocketCard, Icon, KindTile, Money, pocketFocusRing, showToast } from '@talyvor/ui/pocket'
import { Card } from './walletBrand'
import { dayAfter, monthPeriod, readFailure, saveFile } from './AgentBank'
import { AgentFace } from './AgentFace'
import { lineWhen } from './AgentStatement'
import { AgentBankError, agentBankApi, refusalText, type Agent, type CurrencyAccount, type MoneyStatementLine } from './agentBankApi'
import { formatWhen } from './format'
import { Lxc } from './money'
import { DisputePayment } from './CardDisputes'
import { DESIGN_ATTR } from '../../pocketPending'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'

// B56.15 — Statements for the dollar, pound, euro and USDC accounts (Lens B56.14), beside each agent's credit statement:
// a period's opening, money in, money out and balance, every posting to the account, and Download CSV. And, under an
// agent's credit statement, what it put on the company's marketplace bill, which moves no balance of its own.
// B57.25 — a currency account's statement as the reference draws it (w-stmt-cusd, w-stmt-rausd): a document card with
// the agent's face or the company's tile, this month so far in the account's own currency, the band, its lines newest
// first, and the way back to Accounts on Invoices. Download CSV sits at the top of Statements, as an agent's does.

/** Whose account it is: "Company", or the agent's name. An agent the book does not list reads "Agent". */
function accountOwner(a: CurrencyAccount, agents: readonly Agent[]): string {
  return a.purpose === 'agent' && a.agent_id ? (agents.find((x) => x.id === a.agent_id)?.name ?? 'Agent') : 'Company'
}

/** "Company · USD", "Research · EUR": the tab and the file's name. */
export function accountTitle(a: CurrencyAccount, agents: readonly Agent[]): string {
  return `${accountOwner(a, agents)} · ${a.currency}`
}

/** A currency in words: the account it names, and what its statement is in. */
const CURRENCY_WORDS: Record<string, [string, string]> = {
  USD: ['US dollar', 'US dollars'],
  GBP: ['pound', 'pounds'],
  EUR: ['euro', 'euros'],
}
const currencyWords = (c: string): [string, string] => CURRENCY_WORDS[c] ?? [c, c]

const KIND_WORDS: Record<string, string> = {
  payment_in: 'Paid in',
  payment_out: 'Paid out',
  invoice_payment: 'Invoice paid',
  mandate_pull: 'Collected under a mandate',
  card_charge: 'Card payment',
  // B59.25 — what came back of a card payment: a merchant's refund, or a dispute the issuer decided for the owner.
  card_refund: 'Refund',
  card_dispute_won: 'Dispute won',
  payout: 'Paid out',
  return: 'Returned',
  test_money: 'Paid in',
}

/** What a line was: who it was from or to, then in faint words its kind and memo. With nobody named, its kind leads. */
function lineWhat(l: MoneyStatementLine): [string, string] {
  const kind = KIND_WORDS[l.kind] ?? `${l.kind.charAt(0).toUpperCase()}${l.kind.slice(1).replace(/_/g, ' ')}`
  const who = l.counterparty.startsWith('workspace:') ? 'The company' : l.counterparty
  return who ? [who, [kind, l.memo].filter(Boolean).join(' · ')] : [kind, l.memo ?? '']
}

/** This month so far for one currency account, as Lens's CSV: one row per posting. */
export function useAccountMonthCsv(account: CurrencyAccount | null, title: string) {
  return useMutation({
    mutationFn: async () => {
      if (account === null) return ''
      const { from, through } = monthPeriod('this')
      const name = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-statement-${from}-to-${through}.csv`
      saveFile(name, await agentBankApi.accountStatementFile(account.id, from, dayAfter(through)))
      return name
    },
    onSuccess: () => {
      const month = new Date().toLocaleDateString('en-GB', { month: 'long' })
      showToast(`Downloading the ${title} statement for ${month} as a CSV file`)
    },
  })
}

export function AccountStatement({ account, agent }: { account: CurrencyAccount; agent: Agent | null }) {
  const { from, through } = monthPeriod('this')
  const to = dayAfter(through)
  const st = useQuery({
    queryKey: ['money-account-statement', account.id, from, to],
    queryFn: () => agentBankApi.accountStatement(account.id, from, to),
  })
  const [unit, inWords] = currencyWords(account.currency)
  const owner = agent?.name ?? accountOwner(account, [])
  const monthStart = new Date(`${from}T00:00:00Z`)
  const month = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const opened = monthStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  // Lens lists the period oldest first, each line with the balance after it; the document reads newest first.
  const lines = [...(st.data?.lines ?? [])].sort((a, b) => b.at.localeCompare(a.at) || b.line - a.line)
  const now = new Date()

  return (
    <PocketCard tone="white" data-testid="account-statement-doc" {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-4 p-5 wide:px-7 wide:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {agent ? (
            <Link to={`/agents?agent=${encodeURIComponent(agent.id)}`} aria-label={`Open ${agent.name}`} className={`rounded-pill ${pocketFocusRing}`}>
              <AgentFace agent={agent} size={44} />
            </Link>
          ) : (
            <KindTile on="white" icon={<Icon name="billing" />} />
          )}
          <div>
            <h2 className="font-display text-title font-extrabold leading-none text-ink">
              {owner} · {unit} account
            </h2>
            <p className="mt-1 text-body text-ink-2">
              Statement · {month}, so far · in {inWords}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <WorkspaceLabel capability={CURRENCY_ACCOUNT} />
          <Logo width={120} />
        </div>
      </div>
      {st.isError ? (
        <p className="text-body text-ink-2">
          {st.error instanceof AgentBankError && st.error.status < 500 && st.error.sentence
            ? refusalText(st.error)
            : readFailure(st.error, 'This account’s statement')}
        </p>
      ) : st.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 rounded-card-tight bg-cloud px-4 py-3.5 wide:grid-cols-4" data-testid="account-statement-band">
            {(
              [
                [`Opening, ${opened}`, st.data.opening_minor, false, ''],
                ['Money in', st.data.in_minor, true, 'text-success'],
                ['Money out', -st.data.out_minor, false, ''],
                ['Balance now', st.data.closing_minor, false, ''],
              ] as const
            ).map(([label, minor, signed, tone]) => (
              <div key={label} className="grid content-end gap-0.5">
                <dt className="text-micro font-semibold text-ink-3">{label}</dt>
                <dd className="grid justify-items-start gap-0.5">
                  <Money minor={minor} currency={account.currency} signed={signed} className={`font-display text-head font-bold ${minor > 0 ? tone : ''}`} />
                  <span className="text-micro font-semibold text-ink-3">{account.currency}</span>
                </dd>
              </div>
            ))}
          </dl>
          {lines.length === 0 ? (
            <p className="text-body text-ink-2">
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
            <table className="w-full border-collapse text-body" data-testid="account-statement">
              <thead>
                <tr className="text-left font-semibold text-ink-3">
                  <th className="hidden py-1.5 font-semibold wide:table-cell">When</th>
                  <th className="py-1.5 font-semibold wide:pl-4">What</th>
                  <th className="py-1.5 pl-4 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const [what, detail] = lineWhat(l)
                  return (
                    <tr key={`${l.entry_id}-${l.line}`} className="border-t border-line text-ink">
                      <td className="hidden whitespace-nowrap py-2.5 text-ink-3 wide:table-cell">{lineWhen(l.at, now)}</td>
                      <td className="py-2.5 wide:pl-4">
                        <span data-testid="account-statement-what">
                          {what}
                          {detail ? <span className="text-ink-3"> · {detail}</span> : null}
                        </span>
                        {/* On a phone the time goes under the words, so the line keeps its width. */}
                        <span className="block text-micro text-ink-3 wide:hidden">{lineWhen(l.at, now)}</span>
                        {/* B59.25 — a card payment is disputed from its line, and says where its dispute stands. */}
                        {l.kind === 'card_charge' && l.partner_ref ? (
                          <span className="mt-1 block">
                            <DisputePayment paymentID={l.partner_ref} />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pl-4 text-right">
                        <Money minor={l.amount_minor} currency={account.currency} signed className={l.amount_minor > 0 ? 'text-success' : ''} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-micro text-ink-3">Payments in and out of this account. An agent’s LXC is on its own statement.</span>
        <Button asChild variant="secondary" size="sm">
          <Link to="/money/invoices">Accounts, on Invoices</Link>
        </Button>
      </div>
    </PocketCard>
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
