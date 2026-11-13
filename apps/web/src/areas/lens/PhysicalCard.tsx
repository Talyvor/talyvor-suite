import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Dialog, EmptyState, Field, Icon, Input, KindTile, Row, Tabs, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { cn } from '@talyvor/ui'
import { TalyvorCard } from '../../cards/TalyvorCard'
import { OWNER_HOLDER, OWNER_SUB, ownerFaces, ownerFamily, setOwnerTier, useOwnerFace } from '../../cards/ownerCard'
import { readFailure } from './WalletMoney'
import { type CardAddress, type PhysicalCard, type WorkspaceAccount, WORKSPACE_NAME_KEY, agentBankApi, refusalText, useAccount } from './agentBankApi'

// PhysicalCard.tsx — B53.12: order the physical Talyvor Card in the partner's standard design, follow its delivery,
// activate it on arrival, open the partner's own screen for the PIN, and replace one that is lost (the old card frozen
// at once). Lens holds the switch (B53.19): while it is off GET /api/money/physical-cards answers 404, this screen
// sends the person to Spending, and Spending shows no link to it.
// B57.97 — drawn in Pocket (reference w-card and its three dialogs). B56.9's Sandbox label goes beside the heading
// once that component lands; until then the place stays empty.

export const PHYSICAL_CARDS_KEY = ['physical-cards']

const oneLine = (a: CardAddress) => [a.line1, a.line2, a.city, a.postcode, a.country].filter(Boolean).join(', ')
const cardIcon = <Icon name="card" />

/** The line under a card and its chip, by what Lens says of it. */
function stateOf(c: PhysicalCard): { line: string; chip: React.ReactNode } {
  if (c.state === 'active') return { line: `Active · ${c.name_on_card}`, chip: <Chip tone="good" dot>Active</Chip> }
  if (c.state === 'frozen' && c.replaced_by) return { line: 'Frozen and replaced. The new card is listed below.', chip: <Chip tone="plain">Replaced</Chip> }
  if (c.state === 'frozen') return { line: 'Frozen. It cannot be used.', chip: <Chip tone="paused">Frozen</Chip> }
  if (c.state === 'closed') return { line: 'Closed.', chip: <Chip tone="plain">Closed</Chip> }
  const line =
    c.delivery.status === 'ordered'
      ? c.replaces
        ? 'On its way to the same address. Activate it when it arrives.'
        : 'Ordered. The partner is making it, then posts it to you.'
      : c.delivery.status === 'shipped'
        ? 'Posted. It is on its way to you.'
        : 'Delivered. Activate it with the last four digits printed on it.'
  return { line, chip: <Chip tone="wait">Not yet active</Chip> }
}

/**
 * B57.127 — the owner's own card in its tier art, the account's default until the owner picks another tier beside it.
 * The pick changes only the picture: it stays in this browser and nothing else on the page reads it. Drawn once the
 * account's type is known, so a face never claims a type the read did not give.
 * B57.143 — drawn in Pocket: a white card with the art 312 wide, as W4 draws a card, and beside it the choice under its
 * own heading and line, as Settings draws "Show amounts in".
 */
function OwnerCardFace({ account }: { account: WorkspaceAccount }) {
  const family = ownerFamily(account)
  const card = useOwnerFace(family)
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  const named = workspace.data && workspace.data.name !== workspace.data.id ? workspace.data.name : null
  return (
    <Card tone="white" data-testid="owner-card-face" className="flex flex-col gap-5 wide:flex-row wide:items-center">
      <div className="w-full max-w-78 shrink-0">
        <TalyvorCard card={card} holder={named ?? OWNER_HOLDER[family]} sub={OWNER_SUB[card.id]} />
      </div>
      <div className="grid min-w-0 gap-1">
        <h3 className="font-display text-reading font-bold text-ink">Card tier</h3>
        <p className="text-body text-ink-2">Shows your card in another tier. Only the picture changes.</p>
        <Tabs label="Card tier" tabs={ownerFaces(family).map((c) => c.tier)} value={card.tier} onChange={setOwnerTier} className="mt-2" />
      </div>
    </Card>
  )
}

function Refused({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-body text-danger">
      {refusalText(error)}
    </p>
  )
}

export function PhysicalCardScreen() {
  const qc = useQueryClient()
  const cards = useQuery({ queryKey: PHYSICAL_CARDS_KEY, queryFn: agentBankApi.physicalCards })
  const { account } = useAccount()
  const refresh = () => void qc.invalidateQueries({ queryKey: PHYSICAL_CARDS_KEY })

  const [order, setOrder] = useState({ name_on_card: '', line1: '', line2: '', city: '', postcode: '', country: 'GB' })
  const set = (p: Partial<typeof order>) => setOrder((o) => ({ ...o, ...p }))
  const [ordering, setOrdering] = useState(false)
  const place = useMutation({
    mutationFn: () => {
      const { name_on_card, ...address } = order
      return agentBankApi.orderPhysicalCard({ name_on_card: name_on_card.trim(), address })
    },
    onSuccess: () => {
      setOrdering(false)
      showSnack({ title: 'Ordered', line: 'The partner is making it. It appears under Your card with its delivery.' })
      refresh()
    },
  })
  const [activating, setActivating] = useState<string | null>(null)
  const [last4, setLast4] = useState('')
  const activate = useMutation({
    mutationFn: (id: string) => agentBankApi.activatePhysicalCard(id, last4),
    onSuccess: () => {
      setActivating(null)
      showSnack({ title: 'Activated', line: 'The card is ready to use.' })
      refresh()
    },
  })
  const [replacing, setReplacing] = useState<string | null>(null)
  const [reason, setReason] = useState<'lost' | 'stolen' | 'damaged' | null>(null)
  const replace = useMutation({
    mutationFn: ({ id, why }: { id: string; why: 'lost' | 'stolen' | 'damaged' }) => agentBankApi.replacePhysicalCard(id, why),
    onSuccess: () => {
      setReplacing(null)
      showSnack({ title: 'The old card is frozen', line: 'A new one is on its way to the same address.' })
      refresh()
    },
  })

  if (cards.data === null) return <Navigate to="/money/spending" replace />
  const list = cards.data ?? []
  // A card on its way or in use; a frozen or closed one stays listed but does not stop a new order.
  const live = list.filter((c) => c.state === 'inactive' || c.state === 'active')
  const complete = order.name_on_card.trim() !== '' && order.line1.trim() !== '' && order.city.trim() !== '' && order.postcode.trim() !== ''

  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-body text-ink-3">
          <li className="flex items-center gap-1.5">
            <Link to="/money/spending" className={pocketFocusRing}>
              Spending
            </Link>
            <Icon name="chev" size={16} />
          </li>
          <li>
            <span aria-current="page" className="text-ink">
              Talyvor Card
            </span>
          </li>
        </ol>
      </nav>
      <div className="grid max-w-2xl gap-1">
        {/* The shell's top bar holds the page's one h1. */}
        <h2 className="font-display text-title font-bold text-ink">Your Talyvor Card</h2>
        <p className="text-reading text-ink-2">
          A physical card on your own wallet, in the card partner’s standard design. It arrives switched off: activate it with the last
          four digits printed on it. Your PIN is set and shown only in the card partner’s own screens.
        </p>
      </div>

      {account ? <OwnerCardFace account={account} /> : null}

      <div className="grid items-start gap-4 wide:grid-cols-12">
        <Card tone="white" className="wide:col-span-7">
          <h3 className="font-display text-reading font-bold text-ink">Your card</h3>
          <div className="mt-2">
            {cards.isError ? (
              <p className="text-body text-ink-2">{readFailure(cards.error, 'Your card')}</p>
            ) : cards.isPending ? (
              <p className="text-body text-ink-2">Reading…</p>
            ) : list.length === 0 ? (
              <EmptyState icon={cardIcon} title="No card yet." line="Choose where to post it below, and it appears here with its delivery." />
            ) : (
              list.map((c) => {
                const { line, chip } = stateOf(c)
                return (
                  <div key={c.id} data-testid={`physical-card-${c.id}`}>
                    <Row
                      leading={<KindTile icon={cardIcon} on="white" />}
                      title={
                        <>
                          Card ending <span className="font-figure">{c.last4}</span>
                        </>
                      }
                      line={line}
                      action={chip}
                    />
                    {/* Its own line, so a narrow screen wraps the buttons rather than scrolling sideways. */}
                    <div className="flex flex-wrap gap-2 pb-2.5 empty:hidden wide:justify-end">
                      {c.state === 'inactive' && c.delivery.status !== 'ordered' ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setLast4('')
                            activate.reset()
                            setActivating(c.id)
                          }}
                        >
                          Activate
                        </Button>
                      ) : null}
                      {c.state === 'active' && c.pin_url ? (
                        <Button asChild size="sm" variant="secondary">
                          <a href={c.pin_url} target="_blank" rel="noopener noreferrer">
                            Set or view your PIN
                          </a>
                        </Button>
                      ) : null}
                      {c.state === 'active' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setReason(null)
                            replace.reset()
                            setReplacing(c.id)
                          }}
                        >
                          Lost, stolen or damaged
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        {live.length > 0 ? (
          <Card className="wide:col-span-5">
            <h3 className="font-display text-reading font-bold text-ink">Where it is posted</h3>
            <p className="mt-1 text-body text-ink-2">{oneLine(live[live.length - 1].address)}</p>
          </Card>
        ) : cards.isSuccess ? (
          <Card className="wide:col-span-5">
            <h3 className="font-display text-reading font-bold text-ink">Order a card</h3>
            <form
              className="mt-2 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (complete) {
                  place.reset()
                  setOrdering(true)
                }
              }}
            >
              <Field label="Name on the card">
                <Input value={order.name_on_card} onChange={(e) => set({ name_on_card: e.target.value })} />
              </Field>
              <Field label="Address line 1">
                <Input value={order.line1} onChange={(e) => set({ line1: e.target.value })} />
              </Field>
              <Field label="Address line 2 (optional)">
                <Input value={order.line2} onChange={(e) => set({ line2: e.target.value })} />
              </Field>
              <div className="grid gap-3 wide:grid-cols-3">
                <Field label="Town or city" className="min-w-0 grid-cols-1">
                  <Input value={order.city} onChange={(e) => set({ city: e.target.value })} />
                </Field>
                <Field label="Postcode" className="min-w-0 grid-cols-1">
                  <Input value={order.postcode} onChange={(e) => set({ postcode: e.target.value })} />
                </Field>
                <Field label="Country" className="min-w-0 grid-cols-1">
                  <Input placeholder="GB" maxLength={2} value={order.country} onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
                </Field>
              </div>
              <div>
                <Button type="submit" disabledReason={complete ? undefined : 'Fill in the name, the first line, the town and the postcode first.'}>
                  Order the card
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={ordering}
        onClose={() => setOrdering(false)}
        title="Order a Talyvor Card?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setOrdering(false)}>
              Cancel
            </Button>
            <Button disabled={place.isPending} onClick={() => place.mutate()}>
              {place.isPending ? 'Ordering…' : 'Order it'}
            </Button>
          </>
        }
      >
        <p>
          It is posted to {order.line1.trim()}, {order.city.trim()} {order.postcode.trim()}, and arrives switched off.
        </p>
        {place.isError ? <Refused error={place.error} /> : null}
      </Dialog>

      <Dialog
        open={activating !== null}
        onClose={() => setActivating(null)}
        title="Activate your card"
        actions={
          <>
            <Button variant="secondary" onClick={() => setActivating(null)}>
              Cancel
            </Button>
            <Button
              disabledReason={/^\d{4}$/.test(last4) ? undefined : 'Type the four digits first.'}
              disabled={activate.isPending}
              onClick={() => activating && activate.mutate(activating)}
            >
              {activate.isPending ? 'Activating…' : 'Activate'}
            </Button>
          </>
        }
      >
        <p>Type the last four digits printed on the card.</p>
        <Field label="Last four digits on the card">
          <Input inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
        </Field>
        {activate.isError ? <Refused error={activate.error} /> : null}
      </Dialog>

      <Dialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title="What happened to the card?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setReplacing(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabledReason={reason ? undefined : 'Choose what happened first.'}
              disabled={replace.isPending}
              onClick={() => replacing && reason && replace.mutate({ id: replacing, why: reason })}
            >
              {replace.isPending ? 'Freezing…' : 'Freeze and replace'}
            </Button>
          </>
        }
      >
        <div role="group" aria-label="What happened to the card" className="flex flex-wrap gap-2">
          {(['lost', 'stolen', 'damaged'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'flex h-10 items-center gap-2.5 rounded-control px-3 text-body font-semibold text-ink',
                reason === r ? 'bg-page ring-2 ring-inset ring-ink' : 'bg-cloud',
                pocketFocusRing,
              )}
            >
              <span aria-hidden="true" className={cn('h-4 w-4 rounded-pill', reason === r ? 'bg-ink' : 'shadow-edge')} />
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <p>The card is frozen at once, and a new one is posted to the same address.</p>
        {replace.isError ? <Refused error={replace.error} /> : null}
      </Dialog>
    </div>
  )
}
