import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Note, readFailure } from './WalletMoney'
import { type CardAddress, type PhysicalCard, agentBankApi, refusalText } from './agentBankApi'

// PhysicalCard.tsx — B53.12: order the physical Talyvor Card in the partner's standard design, follow its delivery,
// activate it on arrival, open the partner's own screen for the PIN, and replace one that is lost (the old card frozen
// at once). Lens holds the switch (B53.19): while it is off GET /api/money/physical-cards answers 404, this screen
// sends the person to Spending, and Spending shows no link to it.

export const PHYSICAL_CARDS_KEY = ['physical-cards']

const DELIVERY: Record<PhysicalCard['delivery']['status'], string> = {
  ordered: 'Ordered — the partner is making it',
  shipped: 'Posted — on its way to you',
  delivered: 'Delivered',
}
const STATE: Record<PhysicalCard['state'], string> = {
  inactive: 'Not yet active',
  active: 'Active',
  frozen: 'Frozen',
  closed: 'Closed',
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const oneLine = (a: CardAddress) => [a.line1, a.line2, a.city, a.postcode, a.country].filter(Boolean).join(', ')

export function PhysicalCardScreen() {
  const qc = useQueryClient()
  const cards = useQuery({ queryKey: PHYSICAL_CARDS_KEY, queryFn: agentBankApi.physicalCards })
  const refresh = () => void qc.invalidateQueries({ queryKey: PHYSICAL_CARDS_KEY })

  const [order, setOrder] = useState({ name_on_card: '', line1: '', line2: '', city: '', postcode: '', country: 'GB' })
  const set = (p: Partial<typeof order>) => setOrder((o) => ({ ...o, ...p }))
  const place = useMutation({
    mutationFn: () => {
      const { name_on_card, ...address } = order
      return agentBankApi.orderPhysicalCard({ name_on_card: name_on_card.trim(), address })
    },
    onSuccess: refresh,
  })
  const [last4, setLast4] = useState('')
  const activate = useMutation({ mutationFn: (id: string) => agentBankApi.activatePhysicalCard(id, last4), onSuccess: refresh })
  const [reason, setReason] = useState<'lost' | 'stolen' | 'damaged'>('lost')
  const replace = useMutation({ mutationFn: (id: string) => agentBankApi.replacePhysicalCard(id, reason), onSuccess: refresh })

  if (cards.data === null) return <Navigate to="/money/spending" replace />
  const list = cards.data ?? []
  // A card on its way or in use; a frozen or closed one stays listed but does not stop a new order.
  const live = list.some((c) => c.state === 'inactive' || c.state === 'active')
  const complete = order.name_on_card.trim() !== '' && order.line1.trim() !== '' && order.city.trim() !== '' && order.postcode.trim() !== ''

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Talyvor Card"
        heading="Your Talyvor Card"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A physical card on your own wallet, in the card partner’s standard design. It arrives switched off: activate it with the
          last four digits printed on it. Your PIN is set and shown only in the card partner’s own screens.
        </p>
      </Region>
      <Region index="01" label="Your cards" heading="Your card" className="flex max-w-2xl flex-col gap-3">
        {cards.isError ? (
          <p className="text-body text-muted">{readFailure(cards.error, 'Your card')}</p>
        ) : cards.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">No card yet. Choose where to post it below, and it appears here with its delivery.</p>
        ) : (
          <Card>
            <CardHeader>Cards</CardHeader>
            {list.map((c) => (
              <Row
                key={c.id}
                stack
                data-testid={`physical-card-${c.id}`}
                label={
                  <>
                    Card ending <span className="font-figure">{c.last4}</span> · {STATE[c.state]}
                  </>
                }
                hint={
                  <>
                    {c.name_on_card} · {oneLine(c.address)}
                    <br />
                    {c.state === 'inactive' ? (
                      <>
                        {DELIVERY[c.delivery.status]} · <span className="font-figure">{day(c.delivery.updated_at)}</span>
                      </>
                    ) : c.replaced_by ? (
                      'Replaced — the new card is listed here'
                    ) : (
                      <>
                        Ordered <span className="font-figure">{day(c.created_at)}</span>
                      </>
                    )}
                  </>
                }
              >
                {c.state === 'inactive' && c.delivery.status !== 'ordered' ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (/^\d{4}$/.test(last4) && !activate.isPending) activate.mutate(c.id)
                    }}
                  >
                    <Input
                      aria-label="Last four digits on the card"
                      placeholder="Last 4"
                      className="w-28 font-figure"
                      inputMode="numeric"
                      maxLength={4}
                      value={last4}
                      onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
                    />
                    <Button type="submit" variant="primary" disabled={!/^\d{4}$/.test(last4) || activate.isPending}>
                      {activate.isPending ? 'Activating…' : 'Activate'}
                    </Button>
                  </form>
                ) : null}
                {c.state === 'active' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {c.pin_url ? (
                      <a className={inlineLink} href={c.pin_url} target="_blank" rel="noopener noreferrer">
                        Set or view your PIN
                      </a>
                    ) : null}
                    <select
                      aria-label="What happened to the card"
                      className={`h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value as typeof reason)}
                    >
                      <option value="lost">Lost</option>
                      <option value="stolen">Stolen</option>
                      <option value="damaged">Damaged</option>
                    </select>
                    <Button variant="danger" disabled={replace.isPending} onClick={() => replace.mutate(c.id)}>
                      {replace.isPending ? 'Freezing…' : 'Freeze and replace'}
                    </Button>
                  </div>
                ) : null}
              </Row>
            ))}
          </Card>
        )}
        {activate.isError ? <Note ok={false}>{refusalText(activate.error)}</Note> : null}
        {activate.isSuccess ? <Note ok>Activated. The card is ready to use.</Note> : null}
        {replace.isError ? <Note ok={false}>{refusalText(replace.error)}</Note> : null}
        {replace.isSuccess ? <Note ok>The old card is frozen. A new one is on its way to the same address.</Note> : null}
      </Region>
      {cards.isSuccess && !live ? (
        <Region index="02" label="Order" heading="Order a card" className="flex max-w-2xl flex-col gap-3">
          <form
            className="flex flex-col gap-3"
            data-testid="order-physical-card"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !place.isPending) place.mutate()
            }}
          >
            <Input aria-label="Name on the card" placeholder="Name on the card" value={order.name_on_card} onChange={(e) => set({ name_on_card: e.target.value })} />
            <Input aria-label="Address line 1" placeholder="Address line 1" value={order.line1} onChange={(e) => set({ line1: e.target.value })} />
            <Input aria-label="Address line 2" placeholder="Address line 2 (optional)" value={order.line2} onChange={(e) => set({ line2: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Town or city" placeholder="Town or city" className="w-48" value={order.city} onChange={(e) => set({ city: e.target.value })} />
              <Input aria-label="Postcode" placeholder="Postcode" className="w-32" value={order.postcode} onChange={(e) => set({ postcode: e.target.value })} />
              <Input
                aria-label="Country code"
                placeholder="GB"
                className="w-16"
                maxLength={2}
                value={order.country}
                onChange={(e) => set({ country: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Button type="submit" variant="primary" disabled={!complete || place.isPending}>
                {place.isPending ? 'Ordering…' : 'Order card'}
              </Button>
            </div>
            {place.isError ? <Note ok={false}>{refusalText(place.error)}</Note> : null}
          </form>
        </Region>
      ) : null}
    </RegionScreen>
  )
}
