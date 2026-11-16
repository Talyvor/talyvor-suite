import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, CodeBox, Crumb, Dialog, Eyebrow, Input, KindTile, Money, Row, showSnack, showToast } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'

import { ApiError, getJSON, readable } from '../../lib/api'
import { PREPARED_KEY } from './AgentBank'
import { type PaymentRequest, agentBankApi } from './agentBankApi'
import { formatWhen } from './format'
import { CURRENCY_WORDS, parseRuleAmount, ruleAmountText, useAccountCurrency } from './rulesCurrency'

// B40.8 — Settings › Connect your AI: the address of Talyvor's MCP server (B40.7), how to add it to each assistant,
// and the assistants this person has connected (B40.6 grants), each with its last use, what it did (B52.3) and a
// revoke button.
// B57.45 — drawn in Pocket (design/pocket w-connect): every assistant in one list, a connected one with Connected and
// a Revoke that asks first, the others opening their steps in a dialog; the address and the Claude Code command
// beside them; how a payment works; each connected assistant's latest tool calls below.
// B52.9 — sign out everywhere, which ends every assistant with every other sign-in. Asks once first.
// B52.6 — New agents from an assistant: the most an assistant may give a new agent it creates.
// B57.157 — its three limits drawn as rows of the agent's rules sheet (w-rules), every word B52.6 showed kept.
// B61.19 — and typed and kept in the account's own currency, as an agent's rules are.

/** One tool call, as the BFF's audit trail keeps it: the arguments by SHA-256 only. */
interface Call {
  tool: string
  args_sha256: string
  result: 'done' | 'refused' | 'failed'
  at: string
}

export interface Connected {
  id: string
  name: string
  scopes: string[]
  connected_at: string
  last_used_at: string
  /** Newest first, the latest 20; null where the server keeps no record. */
  calls?: Call[] | null
}

const RESULT_WORDS: Record<Call['result'], string> = {
  done: 'Done',
  refused: 'Refused',
  failed: 'Not understood',
}

/** What one connected assistant did, newest first. */
export function CallList({ calls }: { calls: Call[] | null | undefined }) {
  if (!calls) return <p className="text-caption text-muted">This server keeps no record of what assistants did.</p>
  if (!calls.length) return <p className="text-caption text-muted">It has not used a tool yet.</p>
  return (
    <details>
      <summary className="cursor-pointer text-caption text-ink">
        What it did · latest {calls.length === 1 ? 'call' : <span className="font-figure">{calls.length} calls</span>}
      </summary>
      <ul className="mt-2 space-y-1 text-caption" aria-label="Its latest tool calls">
        {calls.map((c, i) => (
          <li key={`${c.at}-${i}`} className="flex flex-wrap gap-x-3">
            <span className="font-figure text-ink">{c.tool}</span>
            <span className={c.result === 'done' ? 'text-ink' : 'text-muted'}>{RESULT_WORDS[c.result] ?? c.result}</span>
            <span className="font-figure text-muted">{formatWhen(c.at)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

const KEY = ['connected-assistants']
const PATH = '/api/connect/assistants'
/** Go's zero time: the assistant has not called Talyvor since it connected. */
export const NEVER = '0001-01-01T00:00:00Z'

/** The scopes in the words the consent screen showed (apps/bff/oauth.go oauthScopes). */
export const SCOPE_WORDS: Record<string, string> = {
  'wallets:read': 'See your wallets and bills',
  'invoices:draft': 'Draft invoices and payees',
  'payments:prepare': 'Prepare payments for you to approve',
  'payments:send': 'Pay from your agents within the limits you set',
  'agents:write': 'Create and pause your agents, and lower their limits',
}

interface Assistant {
  name: string
  steps: string[]
  snippet?: { label: string; text: (url: string) => string }
  note?: string
}

// In the order Pocket lists them; each one's steps say "your Talyvor address", which the page and its dialog both show.
export const ASSISTANTS: Assistant[] = [
  {
    name: 'Claude',
    steps: [
      'In Claude, open Settings › Connectors.',
      'Choose Add custom connector, name it Talyvor and paste your Talyvor address.',
      'Choose Connect, sign in to Talyvor and approve what Claude may do.',
    ],
    note: 'Every Claude plan can add it. The Free plan allows one custom connector.',
  },
  {
    name: 'ChatGPT',
    steps: [
      'On chatgpt.com, open Plugins, choose + and then Add custom MCP server.',
      'Name it Talyvor, paste your Talyvor address, choose OAuth and then Create as a plugin.',
      'Install Talyvor from your plugins, sign in to Talyvor and approve what ChatGPT may do.',
    ],
    note: 'Adding one needs Developer mode, in ChatGPT’s settings on the web, on Plus, Pro, Business, Enterprise and Edu.',
  },
  {
    name: 'Claude Code',
    steps: ['Run this in a terminal.', 'In Claude Code, type /mcp, choose talyvor and sign in.'],
    snippet: { label: 'the command', text: (url) => claudeCodeCommand(url) },
  },
  {
    name: 'Cursor',
    steps: [
      'Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).',
      'In Cursor Settings › MCP, choose Connect next to Talyvor and sign in.',
    ],
    snippet: {
      label: 'the config',
      text: (url) => JSON.stringify({ mcpServers: { talyvor: { url } } }, null, 2),
    },
  },
  {
    name: 'Microsoft Copilot',
    steps: [
      'Copilot reaches Talyvor through your organisation’s Microsoft 365.',
      'Your Microsoft 365 admin adds your Talyvor address as an MCP connector in Copilot Studio.',
      'Once they have, each person signs in to Talyvor the first time Copilot uses it.',
    ],
  },
  {
    name: 'Mistral Le Chat',
    steps: [
      'In Le Chat, open Intelligence › Connectors and choose Add connector.',
      'Choose Custom MCP connector, name it Talyvor and paste your Talyvor address.',
      'Connect, sign in to Talyvor and approve what Le Chat may do.',
    ],
  },
  {
    name: 'Grok',
    steps: [
      'In Grok, open Settings › Connectors and add a custom connector.',
      'Name it Talyvor and paste your Talyvor address.',
      'Sign in to Talyvor and approve what Grok may do.',
    ],
  },
  {
    name: 'Gemini',
    steps: [],
    note: 'Gemini’s custom apps are for US personal Google accounts only today, so Talyvor cannot be added from a work account or outside the US yet.',
  },
]

const claudeCodeCommand = (url: string) => `claude mcp add --transport http talyvor ${url}`

export async function revokeAssistant(id: string): Promise<void> {
  const path = `${PATH}/${encodeURIComponent(id)}/revoke`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
}

/** The assistants this person has connected; Keys draws them as Pocket rows from the same read (B57.94). */
export function useConnectedAssistants() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      readable<{ assistants: Connected[] }>(PATH, await getJSON<unknown>(PATH), { assistants: 'array' }).assistants,
  })
}

export const CONNECTED_KEY = KEY

/** RevokeAssistant — asks before an assistant is disconnected (w-connect+revoke-claude); Keys asks with it too. */
export function RevokeAssistant({ c, onClose, onRevoked }: { c: Connected; onClose: () => void; onRevoked: () => void }) {
  const qc = useQueryClient()
  const cut = useMutation({
    mutationFn: () => revokeAssistant(c.id),
    onSuccess: () => {
      showSnack({ title: `${c.name} can no longer reach Talyvor`, line: 'Add it again with your Talyvor address.' })
      onRevoked()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CONNECTED_KEY }),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Revoke ${c.name}?`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => cut.mutate()} disabled={cut.isPending}>
            {cut.isPending ? 'Revoking…' : 'Revoke'}
          </Button>
        </>
      }
    >
      <p>{c.name} can no longer read your wallets and bills or prepare payments. You can add it again at any time.</p>
      {cut.isError ? (
        <p role="alert" className="text-body text-ink">
          That assistant was not revoked. Try again.
        </p>
      ) : null}
    </Dialog>
  )
}

/** "a, b, and c", as the reference lists what an assistant may do. */
function inWords(parts: string[]): string {
  if (parts.length < 3) return parts.join(' and ')
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

/** When it was last used and connected, and what it may do, in the words its consent page used. */
function connectedLine(c: Connected) {
  const may = c.scopes.map((s) => {
    const w = SCOPE_WORDS[s] ?? s
    return w.charAt(0).toLowerCase() + w.slice(1)
  })
  return (
    <>
      Last used {c.last_used_at === NEVER ? 'never' : <span className="font-figure">{formatWhen(c.last_used_at)}</span>} · connected{' '}
      <span className="font-figure">{formatWhen(c.connected_at)}</span>
      {may.length ? ` · may ${inWords(may)}` : null}
    </>
  )
}

function copyAddress(url: string) {
  navigator.clipboard.writeText(url).then(
    () => showToast('Copied the address'),
    () => showToast('Could not copy. Select it and copy it yourself.'),
  )
}

/** One assistant's steps, in the dialog How to add it opens. */
function HowToAdd({ a, url, onClose }: { a: Assistant; url: string; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add Talyvor to ${a.name}`}
      actions={
        <>
          <Button variant="secondary" onClick={() => copyAddress(url)}>
            Copy the address
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <ol className="grid list-decimal gap-2 pl-5">
        {a.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {a.snippet ? <CodeBox code={a.snippet.text(url)} copied={`Copied ${a.snippet.label}`} /> : null}
      {a.note ? <p className="text-body text-ink-3">{a.note}</p> : null}
    </Dialog>
  )
}

const tile = (name: string) => <KindTile on="white" className="h-8 w-8 font-bold" icon={name.charAt(0)} />

/**
 * Every assistant Talyvor can be added to, each grant this person made shown on its assistant's row by name; a grant
 * whose client named itself otherwise has a row of its own, so nothing connected goes unseen.
 */
function AssistantList({ url }: { url: string }) {
  const list = useConnectedAssistants()
  const heading = useId()
  const [howTo, setHowTo] = useState<Assistant | null>(null)
  const [asking, setAsking] = useState<Connected | null>(null)
  const [cutName, setCutName] = useState('')
  const grants = list.data ?? []
  const known = new Set(ASSISTANTS.map((a) => a.name.toLowerCase()))
  const others = grants.filter((g) => !known.has(g.name.toLowerCase()))

  const connectedRow = (c: Connected, note?: string) => (
    <div key={c.id} data-assistant={c.name}>
      <Row
        wrap
        leading={tile(c.name)}
        title={c.name}
        line={
          <>
            {note ? <span className="block">{note}</span> : null}
            <span className="block">{connectedLine(c)}</span>
          </>
        }
        action={
          <>
            <Chip tone="good" dot>
              Connected
            </Chip>
            <Button variant="secondary" size="sm" aria-label={`Revoke ${c.name}`} onClick={() => setAsking(c)}>
              Revoke
            </Button>
          </>
        }
      />
    </div>
  )

  return (
    <Card tone="white" role="region" aria-labelledby={heading} className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={heading} className="font-display text-reading font-bold text-ink">
          Assistants
        </h2>
        <span className="text-body text-ink-3">You can revoke any of them</span>
      </div>
      {cutName ? (
        // B41.15 — the revocation stays said after its row is gone: the assistant's next request is refused.
        <p role="status" className="text-body text-ink">
          {cutName} is disconnected. Its next request to Talyvor is refused as not connected.
        </p>
      ) : null}
      {list.isError ? (
        <p className="text-body text-ink-2">
          {list.error instanceof ApiError && list.error.status === 404
            ? 'Assistants cannot sign in to Talyvor on this server, so none are connected.'
            : 'Your connected assistants could not be read. This is a fault, not an empty list.'}
        </p>
      ) : null}
      <div>
        {others.map((c) => connectedRow(c))}
        {ASSISTANTS.map((a) => {
          const mine = grants.filter((g) => g.name.toLowerCase() === a.name.toLowerCase())
          if (mine.length) return mine.map((c) => connectedRow(c, a.note))
          return (
            <div key={a.name} data-assistant={a.name}>
              <Row
                wrap
                leading={tile(a.name)}
                title={a.name}
                line={a.note}
                action={
                  a.steps.length ? (
                    <button
                      type="button"
                      aria-label={`How to add ${a.name}`}
                      onClick={() => setHowTo(a)}
                      className={cn(inlineLink, 'text-body text-ink-2')}
                    >
                      How to add it
                    </button>
                  ) : undefined
                }
              />
            </div>
          )
        })}
      </div>
      {howTo ? <HowToAdd a={howTo} url={url} onClose={() => setHowTo(null)} /> : null}
      {asking ? (
        <RevokeAssistant
          c={asking}
          onClose={() => setAsking(null)}
          onRevoked={() => {
            setCutName(asking.name)
            setAsking(null)
          }}
        />
      ) : null}
    </Card>
  )
}

/** The address an assistant is given, and the one command Claude Code takes. */
function Address({ url }: { url: string }) {
  const heading = useId()
  return (
    <Card tone="white" role="region" aria-labelledby={heading} className="grid min-w-0 gap-2">
      <Eyebrow id={heading}>Your Talyvor address</Eyebrow>
      <CodeBox code={url} copied="Copied the address" />
      <Eyebrow className="mt-2">In Claude Code</Eyebrow>
      <CodeBox code={claudeCodeCommand(url)} copied="Copied the command" />
    </Card>
  )
}

const PAYMENT_STEPS = [
  { title: 'Your assistant prepares it', line: 'It names the payee, the amount and why.' },
  { title: 'Talyvor writes it out', line: 'Each payment’s payee, amount and reference, exactly as you will sign it.' },
  { title: 'You approve it', line: 'With your passkey or on your phone, unless a permission you signed covers it.' },
]

/** The three steps of a payment an assistant prepares, and the page it opens: the one waiting now, if one is. */
function HowAPaymentWorks() {
  const heading = useId()
  const waiting = useQuery({ queryKey: PREPARED_KEY, queryFn: agentBankApi.pendingPaymentRequests })
  const newest = (waiting.data?.requests ?? []).reduce<PaymentRequest | null>((b, r) => (!b || r.created_at > b.created_at ? r : b), null)?.id
  return (
    <Card role="region" aria-labelledby={heading} className="grid min-w-0 gap-3">
      <h2 id={heading} className="font-display text-reading font-bold text-ink">
        How a payment works
      </h2>
      {/* pocket.css .howsteps.one: one column, each number on its disc beside its step. */}
      <ol className="grid gap-3">
        {PAYMENT_STEPS.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span aria-hidden="true" className="inline-grid shrink-0 h-7 w-7 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink">
              {i + 1}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="font-semibold text-ink">{step.title}</span>
              <span className="text-body text-ink-3">{step.line}</span>
            </span>
          </li>
        ))}
      </ol>
      <div>
        {newest ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`/approve/${encodeURIComponent(newest)}`}>See the page a prepared payment opens</Link>
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => showToast('No prepared payment is waiting now. A prepared payment opens its own page, to approve or decline.')}
          >
            See the page a prepared payment opens
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * B52.6 — the most an assistant may give a new agent (apps/bff/mcp_agents.go connectCeiling). B61.19 — in the account's
 * own currency, each limit in its minor units.
 */
type Ceiling = { currency: string } & Record<(typeof CEILING_FIELDS)[number][0], number>

const CEILING_PATH = '/api/connect/agent-ceiling'
const CEILING_FIELDS = [
  ['max_per_payment_minor', 'One payment'],
  ['daily_limit_minor', 'A day'],
  ['monthly_limit_minor', 'A month'],
] as const

async function saveCeiling(c: Ceiling): Promise<Ceiling> {
  const res = await fetch(CEILING_PATH, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  })
  if (!res.ok) throw new ApiError(res.status, CEILING_PATH)
  return (await res.json()) as Ceiling
}

/** New agents from an assistant: the ceiling as it is, then a form to set or change it. */
function NewAgents() {
  const heading = useId()
  const read = useQuery({ queryKey: ['agent-ceiling'], queryFn: () => getJSON<Partial<Ceiling>>(CEILING_PATH) })
  // B61.19 — typed in the account's own currency, as an agent's rules are (B61.87).
  const currency = useAccountCurrency()
  return (
    <Card tone="white" role="region" aria-labelledby={heading} className="grid min-w-0 gap-3">
      <h2 id={heading} className="font-display text-reading font-bold text-ink">
        New agents from an assistant
      </h2>
      <p className="text-body text-ink-3">
        An assistant you allow to create agents gives each one limits no higher than these. A new agent starts with no money.
      </p>
      {read.isError ? (
        <p className="text-body text-ink-2">The limit for new agents could not be read. Try again shortly.</p>
      ) : read.isPending || currency === null ? (
        <p className="text-body text-ink-3">Reading the limit for new agents…</p>
      ) : (
        <CeilingForm key={read.dataUpdatedAt} current={read.data.currency ? (read.data as Ceiling) : null} currency={currency} />
      )}
    </Card>
  )
}

function CeilingForm({ current, currency }: { current: Ceiling | null; currency: string }) {
  const qc = useQueryClient()
  // A limit kept in another currency is shown as it is kept, and typed again in the account's.
  const [text, setText] = useState(
    () =>
      Object.fromEntries(
        CEILING_FIELDS.map(([k]) => [k, current?.currency === currency ? ruleAmountText(current[k], currency) : '']),
      ) as Record<(typeof CEILING_FIELDS)[number][0], string>,
  )
  const minors = Object.fromEntries(CEILING_FIELDS.map(([k]) => [k, parseRuleAmount(text[k], currency) || null])) as Record<
    (typeof CEILING_FIELDS)[number][0],
    number | null
  >
  const ready = CEILING_FIELDS.every(([k]) => minors[k] !== null)
  const save = useMutation({
    mutationFn: () => saveCeiling({ currency, ...minors } as Ceiling),
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent-ceiling'] }),
  })
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !save.isPending) save.mutate()
      }}
    >
      <p className="text-body text-ink" data-testid="agent-ceiling">
        {current ? (
          <>
            An agent an assistant creates may spend at most <Money minor={current.max_per_payment_minor} currency={current.currency} /> a payment,{' '}
            <Money minor={current.daily_limit_minor} currency={current.currency} /> a day and{' '}
            <Money minor={current.monthly_limit_minor} currency={current.currency} /> a month. Higher limits are yours to set, on Agent Wallets.
          </>
        ) : (
          'Assistants cannot create agents until you say how much a new one may spend.'
        )}
      </p>
      {/* B57.157 — drawn as the agent's rules sheet draws a limit (w-rules): its name over its value, the amount beside. */}
      <div data-testid="ceiling-rows">
        {CEILING_FIELDS.map(([k, label]) => (
          <div key={k} data-testid="ceiling-row" className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
            <div className="min-w-0 basis-full sm:basis-2/5">
              <div className="font-semibold text-ink">{label}</div>
              {minors[k] ? (
                <div className="font-figure text-body text-ink-3">
                  <Money minor={minors[k]} currency={currency} />
                </div>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <Input
                aria-label={`${label}, in ${CURRENCY_WORDS[currency] ?? currency}`}
                inputMode="decimal"
                unit={currency}
                value={text[k]}
                onChange={(e) => setText({ ...text, [k]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={!ready || save.isPending}>
          {current ? 'Change' : 'Set'}
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className="text-body text-ink">
          That limit was not saved. Try again.
        </p>
      ) : null}
    </form>
  )
}

/** Each connected assistant's latest tool calls, newest first. */
function LatestCalls() {
  const list = useConnectedAssistants()
  return (
    <>
      {(list.data ?? []).map((c) => (
        <CallsCard key={c.id} c={c} />
      ))}
    </>
  )
}

function CallsCard({ c }: { c: Connected }) {
  const heading = useId()
  return (
    <Card tone="white" role="region" aria-labelledby={heading} className="grid min-w-0 gap-2">
      <h2 id={heading} className="font-display text-reading font-bold text-ink">
        {c.name}’s latest tool calls
      </h2>
      {!c.calls ? (
        <p className="text-body text-ink-3">This server keeps no record of what assistants did.</p>
      ) : !c.calls.length ? (
        <p className="text-body text-ink-3">It has not used a tool yet.</p>
      ) : (
        <div>
          {c.calls.map((call, i) => (
            <Row
              key={`${call.at}-${i}`}
              title={<span className="font-mono">{call.tool}</span>}
              line={
                <>
                  <span className="font-figure">{formatWhen(call.at)}</span> · {RESULT_WORDS[call.result] ?? call.result}
                </>
              }
            />
          ))}
        </div>
      )}
      <p className="text-body text-ink-3">Each call an assistant makes is kept here, newest first.</p>
    </Card>
  )
}

/** B52.9 — ends every sign-in of this person: browsers, phones and every connected assistant. Asks once first. */
function SignOutEverywhere() {
  const heading = useId()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const out = useMutation({
    mutationFn: async () => {
      const res = await fetch('/auth/logout-everywhere', { method: 'POST', headers: { Accept: 'application/json' } })
      if (!res.ok) throw new ApiError(res.status, '/auth/logout-everywhere')
    },
    // This browser is signed out too; re-probe so the sign-in page takes over.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-me'] }),
  })
  return (
    <Card role="region" aria-labelledby={heading} className="grid min-w-0 gap-3">
      <h2 id={heading} className="font-display text-reading font-bold text-ink">
        Sign out everywhere
      </h2>
      <p className="text-body text-ink-3">
        Signs you out of Talyvor in every browser and on every phone, and disconnects every assistant above. Each one has
        to sign in again.
      </p>
      <div>
        <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
          Sign out everywhere
        </Button>
      </div>
      {asking ? (
        <Dialog
          open
          onClose={() => setAsking(false)}
          title="Sign out everywhere?"
          actions={
            <>
              <Button variant="secondary" disabled={out.isPending} onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={out.isPending} onClick={() => out.mutate()}>
                {out.isPending ? 'Signing out…' : 'Yes, sign out everywhere'}
              </Button>
            </>
          }
        >
          <p>Every browser, every phone and every connected assistant has to sign in again.</p>
          {out.isError ? (
            <p role="alert" className="text-body text-ink">
              You were not signed out anywhere. Try again.
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </Card>
  )
}

export function ConnectAI() {
  const url = `${window.location.origin}/mcp`
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Connect your AI' }]} />
      <p className="max-w-3xl text-reading text-ink-2">
        Use Talyvor from the assistant you already use. It can read your balances and bills, draft invoices and prepare payments. Every payment it
        prepares waits for you to approve it, unless a permission you signed covers it.
      </p>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid min-w-0 gap-4 wide:col-span-7">
          <AssistantList url={url} />
        </div>
        <div className="grid min-w-0 gap-4 wide:col-span-5">
          <Address url={url} />
          <HowAPaymentWorks />
          <SignOutEverywhere />
          <NewAgents />
        </div>
      </div>
      <LatestCalls />
    </div>
  )
}
