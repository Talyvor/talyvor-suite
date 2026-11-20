import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Logo, inlineLink } from '@talyvor/ui'
import { Button, Card as PocketCard, Icon, KindTile, Money, Row, pocketFocusRing, showToast } from '@talyvor/ui/pocket'
import { dayAfter, monthPeriod, readFailure, saveFile } from './AgentBank'
import { AgentFace } from './AgentFace'
import { lineWhen } from './AgentStatement'
import { AgentBankError, agentBankApi, refusalText, type Agent, type CurrencyAccount, type MoneyStatementLine } from './agentBankApi'
import { DisputePayment } from './CardDisputes'
import { InstantLegs, groupInstant } from './InstantTransferReceipt'
import { DESIGN_ATTR } from '../../pocketPending'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'

// B56.15 — Statements for the dollar, pound, euro and USDC accounts (Lens B56.14): a period's opening, money in, money
// out and balance, every posting to the account, and Download CSV. B61.55: the agents' credit statements, and the
// marketplace bill under them, are parked.
// B57.25 — a currency account's statement as the reference draws it (w-stmt-cusd, w-stmt-rausd): a document card with
// the agent's face or the company's tile, this month so far in the account's own currency, the band, its lines newest
// first, and the way back to Accounts on Invoices. Download CSV sits at the top of Statements, as an agent's does.

/** Whose account it is: "Company", or the agent's name. An agent the book does not list reads "Agent". */
export function accountOwner(a: CurrencyAccount, agents: readonly Agent[]): string {
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

/** A line's kind in words: "Card payment", "Paid in". B61.2's Activity names its rows with them too. */
export const kindWords = (kind: string) => KIND_WORDS[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1).replace(/_/g, ' ')}`

/** What a line was: who it was from or to, then in faint words its kind and memo. With nobody named, its kind leads. */
function lineWhat(l: MoneyStatementLine): [string, string] {
  const kind = kindWords(l.kind)
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

/** B30.95 — how many months Monthly statements lists, this one first. */
export const STATEMENT_MONTHS = 12

/** This month and the ones before it, newest first: each its first UTC day, the day its period ends before, and its name. */
export function statementMonths(now = new Date(), count = STATEMENT_MONTHS): Array<{ from: string; to: string; name: string; current: boolean }> {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1))
    return {
      from: day(start),
      to: i === 0 ? dayAfter(day(now)) : day(end),
      name: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      current: i === 0,
    }
  })
}

/**
 * B30.95 — a currency account's monthly statements: this month so far and each month before it, every one the PDF
 * document Lens writes (Lens B30.23), named for the account and the month.
 */
export function MonthlyStatements({ account, title }: { account: CurrencyAccount; title: string }) {
  const [, inWords] = currencyWords(account.currency)
  const months = statementMonths()
  const file = useMutation({
    mutationFn: async (m: (typeof months)[number]) => {
      const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      saveFile(`${stem}-statement-${m.from.slice(0, 7)}.pdf`, await agentBankApi.accountStatementFile(account.id, m.from, m.to, 'pdf'))
      return m
    },
    onSuccess: (m) => showToast(`Downloading the ${title} statement for ${m.name} as a PDF file`),
  })
  return (
    <PocketCard tone="white" data-testid="monthly-statements" {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-2 p-5 wide:px-7 wide:py-6">
      <div>
        <h2 className="font-display text-title font-extrabold leading-none text-ink">Monthly statements</h2>
        <p className="mt-1 text-body text-ink-2">Each month of this account as a PDF, in {inWords}.</p>
      </div>
      <div>
        {months.map((m) => (
          <Row
            key={m.from}
            title={m.current ? `${m.name}, so far` : m.name}
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="download" />}
                aria-label={`Download PDF for ${m.name}`}
                disabled={file.isPending}
                onClick={() => file.mutate(m)}
              >
                Download PDF
              </Button>
            }
          />
        ))}
      </div>
      {file.isError ? (
        <p className="text-body text-ink-2">
          {file.error instanceof AgentBankError && file.error.status < 500 && file.error.sentence
            ? refusalText(file.error)
            : readFailure(file.error, 'The statement')}
        </p>
      ) : null}
    </PocketCard>
  )
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
                {groupInstant(lines).map((row) => {
                  // B59.19 — an Instant transfer is one line, which opens its legs.
                  if ('transfer' in row) return <InstantRow key={row.transfer} row={row} currency={account.currency} when={lineWhen(row.lines[0].at, now)} />
                  const l = row.line
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
                            <DisputePayment
                              paymentID={l.partner_ref}
                              payment={{ what, when: lineWhen(l.at, now), minor: l.amount_minor, currency: account.currency }}
                            />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pl-4 text-right">
                        <Money minor={l.amount_minor} currency={account.currency} signed />
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
        <span className="text-micro text-ink-3">Payments in and out of this account.</span>
        <Button asChild variant="secondary" size="sm">
          <Link to="/money/invoices">Accounts, on Invoices</Link>
        </Button>
      </div>
    </PocketCard>
  )
}

/** B59.19 — an Instant transfer's lines as one: "Instant transfer to Lumen Freight GmbH", its total, and its legs when opened. */
function InstantRow({ row, currency, when }: { row: { transfer: string; to: string; amount_minor: number }; currency: string; when: string }) {
  const [open, setOpen] = useState(false)
  return (
    <tr className="border-t border-line text-ink" data-testid="account-statement-instant">
      <td className="hidden whitespace-nowrap py-2.5 align-top text-ink-3 wide:table-cell">{when}</td>
      <td className="py-2.5 wide:pl-4">
        <button
          type="button"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 text-left font-semibold ${pocketFocusRing}`}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chev" size={14} className={open ? 'rotate-90' : ''} />
          Instant transfer{row.to ? ` to ${row.to}` : ''}
        </button>
        <span className="block text-micro text-ink-3 wide:hidden">{when}</span>
        {open ? (
          <div className="mt-2 pl-5">
            <InstantLegs transfer={row.transfer} />
          </div>
        ) : null}
      </td>
      <td className="py-2.5 pl-4 text-right align-top">
        <Money minor={row.amount_minor} currency={currency} signed />
      </td>
    </tr>
  )
}
