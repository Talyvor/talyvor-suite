import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cn, inlineLink } from '@talyvor/ui'
import { Button as PocketButton, Card as PocketCard, Chip, Crumb, Eyebrow, Facts, Icon, Money, pocketFocusRing, showToast } from '@talyvor/ui/pocket'
import { BOOK_KEY } from './AgentBank'
import { BALANCE_WORDS, MONEY_WORDS, arrivesText, instantKey, rateText } from './InstantTransfer'
import { type InstantLeg, type InstantTransfer, agentBankApi, useAccount } from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { INSTANT_TRANSFER } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

// InstantTransferReceipt.tsx — B59.19: an Instant transfer once sent (design P9 and P10, launch pack 4.1): its progress —
// Sent, Converted, On its way, Received, or reversed with the agent's money back — read from Lens until it lands, then
// its receipt with both conversions and the on-chain reference; and on a statement, its lines as one that opens its legs.

// ── Progress and the receipt ─────────────────────────────────────────────────────────────────────────────────────

const STEPS = ['Sent', 'Converted', 'On its way', 'Received'] as const
const STATUS_WORDS: Record<InstantTransfer['status'], string> = {
  sent: 'Sent',
  converted: 'Converted',
  on_its_way: 'On its way',
  received: 'Received',
  reversed: 'Didn’t go through',
}
/** How many steps are done at each state: the next one is in progress. On its way is the step in progress until it lands. */
const DONE_STEPS: Record<Exclude<InstantTransfer['status'], 'reversed'>, number> = { sent: 1, converted: 2, on_its_way: 2, received: 4 }

const finished = (t: InstantTransfer | undefined) => t?.status === 'received' || t?.status === 'reversed'

/** B59.19 — /money/pay/instant-transfer/:id: the transfer's progress while it moves, then its receipt. */
export function InstantTransferScreen() {
  const { id = '' } = useParams()
  const { shows } = useAccount()
  const t = useQuery({
    queryKey: instantKey(id),
    queryFn: () => agentBankApi.instantTransfer(id),
    refetchInterval: (q) => (finished(q.state.data) ? false : 1000),
  })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  if (shows && !shows.instantTransfer) return <Navigate to="/money/pay" replace />
  const agent = book.data?.agents?.find((a) => a.id === t.data?.agent_id)?.name ?? 'The agent'
  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-3xl gap-4 pb-10">
      <Crumb
        trail={[
          { label: 'Pay', href: '/money/pay' },
          { label: 'Instant transfer', href: '/money/pay/instant-transfer' },
          { label: t.data?.status === 'received' ? 'Receipt' : 'Progress' },
        ]}
      />
      {t.isError ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-body text-ink-2">We couldn’t read this receipt.</p>
          <PocketButton type="button" variant="secondary" size="sm" onClick={() => void t.refetch()}>
            Try again
          </PocketButton>
        </div>
      ) : !t.data ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : (
        <>
          <Progress t={t.data} agent={agent} />
          {t.data.status === 'received' ? <Receipt t={t.data} agent={agent} /> : null}
        </>
      )}
    </div>
  )
}

function Progress({ t, agent }: { t: InstantTransfer; agent: string }) {
  const reversed = t.status === 'reversed'
  const done = t.status === 'reversed' ? 0 : DONE_STEPS[t.status]
  const lines: React.ReactNode[] = [
    `From ${agent}’s ${BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance`,
    `${MONEY_WORDS[t.send_currency] ?? t.send_currency} to USDC`,
    `Moving to ${t.beneficiary_name}`,
    <>
      They get <Money minor={t.receive_minor} currency={t.receive_currency} />
    </>,
  ]
  return (
    <PocketCard tone="white" className="grid gap-4" data-testid="instant-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <Eyebrow data-testid="instant-status">{STATUS_WORDS[t.status]}</Eyebrow>
          <p className="font-display text-title font-bold text-ink">
            <Money minor={t.send_minor} currency={t.send_currency} />
          </p>
          <p className="text-body text-ink-2">to {t.beneficiary_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceLabel capability={INSTANT_TRANSFER} />
          {reversed ? <Chip tone="bad">Reversed</Chip> : <Chip tone="plain">{arrivesText(t, new Date(t.created_at))}</Chip>}
        </div>
      </div>
      <ol className="grid gap-3" aria-label="Progress">
        {STEPS.map((step, i) => {
          const state = reversed ? (i === 0 ? 'failed' : 'next') : i < done ? 'done' : i === done ? 'current' : 'next'
          return (
            <li key={step} className="flex items-start gap-3" data-testid="instant-step" data-state={state}>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-pill',
                  state === 'done' ? 'bg-ink text-on-primary' : state === 'current' ? 'shadow-edge' : state === 'failed' ? 'bg-danger text-on-primary' : 'bg-cloud-2',
                )}
              >
                {state === 'done' ? <Icon name="check" size={12} /> : null}
              </span>
              <span className="grid gap-0.5">
                <span className="font-semibold text-ink">{state === 'failed' ? 'Didn’t go through' : step}</span>
                <span className="text-body text-ink-3">{lines[i]}</span>
                <span className="sr-only">{state === 'done' ? 'Step done' : state === 'current' ? 'Step in progress' : 'Step not started'}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {reversed ? (
        <p className="flex items-start gap-1.5 text-body text-danger" role="alert" data-testid="instant-reversed">
          <Icon name="x" size={16} />
          <span>
            This transfer didn’t go through. The full <Money minor={t.send_minor} currency={t.send_currency} /> is back in {agent}’s{' '}
            {BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance.
          </span>
        </p>
      ) : t.status !== 'received' ? (
        <p className="text-body text-ink-3">You can leave this screen. We’ll tell you when it lands.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <PocketButton asChild>
          <Link to="/money/pay">Done</Link>
        </PocketButton>
        <PocketButton asChild variant="secondary">
          <Link to={`/statements?wallet=${encodeURIComponent(t.from_account_id)}`}>See it in Activity</Link>
        </PocketButton>
      </div>
    </PocketCard>
  )
}

/** One conversion of the receipt, from its leg: what it sold, what it bought, and the rate between them. */
function conversion(leg: InstantLeg, sell: number): { text: React.ReactNode; rate: string } {
  const unit = (c: string) => (c === 'USDC' ? 1e6 : 100)
  const rate = leg.buy.minor / unit(leg.buy.currency) / (sell / unit(leg.sell.currency))
  return {
    text: (
      <>
        <Money minor={sell} currency={leg.sell.currency} /> to <Money minor={leg.buy.minor} currency={leg.buy.currency} />
      </>
    ),
    rate: `Rate ${rateText(rate, leg.sell.currency, leg.buy.currency)}`,
  }
}

function Receipt({ t, agent }: { t: InstantTransfer; agent: string }) {
  const legs = t.legs ?? []
  const convert = legs.find((l) => l.leg === 'convert')
  const out = legs.find((l) => (l.leg === 'credit' || l.leg === 'payout') && l.sell.currency === 'USDC')
  const move = legs.find((l) => l.leg === 'move')
  // The convert leg sells what was sent; the fee comes out of it first (DESIGN 9.8), so the conversion is of the rest.
  const conversions = [...(convert ? [conversion(convert, convert.sell.minor - t.fee_minor)] : []), ...(out ? [conversion(out, out.sell.minor)] : [])]
  const at = new Date(t.created_at)
  const took = Math.max(1, Math.round((new Date(t.updated_at).getTime() - at.getTime()) / 1000))
  const copy = (ref: string) => {
    const said = () => showToast('Copied')
    void (navigator.clipboard?.writeText(ref) ?? Promise.resolve()).then(said, () => showToast('We couldn’t copy it. Select it and copy it instead.'))
  }

  return (
    <PocketCard tone="white" className="grid gap-4" data-testid="instant-receipt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-head font-bold text-ink">Receipt</h2>
        <Chip tone="good">Received</Chip>
      </div>
      <p className="text-body text-ink-2">
        {at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} at{' '}
        <span className="font-figure">
          {at.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>{' '}
        · arrived in <span className="font-figure">{took}</span> seconds
      </p>
      <Facts
        facts={[
          {
            label: 'You sent',
            value: <Money minor={t.send_minor} currency={t.send_currency} />,
          },
          {
            label: 'Fee',
            value: <Money minor={t.fee_minor} currency={t.send_currency} />,
          },
          {
            label: 'They got',
            value: <Money minor={t.receive_minor} currency={t.receive_currency} />,
          },
        ]}
      />
      {conversions.length > 0 ? (
        <div className="grid gap-2" data-testid="instant-conversions">
          <h3 className="font-semibold text-ink">Conversions</h3>
          <ol className="grid gap-2">
            {conversions.map((c, i) => (
              <li key={i} className="flex gap-3 text-body">
                <span className="font-figure text-ink-3">{i + 1}</span>
                <span className="grid gap-0.5">
                  <span className="text-ink">{c.text}</span>
                  <span className="font-figure text-ink-3">{c.rate}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Facts
        facts={[
          ...(move?.partner_ref
            ? [
                {
                  label: 'On-chain reference',
                  value: (
                    <span className="inline-flex items-center gap-2">
                      <span data-testid="instant-onchain-ref">{move.partner_ref}</span>
                      <button
                        type="button"
                        aria-label="Copy the on-chain reference"
                        className={`rounded-pill text-ink-3 ${pocketFocusRing}`}
                        onClick={() => copy(move.partner_ref ?? '')}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                    </span>
                  ),
                },
              ]
            : []),
          { label: 'Transfer ID', value: t.id },
          {
            label: 'Paid from',
            value: `${agent}’s ${BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance`,
          },
        ]}
      />
    </PocketCard>
  )
}

// ── On a statement ───────────────────────────────────────────────────────────────────────────────────────────────

/** The transfer a statement line belongs to, and who it went to, from the memo Lens posts each leg with. */
const INSTANT_MEMO = /^Instant transfer (itr_[\w-]+)(?: to (.+?):| reversed)/

/** B59.19 — a statement's lines with each Instant transfer's lines grouped under one, in the place of its newest. */
export function groupInstant<L extends { memo?: string; amount_minor: number }>(
  lines: readonly L[],
): ({ line: L } | { transfer: string; to: string; amount_minor: number; lines: L[] })[] {
  const out: ({ line: L } | { transfer: string; to: string; amount_minor: number; lines: L[] })[] = []
  const groups = new Map<string, { transfer: string; to: string; amount_minor: number; lines: L[] }>()
  for (const l of lines) {
    const m = INSTANT_MEMO.exec(l.memo ?? '')
    if (!m) {
      out.push({ line: l })
      continue
    }
    let g = groups.get(m[1])
    if (!g) {
      g = { transfer: m[1], to: m[2] ?? '', amount_minor: 0, lines: [] }
      groups.set(m[1], g)
      out.push(g)
    }
    if (!g.to && m[2]) g.to = m[2]
    g.amount_minor += l.amount_minor
    g.lines.push(l)
  }
  return out
}

/** The legs under an Instant transfer's statement line, read from its receipt: convert, move, credit or pay out, and the fee. */
export function InstantLegs({ transfer }: { transfer: string }) {
  const t = useQuery({
    queryKey: instantKey(transfer),
    queryFn: () => agentBankApi.instantTransfer(transfer),
  })
  if (t.isError) return <p className="text-body text-ink-3">We couldn’t read this receipt.</p>
  if (!t.data) return <p className="text-body text-ink-3">Reading…</p>
  const r = t.data
  const legs: [string, React.ReactNode][] = (r.legs ?? []).map((l) => {
    switch (l.leg) {
      case 'convert':
        return [
          `Convert · ${MONEY_WORDS[l.sell.currency] ?? l.sell.currency} to USDC`,
          <>
            <Money minor={l.sell.minor - r.fee_minor} currency={l.sell.currency} /> to <Money minor={l.buy.minor} currency={l.buy.currency} />
          </>,
        ]
      case 'move':
        return ['Move · on chain', <Money minor={l.buy.minor} currency={l.buy.currency} />]
      case 'payout':
        return ['Pay out · to their bank', <Money minor={l.buy.minor} currency={l.buy.currency} />]
      default:
        return ['Credit · to their account', <Money minor={l.buy.minor} currency={l.buy.currency} />]
    }
  })
  if (r.fee_minor > 0) legs.push(['Fee', <Money minor={r.fee_minor} currency={r.send_currency} />])
  return (
    <div className="grid gap-1" data-testid="instant-legs">
      {legs.map(([what, figure]) => (
        <div key={what} className="flex justify-between gap-3 text-body text-ink-2">
          <span>{what}</span>
          {figure}
        </div>
      ))}
      {r.status === 'reversed' ? (
        <p className="text-body text-ink-2">
          Reversed: the full <Money minor={r.send_minor} currency={r.send_currency} /> went back.
        </p>
      ) : null}
      <Link className={`justify-self-start text-body text-ink ${inlineLink}`} to={`/money/pay/instant-transfer/${encodeURIComponent(r.id)}`}>
        See the receipt
      </Link>
    </div>
  )
}
