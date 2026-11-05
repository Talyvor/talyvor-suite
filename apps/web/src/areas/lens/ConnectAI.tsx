import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'

import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSON, readable } from '../../lib/api'
import { formatWhen } from './format'
import { CopyBlock } from './Setup'

// B40.8 — Settings › Connect your AI: the address of Talyvor's MCP server (B40.7), how to add it to each assistant,
// and the assistants this person has connected (B40.6 grants), each with its last use, what it did (B52.3) and a
// revoke button.

/** One tool call, as the BFF's audit trail keeps it: the arguments by SHA-256 only. */
interface Call {
  tool: string
  args_sha256: string
  result: 'done' | 'refused' | 'failed'
  at: string
}

interface Connected {
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
function CallList({ calls }: { calls: Call[] | null | undefined }) {
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
const NEVER = '0001-01-01T00:00:00Z'

/** The scopes in the words the consent screen showed (apps/bff/oauth.go oauthScopes). */
const SCOPE_WORDS: Record<string, string> = {
  'wallets:read': 'See your wallets and bills',
  'invoices:draft': 'Draft invoices and payees',
  'payments:prepare': 'Prepare payments for you to approve',
}

interface Assistant {
  name: string
  steps: string[]
  snippet?: { label: string; text: (url: string) => string }
  note?: string
}

export const ASSISTANTS: Assistant[] = [
  {
    name: 'Claude',
    steps: [
      'In Claude, open Settings › Connectors.',
      'Choose Add custom connector, name it Talyvor and paste the address above.',
      'Choose Connect, sign in to Talyvor and approve what Claude may do.',
    ],
    note: 'Every Claude plan can add it. The Free plan allows one custom connector.',
  },
  {
    name: 'ChatGPT',
    steps: [
      'On chatgpt.com, open Settings › Apps & Connectors › Advanced settings and turn on Developer mode.',
      'Back in Apps & Connectors, choose Create, name it Talyvor, paste the address above and choose OAuth.',
      'Sign in to Talyvor and approve what ChatGPT may do.',
    ],
    note: 'Developer mode is on the web, on paid plans.',
  },
  {
    name: 'Mistral Le Chat',
    steps: [
      'In Le Chat, open Intelligence › Connectors and choose Add connector.',
      'Choose Custom MCP connector, name it Talyvor and paste the address above.',
      'Connect, sign in to Talyvor and approve what Le Chat may do.',
    ],
  },
  {
    name: 'Grok',
    steps: [
      'In Grok, open Settings › Connectors and add a custom connector.',
      'Name it Talyvor and paste the address above.',
      'Sign in to Talyvor and approve what Grok may do.',
    ],
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
    name: 'Claude Code',
    steps: ['Run this in a terminal.', 'In Claude Code, type /mcp, choose talyvor and sign in.'],
    snippet: { label: 'the command', text: (url) => `claude mcp add --transport http talyvor ${url}` },
  },
  {
    name: 'Microsoft Copilot',
    steps: [
      'Copilot reaches Talyvor through your organisation’s Microsoft 365.',
      'Your Microsoft 365 admin adds the address above as an MCP connector in Copilot Studio.',
      'Once they have, each person signs in to Talyvor the first time Copilot uses it.',
    ],
  },
  {
    name: 'Gemini',
    steps: [],
    note: 'Gemini’s custom apps are for US personal Google accounts only today, so Talyvor cannot be added from a work account or outside the US yet.',
  },
]

async function revoke(id: string): Promise<void> {
  const path = `${PATH}/${encodeURIComponent(id)}/revoke`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
}

function AssistantCard({ a, url }: { a: Assistant; url: string }) {
  return (
    <Card raised>
      <CardHeader>{a.name}</CardHeader>
      <div className="space-y-3 px-gutter py-3">
        {a.steps.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-body text-ink">
            {a.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        ) : null}
        {a.snippet ? <CopyBlock text={a.snippet.text(url)} label={a.snippet.label} /> : null}
        {a.note ? <p className="text-caption text-muted">{a.note}</p> : null}
      </div>
    </Card>
  )
}

/** The assistants this person has connected, each revoked by its own button. Also drawn on Keys (B41.15). */
export function ConnectedList() {
  const qc = useQueryClient()
  const [cutName, setCutName] = useState('')
  const list = useQuery({
    queryKey: KEY,
    queryFn: async () =>
      readable<{ assistants: Connected[] }>(PATH, await getJSON<unknown>(PATH), { assistants: 'array' }).assistants,
  })
  const cut = useMutation({
    mutationFn: revoke,
    onSuccess: (_, id) => setCutName(list.data?.find((c) => c.id === id)?.name ?? 'That assistant'),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
  // B41.15 — the revocation stays said after its row is gone: the assistant's next request is refused.
  const cutDone = cutName ? (
    <p role="status" className="mb-3 max-w-2xl text-body text-ink">
      {cutName} is disconnected. Its next request to Talyvor is refused as not connected.
    </p>
  ) : null

  if (list.isError)
    return (
      <p className="max-w-2xl text-body text-muted">
        {list.error instanceof ApiError && list.error.status === 404
          ? 'Assistants cannot sign in to Talyvor on this server, so none are connected.'
          : 'Your connected assistants could not be read. This is a fault, not an empty list.'}
      </p>
    )
  if (list.isPending) return <p className="text-body text-muted">Reading your connected assistants…</p>
  if (!list.data.length)
    return (
      <>
        {cutDone}
        <p className="max-w-2xl text-body text-muted">No assistant is connected yet. Add one from Settings › Connect your AI.</p>
      </>
    )
  return (
    <>
    {cutDone}
    <ul className="max-w-3xl divide-y divide-rule rounded-control border border-rule">
      {list.data.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <p className="text-body font-semibold text-ink">{c.name}</p>
            <p className="text-caption text-muted">
              Last used{' '}
              {c.last_used_at === NEVER ? 'never' : <span className="font-figure">{formatWhen(c.last_used_at)}</span>}{' '}
              · connected <span className="font-figure">{formatWhen(c.connected_at)}</span>
            </p>
            <p className="text-caption text-muted">{c.scopes.map((s) => SCOPE_WORDS[s] ?? s).join(' · ')}</p>
            <CallList calls={c.calls} />
          </div>
          <Button
            variant="default"
            aria-label={`Revoke ${c.name}`}
            disabled={cut.isPending && cut.variables === c.id}
            onClick={() => cut.mutate(c.id)}
          >
            {cut.isPending && cut.variables === c.id ? 'Revoking…' : 'Revoke'}
          </Button>
        </li>
      ))}
      {cut.isError ? (
        <li className="px-4 py-3 text-caption text-ink" role="alert">
          That assistant was not revoked. Try again.
        </li>
      ) : null}
    </ul>
    </>
  )
}

export function ConnectAI() {
  const url = `${window.location.origin}/mcp`
  return (
    <RegionScreen>
      <Region index="00" label="Connect your AI" heading="Connect your AI" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          Add Talyvor to the assistant you already use. It can read your balances and bills, draft invoices and prepare
          payments — every payment waits for you to approve it here.
        </p>
        <div className="mt-4 max-w-2xl">
          <CopyBlock text={url} label="the address" />
        </div>
      </Region>

      <Region index="01" label="Add it to your assistant">
        <div className="mt-4 grid gap-4 wide:grid-cols-2">
          {ASSISTANTS.map((a) => (
            <AssistantCard key={a.name} a={a} url={url} />
          ))}
        </div>
      </Region>

      <Region index="02" label="Connected assistants">
        <div className="mt-4">
          <ConnectedList />
        </div>
      </Region>
    </RegionScreen>
  )
}
