import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Row } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { type Agent, type AgentCard, type CardAuthorization, type Cardholder, agentBankApi, refusalText } from './agentBankApi'
import { Lxc } from './money'
import { WorkspaceLabel } from '../../labels/workspace'
import { AgentCard as AgentCardFace } from '../../cards/AgentCard'
import { CardDisputesAndRefunds, CardExport } from './CardDisputes'
import { DESIGN_ATTR } from '../../pocketPending'

// AgentCardPanel.tsx — B19.24: an agent's card on Agent Wallets. Lens (B19.12) issues an agent a virtual
// card through Stripe Issuing, in TEST MODE ONLY — cards are class RED, test money until a licensed partner
// exists — and decides every purchase on it in real time by the agent's rules and balance, converting it
// from pounds at the day's European Central Bank reference rate. This shows the card and each purchase
// with Lens's own reason and the rate; issuing one asks for the cardholder Stripe needs.
// B57.125 — an issued card is drawn as the agent's own card: its helper, its name and its job line, with the number's
// last four and the expiry in the line under it, never on the face.
// B57.142 — the panel is drawn in Pocket, as the launch pack's W4 draws an agent's card on its page: the card art 312
// wide on a white card, the last-four line under it, each purchase a row with its decision in words.

export const cardKey = (id: string) => ['agent-card', id]

/** An amount in a currency's minor units, as money: 150 gbp → £1.50. */
export function moneyText(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** "£1 = $1.3972 · ECB, 2026-09-25": the rate a purchase was converted at, from the ECB's two published figures. */
export function rateText(a: CardAuthorization): string | null {
  const usd = Number(a.ecb_usd_per_eur)
  const ccy = Number(a.ecb_currency_per_eur)
  if (!a.rate_date || !(usd > 0) || !(ccy > 0)) return null
  return `${moneyText(100, a.currency).replace(/\.00$/, '')} = $${(usd / ccy).toFixed(4)} · ECB, ${a.rate_date.slice(0, 10)}`
}

function CardFace({ card }: { card: AgentCard }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-body" data-testid="agent-card">
      <span className="font-figure font-semibold text-ink">•••• {card.last4}</span>
      <span className="text-ink-3">
        expires {String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)} · {card.currency.toUpperCase()}
      </span>
      {card.frozen ? <Chip tone="paused">Frozen</Chip> : null}
    </div>
  )
}

function Purchases({ auths }: { auths: CardAuthorization[] }) {
  return (
    <div data-testid="agent-card-purchases">
      {auths.map((a) => {
        const rate = rateText(a)
        return (
          <div key={a.id} data-testid="agent-card-purchase" className="border-t border-line first:border-t-0">
            <Row
              wrap
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {a.merchant_name || 'A merchant'}
                  <Chip tone={a.approved ? 'good' : 'bad'}>{a.approved ? 'Approved' : 'Declined'}</Chip>
                </span>
              }
              line={<span className="font-figure">{formatWhen(a.created_at)}</span>}
              amount={
                <span className="grid justify-items-end">
                  <span>{moneyText(a.amount_minor, a.currency)}</span>
                  <span className="text-body font-normal text-ink-3">
                    {a.approved && a.amount_ulxc ? <Lxc ulxc={a.amount_ulxc} sign="−" /> : 'None'}
                  </span>
                </span>
              }
            />
            {a.reason ? <p className="pb-1 text-body text-ink-3">{a.reason}</p> : null}
            {rate ? <p className="pb-2.5 font-figure text-body text-ink-3">{rate}</p> : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * B27.21 — the cardholder's phone as Stripe takes it, E.164: "+44 7700 900123" → "+447700900123". Empty stays
 * empty (Lens gives a test card an unallocated number); null when what was typed is not a phone number.
 */
export function e164(text: string): string | null {
  const compact = text.replace(/[\s().-]/g, '')
  if (compact === '') return ''
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null
}

const FIELDS: { key: keyof Cardholder; label: string; required: boolean; width: string; auto: string; type?: string }[] = [
  { key: 'first_name', label: 'First name', required: true, width: 'w-40', auto: 'given-name' },
  { key: 'last_name', label: 'Last name', required: true, width: 'w-40', auto: 'family-name' },
  { key: 'email', label: 'Email', required: false, width: 'w-64', auto: 'email' },
  { key: 'phone_number', label: 'Phone', required: false, width: 'w-48', auto: 'tel', type: 'tel' },
  { key: 'line1', label: 'Address', required: true, width: 'w-64', auto: 'address-line1' },
  { key: 'line2', label: 'Address line 2', required: false, width: 'w-64', auto: 'address-line2' },
  { key: 'city', label: 'Town or city', required: true, width: 'w-40', auto: 'address-level2' },
  { key: 'postal_code', label: 'Postcode', required: true, width: 'w-28', auto: 'postal-code' },
  { key: 'country', label: 'Country (two letters)', required: false, width: 'w-20', auto: 'country' },
]

/** B57.20: the agent's page opens it in a dialog, and closes that once the card is issued. */
export function IssueCard({ agent, onIssued }: { agent: Agent; onIssued?: () => void }) {
  const qc = useQueryClient()
  const [holder, setHolder] = useState<Cardholder>({
    first_name: '',
    last_name: '',
    email: '',
    phone_number: '',
    line1: '',
    line2: '',
    city: '',
    postal_code: '',
    country: 'GB',
  })
  const phone = e164(holder.phone_number)
  const ready = FIELDS.every((f) => !f.required || holder[f.key].trim() !== '') && phone !== null
  const issue = useMutation({
    mutationFn: () => agentBankApi.issueCard(agent.id, { ...holder, phone_number: phone ?? '' }),
    onSuccess: () => {
      onIssued?.()
      return qc.invalidateQueries({ queryKey: cardKey(agent.id) })
    },
  })
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !issue.isPending) issue.mutate()
      }}
    >
      <p className="text-body text-ink-2">
        Give {agent.name} a virtual card. Each purchase is paid from its wallet only if its rules
        allow it, converted from pounds at the day’s European Central Bank rate. Stripe issues the card to a person
        (the cardholder), and a merchant may ask for their billing address. Their phone number is optional.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {/* Named by aria-label and its placeholder, not a Field's label: nine labels on /agents doubled the time every
            test of that page takes to find a control (B57.142, measured), and the words are the form's own. */}
        {FIELDS.map((f) => (
          <Input
            key={f.key}
            aria-label={f.label}
            placeholder={f.required ? f.label : `${f.label} (optional)`}
            autoComplete={f.auto}
            type={f.type}
            aria-invalid={f.key === 'phone_number' && phone === null}
            className={f.width}
            value={holder[f.key]}
            onChange={(e) => setHolder((h) => ({ ...h, [f.key]: e.target.value }))}
          />
        ))}
      </div>
      {phone === null ? (
        <p className="text-body text-ink">
          The phone number needs its country code, like +44 7700 900123.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!ready || issue.isPending}>
          {issue.isPending ? 'Issuing…' : 'Issue a card'}
        </Button>
      </div>
      {issue.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalText(issue.error)}
        </p>
      ) : null}
    </form>
  )
}

export function AgentCardPanel({ agent }: { agent: Agent }) {
  const q = useQuery({ queryKey: cardKey(agent.id), queryFn: () => agentBankApi.card(agent.id) })
  return (
    <Card tone="white" data-testid="agent-card-panel" {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-reading font-bold text-ink">Card</h3>
        <WorkspaceLabel capability="agent_card" />
      </div>
      {q.isError ? (
        <p className="text-body text-ink-2">
          {isSessionExpired(q.error)
            ? 'Its card can’t be read until you sign in again.'
            : 'Its card could not be read just now.'}
        </p>
      ) : q.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : q.data ? (
        <>
          <div className="grid gap-3">
            <AgentCardFace agent={agent} className="max-w-78" />
            <CardFace card={q.data.card} />
          </div>
          <div className="border-t border-line pt-1">
            {(q.data.authorizations ?? []).length === 0 ? (
              <p className="py-2.5 text-body text-ink-2">
                No purchases yet. Each one appears here when the agent pays with this card, with what its rules
                decided and why.
              </p>
            ) : (
              <Purchases auths={q.data.authorizations ?? []} />
            )}
          </div>
          {/* B59.25 — what came back of its payments, and every card payment of a date range as a file. */}
          {/* Full width rules, with the two parts' own gutter plus 4 meeting the card's 20. */}
          <div className="-mx-5 border-t border-line px-1">
            <CardDisputesAndRefunds agentID={agent.id} />
            <div className="border-t border-line px-gutter py-3">
              <CardExport />
            </div>
          </div>
        </>
      ) : (
        <IssueCard agent={agent} />
      )}
    </Card>
  )
}
