import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { SAFE_TO_SPEND_KEY } from '../lens/Home'
import { type SafeToSpendFigure, agentBankApi } from '../lens/agentBankApi'
import { SafeAmount, SafeBreakdown } from '../lens/SafeToSpend'
import { Card } from '../lens/walletBrand'
import { readFailure } from '../lens/WalletMoney'

// B41.5 — "How much can Researcher spend?" (or "What's safe to spend?") typed in Chat's composer is not sent to the model:
// it opens a card in the conversation that answers from Lens's safe-to-spend figure (GET /api/agents/safe-to-spend, as
// Home reads it): the agent's balance less this month's scheduled payments and payments waiting for approval. Asked
// without an agent, or of "I" or "we", it answers for the company, whose figure also counts its bills due.

const HOW_MUCH = /^\s*(?:please\s+)?how\s+much\s+can\s+(?:agent\s+)?(.+?)\s+(?:safely\s+)?spend(?:\s+this\s+month)?\s*\??\s*$/i
const SAFE = /^\s*(?:(?:what\s+is|what['’]s|how\s+much\s+is)\s+)?safe\s+to\s+spend(?:\s+(?:for|by)\s+(?:agent\s+)?(.+?))?(?:\s+this\s+month)?\s*\??\s*$/i
const COMPANY = /^(?:i|we|us|my\s+agents|our\s+agents|the\s+company|everyone)$/i

/**
 * The agent a safe-to-spend question names, '' for the company, or null when it is not one: "How much can [agent] <name>
 * [safely] spend [this month]?" or "[What's] safe to spend [for <name>] [this month]?". Anything else still goes to the model.
 */
export function parseSafeToSpend(text: string): string | null {
  const m = HOW_MUCH.exec(text) ?? SAFE.exec(text)
  if (m === null) return null
  const name = (m[1] ?? '').replace(/^[\s"'“‘]+|[\s"'”’]+$/g, '')
  return COMPANY.test(name) ? '' : name
}

/** A question the safe-to-spend figure answers rather than the model. */
export const isSafeToSpendQuestion = (text: string) => parseSafeToSpend(text) !== null

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** Each figure: the amount safe to spend, and what it is made of. */
function Figures({ figures, testid }: { figures: SafeToSpendFigure[]; testid: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {figures.map((f) => (
        <li key={f.currency} className="flex flex-col">
          <span className="text-body text-ink" data-testid={`${testid}-${f.currency}`}>
            <SafeAmount currency={f.currency} amount={f.safe_to_spend} /> safe to spend this month
          </span>
          <span className="text-caption text-muted">
            <SafeBreakdown figure={f} />
          </span>
        </li>
      ))}
    </ul>
  )
}

export function SafeToSpendCard({ question, onClose }: { question: string; onClose: () => void }) {
  const [typed] = useState(() => parseSafeToSpend(question) ?? '')
  // Its own read, as of the question: never a figure cached a moment before it was asked.
  const asked = useId()
  const safe = useQuery({ queryKey: [...SAFE_TO_SPEND_KEY, 'asked', asked], queryFn: agentBankApi.safeToSpend })
  const agents = safe.data?.agents ?? []
  const [agentId, setAgentId] = useState<string | null>(null)
  const named = agents.find((a) => a.name.trim().toLowerCase() === typed.toLowerCase())
  const chosen = agentId ?? named?.agent_id ?? ''
  const agent = agents.find((a) => a.agent_id === chosen)

  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-safe-to-spend">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Asked <span className="break-all font-mono">{question}</span>
          </p>
          {safe.isError ? (
            <p role="alert" className="text-body text-ink">
              {readFailure(safe.error, 'What is safe to spend')}
            </p>
          ) : safe.isPending ? (
            <p className="text-body text-muted">Reading what is safe to spend…</p>
          ) : typed === '' ? (
            <div role="status" className="flex flex-col gap-3" data-testid="chat-safe-answer">
              <p className="text-body text-ink">The company, after this month’s schedules, bills due and approvals waiting:</p>
              <Figures figures={safe.data.company ?? []} testid="chat-safe-company" />
              {agents.length > 0 ? (
                <ul className="flex flex-col gap-1 border-t border-rule pt-2">
                  {agents.map((a) => (
                    <li key={a.agent_id} className="text-body text-ink">
                      {a.name}:{' '}
                      {(a.figures ?? []).map((f, i) => (
                        <span key={f.currency}>
                          {i > 0 ? ', ' : ''}
                          <SafeAmount currency={f.currency} amount={f.safe_to_spend} />
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : agent === undefined ? (
            <>
              <select aria-label="Agent" className={`${selectClass} wide:max-w-48`} value={chosen} onChange={(e) => setAgentId(e.target.value)}>
                <option value="" disabled>
                  Pick an agent
                </option>
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="text-caption text-muted">No agent is called “{typed}” — pick one.</p>
            </>
          ) : (
            <div role="status" className="flex flex-col gap-2" data-testid="chat-safe-answer">
              <p className="text-body text-ink">{agent.name}, after this month’s schedules and approvals waiting:</p>
              <Figures figures={agent.figures ?? []} testid="chat-safe-agent" />
              <p className="text-caption text-muted">
                <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: agent.agent_id }).toString()}`}>
                  See it on Agent Wallets
                </Link>
              </p>
            </div>
          )}
          <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
            <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
