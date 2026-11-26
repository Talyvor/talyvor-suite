import { useId, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Facts, Field, Icon, Input, Money, Row, Select, pocketFocusRing, type ChipTone } from '@talyvor/ui/pocket'
import { inlineLink } from '@talyvor/ui'
import { DESIGN_ATTR } from '../../pocketPending'
import { WorkspaceLabel } from '../../labels/workspace'
import { AgentFace } from './AgentFace'
import { formatWhen } from './format'
import { ArrivesChip } from './InstantTransfer'
import { Note, PanelForm, readFailure } from './WalletMoney'
import { AgentBankError, type Agent, type CryptoAddress, type CryptoSend, type CryptoSendQuote, type CryptoSendRequest, cryptoSendApi, newMoveKey, refusalText, usdcMinorOf } from './agentBankApi'
import { assertOver } from './passkeys'

// AgentCryptoSend.tsx — B48.36: Send USDC from an agent's crypto wallet (Lens B48.9). To any 0x address or to another of
// the workspace's agents, on a network: the quote first (the amount, the most the network fee can be and who pays it,
// when it arrives, the receiving agent's trust label, and whether the address is new), then Send under one
// Idempotency-Key — kept until Lens answers, so a retry after no answer sends that same send once — then the receipt
// with its explorer link. A first send the agent asked for to a new address waits for the owner, who approves it,
// sends a test amount there first, or declines it, here and on Approvals. History lists what was sent and received.
// B48.47 — or to a person on Talyvor by their @name, email or phone number, which Lens resolves to the wallet they chose.
// B57.202 — in Pocket: the quote is W3's quote card (its facts with the amount as the strong row, the ink Arrives chip,
// the note) and a send waiting for the owner is a w-approvals waiting row, with Review, inside Approvals' Waiting for you.
// B48.50 — or to a name.eth or a name the owner saved an address under (Lens B48.49), the quote showing the address it
// resolved to; the owner keeps their saved addresses under Send; and once the workspace has a passkey, the owner's send,
// and their yes to an agent's send to a new address or its test amount, are signed with it over Lens's challenge for
// exactly that send. Nothing is signed when the challenge names another address or amount than the one reviewed.
// B57.223 — in Pocket: each saved address is a w-agent-research Money card row (its initial on a round tile, the whole
// row pressed to send to it, Remove at its end), as the phone draws it (B48.51); a send by name keeps that name on the
// receipt and the history; and the quote carries W3's passkey note.

export const cryptoSendsKey = (id: string) => ['agent-crypto-sends', id]

/** The networks agents send on. Lens refuses one it does not serve here. */
const NETWORKS: { value: string; name: string }[] = [
  { value: 'base', name: 'Base' },
  { value: 'base-sepolia', name: 'Base Sepolia' },
]
const networkName = (n: string) => NETWORKS.find((x) => x.value === n)?.name ?? n

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
/** Where a send goes, by the name it was sent to when it has one: "Treasury (0x1111…1111)". */
const sendsTo = (s: Pick<CryptoSendQuote, 'to' | 'saved_name' | 'ens_name'>) =>
  s.saved_name || s.ens_name ? `${s.saved_name || s.ens_name} (${shortAddress(s.to)})` : shortAddress(s.to)

/** Wei as the network's coin, to at most six decimals: "0.000042 ETH". */
export function feeText(wei: string): string {
  let n: bigint
  try {
    n = BigInt(wei || '0')
  } catch {
    return 'Not known'
  }
  const whole = n / 10n ** 18n
  const micro = (n % 10n ** 18n) / 10n ** 12n + ((n % 10n ** 12n) > 0n ? 1n : 0n) // a fee rounds up
  const frac = micro.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''} ETH`
}

function arrivalText(seconds?: number): string {
  if (!seconds) return 'When the network confirms it'
  return seconds < 90 ? `In about ${seconds} seconds` : `In about ${Math.round(seconds / 60)} minutes`
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

const STATUS: Record<CryptoSend['status'], { words: string; tone: ChipTone }> = {
  awaiting_owner: { words: 'Waiting for you', tone: 'wait' },
  sending: { words: 'Sending', tone: 'wait' },
  sent: { words: 'Sent', tone: 'wait' },
  landed: { words: 'Arrived', tone: 'good' },
  failed: { words: 'Failed', tone: 'bad' },
  refused: { words: 'Refused', tone: 'bad' },
}

/** Who it goes to, as the quote and the receipt name it. */
function Recipient({ q }: { q: Pick<CryptoSendQuote, 'to' | 'to_kind' | 'to_label'> }) {
  return (
    <span className="grid justify-items-end">
      <span className="break-all font-figure">{q.to}</span>
      {q.to_kind === 'agent' && q.to_label ? <span className="text-ink-3">{q.to_label}</span> : null}
    </span>
  )
}

function QuoteFacts({ q, agent }: { q: CryptoSendQuote; agent: Agent }) {
  const named = q.saved_name || q.ens_name
  return (
    <Facts
      facts={[
        // B48.50 — a saved or ENS name is shown with the address it resolved to, which is what is signed and sent to.
        ...(named
          ? [
              { label: 'To', value: <span data-testid="crypto-send-name">{named}</span> },
              { label: 'Address', value: <span className="break-all font-figure" data-testid="crypto-send-resolved">{q.to}</span> },
            ]
          : [{ label: 'To', value: <Recipient q={q} /> }]),
        { label: 'Network', value: networkName(q.network) },
        {
          label: 'Network fee, at most',
          value: (
            <span className="grid justify-items-end">
              <span className="font-figure">{feeText(q.max_fee_wei)}</span>
              <span className="text-ink-3">{q.fee_paid_by === 'workspace_gas_budget' ? 'Paid from your network fee budget' : `Paid by ${agent.name}’s wallet`}</span>
            </span>
          ),
        },
        {
          label: <span className="font-semibold text-ink">You send</span>,
          value: (
            <span data-testid="crypto-send-amount" className="font-display text-title font-bold">
              <Money minor={q.amount_minor} currency="USDC" />
            </span>
          ),
        },
      ]}
    />
  )
}

/** The receipt: where the send stands, and its transaction on the network's explorer. */
function Receipt({ s }: { s: CryptoSend }) {
  const st = STATUS[s.status]
  return (
    <div className="grid gap-2" data-testid="crypto-send-receipt" role="status">
      <div className="flex items-center gap-2">
        <Chip tone={st.tone}>{st.words}</Chip>
        <span className="text-body text-ink">
          {s.status === 'awaiting_owner'
            ? 'A first send to a new address waits for the workspace’s owner.'
            : s.status === 'refused' || s.status === 'failed'
              ? s.reason || 'Nothing was sent.'
              : (
                  <>
                    <Money minor={s.amount_minor} currency="USDC" /> to {sendsTo(s)}
                  </>
                )}
        </span>
      </div>
      {s.tx_hash ? (
        <p className="text-body text-ink-3">
          Transaction <span className="break-all font-figure text-ink">{s.tx_hash}</span>
          {s.explorer_url ? (
            <>
              {' · '}
              <a href={s.explorer_url} target="_blank" rel="noreferrer" className={`font-semibold text-ink ${inlineLink}`}>
                See it on the explorer
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

/** A send Lens did not answer may have gone: pressing Send again under the same key sends it once, never twice. */
function sendFailure(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Cancelled. Nothing was sent.'
  return err instanceof AgentBankError && err.status < 500 ? refusalText(err) : 'There was no answer. Press Send again: it is sent once, however many times you press.'
}

/**
 * B48.50 — the owner's send, signed with their passkey over Lens's challenge for exactly this body and key once the
 * workspace has one. The challenge names the address `to` resolves to now; when that, the amount or the network is not
 * what the owner reviewed, nothing is signed or sent.
 */
async function sendSigned(agentID: string, body: CryptoSendRequest, key: string, reviewed: CryptoSendQuote): Promise<CryptoSend> {
  const c = await cryptoSendApi.challenge(agentID, body, key)
  const q = c.quote
  // A name pointed elsewhere since it was reviewed: refused here, as Lens refuses a send that no longer matches.
  if (q && (q.to.toLowerCase() !== reviewed.to.toLowerCase() || q.amount_minor !== reviewed.amount_minor || q.network !== reviewed.network)) {
    throw new AgentBankError(409, `/api/agents/${agentID}/crypto-sends/challenge`, `The address changed: ${body.to} now goes to ${q.to}, not the address you reviewed. Nothing was sent: review it again.`)
  }
  return cryptoSendApi.send(agentID, body, key, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/** B48.50 — the owner's yes, or their test amount, signed the same way over the challenge naming that answer. */
async function approveSigned(agentID: string, sendID: string, test?: number): Promise<CryptoSend> {
  const c = await cryptoSendApi.approveChallenge(agentID, sendID, test)
  return cryptoSendApi.approve(agentID, sendID, test, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

const answerFailure = (err: unknown) => (err instanceof DOMException && err.name === 'NotAllowedError' ? 'Cancelled. Nothing changed.' : refusalText(err))

/** The owner's answer to a send waiting for them, as w-approvals draws a waiting row: Review opens Approve, Send a test
 *  amount first and Decline. The address is shown in full, so the owner reads the whole of it before approving. */
export function AwaitingCryptoSend({ agent, s }: { agent: Agent; s: CryptoSend }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState('')
  const testMinor = usdcMinorOf(test)
  const answer = useMutation({
    mutationFn: (a: { approve: boolean; test?: number }) =>
      a.approve ? approveSigned(agent.id, s.id, a.test) : cryptoSendApi.decline(agent.id, s.id),
    onSettled: () => qc.invalidateQueries({ queryKey: cryptoSendsKey(agent.id) }),
  })
  const busy = answer.isPending
  return (
    <div data-crypto-send={s.id} {...{ [DESIGN_ATTR]: 'pocket' }} className="border-t border-line first:border-t-0">
      <Row
        wrap
        leading={<AgentFace agent={agent} waiting />}
        title={`${agent.name} wants to send to a new address`}
        line={
          // Sandbox or live, as Approvals' other waiting rows say it (B56.11).
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <WorkspaceLabel capability="stablecoins" />
            <span className="whitespace-normal">
              <span className="break-all font-figure">{s.to}</span> on {networkName(s.network)}
              {s.to_kind === 'agent' && s.to_label ? ` · ${s.to_label}` : ''} · asked <span className="font-figure">{formatWhen(s.created_at)}</span>
            </span>
          </span>
        }
        amount={<Money minor={s.amount_minor} currency="USDC" />}
        action={
          open ? null : (
            <Button variant="secondary" size="sm" data-tangerine="your-move" onClick={() => setOpen(true)}>
              Review
            </Button>
          )
        }
      />
      {open ? (
        <div className="grid gap-2 pb-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => answer.mutate({ approve: true })}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setTesting((t) => !t)} aria-expanded={testing}>
              Send a test amount first
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => answer.mutate({ approve: false })}>
              Decline
            </Button>
          </div>
          {testing ? (
            <PanelForm onSubmit={() => (testMinor !== null && testMinor < s.amount_minor && !busy ? answer.mutate({ approve: true, test: testMinor }) : undefined)}>
              <Field label="Test amount in USDC">
                <Input inputMode="decimal" placeholder="0.10" value={test} onChange={(e) => setTest(e.target.value)} />
              </Field>
              <div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy}
                  disabledReason={testMinor !== null && testMinor < s.amount_minor ? undefined : 'Type an amount less than the send first'}
                >
                  Send the test amount
                </Button>
              </div>
            </PanelForm>
          ) : null}
          {answer.isError ? <Note ok={false}>{answerFailure(answer.error)}</Note> : null}
        </div>
      ) : null}
    </div>
  )
}

const addressesKey = ['crypto-addresses']

/** A saved address's initial on its round tile, as w-members draws a person's. */
function Initial({ of }: { of: string }) {
  return (
    <span aria-hidden="true" data-testid="crypto-address-initial" className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-cloud-2 text-body font-bold text-ink">
      {(of.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

/** One saved address as a Money card row: pressing the row sends to it by its name; Remove sits above the press. */
function SavedAddressRow({ a, busy, onPick, onRemove }: { a: CryptoAddress; busy: boolean; onPick: () => void; onRemove: () => void }) {
  const id = useId()
  return (
    <div data-crypto-address={a.id} className="relative flex items-center gap-3 border-t border-line py-2.5 text-reading first:border-t-0">
      <Initial of={a.name} />
      <span className="min-w-0 flex-1">
        <button type="button" onClick={onPick} aria-describedby={id} className={`block rounded-control text-left font-semibold text-ink ${pocketFocusRing}`}>
          <span aria-hidden="true" className="absolute inset-0" />
          {a.name}
        </button>
        <span id={id} className="block font-figure text-body text-ink-3">
          {shortAddress(a.address)}
        </span>
      </span>
      <span className="relative shrink-0">
        <Button variant="secondary" size="sm" aria-label={`Remove ${a.name}`} disabled={busy} onClick={onRemove}>
          Remove
        </Button>
      </span>
    </div>
  )
}

/** B48.50 — the workspace's saved addresses: pressing one sends to it by its name; the owner saves and removes them. */
function SavedAddresses({ onPick }: { onPick: (name: string) => void }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: addressesKey, queryFn: cryptoSendApi.addresses, retry: false })
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const saved = () => qc.invalidateQueries({ queryKey: addressesKey })
  const save = useMutation({
    mutationFn: () => cryptoSendApi.saveAddress(name.trim(), address.trim()),
    onSuccess: () => {
      setName('')
      setAddress('')
    },
    onSettled: saved,
  })
  const remove = useMutation({ mutationFn: (a: CryptoAddress) => cryptoSendApi.removeAddress(a.id), onSettled: saved })
  const busy = save.isPending || remove.isPending
  const ok = name.trim() !== '' && isAddress(address)
  const list = book.data?.addresses ?? []
  return (
    <section aria-label="Saved addresses" className="grid gap-1" data-testid="crypto-saved-addresses">
      <h3 className="font-semibold text-ink">Saved addresses</h3>
      {book.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : book.isError ? (
        <p className="text-body text-ink-2">{readFailure(book.error, 'Your saved addresses')}</p>
      ) : list.length === 0 ? (
        <p className="text-body text-ink-3">No saved addresses yet. Add one below.</p>
      ) : (
        <div>
          {list.map((a) => (
            <SavedAddressRow key={a.id} a={a} busy={busy} onPick={() => onPick(a.name)} onRemove={() => remove.mutate(a)} />
          ))}
        </div>
      )}
      <PanelForm className="pt-2" onSubmit={() => (ok && !busy ? save.mutate() : undefined)}>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Name">
            <Input placeholder="Treasury" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Address">
            <Input placeholder="0x…" spellCheck={false} autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={busy} disabledReason={ok ? undefined : 'Type a name and a 0x address first'}>
            {save.isPending ? 'Saving…' : 'Save address'}
          </Button>
        </div>
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
        {remove.isError ? <Note ok={false}>{refusalText(remove.error)}</Note> : null}
      </PanelForm>
    </section>
  )
}

/** What the agent sent and was sent, each with where it stands and its explorer link. */
function History({ agent }: { agent: Agent }) {
  const list = useQuery({
    queryKey: cryptoSendsKey(agent.id),
    queryFn: () => cryptoSendApi.list(agent.id),
    // A send on its way is read again until it arrives or fails.
    refetchInterval: (q) => ((q.state.data?.sends ?? []).some((s) => s.status === 'sending' || s.status === 'sent') ? 5000 : false),
  })
  if (list.isPending) return <p className="text-body text-ink-3">Reading…</p>
  if (list.isError) return <p className="text-body text-ink-2">{readFailure(list.error, `${agent.name}’s sends`)}</p>
  const sends = list.data.sends ?? []
  const waiting = sends.filter((s) => s.direction === 'out' && s.status === 'awaiting_owner')
  const rest = sends.filter((s) => !waiting.includes(s))
  return (
    <div className="grid gap-3">
      {waiting.length > 0 ? (
        <section aria-label="Waiting for you" className="grid gap-1">
          <h3 className="font-semibold text-ink">Waiting for you</h3>
          {waiting.map((s) => (
            <AwaitingCryptoSend key={s.id} agent={agent} s={s} />
          ))}
        </section>
      ) : null}
      <section aria-label="Sent and received" className="grid gap-1" data-testid="crypto-send-history">
        <h3 className="font-semibold text-ink">Sent and received</h3>
        {rest.length === 0 ? (
          <p className="text-body text-ink-3">{agent.name} has not sent or received USDC yet.</p>
        ) : (
          rest.map((s) => (
            <div key={s.id} data-crypto-send={s.id} className="border-t border-line first:border-t-0">
              <Row
                wrap
                title={s.direction === 'in' ? `From ${shortAddress(s.to)}` : `To ${s.saved_name || s.ens_name || shortAddress(s.to)}`}
                line={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].words}</Chip>
                    <span>
                      <span className="font-figure">{formatWhen(s.created_at)}</span> · {networkName(s.network)}
                    </span>
                    {s.explorer_url ? (
                      <a href={s.explorer_url} target="_blank" rel="noreferrer" className={`font-semibold text-ink ${inlineLink}`}>
                        See it on the explorer
                      </a>
                    ) : null}
                  </span>
                }
                amount={
                  <>
                    {s.direction === 'in' ? '+' : '−'}
                    <Money minor={s.amount_minor} currency="USDC" />
                  </>
                }
              />
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/** Send USDC: to an address, a name.eth, a saved name, a person or another agent → the quote, with the address it
 *  resolved to → Send, signed with the owner's passkey → the receipt; then the saved addresses and the history. */
export function AgentCryptoSend({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const qc = useQueryClient()
  const [toAgent, setToAgent] = useState('')
  const [to, setTo] = useState('')
  const [network, setNetwork] = useState(NETWORKS[0].value)
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<CryptoSendQuote | null>(null)
  // One key per send, kept through every retry until Lens answers it.
  const [key, setKey] = useState(newMoveKey)
  const others = agents.filter((a) => a.id !== agent.id)
  const other = useQuery({
    queryKey: ['agent-smart-account', toAgent],
    queryFn: () => cryptoSendApi.smartAccount(toAgent),
    enabled: toAgent !== '',
    retry: false,
  })
  const address = toAgent ? (other.data?.address ?? '') : to.trim()
  const minor = usdcMinorOf(amount)
  const request = (): CryptoSendRequest => ({ to: address, network, token: 'USDC', amount_minor: minor ?? 0 })
  const ask = useMutation({ mutationFn: () => cryptoSendApi.quote(agent.id, request()), onSuccess: setQuote })
  const sent = useMutation({
    mutationFn: (reviewed: CryptoSendQuote) => sendSigned(agent.id, request(), key, reviewed),
    onSuccess: () => {
      setKey(newMoveKey())
      setQuote(null)
      setAmount('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cryptoSendsKey(agent.id) }),
  })
  const change = () => {
    setQuote(null)
    ask.reset()
  }
  // A name.eth, a saved name or a person is checked by Lens, which answers the address it names or nobody found.
  const ready = (toAgent ? isAddress(address) : address !== '') && minor !== null
  return (
    <div className="grid gap-4" data-testid="agent-crypto-send">
      {quote ? (
        <div className="grid gap-3" data-testid="crypto-send-quote">
          <QuoteFacts q={quote} agent={agent} />
          <ArrivesChip data-testid="crypto-send-arrives">Arrives {lowerFirst(arrivalText(quote.arrival_seconds))}</ArrivesChip>
          <Button size="lg" className="w-full" disabled={sent.isPending} onClick={() => sent.mutate(quote)}>
            {sent.isPending ? 'Sending…' : 'Send'}
          </Button>
          <Button variant="secondary" className="w-full" disabled={sent.isPending} onClick={change}>
            Change
          </Button>
          {quote.new_address ? (
            <p className="flex items-start gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2" data-testid="crypto-send-new-address">
              <Icon name="key" size={16} />
              <span>A new address: this workspace has not paid it before.</span>
            </p>
          ) : null}
          <p className="flex items-start gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2">
            <Icon name="key" size={16} />
            <span>Your passkey or Face ID asks before anything is sent.</span>
          </p>
          {sent.isError ? <Note ok={false}>{sendFailure(sent.error)}</Note> : null}
        </div>
      ) : (
        <PanelForm onSubmit={() => (ready && !ask.isPending ? ask.mutate() : undefined)}>
          {others.length > 0 ? (
            <Field label="Send to">
              <Select value={toAgent} onChange={(e) => setToAgent(e.target.value)}>
                <option value="">A wallet address or a person</option>
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {toAgent ? (
            other.isError ? (
              <Note ok={false}>{others.find((a) => a.id === toAgent)?.name ?? 'That agent'} has no crypto wallet yet.</Note>
            ) : null
          ) : (
            <Field label="Wallet address, name.eth, saved name, @name, email or phone">
              <Input placeholder="0x…, name.eth or @name" spellCheck={false} autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          )}
          <div className="grid gap-3 wide:grid-cols-2">
            <Field label="Network">
              <Select value={network} onChange={(e) => setNetwork(e.target.value)}>
                {NETWORKS.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount in USDC">
              <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={ask.isPending} disabledReason={ready ? undefined : 'Type who it goes to and an amount first'}>
              {ask.isPending ? 'Reading the quote…' : 'Review'}
            </Button>
          </div>
          {ask.isError ? <Note ok={false}>{refusalText(ask.error)}</Note> : null}
        </PanelForm>
      )}
      {sent.data ? <Receipt s={sent.data} /> : null}
      {quote ? null : (
        <div className="border-t border-line pt-3">
          <SavedAddresses
            onPick={(name) => {
              setToAgent('')
              setTo(name)
            }}
          />
        </div>
      )}
      <div className="border-t border-line pt-3">
        <History agent={agent} />
      </div>
    </div>
  )
}

/**
 * B48.36, B57.202 — every agent's send to a new address that waits for the owner, for Approvals' Waiting for you and the
 * sidebar's badge. `failed` is whether some agent's sends could not be read. Nothing is read for a workspace without the
 * on-chain side.
 */
export function useCryptoSendsWaiting(agents: Agent[], enabled: boolean): { waiting: { a: Agent; s: CryptoSend }[]; failed: boolean } {
  const lists = useQueries({
    queries: (enabled ? agents : []).map((a) => ({ queryKey: cryptoSendsKey(a.id), queryFn: () => cryptoSendApi.list(a.id), retry: false })),
  })
  const waiting = (enabled ? agents : []).flatMap((a, i) =>
    (lists[i]?.data?.sends ?? []).filter((s) => s.direction === 'out' && s.status === 'awaiting_owner').map((s) => ({ a, s })),
  )
  return { waiting, failed: lists.some((l) => l.isError) }
}
