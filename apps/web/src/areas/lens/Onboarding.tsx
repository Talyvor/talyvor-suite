import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@talyvor/ui'
import { api } from '../../lib/api'
import { BOOK_KEY } from './AgentBank'
import { CopyBlock } from './Setup'
import { toolsFor } from './setupSnippets'
import { CAPABILITIES_KEY } from './WalletMoney'
import {
  type Agent,
  type AgentBook,
  type AgentKey,
  type StatementLine,
  type WalletCapability,
  agentBankApi,
  formatULXC,
  newMoveKey,
  refusalText,
} from './agentBankApi'

// Onboarding.tsx — B46.2 (B45.8's flow): a new workspace's first agent in one click on Home. Sign up, then
// "Your first agent is ready": the agent is made, given the workspace's free credit, and its key is shown
// once with a copy button; then Home. No budget, funding or identity forms on the way — the agent's rules
// are Agent Wallets' to set later. The one sentence about real money is said here, once, and nowhere else.

/** Said once, at sign-up, until a partner serves the workspace real money (Nick, 24 Oct 2026). */
export const NOT_REAL_MONEY_YET = 'Until our first money partner is switched on, the balances you see here aren’t real money yet.'

/** A partner serves the workspace real money: Lens says an AMBER or RED capability takes it now. GREEN is Talyvor's own credit. */
export const partnerLive = (caps: WalletCapability[] | null | undefined): boolean =>
  (caps ?? []).some((c) => c.class !== 'GREEN' && c.real_money)

const lxc = (micros: number) => (
  <>
    <span className="font-figure">{formatULXC(micros).replace(/ LXC$/, '')}</span> LXC
  </>
)

const REQUEST_KINDS: readonly StatementLine['kind'][] = ['spend', 'hold', 'settle', 'release']

/** The oldest line a request put on the statement; Lens lists it newest first. Chat's launch card (B28.350) reads it too. */
export const firstRequest = (lines: StatementLine[] | null | undefined): StatementLine | null =>
  [...(lines ?? [])].reverse().find((l) => REQUEST_KINDS.includes(l.kind)) ?? null

interface Ready {
  agent: Agent
  key: AgentKey
  funded_ulxc: number
}

/** The key, once, with its copy button and the two lines to point a tool at Lens. */
function ReadyView({ ready, onFinished }: { ready: Ready; onFinished: () => void }) {
  const ctx = useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000 })
  const tools = toolsFor(ctx.data?.lens_public_base_url ?? '', ready.key.key).filter((t) => t.kind === 'env')
  return (
    <div className="flex w-full flex-col gap-3" data-testid="first-agent-ready">
      <p className="text-head text-ink">Your first agent is ready</p>
      <p className="text-body text-ink">
        {ready.funded_ulxc > 0 ? (
          <>{ready.agent.name} holds {lxc(ready.funded_ulxc)}. </>
        ) : (
          <>The workspace had no credit to give {ready.agent.name}; add some on Billing, then fund it on Agent Wallets. </>
        )}
        Its key is shown once — copy it now:
      </p>
      <div data-testid="onboarding-key">
        <CopyBlock text={ready.key.key} label="the key" />
      </div>
      {tools.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <p className="text-caption text-ink">{t.name}</p>
          <CopyBlock text={t.copyText} label="the two lines" />
        </div>
      ))}
      <div>
        <Button variant="primary" onClick={onFinished}>
          Go to Home
        </Button>
      </div>
    </div>
  )
}

/**
 * One click: the agent, the workspace's free credit moved to it, and its key. `onStarted` fires once the
 * agent exists, so Home keeps this open after the book lists it; `onFinished` hands Home back its wallets.
 */
export function FirstAgent({ book, onStarted, onFinished }: { book: AgentBook; onStarted: () => void; onFinished: () => void }) {
  const qc = useQueryClient()
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
  const [name, setName] = useState('My first agent')
  // Each step is kept once Lens did it, and the move keeps its Idempotency-Key, so a retry after a failure
  // makes no second agent and moves the credit once.
  const [agent, setAgent] = useState<Agent | null>(null)
  const [funded, setFunded] = useState<number | null>(null)
  const [moveKey] = useState(newMoveKey)
  const [ready, setReady] = useState<Ready | null>(null)
  const make = useMutation({
    mutationFn: async (): Promise<Ready> => {
      const a = agent ?? (await agentBankApi.create(name.trim()))
      if (!agent) {
        setAgent(a)
        onStarted()
      }
      let given = funded
      if (given === null) {
        given = book.unallocated_ulxc
        if (given > 0) await agentBankApi.fund(a.id, given, moveKey)
        setFunded(given)
      }
      return { agent: a, key: await agentBankApi.issueKey(a.id, a.name), funded_ulxc: given }
    },
    onSuccess: setReady,
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <div className="flex flex-col items-start gap-3 border border-rule bg-surface px-gutter py-5" data-testid="wallet-onboarding">
      {/* Unread capabilities say the sentence: the app never implies real money it cannot show. */}
      {partnerLive(caps.data?.capabilities) ? null : (
        <p className="text-body text-ink" data-testid="not-real-money-yet">
          {NOT_REAL_MONEY_YET}
        </p>
      )}
      {ready ? (
        <ReadyView ready={ready} onFinished={onFinished} />
      ) : (
        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if ((agent || name.trim()) && !make.isPending) make.mutate()
          }}
        >
          <Input aria-label="Agent name" value={agent?.name ?? name} disabled={agent !== null} onChange={(e) => setName(e.target.value)} />
          <div>
            <Button type="submit" variant="primary" disabled={(!agent && !name.trim()) || make.isPending}>
              {make.isPending ? 'Getting it ready…' : 'Create my first agent'}
            </Button>
          </div>
          {make.isError ? (
            <p role="alert" className="text-caption text-ink">
              {refusalText(make.error)}
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}
