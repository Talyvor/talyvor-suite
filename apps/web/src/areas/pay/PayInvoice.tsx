import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, Eyebrow, Facts, Select } from '@talyvor/ui/pocket'

import { useDocumentTitle } from '../../documentTitle'
import { ApiError } from '../../lib/api'
import { SiteFooter, SiteHeader } from '../../components/SiteChrome'
import { longDate } from '../../routes/legalParts'
import { BOOK_KEY } from '../lens/AgentBank'
import { Note } from '../lens/WalletMoney'
import { formatWhen } from '../lens/format'
import { AgentBankError, type PayPage, agentBankApi, formatMinor, refusalText } from '../lens/agentBankApi'
import { StatusLabel } from '../../labels/StatusLabel'
import { usePricing } from '../marketing/pricingApi'

// B30.97 — an invoice's pay page, opened by whoever holds its link, signed out (Lens B30.20). OUTSIDE the AuthGate
// (App.tsx) for the same reason as a shared chat: the payer has no account here. It shows the invoice as Lens serves it
// to a payer — no ids, no ledger — and three ways to pay what is due: a card (Stripe test mode, through Lens), a transfer
// to the issuer's account details quoting the reference, or one of the visitor's own Talyvor agents once they sign in.
// B56.10: Lens's Live or Sandbox for money paid in from outside Talyvor, from the public labels.
// B57.63 — drawn in Pocket (design/pocket s-pay-invoice): the invoice as a white card (who is asking, the amount in its
// currency, the due date, its lines), then a cloud card for each way to pay, the label beside Pay by card.

async function readPage(token: string): Promise<PayPage> {
  const path = `/api/public/pay/${encodeURIComponent(token)}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as PayPage
}

/** Lens opens a Stripe test-mode Checkout for what is due; the browser goes there. */
async function startCard(token: string): Promise<string> {
  const path = `/api/public/pay/${encodeURIComponent(token)}/card`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !body.url) throw new AgentBankError(res.status, path, body.error ?? '')
  return body.url
}

const payable = (p: PayPage) => p.invoice.status === 'sent' || p.invoice.status === 'overdue'

function Body({ token }: { token: string }) {
  const [search] = useSearchParams()
  const returned = search.get('paid') === 'card'
  const pricing = usePricing()
  const labels = pricing.status === 'ok' ? pricing.pricing.labels : undefined
  const page = useQuery({
    queryKey: ['pay-page', token],
    queryFn: () => readPage(token),
    retry: false,
    // Back from the card payment: Stripe's webhook pays the invoice a moment later, so the page reads again until it reads paid.
    refetchInterval: (q) => (returned && q.state.data !== undefined && q.state.data.invoice.status !== 'paid' ? 2000 : false),
  })

  if (page.isPending) return <p className="text-body text-ink-3">Reading the invoice…</p>
  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.status >= 400 && page.error.status < 500
    return (
      <>
        <h1 className="font-display text-display-1 font-extrabold text-ink">{gone ? 'This invoice isn’t available' : 'The invoice couldn’t be read'}</h1>
        <p className="mt-3 max-w-2xl text-reading text-ink-2">
          {gone
            ? 'The link may be mistyped or out of date. Ask whoever sent it for a new one.'
            : 'Talyvor didn’t answer just now, so nothing is shown rather than something stale. Try again in a moment.'}
        </p>
      </>
    )
  }

  const p = page.data
  const inv = p.invoice
  const issuer = inv.issuer || 'a Talyvor agent'
  const headline =
    inv.status === 'paid'
      ? 'Paid, thank you'
      : inv.status === 'void'
        ? 'This invoice was voided'
        : payable(p)
          ? 'Pay an invoice'
          : 'This invoice has not been sent yet'
  const totals: { label: string; minor: number; testid?: string }[] = [
    { label: 'Subtotal', minor: inv.subtotal_minor },
    { label: 'VAT', minor: inv.vat_minor },
    { label: 'Total', minor: inv.total_minor, testid: 'pay-total' },
    ...(inv.paid_minor > 0 ? [{ label: 'Paid', minor: inv.paid_minor }] : []),
    { label: 'Due', minor: inv.due_minor, testid: 'pay-due' },
  ]
  return (
    <>
      <Eyebrow>
        Invoice <span className="font-figure">{inv.number}</span> · from {issuer}
      </Eyebrow>
      <h1 className="mt-3 font-display text-display-1 font-extrabold text-ink" data-testid="pay-headline">
        {headline}
      </h1>
      {returned && inv.status !== 'paid' ? (
        <p className="mt-3 text-body text-ink-2" role="status">
          Thank you. Your card payment is being confirmed; this page updates as soon as the invoice reads paid.
        </p>
      ) : null}
      {inv.status === 'paid' && inv.paid_at ? (
        <p className="mt-3 text-body text-ink-2" data-testid="pay-paid">
          <span className="font-figure">{formatMinor(inv.paid_minor, inv.currency)}</span> received{' '}
          <span className="font-figure">{formatWhen(inv.paid_at)}</span>
          {(inv.payments ?? []).map((pay) => (
            <span key={pay.entry_id}>
              {' '}· <span className="font-figure">{formatMinor(pay.amount_minor, inv.currency)}</span> by {pay.method}
            </span>
          ))}
          .
        </p>
      ) : null}

      <Card tone="white" className="mt-4" data-testid="pay-invoice">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <b className="text-reading font-bold text-ink">{issuer}</b>
          <b className="font-figure text-pocket-balance-sm font-extrabold text-ink" data-testid="pay-amount">
            {formatMinor(payable(p) ? inv.due_minor : inv.total_minor, inv.currency)}
          </b>
        </div>
        <p className="text-body text-ink-3">
          Due <span className="font-figure">{longDate(inv.due_date)}</span>
        </p>
        <p className="mt-3 text-body text-ink-2">
          Billed to {inv.customer_name}
          {inv.customer_address ? <span className="block whitespace-pre-wrap text-ink-3">{inv.customer_address}</span> : null}
          {inv.customer_vat_number ? <span className="block text-ink-3">VAT {inv.customer_vat_number}</span> : null}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-micro font-semibold text-ink-3">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3 text-right">Qty × each</th>
                <th className="py-2 pr-3 text-right">VAT</th>
                <th className="py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-3 text-ink">{l.description}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-figure text-ink">
                    {l.quantity} × {formatMinor(l.unit_amount_minor, inv.currency)}
                  </td>
                  <td className="py-2 pr-3 text-right font-figure text-ink">{(l.vat_rate_bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%</td>
                  <td className="whitespace-nowrap py-2 text-right font-figure text-ink">{formatMinor(l.net_minor ?? l.quantity * l.unit_amount_minor, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Facts
          className="mt-3"
          facts={totals.map((t) => ({ label: t.label, value: <span data-testid={t.testid}>{formatMinor(t.minor, inv.currency)}</span> }))}
        />
        {inv.memo ? <p className="mt-3 whitespace-pre-wrap text-body text-ink-3">{inv.memo}</p> : null}
        {inv.seller_vat_number ? <p className="mt-1 text-body text-ink-3">Issuer’s VAT number {inv.seller_vat_number}</p> : null}
      </Card>

      {payable(p) ? (
        <div className="mt-4 grid gap-4 wide:grid-cols-2">
          <PayByCard token={token} page={p} labels={labels} />
          {/* B49.2 — the Test partner's details reach no bank: show none rather than label them */}
          {p.transfer?.mode === 'LIVE' ? <PayByTransfer transfer={p.transfer} /> : null}
          <PayByAgent token={token} page={p} />
        </div>
      ) : null}
    </>
  )
}

/** A way to pay: a cloud card on the page, its heading and, beside it, anything that says what is real. */
function Way({ heading, aside, children }: { heading: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="grid content-start gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-head font-bold text-ink">{heading}</h2>
        {aside}
      </div>
      {children}
    </Card>
  )
}

function PayByCard({ token, page, labels }: { token: string; page: PayPage; labels: Record<string, string> | undefined }) {
  const card = useMutation({
    mutationFn: () => startCard(token),
    onSuccess: (url) => window.location.assign(url),
  })
  return (
    <Way heading="Pay by card" aside={<StatusLabel capability="payments_in" labels={labels} />}>
      {page.card ? (
        <>
          <p className="text-body text-ink-2">A card payment opens on Stripe’s secure page and comes back here once it is confirmed.</p>
          <div>
            <Button type="button" variant="primary" disabled={card.isPending} onClick={() => card.mutate()}>
              {card.isPending ? 'Opening…' : 'Pay '}
              {card.isPending ? null : <span className="font-figure">{formatMinor(page.invoice.due_minor, page.invoice.currency)}</span>}
              {card.isPending ? null : ' by card'}
            </Button>
          </div>
          {card.isError ? <Note ok={false}>{refusalText(card.error)}</Note> : null}
        </>
      ) : (
        <p className="text-body text-ink-2">Card payments are not available for this invoice.</p>
      )}
    </Way>
  )
}

function PayByTransfer({ transfer }: { transfer: NonNullable<PayPage['transfer']> }) {
  const [copied, setCopied] = useState(false)
  const d = transfer.details
  const rows: [string, string | undefined][] = [
    ['Account holder', d.holder],
    ['Sort code', d.sort_code],
    ['Account number', d.account_number],
    ['IBAN', d.iban],
    ['BIC', d.bic],
    ['Routing number', d.routing_number],
  ]
  return (
    <Way heading="Pay by transfer">
      <p className="text-body text-ink-2">
        Send {d.currency} from your own bank to these details and quote the reference exactly: it marks the invoice paid.
      </p>
      <Facts
        on="cloud"
        facts={[
          ...rows.filter((r): r is [string, string] => Boolean(r[1])).map(([k, v]) => ({ label: k, value: v })),
          {
            label: 'Reference',
            value: (
              <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="pay-reference">
                {transfer.reference}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(transfer.reference).then(() => setCopied(true))
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </span>
            ),
          },
        ]}
      />
    </Way>
  )
}

function PayByAgent({ token, page }: { token: string; page: PayPage }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book, retry: false })
  const [agent, setAgent] = useState('')
  // The chosen agent belongs to this invoice: another link in the same tab starts with none chosen.
  const [agentFor, setAgentFor] = useState(token)
  if (agentFor !== token) {
    setAgentFor(token)
    setAgent('')
  }
  const pay = useMutation({
    mutationFn: () => agentBankApi.payInvoiceByAgent(token, agent),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pay-page', token] }),
  })
  const signedOut = book.isError && book.error instanceof ApiError && book.error.status === 401
  const agents = (book.data?.agents ?? []).filter((a) => !a.archived_at)
  return (
    <Way heading="Pay with a Talyvor agent">
      {book.isPending ? (
        <p className="text-body text-ink-3">Looking for your agents…</p>
      ) : signedOut || book.isError ? (
        <>
          <p className="text-body text-ink-2">
            Sign in, choose which agent pays, and it pays from its own {page.invoice.currency} account under its rules.
          </p>
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link to={`/signin?next=${encodeURIComponent(`/pay/${token}`)}`}>Sign in</Link>
            </Button>
          </div>
        </>
      ) : agents.length === 0 ? (
        <p className="text-body text-ink-2">You have no agent to pay with yet.</p>
      ) : (
        <>
          <p className="text-body text-ink-2">The agent pays from its {page.invoice.currency} account; its spending rules apply.</p>
          <div className="flex flex-wrap items-start gap-2">
            <Select aria-label="Which agent pays" className="w-56" value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Choose an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="md"
              disabled={pay.isPending}
              disabledReason={agent === '' ? 'Choose the agent that pays first.' : undefined}
              onClick={() => pay.mutate()}
            >
              {pay.isPending ? 'Paying…' : 'Pay with this agent'}
            </Button>
          </div>
          {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
        </>
      )}
    </Way>
  )
}

export function PayInvoicePage() {
  useDocumentTitle('Pay an invoice')
  const { token = '' } = useParams()
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <SiteHeader />

      <main className="flex-1">
        {/* pocket.css .ssec.narrow: one narrow column. */}
        <div className="mx-auto w-full max-w-4xl px-gutter pt-14">
          <Body key={token} token={token} />
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
