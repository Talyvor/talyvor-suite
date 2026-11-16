import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, Chip, Dialog, EmptyState, Field, Icon, Input, KindTile, Select, pocketFocusRing, showSnack, showToast, type ChipTone } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { WorkspaceLabel } from '../../labels/workspace'
import { PAY_IN } from '../../labels/capabilities'
import { type CurrencyAccount, type Invoice, type InvoiceRequest, FIATS, agentBankApi, formatMinor, minorOf, refusalText } from './agentBankApi'

// Invoices.tsx — B30.97: invoices and their pay links (Lens B30.20). An agent's currency account issues an invoice —
// lines with optional VAT, a due date, a reminder — and sends a public pay link that takes a card, a transfer quoting the
// reference, or another Talyvor agent's payment; a paid invoice posts into the agent's account and reads paid here.
// Lens decides everything: which account may issue, what is due and which states may move. A refusal shows its sentence.
//
// B57.33 — Pocket's w-invoices: Issued beside Accounts, New invoice in a dialog (its main fields, then More details for
// VAT numbers, an address, more lines, reminders and a note), and Void only after "Void invoice INV-…?" (B55.41).
// A USDC wallet is listed in USDC (formatMinor, no Intl currency call) and is never offered as Paid into (B55.26).

export const INVOICES_KEY = ['money-invoices']
export const MONEY_ACCOUNTS_KEY = ['money-accounts']
const CURRENCIES = ['GBP', 'EUR', 'USD']

const STATUS: Record<Invoice['status'], { text: string; tone: ChipTone }> = {
  draft: { text: 'Draft', tone: 'paused' },
  sent: { text: 'Sent', tone: 'wait' },
  overdue: { text: 'Overdue', tone: 'wait' },
  paid: { text: 'Paid', tone: 'good' },
  void: { text: 'Void', tone: 'paused' },
}

const PAID_BY: Record<string, string> = { card: 'by card', transfer: 'by transfer', agent: 'by an agent of theirs' }

/** Thirty days from today, as the date field wants it. */
function inThirtyDays(): string {
  const d = new Date(Date.now() + 30 * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-11-21" → "21 Nov" (or "21 November"): a due date is a day, so it is read in UTC and never moves a day. */
function dayOf(date: string, month: 'short' | 'long' = 'short'): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { day: 'numeric', month, timeZone: 'UTC' })
}

/** A moment, as the day it fell on here: "today", or "12 Oct". */
function whenOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function useAgentNames() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  return (id: string | undefined) => (id ? book.data?.agents?.find((a) => a.id === id)?.name : undefined)
}

/** "Company · USD" or "Research · USD". */
function accountName(a: CurrencyAccount, agentName: (id: string | undefined) => string | undefined): string {
  return `${a.purpose === 'agent' ? (agentName(a.agent_id) ?? a.name) : 'Company'} · ${a.currency}`
}

export function InvoicesScreen() {
  const invoices = useQuery({ queryKey: INVOICES_KEY, queryFn: agentBankApi.invoices })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const agentName = useAgentNames()
  const [creating, setCreating] = useState(false)
  const [opening, setOpening] = useState(false)
  const list = invoices.data?.invoices ?? []
  const all = accounts.data?.accounts ?? []
  const paidInto = all.filter((a) => a.purpose === 'agent' && a.status === 'open' && FIATS.includes(a.currency))
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-reading text-ink-2">
          Invoice your customers from an agent’s account. Whoever holds the pay link pays, and the money lands in the agent’s account.
          Invoices you receive are bills, on Pay.
        </p>
        <Button variant="primary" icon={<Icon name="plus" size={18} />} onClick={() => setCreating(true)}>
          New invoice
        </Button>
      </div>
      <div className="grid items-start gap-4.5 wide:grid-cols-12">
        <Card tone="white" className="min-w-0 wide:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-head font-bold text-ink">Issued</h2>
            <WorkspaceLabel capability={PAY_IN} />
          </div>
          {invoices.isError ? (
            <p className="mt-2 text-body text-ink-2">{readFailure(invoices.error, 'Your invoices')}</p>
          ) : invoices.isPending ? (
            <p className="mt-2 text-body text-ink-2">Reading…</p>
          ) : list.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={<Icon name="invoices" size={18} />}
              title="No invoice issued yet"
              line="Create one with New invoice, and it appears here once it is issued."
            />
          ) : (
            <ul className="mt-2" aria-label="Issued invoices">
              {list.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} paidInto={all.find((a) => a.id === inv.account_id)} agentName={agentName} />
              ))}
            </ul>
          )}
        </Card>
        <Card className="min-w-0 wide:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-head font-bold text-ink">Accounts</h2>
            <Button size="sm" variant="secondary" icon={<Icon name="plus" size={16} />} onClick={() => setOpening(true)}>
              Open an account
            </Button>
          </div>
          {accounts.isError ? (
            <p className="mt-2 text-body text-ink-2">{readFailure(accounts.error, 'Your accounts')}</p>
          ) : accounts.isPending ? (
            <p className="mt-2 text-body text-ink-2">Reading…</p>
          ) : all.length === 0 ? (
            <p className="mt-2 text-body text-ink-2" data-testid="invoices-no-account">
              No currency account yet. An invoice is paid into one of your agents’ accounts: open the company’s account in a currency,
              then the agent’s.
            </p>
          ) : (
            <>
              <ul className="mt-2" aria-label="Currency accounts">
                {all.map((a) => (
                  <li key={a.id} className="border-t border-line first:border-t-0">
                    {/* B57.25 — each account opens its statement, in its own currency. */}
                    <Link
                      to={`/statements?wallet=${encodeURIComponent(a.id)}`}
                      className={cn('flex items-center justify-between gap-3 rounded-control py-2.5 text-reading', pocketFocusRing)}
                    >
                      <span className="min-w-0 font-semibold text-ink">{accountName(a, agentName)}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="whitespace-nowrap font-figure font-semibold text-ink">{formatMinor(a.live_minor, a.currency)}</span>
                        <span aria-hidden="true" className="text-ink-3">
                          <Icon name="chev" size={16} />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-caption text-faint">Each account opens its statement, in its own currency.</p>
            </>
          )}
        </Card>
      </div>
      {creating ? (
        <NewInvoiceDialog
          accounts={paidInto}
          read={accounts}
          agentName={agentName}
          onClose={() => setCreating(false)}
          onOpenAccount={() => {
            setCreating(false)
            setOpening(true)
          }}
        />
      ) : null}
      {opening ? <OpenAccountDialog onClose={() => setOpening(false)} /> : null}
    </div>
  )
}

/** Open the company's or an agent's account in a currency (Lens B30.13): an agent's is a sub-account of the company's. */
function OpenAccountDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const [holder, setHolder] = useState('')
  const [currency, setCurrency] = useState('GBP')
  const agents = (book.data?.agents ?? []).filter((a) => !a.archived_at)
  const open = useMutation({
    mutationFn: () => agentBankApi.openMoneyAccount(currency, holder),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      const whose = holder === '' ? 'The company' : (agents.find((x) => x.id === holder)?.name ?? a.name)
      showSnack({ title: `Opened: ${whose} · ${a.currency}`, line: 'It opens its statement from Accounts.' })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Open an account"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="open-account" variant="primary" disabled={open.isPending}>
            {open.isPending ? 'Opening…' : 'Open account'}
          </Button>
        </>
      }
    >
      <p>You choose a currency (dollars, pounds or euros) and whose account it is: the company’s or an agent’s.</p>
      <form
        id="open-account"
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!open.isPending) open.mutate()
        }}
      >
        <Field label="Whose account">
          <Select value={holder} onChange={(e) => setHolder(e.target.value)}>
            <option value="">The company</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </form>
      {open.isError ? (
        <p role="alert" className="text-ink">
          {refusalText(open.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

interface DraftLine {
  description: string
  quantity: string
  unit: string
  vat: string
}

const blankLine = (): DraftLine => ({ description: '', quantity: '1', unit: '', vat: '0' })

function NewInvoiceDialog({
  accounts,
  read,
  agentName,
  onClose,
  onOpenAccount,
}: {
  accounts: CurrencyAccount[]
  /** The accounts' read: a failed one is not "no account yet". */
  read: { isError: boolean; isPending: boolean; error: unknown }
  agentName: (id: string | undefined) => string | undefined
  onClose: () => void
  onOpenAccount: () => void
}) {
  const qc = useQueryClient()
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [customer, setCustomer] = useState({ name: '', email: '', address: '', vat: '' })
  const [sellerVAT, setSellerVAT] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [dueDate, setDueDate] = useState(inThirtyDays)
  const [remind, setRemind] = useState('0')
  const [memo, setMemo] = useState('')
  const [more, setMore] = useState(false)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const currency = account?.currency ?? 'GBP'

  const parsed = lines.map((l) => ({
    description: l.description.trim(),
    quantity: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : 0,
    unit_amount_minor: minorOf(l.unit),
    vat_rate_bps: /^\d+(\.\d+)?$/.test(l.vat.trim()) ? Math.round(Number(l.vat) * 100) : -1,
  }))
  const complete = customer.name.trim() !== '' && account !== undefined && dueDate !== '' &&
    parsed.every((l) => l.description !== '' && l.quantity > 0 && l.unit_amount_minor !== null && l.vat_rate_bps >= 0 && l.vat_rate_bps <= 10000)
  const why = customer.name.trim() === ''
    ? 'Type the customer’s name first.'
    : complete ? undefined : 'Type what each line is for and its amount first.'
  const total = parsed.reduce((sum, l) => {
    const net = l.quantity * (l.unit_amount_minor ?? 0)
    return sum + net + Math.round((net * Math.max(l.vat_rate_bps, 0)) / 10000)
  }, 0)

  const create = useMutation({
    mutationFn: (send: boolean) => {
      const body: InvoiceRequest = {
        account_id: account?.id ?? '',
        customer_name: customer.name.trim(),
        customer_email: customer.email.trim(),
        customer_address: customer.address.trim(),
        customer_vat_number: customer.vat.trim(),
        seller_vat_number: sellerVAT.trim(),
        lines: parsed.map((l) => ({ ...l, unit_amount_minor: l.unit_amount_minor ?? 0 })),
        due_date: dueDate,
        remind_days_before: /^\d+$/.test(remind.trim()) ? Number(remind) : 0,
        memo: memo.trim(),
        send,
      }
      return agentBankApi.createInvoice(body)
    },
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: INVOICES_KEY })
      const due = `${formatMinor(inv.total_minor, inv.currency)} due by ${dayOf(inv.due_date, 'long')}`
      showSnack(
        inv.status === 'draft'
          ? { title: `${inv.number} saved as a draft: ${due}`, line: 'Send it from Issued when it is ready.' }
          : { title: `${inv.number} sent: ${due}`, line: 'Its pay link is on the invoice.' },
      )
      onClose()
    },
  })
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((old) => old.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  if (read.isError || read.isPending) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="New invoice"
        actions={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p>{read.isError ? readFailure(read.error, 'Your accounts') : 'Reading your accounts…'}</p>
      </Dialog>
    )
  }

  if (accounts.length === 0) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="New invoice"
        actions={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onOpenAccount}>
              Open an account
            </Button>
          </>
        }
      >
        <p data-testid="invoices-no-account">
          An invoice is paid into one of your agents’ accounts: open the company’s account in a currency, then the agent’s.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New invoice"
      className="max-h-screen overflow-y-auto"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {/* Offered once the invoice is complete, so only Create and send says what is missing. */}
          {complete ? (
            <Button variant="secondary" disabled={create.isPending} onClick={() => create.mutate(false)}>
              Save as draft
            </Button>
          ) : null}
          <Button type="submit" form="new-invoice" variant="primary" disabled={!complete || create.isPending} disabledReason={why}>
            {create.isPending ? 'Issuing…' : 'Create and send'}
          </Button>
        </>
      }
    >
      <form
        id="new-invoice"
        data-testid="new-invoice"
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete && !create.isPending) create.mutate(true)
        }}
      >
        <Field label="Paid into">
          <Select value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountName(a, agentName)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer’s name">
          <Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2.5" data-testid={`line-${i + 1}`}>
            <Field label={lines.length > 1 ? `What for, line ${i + 1}` : 'What for'}>
              <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            </Field>
            <div className={cn('grid gap-2.5', more ? 'grid-cols-3' : 'grid-cols-1')}>
              {more ? (
                <Field label="Quantity">
                  <Input inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </Field>
              ) : null}
              <Field label={more ? 'Each' : 'Amount'}>
                <Input inputMode="decimal" unit={currency} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
              </Field>
              {more ? (
                <Field label="VAT">
                  <Input inputMode="decimal" unit="%" value={l.vat} onChange={(e) => setLine(i, { vat: e.target.value })} />
                </Field>
              ) : null}
            </div>
            {more && lines.length > 1 ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setLines((old) => old.filter((_, j) => j !== i))}>
                  Remove line {i + 1}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        <Field label="Due on">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {more ? (
          <>
            <div>
              <Button size="sm" variant="secondary" icon={<Icon name="plus" size={16} />} onClick={() => setLines((old) => [...old, blankLine()])}>
                Add a line
              </Button>
            </div>
            <Field label="Customer’s email">
              <Input type="email" placeholder="For reminders" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </Field>
            <Field label="Customer’s VAT number">
              <Input value={customer.vat} onChange={(e) => setCustomer({ ...customer, vat: e.target.value })} />
            </Field>
            <Field label="Your VAT number">
              <Input value={sellerVAT} onChange={(e) => setSellerVAT(e.target.value)} />
            </Field>
            <Field label="Customer’s address">
              <Input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
            </Field>
            <Field label="Remind this many days before (0: none)">
              <Input inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value)} />
            </Field>
            <Field label="A note on the invoice">
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
          </>
        ) : (
          <div>
            <button type="button" className={cn(inlineLink, 'font-semibold text-ink')} onClick={() => setMore(true)}>
              More details
            </button>
          </div>
        )}
        <p className="flex items-center justify-between gap-2 text-body text-ink-2">
          Total with VAT
          <span className="font-figure font-semibold text-ink" data-testid="new-invoice-total">
            {formatMinor(total, currency)}
          </span>
        </p>
      </form>
      {create.isError ? (
        <p role="alert" className="text-ink">
          {refusalText(create.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

/** "Due 30 Nov · sent today · paid into Research · USD", or "Paid 12 Oct, by an agent of theirs · paid into …". */
function invoiceLine(inv: Invoice, paidInto: string | null): string {
  const parts: string[] = []
  const pays = inv.payments ?? []
  const last = pays[pays.length - 1]
  if (inv.status === 'paid') {
    parts.push(`Paid ${whenOf(inv.paid_at ?? last?.paid_at ?? '')}${last ? `, ${PAID_BY[last.method] ?? `by ${last.method}`}` : ''}`)
  } else {
    parts.push(`Due ${dayOf(inv.due_date)}`)
    if (inv.status === 'void' && inv.voided_at) parts.push(`void ${whenOf(inv.voided_at)}`)
    else if (inv.sent_at) parts.push(`sent ${whenOf(inv.sent_at)}`)
    if (inv.status !== 'void' && inv.paid_minor > 0) parts.push(`${formatMinor(inv.due_minor, inv.currency)} still due`)
  }
  if (paidInto) parts.push(`paid into ${paidInto}`)
  else parts.push(inv.currency)
  return parts.join(' · ')
}

function InvoiceRow({
  inv,
  paidInto,
  agentName,
}: {
  inv: Invoice
  paidInto: CurrencyAccount | undefined
  agentName: (id: string | undefined) => string | undefined
}) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: INVOICES_KEY })
  const send = useMutation({
    mutationFn: () => agentBankApi.sendInvoice(inv.id),
    onSuccess: (sent) => {
      refresh()
      showSnack({ title: `${sent.number} sent: ${formatMinor(sent.total_minor, sent.currency)} due by ${dayOf(sent.due_date, 'long')}`, line: 'Its pay link is on the invoice.' })
    },
  })
  const voidIt = useMutation({
    mutationFn: () => agentBankApi.voidInvoice(inv.id),
    onSuccess: () => {
      refresh()
      setAsking(false)
      showSnack({ title: `${inv.number} is void`, line: 'Its pay link no longer works.' })
    },
  })
  const s = STATUS[inv.status] ?? { text: inv.status, tone: 'plain' as ChipTone }
  const open = inv.status === 'draft' || inv.status === 'sent' || inv.status === 'overdue'
  const name = paidInto ? accountName(paidInto, agentName) : (agentName(inv.agent_id) ? `${agentName(inv.agent_id)} · ${inv.currency}` : null)
  const copy = () => {
    const link = inv.pay_url ?? ''
    if (!navigator.clipboard) {
      showToast('Could not copy the pay link')
      return
    }
    navigator.clipboard.writeText(link).then(
      () => showToast('Copied the pay link'),
      () => showToast('Could not copy the pay link'),
    )
  }
  return (
    <li
      id={`invoice-${inv.id}`}
      data-testid={`invoice-${inv.number}`}
      className="flex flex-wrap items-start gap-3 border-t border-line py-3 text-reading first:border-t-0 wide:flex-nowrap"
    >
      <KindTile on="white" icon={<Icon name="invoices" size={18} />} />
      <div className="min-w-0 flex-1 basis-3/5">
        <div className="font-semibold text-ink">
          <span className="font-figure">{inv.number}</span> · {inv.customer_name}
        </div>
        <div className="text-body text-ink-3">{invoiceLine(inv, name)}</div>
        {open ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {inv.status === 'draft' ? (
              <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? 'Sending…' : 'Send'}
              </Button>
            ) : null}
            {inv.pay_url ? (
              <Button size="sm" variant="secondary" onClick={copy}>
                Copy link
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
              Void
            </Button>
          </div>
        ) : null}
        {send.isError ? <p role="alert" className="mt-2 text-body text-ink">{refusalText(send.error)}</p> : null}
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <b className="whitespace-nowrap font-figure font-semibold text-ink">{formatMinor(inv.total_minor, inv.currency)}</b>
        <Chip tone={s.tone}>{s.text}</Chip>
      </span>
      {/* B55.41 — voiding cannot be undone, so it asks first. */}
      <Dialog
        open={asking && inv.status !== 'void'}
        onClose={() => setAsking(false)}
        title={`Void invoice ${inv.number}?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={voidIt.isPending} onClick={() => voidIt.mutate()}>
              {voidIt.isPending ? 'Voiding…' : 'Void it'}
            </Button>
          </>
        }
      >
        <p>{inv.customer_name} can no longer pay it, and this cannot be undone.</p>
        {voidIt.isError ? (
          <p role="alert" className="text-ink">
            {refusalText(voidIt.error)}
          </p>
        ) : null}
      </Dialog>
    </li>
  )
}
