import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Eyebrow, Money } from '@talyvor/ui/pocket'
import { AgentCard as AgentCardFace } from '../../cards/AgentCard'
import { DESIGN_ATTR } from '../../pocketPending'
import { BOOK_KEY, PASSKEYS_KEY, rulesKey } from './AgentBank'
import { Purchases, cardKey } from './AgentCardPanel'
import { CardDisputesAndRefunds, CardExport } from './CardDisputes'
import { type Agent, type AgentCard, type AgentRules, agentBankApi, refusalText } from './agentBankApi'
import { fromB64u, passkeysSupported } from './passkeys'
import { readFailure } from './WalletMoney'

// Cards.tsx — B59.45: Cards on the web, as the phone's Cards tab draws it (talyvor-mobile B59.34): each agent's card in its
// approved art, Frozen or not, the limits its purchases are judged by, Freeze card, and every purchase with what its rules
// decided, in the phone's words. The card's details stay hidden until the owner's passkey says it is them, and hide
// again when they leave the page. Freeze and Unfreeze are Lens's own: a frozen card is refused every purchase and
// nothing leaves the agent's wallet.

export function frozenText(name: string, card: AgentCard): string {
  return card.frozen
    ? `Frozen. Every purchase on ${name}’s card is refused, and nothing leaves its wallet, until you unfreeze it.`
    : `Unfrozen. ${name}’s card takes purchases again, each one judged by ${name}’s rules.`
}

const expiry = (card: AgentCard) =>
  `expires ${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)} · ${card.currency.toUpperCase()}`

/** The agent's rules as the phone says them (bff-client rulesInWords), one sentence each, the amounts in the workspace's money. */
function limitsInWords(r: AgentRules): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const limit = (ulxc: number | undefined, before: string, after: string) => {
    if (ulxc && ulxc > 0) out.push(<>{before} <Money ulxc={ulxc} />{after}</>)
  }
  limit(r.max_per_request_ulxc, 'Spends at most', ' on one request.')
  limit(r.hourly_limit_ulxc, 'Spends at most', ' an hour.')
  limit(r.daily_limit_ulxc, 'Spends at most', ' a day.')
  limit(r.weekly_limit_ulxc, 'Spends at most', ' a week.')
  limit(r.monthly_limit_ulxc, 'Spends at most', ' a month.')
  limit(r.approval_above_ulxc, 'Asks you first above', '.')
  if (r.requests_per_minute && r.requests_per_minute > 0) out.push(`No more than ${r.requests_per_minute} requests a minute.`)
  if (r.allowed_models?.length) out.push(`Only these models: ${r.allowed_models.join(', ')}.`)
  if (r.allowed_providers?.length) out.push(`Only these providers: ${r.allowed_providers.join(', ')}.`)
  if (r.allowed_payees?.length) out.push(`Pays only ${r.allowed_payees.length} named payee${r.allowed_payees.length === 1 ? '' : 's'}.`)
  if (r.blocked_payees?.length) out.push(`Never pays ${r.blocked_payees.length} blocked payee${r.blocked_payees.length === 1 ? '' : 's'}.`)
  if (r.active_from && r.active_until) out.push(`Works only from ${r.active_from} to ${r.active_until} (${r.timezone || 'UTC'}).`)
  return out.length ? out : ['No limits: it can spend everything it holds.']
}

/**
 * The browser's own check that the person here holds one of the workspace's passkeys, as the phone asks Face ID before it
 * shows a card's details. Nothing is sent to Lens: the details shown are the ones this page already has.
 */
async function checkItsYou(credentialIDs: string[]): Promise<'ok' | 'off' | 'cancelled'> {
  if (!passkeysSupported() || !credentialIDs.length) return 'off'
  try {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: credentialIDs.map((id) => ({ type: 'public-key' as const, id: fromB64u(id) })),
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return cred ? 'ok' : 'cancelled'
  } catch {
    return 'cancelled'
  }
}

function Details({ card, shown, onShow, onHide }: { card: AgentCard; shown: boolean; onShow: () => void; onHide: () => void }) {
  return (
    <Card className="grid justify-items-start gap-2">
      <Eyebrow>Card details</Eyebrow>
      {shown ? (
        <div data-testid="card-details" className="grid gap-1">
          <span className="font-figure text-reading font-semibold text-ink">•••• {card.last4}</span>
          <span className="text-body text-ink-3">{expiry(card)}</span>
        </div>
      ) : (
        <p className="text-body text-ink-3">Hidden until you check it is you with your passkey.</p>
      )}
      <Button variant="secondary" onClick={shown ? onHide : onShow}>
        {shown ? 'Hide card details' : 'Show card details'}
      </Button>
    </Card>
  )
}

function AgentCardEntry({ agent, shown, onShown }: { agent: Agent; shown: boolean; onShown: (id: string | null) => void }) {
  const qc = useQueryClient()
  const held = useQuery({ queryKey: cardKey(agent.id), queryFn: () => agentBankApi.card(agent.id) })
  const rules = useQuery({ queryKey: rulesKey(agent.id), queryFn: () => agentBankApi.rules(agent.id) })
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  const [said, setSaid] = useState<string | null>(null)
  const card = held.data?.card ?? null

  const show = async () => {
    if (passkeys.isError) return setSaid(readFailure(passkeys.error, 'Your passkeys'))
    const live = (passkeys.data?.passkeys ?? []).filter((p) => !p.revoked_at).map((p) => p.credential_id)
    const got = await checkItsYou(live)
    if (got === 'ok') return onShown(agent.id), setSaid(null)
    if (got === 'off') return setSaid('Card details show after your passkey. Add one in Approvals and devices on Agents first.')
  }
  const freeze = useMutation({
    mutationFn: () => (card?.frozen ? agentBankApi.unfreezeCard(agent.id) : agentBankApi.freezeCard(agent.id)),
    onSuccess: (got) => setSaid(frozenText(agent.name, got)),
    onError: (err) => setSaid(refusalText(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: cardKey(agent.id) }),
  })

  return (
    <Card tone="white" className="grid gap-4" data-testid={`card-${agent.id}`}>
      <AgentCardFace agent={agent} className="max-w-78" />
      {held.isError ? (
        <p className="text-body text-ink-2">{readFailure(held.error, 'Its card')}</p>
      ) : held.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : card === null ? (
        <p className="text-body text-ink-2">
          No card for {agent.name} yet.{' '}
          <Link className={`text-ink ${inlineLink}`} to={`/agents?${new URLSearchParams({ agent: agent.id }).toString()}`}>
            Issue one on Agents
          </Link>
        </p>
      ) : (
        <>
          {card.frozen ? (
            <div>
              <Chip tone="bad">Frozen</Chip>
            </div>
          ) : null}
          <Details card={card} shown={shown} onShow={() => void show()} onHide={() => onShown(null)} />
          <section className="grid gap-1">
            <Eyebrow>Limits</Eyebrow>
            <p className="text-body text-ink-3">Each purchase is paid from its wallet only if its rules allow it.</p>
            {rules.isError ? (
              <p className="text-body text-ink-2">{readFailure(rules.error, 'Its limits')}</p>
            ) : rules.data ? (
              limitsInWords(rules.data).map((line, i) => (
                <p key={i} className="text-body text-ink">
                  {line}
                </p>
              ))
            ) : null}
          </section>
          <div>
            <Button variant={card.frozen ? 'outline' : 'danger'} disabled={freeze.isPending} onClick={() => freeze.mutate()}>
              {card.frozen ? 'Unfreeze card' : 'Freeze card'}
            </Button>
          </div>
          {said !== null ? (
            <p role="alert" className="text-body text-ink">
              {said}
            </p>
          ) : null}
          <section className="grid gap-1">
            <Eyebrow>Purchases</Eyebrow>
            {(held.data?.authorizations ?? []).length === 0 ? (
              <p className="text-body text-ink-2">
                No purchases yet. Each one appears here when the agent pays with this card, with what its rules decided and why.
              </p>
            ) : (
              <Purchases auths={held.data?.authorizations ?? []} />
            )}
          </section>
          <div className="-mx-5 border-t border-line px-1">
            <CardDisputesAndRefunds agentID={agent.id} />
          </div>
        </>
      )}
    </Card>
  )
}

export function CardsScreen() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined && a.kind !== 'room')
  // Whose details show: one card at a time, and none once you leave the page.
  const [shown, setShown] = useState<string | null>(null)
  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-3xl gap-5 px-gutter py-4 wide:py-6">
      {book.isError ? (
        <p className="text-body text-ink-2">{readFailure(book.error, 'The agents')}</p>
      ) : book.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : agents.length === 0 ? (
        <p className="text-body text-ink-2">
          No agents yet.{' '}
          <Link className={`text-ink ${inlineLink}`} to="/agents">
            Create one on Agents
          </Link>
          , then issue its card there.
        </p>
      ) : (
        <>
          {agents.map((a) => (
            <AgentCardEntry key={a.id} agent={a} shown={shown === a.id} onShown={setShown} />
          ))}
          <Card>
            <CardExport />
          </Card>
        </>
      )}
    </div>
  )
}
