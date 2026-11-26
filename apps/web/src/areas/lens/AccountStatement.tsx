import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Logo, cn, playSound } from '@talyvor/ui'
import { Button, Chip, Eyebrow, Icon, Money, pocketFocusRing, showToast, useDoneTick } from '@talyvor/ui/pocket'
import { readFailure, saveFile } from './AgentBank'
import { DownloadFailed, lineWhen } from './AgentStatement'
import { AgentBankError, agentBankApi, formatMinor, refusalText, type Agent, type CurrencyAccount, type MoneyStatementLine } from './agentBankApi'
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
// B61.134 — Statements as one sheet of paper (Pocket Live DESIGN.md 16.2): the statement for one balance or one agent
// over one period, the twin of the PDF Lens writes, and its three files, PDF, Excel and CSV, each named as 16.1 says.

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
  GBP: ['British pound', 'pounds'],
  EUR: ['Euro', 'euros'],
  USDC: ['USDC', 'USDC'],
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
  // B61.134 — DESIGN.md 16.1: a payout is a Withdrawal.
  payout: 'Withdrawal',
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


/** B61.134 — one period a statement can be for (DESIGN.md 16.1): [from, to) as YYYY-MM-DD at midnight UTC. */
export interface StatementPeriod {
  id: string
  /** The paper's title: "November so far", "October 2026", "Last 3 months", "2026 so far". */
  name: string
  /** Its dates in words: "1 to 31 October 2026". */
  range: string
  from: string
  to: string
  /** It runs to today, so its last figure is the balance now. */
  toToday: boolean
}

/** How far back the months go when the account does not say when it opened. */
const STATEMENT_MONTHS = 12

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const utcMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1))
const dayOf = (d: string) => new Date(`${d}T00:00:00Z`)

/** The last day [from, to) covers. */
function lastDay(from: string, to: string): string {
  const t = dayOf(to)
  t.setUTCDate(t.getUTCDate() - 1)
  return isoDay(t) < from ? from : isoDay(t)
}

/** [from, to) in words: "1 to 31 October 2026", "1 August to 31 October 2026", "1 December 2025 to 28 February 2026". */
export function periodWords(from: string, to: string): string {
  const a = dayOf(from)
  const z = dayOf(lastDay(from, to))
  const words = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })
  const full = words(z, { day: 'numeric', month: 'long', year: 'numeric' })
  if (a.getUTCFullYear() !== z.getUTCFullYear()) return `${words(a, { day: 'numeric', month: 'long', year: 'numeric' })} to ${full}`
  if (a.getUTCMonth() !== z.getUTCMonth()) return `${words(a, { day: 'numeric', month: 'long' })} to ${full}`
  return `${a.getUTCDate()} to ${full}`
}

/**
 * The periods on offer, no date picker (DESIGN.md 16.1): this month so far, each full month back to the month the account
 * opened, the last 3 months and this year so far.
 */
export function statementPeriods(opened: string | undefined, now = new Date()): StatementPeriod[] {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const at = opened ? new Date(opened) : null
  const first = at && !Number.isNaN(at.getTime()) ? utcMonth(at.getUTCFullYear(), at.getUTCMonth()) : utcMonth(y, m - (STATEMENT_MONTHS - 1))
  const thisMonth = utcMonth(y, m)
  const tomorrow = new Date(Date.UTC(y, m, now.getUTCDate() + 1))
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
  const out: Omit<StatementPeriod, 'range'>[] = [{ id: 'month', name: `${month(thisMonth)} so far`, from: isoDay(thisMonth), to: isoDay(tomorrow), toToday: true }]
  for (let k = 1; utcMonth(y, m - k) >= first; k++) {
    const start = utcMonth(y, m - k)
    out.push({ id: isoDay(start).slice(0, 7), name: `${month(start)} ${start.getUTCFullYear()}`, from: isoDay(start), to: isoDay(utcMonth(y, m - k + 1)), toToday: false })
  }
  const since = (d: Date) => (d < first ? first : d)
  if (since(utcMonth(y, m - 3)) < thisMonth)
    out.push({ id: 'last-3-months', name: 'Last 3 months', from: isoDay(since(utcMonth(y, m - 3))), to: isoDay(thisMonth), toToday: false })
  out.push({ id: 'year', name: `${y} so far`, from: isoDay(since(utcMonth(y, 0))), to: isoDay(tomorrow), toToday: true })
  return out.map((p) => ({ ...p, range: periodWords(p.from, p.to) }))
}

/**
 * A statement file's name without its type (DESIGN.md 16.1, as Lens names its own): talyvor-statement-USD-2026-10 for a
 * whole month or a month so far, talyvor-statement-USD-2026-08-01-to-2026-10-31 otherwise, with the agent's name before
 * the currency on an agent's statement.
 */
export function statementFileName(agent: string, currency: string, from: string, to: string): string {
  const slug = agent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const start = dayOf(from)
  const whole = start.getUTCDate() === 1 && to <= isoDay(utcMonth(start.getUTCFullYear(), start.getUTCMonth() + 1))
  return ['talyvor-statement', slug, currency, whole ? from.slice(0, 7) : `${from}-to-${lastDay(from, to)}`].filter(Boolean).join('-')
}

/** The three files, as the Download card names them (DESIGN.md 16.2). */
export const STATEMENT_FILES = [
  { format: 'pdf', name: 'PDF', line: 'Branded, ready to print or send', icon: 'doc' },
  { format: 'xlsx', name: 'Excel', line: 'A sheet with totals that add up', icon: 'sheet' },
  { format: 'csv', name: 'CSV', line: 'Plain rows for accounting tools', icon: 'rows' },
] as const
export type StatementFileFormat = (typeof STATEMENT_FILES)[number]['format']

/** The balance's name: "US dollar balance", "USDC balance". */
export const balanceName = (currency: string) => `${currencyWords(currency)[0]} balance`

/** Download: the statement on the paper as a PDF (the main button), an Excel sheet or a CSV, and the toast names the file. */
export function StatementDownloads({ account, agentName, period }: { account: CurrencyAccount; agentName: string; period: StatementPeriod }) {
  const tick = useDoneTick()
  const [pressed, setPressed] = useState<StatementFileFormat | null>(null)
  const file = useMutation({
    mutationFn: async (format: StatementFileFormat) => {
      const name = `${statementFileName(agentName, account.currency, period.from, period.to)}.${format}`
      saveFile(name, await agentBankApi.accountStatementFile(account.id, period.from, period.to, format))
      return name
    },
    onMutate: (format) => setPressed(format),
    onSuccess: (name) => {
      playSound('tick')
      showToast(`Saved ${name}`)
      tick.finish(() => setPressed(null))
    },
    onError: () => playSound('refused'),
  })
  return (
    <div className="pk-card rounded-card bg-cloud p-5" data-testid="statement-download">
      <h3 className="font-display text-reading font-bold text-ink">Download</h3>
      <div className="mt-3 grid gap-2">
        {STATEMENT_FILES.map((f) => (
          <Button
            key={f.format}
            type="button"
            variant={f.format === 'pdf' ? 'primary' : 'secondary'}
            aria-label={`Download ${f.name}`}
            className="h-13.5 w-full justify-start gap-2.5 px-4"
            disabled={file.isPending}
            done={tick.done && pressed === f.format}
            onClick={() => file.mutate(f.format)}
          >
            <Icon name={f.icon} size={18} />
            <b className="font-semibold">{f.name}</b>
            <small className="truncate text-caption font-medium opacity-80">{f.line}</small>
          </Button>
        ))}
      </div>
      <p className="mt-2.5 text-caption font-medium text-ink-3">All three carry the same lines and the same totals.</p>
      {file.isError ? (
        <div className="mt-2 flex items-start gap-1.5 text-ink">
          <Icon name="x" size={16} className="mt-0.5" />
          <DownloadFailed error={file.error} />
        </div>
      ) : null}
    </div>
  )
}

/** The nine tangerine stream lines behind the paper's top right corner, fading to the left (DESIGN.md 16.2, ST_STREAMS). */
function PaperStreams() {
  return (
    <svg
      viewBox="0 0 300 150"
      aria-hidden="true"
      data-tangerine="brand"
      className="pointer-events-none absolute right-0 top-0 h-auto stroke-tangerine"
      style={{ width: '64%', opacity: 0.62, fill: 'none', maskImage: 'linear-gradient(to left, #000, transparent 94%)', WebkitMaskImage: 'linear-gradient(to left, #000, transparent 94%)' }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <path
          key={i}
          d={`M300 ${8 + i * 13.5} C 228 ${8 + i * 13.5}, 150 ${34 + i * 5.4}, 0 ${58 + i * 1.4}`}
          strokeWidth={i % 3 ? 1.1 : 1.5}
          opacity={(0.9 - (i % 4) * 0.14).toFixed(2)}
        />
      ))}
    </svg>
  )
}

/** A figure in a column: no currency sign, no minus, as the PDF's columns write it. */
function plainFigure(minor: number, currency: string): string {
  return formatMinor(Math.abs(minor), currency).replace(/^[^\d]+/, '').replace(/\s+\D+$/, '')
}

/** How many lines the paper shows before See all. */
export const PAPER_LINES = 10

const COLUMNS = 'grid grid-cols-statement-line gap-2.5 wide:grid-cols-statement-line-wide'

/** "03 Oct" over "10:41": a line's day and its time, in UTC as the files write them. */
function LineDate({ at }: { at: string }) {
  const d = new Date(at)
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return (
    <span className="grid content-center leading-tight">
      <b className="text-body font-semibold text-ink">{day}</b>
      <small className="font-figure text-caption font-medium text-ink-3">{time}</small>
    </span>
  )
}

/** Money out, Money in and the balance after, as three columns; on a phone the amount and the balance under it. */
function LineFigures({ minor, balance, currency }: { minor: number; balance: number; currency: string }) {
  return (
    <>
      <span role="cell" className="hidden text-right font-figure text-reading text-ink wide:block">{minor < 0 ? plainFigure(minor, currency) : ''}</span>
      <span role="cell" className="hidden text-right font-figure text-reading text-ink wide:block">{minor > 0 ? plainFigure(minor, currency) : ''}</span>
      <span role="cell" className="hidden text-right font-figure text-reading font-semibold text-ink wide:block">{plainFigure(balance, currency)}</span>
      <span role="cell" className="grid justify-items-end wide:hidden">
        <Money minor={minor} currency={currency} signed />
        <Money minor={balance} currency={currency} className="text-caption font-medium text-ink-3" />
      </span>
    </>
  )
}

/**
 * B61.134 — the statement as one sheet of paper, the twin of the PDF (DESIGN.md 16.2): the logo and the Sandbox chip,
 * the streams in its corner, STATEMENT, the period as its title, the balance and its dates, the four figures with the
 * closing one on ink, then the lines oldest first in five columns, ten of them and See all, and how it adds up.
 */
export function AccountStatement({ account, agent, period = statementPeriods(account.created_at)[0] }: { account: CurrencyAccount; agent: Agent | null; period?: StatementPeriod }) {
  const st = useQuery({
    queryKey: ['money-account-statement', account.id, period.from, period.to],
    queryFn: () => agentBankApi.accountStatement(account.id, period.from, period.to),
  })
  const [all, setAll] = useState(false)
  const cur = account.currency
  const whose = agent ? `${agent.name} · ${balanceName(cur)}` : account.purpose === 'agent' ? `${accountOwner(account, [])} · ${balanceName(cur)}` : balanceName(cur)
  // Lens lists the period oldest first, each line with the balance after it, and the paper reads it in that order.
  const rows = groupInstant(st.data?.lines ?? [])
  const shown = all ? rows : rows.slice(0, PAPER_LINES)
  const now = new Date()

  return (
    <section
      aria-label={`Statement, ${period.name}`}
      data-testid="account-statement-doc"
      {...{ [DESIGN_ATTR]: 'pocket' }}
      className="pk-paper relative overflow-hidden rounded-card bg-page shadow-pocket px-4 pb-1 pt-4.5 wide:px-6.5 wide:pb-1.5 wide:pt-6.5"
    >
      <PaperStreams />
      <div className="relative mb-5 flex items-center justify-between gap-3 wide:mb-6.5">
        <Logo width={132} />
        <WorkspaceLabel capability={CURRENCY_ACCOUNT} />
      </div>
      <Eyebrow className="relative block">Statement</Eyebrow>
      <h2 className="relative mt-1 font-display text-pocket-question font-extrabold leading-none text-ink" data-testid="statement-title">
        {period.name}
      </h2>
      <p className="relative mt-1.5 text-body text-ink-2" data-testid="statement-for">
        {whose} · {period.range}
      </p>
      {st.isError ? (
        <p className="relative my-6 text-body text-ink-2">
          {st.error instanceof AgentBankError && st.error.status < 500 && st.error.sentence ? refusalText(st.error) : readFailure(st.error, 'This account’s statement')}
        </p>
      ) : st.isPending ? (
        <p className="relative my-6 text-body text-ink-2">Reading…</p>
      ) : (
        <>
          <dl className="relative mb-1 mt-4 grid grid-cols-2 rounded-card-tight bg-cloud wide:mb-2 wide:mt-5 wide:grid-cols-statement-band" data-testid="account-statement-band">
            {(
              [
                ['Opening balance', st.data.opening_minor],
                ['Money in', st.data.in_minor],
                ['Money out', st.data.out_minor],
              ] as const
            ).map(([label, minor]) => (
              <div key={label} className="grid min-w-0 gap-1.5 px-3.5 py-3 wide:px-4 wide:py-3.5">
                <dt className="whitespace-nowrap">
                  <Eyebrow className="text-ink-2">{label}</Eyebrow>
                </dt>
                <dd>
                  <Money minor={minor} currency={cur} className="font-display text-head font-bold" />
                </dd>
              </div>
            ))}
            <div className="grid min-w-0 gap-1.5 rounded-inset bg-primary px-3.5 py-3 text-on-primary wide:px-4 wide:py-3.5" data-testid="statement-closing">
              <dt className="flex items-center gap-1.5 whitespace-nowrap">
                <i className="h-1.75 w-1.75 shrink-0 rounded-pill bg-tangerine" data-tangerine="brand" aria-hidden="true" />
                {/* Pocket's eyebrow in the ink tile's own colour: Eyebrow's third ink is for the page. */}
                <span className="text-pocket-eyebrow uppercase text-on-primary">{period.toToday ? 'Balance now' : 'Closing balance'}</span>
              </dt>
              <dd>
                <Money minor={st.data.closing_minor} currency={cur} className="font-display text-head font-bold text-on-primary" />
              </dd>
            </div>
          </dl>
          {rows.length === 0 ? (
            <p className="border-t border-line py-7 text-center text-body text-ink-2">Nothing moved in this period.</p>
          ) : (
            <div role="table" aria-label={`Lines, ${period.name}`} data-testid="account-statement">
              <div role="row" className={cn(COLUMNS, 'hidden min-h-8.5 items-center border-b border-ink wide:grid')}>
                {['Date', 'Details', 'Money out', 'Money in', 'Balance'].map((h, i) => (
                  <Eyebrow key={h} role="columnheader" className={cn('text-ink-2', i > 1 && 'text-right')}>
                    {h}
                  </Eyebrow>
                ))}
              </div>
              <div role="rowgroup" className="divide-y divide-line border-t border-line wide:border-t-0">
                {shown.map((row) =>
                  'transfer' in row ? (
                    <InstantRow key={row.transfer} row={row} currency={cur} />
                  ) : (
                    <PaperLine key={`${row.line.entry_id}-${row.line.line}`} l={row.line} currency={cur} now={now} />
                  ),
                )}
              </div>
            </div>
          )}
          {rows.length > shown.length ? (
            <button
              type="button"
              className={cn('flex h-12 w-full items-center justify-center gap-1 border-t border-line text-body font-semibold text-ink', pocketFocusRing)}
              onClick={() => setAll(true)}
            >
              See all {rows.length} lines
              <Icon name="chev" size={16} />
            </button>
          ) : (
            <p className="border-t border-line pb-3 pt-3.5 font-figure text-caption font-medium text-ink-2" data-testid="statement-adds-up">
              <Money minor={st.data.opening_minor} currency={cur} className="font-medium" /> opening + <Money minor={st.data.in_minor} currency={cur} className="font-medium" /> in −{' '}
              <Money minor={st.data.out_minor} currency={cur} className="font-medium" /> out ={' '}
              <b className="border-b-2 border-tangerine pb-px text-ink" data-tangerine="brand">
                <Money minor={st.data.closing_minor} currency={cur} />
              </b>
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** One line of the paper: the date, who and what it was, and its figures. */
function PaperLine({ l, currency, now }: { l: MoneyStatementLine; currency: string; now: Date }) {
  const [what, detail] = lineWhat(l)
  const returned = l.kind === 'return' || l.kind.endsWith('_reversal')
  return (
    <div role="row" className={cn(COLUMNS, 'min-h-12 items-center py-2')}>
      <span role="cell">
        <LineDate at={l.at} />
      </span>
      <span role="cell" className="grid min-w-0 gap-px">
        <span className="truncate text-reading font-semibold text-ink" data-testid="account-statement-what">
          {what}
          {returned ? (
            <Chip tone="bad" className="ml-1.5">
              Returned
            </Chip>
          ) : null}
        </span>
        {detail ? (
          <span className="truncate text-caption font-medium text-ink-3" data-testid="account-statement-detail">
            {detail}
          </span>
        ) : null}
        {/* What the agent said it was for is its own words, never cut: it wraps. */}
        {l.task ? <span className="break-words text-caption font-medium text-ink-3">The agent says: {l.task}</span> : null}
        {/* B59.25 — a card payment is disputed from its line, and says where its dispute stands. */}
        {l.kind === 'card_charge' && l.partner_ref ? (
          <span className="mt-1 block">
            <DisputePayment paymentID={l.partner_ref} payment={{ what, when: lineWhen(l.at, now), minor: l.amount_minor, currency }} />
          </span>
        ) : null}
      </span>
      <LineFigures minor={l.amount_minor} balance={l.balance_after_minor} currency={currency} />
    </div>
  )
}

/** B59.19 — an Instant transfer's lines as one: "Instant transfer to Lumen Freight GmbH", its total, and its legs when opened. */
function InstantRow({ row, currency }: { row: { transfer: string; to: string; amount_minor: number; lines: MoneyStatementLine[] }; currency: string }) {
  const [open, setOpen] = useState(false)
  const last = row.lines[row.lines.length - 1]
  return (
    <div role="row" className={cn(COLUMNS, 'min-h-12 items-center py-2')} data-testid="account-statement-instant">
      <span role="cell" className="self-start pt-0.5">
        <LineDate at={row.lines[0].at} />
      </span>
      <span role="cell" className="min-w-0">
        <button
          type="button"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 text-left text-reading font-semibold text-ink ${pocketFocusRing}`}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chev" size={14} className={open ? 'rotate-90' : ''} />
          Instant transfer{row.to ? ` to ${row.to}` : ''}
        </button>
        {open ? (
          <div className="mt-2 pl-5">
            <InstantLegs transfer={row.transfer} />
          </div>
        ) : null}
      </span>
      <LineFigures minor={row.amount_minor} balance={last.balance_after_minor} currency={currency} />
    </div>
  )
}
