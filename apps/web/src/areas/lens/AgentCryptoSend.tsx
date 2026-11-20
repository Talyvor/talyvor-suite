import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Facts, Field, Input, Money, Row, Select, type ChipTone } from '@talyvor/ui/pocket'
import { inlineLink } from '@talyvor/ui'
import { Note, PanelForm, readFailure } from './WalletMoney'
import { AgentBankError, type Agent, type CryptoSend, type CryptoSendQuote, type CryptoSendRequest, cryptoSendApi, newMoveKey, refusalText, usdcMinorOf } from './agentBankApi'

// AgentCryptoSend.tsx — B48.36: Send USDC from an agent's crypto wallet (Lens B48.9). To any 0x address or to another of
// the workspace's agents, on a network: the quote first (the amount, the most the network fee can be and who pays it,
// when it arrives, the receiving agent's trust label, and whether the address is new), then Send under one
// Idempotency-Key — kept until Lens answers, so a retry after no answer sends that same send once — then the receipt
// with its explorer link. A first send the agent asked for to a new address waits for the owner, who approves it,
// sends a test amount there first, or declines it, here and on Approvals. History lists what was sent and received.

export const cryptoSendsKey = (id: string) => ['agent-crypto-sends', id]

/** The networks agents send on. Lens refuses one it does not serve here. */
const NETWORKS: { value: string; name: string }[] = [
  { value: 'base', name: 'Base' },
  { value: 'base-sepolia', name: 'Base Sepolia' },
]
const networkName = (n: string) => NETWORKS.find((x) => x.value === n)?.name ?? n

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

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
  return (
    <Facts
      facts={[
        { label: 'You send', value: <Money minor={q.amount_minor} currency="USDC" /> },
        { label: 'To', value: <Recipient q={q} /> },
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
        { label: 'Arrives', value: arrivalText(q.arrival_seconds) },
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
                    <Money minor={s.amount_minor} currency="USDC" /> to {shortAddress(s.to)}
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
  return err instanceof AgentBankError && err.status < 500 ? refusalText(err) : 'There was no answer. Press Send again: it is sent once, however many times you press.'
}

/** The owner's answer to a send waiting for them: Approve, Send a test amount first, or Decline. */
export function AwaitingCryptoSend({ agent, s }: { agent: Agent; s: CryptoSend }) {
  const qc = useQueryClient()
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState('')
  const testMinor = usdcMinorOf(test)
  const answer = useMutation({
    mutationFn: (a: { approve: boolean; test?: number }) =>
      a.approve ? cryptoSendApi.approve(agent.id, s.id, a.test) : cryptoSendApi.decline(agent.id, s.id),
    onSettled: () => qc.invalidateQueries({ queryKey: cryptoSendsKey(agent.id) }),
  })
  const busy = answer.isPending
  return (
    <div data-crypto-send={s.id} className="grid gap-2 border-t border-line py-2 first:border-t-0">
      <Row
        wrap
        title={`${agent.name} wants to send to a new address`}
        line={
          <>
            <span className="break-all font-figure">{s.to}</span> on {networkName(s.network)}
            {s.to_kind === 'agent' && s.to_label ? ` · ${s.to_label}` : ''}
          </>
        }
        amount={<Money minor={s.amount_minor} currency="USDC" />}
      />
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
      {answer.isError ? <Note ok={false}>{refusalText(answer.error)}</Note> : null}
    </div>
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
                title={s.direction === 'in' ? `From ${shortAddress(s.to)}` : `To ${shortAddress(s.to)}`}
                line={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].words}</Chip>
                    <span>{networkName(s.network)}</span>
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

/** Send USDC: to an address or another agent → the quote → Send → the receipt; then the history. */
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
    mutationFn: () => cryptoSendApi.send(agent.id, request(), key),
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
  const ready = isAddress(address) && minor !== null
  return (
    <div className="grid gap-4" data-testid="agent-crypto-send">
      {quote ? (
        <div className="grid gap-3" data-testid="crypto-send-quote">
          <QuoteFacts q={quote} agent={agent} />
          {quote.new_address ? (
            <p className="text-body text-ink" data-testid="crypto-send-new-address">
              A new address: this workspace has not paid it before.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={sent.isPending} onClick={() => sent.mutate()}>
              {sent.isPending ? 'Sending…' : 'Send'}
            </Button>
            <Button variant="secondary" disabled={sent.isPending} onClick={change}>
              Change
            </Button>
          </div>
          {sent.isError ? <Note ok={false}>{sendFailure(sent.error)}</Note> : null}
        </div>
      ) : (
        <PanelForm onSubmit={() => (ready && !ask.isPending ? ask.mutate() : undefined)}>
          {others.length > 0 ? (
            <Field label="Send to">
              <Select value={toAgent} onChange={(e) => setToAgent(e.target.value)}>
                <option value="">A wallet address</option>
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
            <Field label="Wallet address">
              <Input placeholder="0x…" spellCheck={false} autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} />
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
            <Button type="submit" disabled={ask.isPending} disabledReason={ready ? undefined : 'Type a 0x address and an amount first'}>
              {ask.isPending ? 'Reading the quote…' : 'Review'}
            </Button>
          </div>
          {ask.isError ? <Note ok={false}>{refusalText(ask.error)}</Note> : null}
        </PanelForm>
      )}
      {sent.data ? <Receipt s={sent.data} /> : null}
      <div className="border-t border-line pt-3">
        <History agent={agent} />
      </div>
    </div>
  )
}

/** B48.36 — on Approvals: every agent's send to a new address that waits for the owner. Nothing while none waits. */
export function CryptoSendsWaiting({ agents }: { agents: Agent[] }) {
  const lists = useQueries({
    queries: agents.map((a) => ({ queryKey: cryptoSendsKey(a.id), queryFn: () => cryptoSendApi.list(a.id), retry: false })),
  })
  const waiting = agents.flatMap((a, i) => (lists[i]?.data?.sends ?? []).filter((s) => s.direction === 'out' && s.status === 'awaiting_owner').map((s) => ({ a, s })))
  const failed = lists.some((l) => l.isError)
  if (waiting.length === 0 && !failed) return null
  return (
    <Card tone="white" aria-label="Sends to a new address" data-testid="approvals-crypto-sends">
      <h2 className="font-display text-reading font-bold text-ink">Sends to a new address</h2>
      <div className="mt-2">
        {waiting.map(({ a, s }) => (
          <AwaitingCryptoSend key={s.id} agent={a} s={s} />
        ))}
      </div>
      {failed ? <p className="mt-2 text-body text-ink-2">Some agents’ sends could not be read just now.</p> : null}
    </Card>
  )
}
