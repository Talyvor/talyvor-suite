import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { cn, inlineLink } from '@talyvor/ui'
import { Card, Chip, Field, Icon, Input, Money, RoomBadge, Row, Select, pocketFocusRing, type ChipTone, type IconName } from '@talyvor/ui/pocket'
import { BOOK_KEY, dayAfter, readFailure } from './AgentBank'
import { lineWhen } from './AgentStatement'
import { accountOwner, kindWords } from './AccountStatement'
import { STATUS_WORDS, groupInstant } from './InstantTransferReceipt'
import { instantKey } from './InstantTransfer'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { agentBankApi, type Agent, type CurrencyAccount, type InstantTransfer, type MoneyStatementLine } from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

// B61.2 — Activity, as the phone has it: every payment in and out of the company's and its agents' accounts, newest
// first, each in its account's own currency (Nick, 15 Nov: no LXC), read from each currency account's statement (Lens
// B56.14), with a search and filters for agent, kind and state. A row opens that payment: an Instant transfer its
// receipt, any other line its own page, /activity/<account>/<entry> (ActivityPayment.tsx).

/** Every line since the first: Activity is not a month, it is everything. */
export const ACTIVITY_FROM = '2020-01-01'
export const activityTo = () => dayAfter(new Date().toISOString().slice(0, 10))
export const statementKey = (accountID: string, to: string) => ['money-account-statement', accountID, ACTIVITY_FROM, to] as const

type Kind = 'card' | 'out' | 'in' | 'instant'
const KINDS: readonly [Kind | '', string][] = [
  ['', 'Every kind'],
  ['card', 'Card payments'],
  ['out', 'Payments out'],
  ['in', 'Payments in'],
  ['instant', 'Instant transfers'],
]
const KIND_ICON: Record<Kind, IconName> = { card: 'card', out: 'send', in: 'arrow', instant: 'send' }

interface ActivityRow {
  key: string
  account: CurrencyAccount
  at: string
  amount_minor: number
  who: string
  what: string
  memo: string
  kind: Kind
  state: string
  tone: ChipTone
  href: string
}

const INSTANT_TONE: Record<InstantTransfer['status'], ChipTone> = { sent: 'wait', converted: 'wait', on_its_way: 'wait', received: 'good', reversed: 'bad' }

/** A posted line's state in words: what came back, what came in, or what was paid. */
export function lineState(l: MoneyStatementLine): [string, ChipTone] {
  if (l.kind.endsWith('_reversal') || l.kind === 'return') return ['Returned', 'bad']
  if (l.kind === 'card_refund' || l.kind === 'card_dispute_won') return ['Refunded', 'good']
  return l.amount_minor > 0 ? ['Received', 'good'] : ['Paid', 'plain']
}

function lineKind(l: MoneyStatementLine): Kind {
  if (l.kind.startsWith('instant_transfer')) return 'instant'
  if (l.kind.startsWith('card_')) return 'card'
  return l.amount_minor > 0 ? 'in' : 'out'
}

/** Who a line was from or to: an outside name, another of the company's accounts by its owner, or the company. */
export function lineWho(l: MoneyStatementLine, accounts: readonly CurrencyAccount[], agents: readonly Agent[]): string {
  if (l.counterparty.startsWith('workspace:')) return 'The company'
  const other = accounts.find((a) => a.id === l.counterparty)
  if (other) return `${accountOwner(other, agents)} · ${other.currency}`
  return l.counterparty || kindWords(l.kind)
}

/** Every account's statement since the first line, the agents who own them, and each Instant transfer's receipt. */
function useActivity() {
  const to = activityTo()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const list = accounts.data?.accounts ?? []
  const statements = useQueries({
    queries: list.map((a) => ({ queryKey: statementKey(a.id, to), queryFn: () => agentBankApi.accountStatement(a.id, ACTIVITY_FROM, to) })),
  })
  const agents = book.data?.agents ?? []
  const grouped = list.flatMap((account, i) => groupInstant(statements[i]?.data?.lines ?? []).map((row) => ({ account, row })))
  const transfers = [...new Set(grouped.flatMap(({ row }) => ('transfer' in row ? [row.transfer] : [])))]
  const receipts = useQueries({ queries: transfers.map((id) => ({ queryKey: instantKey(id), queryFn: () => agentBankApi.instantTransfer(id) })) })
  const status = new Map(transfers.map((id, i) => [id, receipts[i]?.data?.status]))
  const rows: ActivityRow[] = grouped.map(({ account, row }) => {
    if ('transfer' in row) {
      const s = status.get(row.transfer)
      return {
        key: `${account.id}-${row.transfer}`,
        account,
        at: row.lines.reduce((at, l) => (l.at > at ? l.at : at), row.lines[0].at),
        amount_minor: row.amount_minor,
        who: row.to || 'Instant transfer',
        what: 'Instant transfer',
        memo: row.lines.map((l) => l.memo ?? '').join(' '),
        kind: 'instant',
        state: s ? STATUS_WORDS[s] : 'Sent',
        tone: s ? INSTANT_TONE[s] : 'wait',
        href: `/money/pay/instant-transfer/${encodeURIComponent(row.transfer)}`,
      }
    }
    const l = row.line
    const [state, tone] = lineState(l)
    return {
      key: `${account.id}-${l.entry_id}-${l.line}`,
      account,
      at: l.at,
      amount_minor: l.amount_minor,
      who: lineWho(l, list, agents),
      what: kindWords(l.kind),
      memo: l.memo ?? '',
      kind: lineKind(l),
      state,
      tone,
      href: `/activity/${encodeURIComponent(account.id)}/${encodeURIComponent(l.entry_id)}`,
    }
  })
  rows.sort((a, b) => b.at.localeCompare(a.at))
  const failed = accounts.error ?? statements.find((s) => s.isError)?.error ?? null
  const pending = accounts.isPending || book.isPending || statements.some((s) => s.isPending)
  return { rows, agents, accounts: list, error: failed, pending }
}

/** B61.2 — /activity: every payment in and out, newest first. */
export function ActivityScreen() {
  const read = useActivity()
  const { rows, agents, accounts, pending } = read
  const [agent, setAgent] = useState('')
  const [kind, setKind] = useState<Kind | ''>('')
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  const now = new Date()
  const owners = [...new Set(accounts.map((a) => (a.purpose === 'agent' && a.agent_id ? a.agent_id : 'company')))]
  const states = [...new Set(rows.map((r) => r.state))]
  const words = q.trim().toLowerCase()
  const shown = rows
    .filter((r) => agent === '' || (agent === 'company' ? r.account.purpose === 'company' : r.account.agent_id === agent))
    .filter((r) => kind === '' || r.kind === kind)
    .filter((r) => state === '' || r.state === state)
    .filter((r) => words === '' || [r.who, r.what, r.memo, r.account.currency].some((w) => w.toLowerCase().includes(words)))

  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-3xl gap-5 px-gutter py-4 wide:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-2">Every payment in and out of your accounts and your agents’, newest first.</p>
        <WorkspaceLabel capability={CURRENCY_ACCOUNT} />
      </div>
      <div className="grid gap-3 wide:grid-cols-4">
        <Field label="Search" className="wide:col-span-4">
          <Input type="search" placeholder="Search" maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Agent">
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Every agent</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o === 'company' ? 'Company' : (agents.find((a) => a.id === o)?.name ?? 'Agent')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
            {KINDS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="State">
          <Select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Every state</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {read.error ? (
        <p className="text-body text-ink-2">{readFailure(read.error, 'Your payments')}</p>
      ) : pending && rows.length === 0 ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-ink-2">
          No payments yet. Payments in on{' '}
          <Link className={`text-ink ${inlineLink}`} to="/money/invoices">
            Invoices
          </Link>{' '}
          and out on{' '}
          <Link className={`text-ink ${inlineLink}`} to="/money/pay">
            Pay
          </Link>{' '}
          show here.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-body text-ink-2">No payment matches.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line" data-testid="activity">
            {shown.map((r) => (
              <li key={r.key}>
                <Link to={r.href} data-testid="activity-row" className={cn('block rounded-control', pocketFocusRing)}>
                  <Row
                    wrap
                    className="border-t-0"
                    leading={<RoomBadge icon={<Icon name={KIND_ICON[r.kind]} />} />}
                    title={r.who}
                    line={[r.what, accountOwner(r.account, agents), lineWhen(r.at, now)].join(' · ')}
                    amount={<Money minor={r.amount_minor} currency={r.account.currency} signed className={r.amount_minor > 0 ? 'text-success' : ''} />}
                    action={<Chip tone={r.tone}>{r.state}</Chip>}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
