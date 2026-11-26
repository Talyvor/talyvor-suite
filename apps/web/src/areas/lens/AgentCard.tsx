import { playSound } from '@talyvor/ui'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, Button, Card, Chip, Dialog, Money, Switch, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, BOOK_KEY, FORECAST_KEY, OnThePhone, rulesKey, useKeys } from './AgentBank'
import { cardKey } from './AgentCardPanel'
import { AgentFace } from './AgentFace'
import { RunsOut } from './RunsOut'
import { type Agent, type AgentBook, agentBankApi } from './agentBankApi'
import { resumeAgent, resumeEveryAgent } from './passkeys'

// AgentCard.tsx — B57.16: Pocket's agent card (w-home, w-agents and the agent's page) with its switch, and the two dialogs
// it opens. Pausing is instant; resuming is signed over the agent's resume challenge. B61.14: Move LXC is parked and gone.

export const SAFE_TO_SPEND_KEY = ['agent-safe-to-spend'] as const

/** What went wrong, in words a person reads: never Lens's sentence or a µLXC count (problem 8). */
function refusal(err: unknown, nothing: string): string {
  if (isSessionExpired(err)) return `${nothing} Sign in again, then try once more.`
  if (err instanceof DOMException && err.name === 'NotAllowedError') return `${nothing} The passkey was not signed.`
  return `${nothing} You can try again.`
}

export function AgentCard({ agent, book }: { agent: Agent; book: AgentBook }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<'resume' | 'start-all' | null>(null)
  const forecast = useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast })
  const rules = useQuery({ queryKey: rulesKey(agent.id), queryFn: () => agentBankApi.rules(agent.id) })
  const card = useQuery({ queryKey: cardKey(agent.id), queryFn: () => agentBankApi.card(agent.id) })
  // The same query as the approvals card, so the face's waiting badge costs no request of its own.
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const waiting = (approvals.data?.approvals ?? []).some((p) => p.status === 'pending' && p.agent_id === agent.id)
  const pause = useMutation({
    mutationFn: () => agentBankApi.pause(agent.id, 'paused from its card'),
    onSuccess: () => {
      playSound('pause')
      showSnack({ title: `${agent.name} is paused`, line: 'Talyvor refuses its next request or payment until you resume it.' })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })

  const allPaused = !!book.all_paused_at
  const running = !agent.paused_at && !allPaused
  const month = forecast.data ? (forecast.data.agents ?? []).find((f) => f.agent_id === agent.id) : undefined
  const spent = forecast.data ? (month?.spent_ulxc ?? 0) : null
  const budget = rules.data?.monthly_limit_ulxc ?? 0
  const pct = spent !== null && budget > 0 ? Math.round((spent / budget) * 100) : null
  const frozen = !!card.data?.card.frozen

  return (
    <Card data-design="pocket" data-tangerine="your-move" className="grid content-start gap-2.5 py-4" data-testid={`agent-card-${agent.id}`}>
      <div className="flex h-11.5 items-center justify-between">
        <Link to={`/agents/${agent.id}`} aria-label={`Open ${agent.name}`} className={`block rounded-pill leading-none ${pocketFocusRing}`}>
          <AgentFace agent={agent} size={46} waiting={waiting} />
        </Link>
        <span className="flex items-center gap-1.5">
          <span className="text-caption text-ink-3">{running ? 'Running' : 'Paused'}</span>
          <Switch
            checked={running}
            disabled={pause.isPending}
            aria-label={running ? `Pause ${agent.name}` : agent.paused_at ? `Resume ${agent.name}` : 'Start every agent again'}
            onCheckedChange={() => (running ? pause.mutate() : setDialog(agent.paused_at ? 'resume' : 'start-all'))}
          />
        </span>
      </div>
      <div>
        <Link to={`/agents/${agent.id}`} className={`font-display text-body font-semibold text-ink ${pocketFocusRing}`}>
          {agent.name}
        </Link>
      </div>
      <div className="grid gap-1.5">
        {pct !== null ? <Bar value={pct / 100} label={`${pct}% of budget used`} /> : null}
        <div className="flex items-baseline justify-between gap-3 text-caption">
          <span className="shrink-0 text-ink-2">This month</span>
          {spent === null ? (
            <span className="text-ink-3">{forecast.isError ? 'could not be read just now' : 'Reading…'}</span>
          ) : (
            <span className="text-right" data-testid={`agent-card-month-${agent.id}`}>
              <Money ulxc={spent} />
              {budget > 0 ? (
                <span className="text-ink-3">
                  {' '}
                  of <Money ulxc={budget} />
                </span>
              ) : null}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-3" data-testid={`agent-card-note-${agent.id}`}>
          {agent.paused_at ? (
            <span>Paused. Resuming needs your passkey or your phone.</span>
          ) : allPaused ? (
            <span>Paused with every agent.</span>
          ) : month ? (
            <>
              {month.forecast_ulxc > 0 ? (
                <span>
                  On pace for about <Money ulxc={month.forecast_ulxc} />
                </span>
              ) : null}
              {budget > 0 && month.forecast_ulxc > budget ? <Chip tone="wait">Above its budget</Chip> : null}
              {/* B57.114 — the day it runs out in its own zone, under its pace, as Lens's forecast gives it. */}
              {month.runs_out_on !== undefined ? (
                <span className="basis-full">
                  <RunsOut forecast={month} testid="agent-card-runs-out" />
                </span>
              ) : null}
            </>
          ) : null}
          {frozen ? <Chip tone="paused">Card frozen</Chip> : null}
        </div>
      </div>
      {pause.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusal(pause.error, `${agent.name} is still running.`)}
        </p>
      ) : null}
      <ResumeAgent agent={agent} allPaused={allPaused} open={dialog === 'resume'} onClose={() => setDialog(null)} />
      <StartEveryAgent open={dialog === 'start-all'} onClose={() => setDialog(null)} />
    </Card>
  )
}

/** Resume <agent>?: signed with the passkey over /api/agents/{id}/resume-challenge (resumeAgent). */
export function ResumeAgent({ agent, allPaused, open, onClose }: { agent: Agent; allPaused: boolean; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { hold, onlyThePhone } = useKeys()
  const resume = useMutation({
    mutationFn: () => resumeAgent(agent.id),
    onSuccess: () => {
      playSound('resume')
      onClose()
      showSnack(
        allPaused
          ? { title: `${agent.name} runs when you start every agent again`, line: 'Until then it stays paused with every agent.' }
          : { title: `${agent.name} is running again`, line: 'Its requests and payments are served again.' },
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Resume ${agent.name}?`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {onlyThePhone ? null : (
            <Button variant="primary" disabled={hold || resume.isPending} onClick={() => resume.mutate()}>
              Resume with your passkey
            </Button>
          )}
        </>
      }
    >
      <p>Its requests and payments are served again, within its rules.</p>
      {allPaused ? <p>Every agent is paused too, so {agent.name} waits until you start every agent again.</p> : null}
      {onlyThePhone ? <OnThePhone>Resume {agent.name} on your phone with Face ID.</OnThePhone> : null}
      {resume.isError ? <p role="alert">{refusal(resume.error, `${agent.name} is still paused.`)}</p> : null}
    </Dialog>
  )
}

/** The switch of an agent paused only with every agent: starting every agent again, signed the same way. */
export function StartEveryAgent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { hold, onlyThePhone } = useKeys()
  const start = useMutation({
    mutationFn: resumeEveryAgent,
    onSuccess: () => {
      playSound('resume')
      onClose()
      showSnack({ title: 'Your agents can work again', line: 'An agent paused on its own stays paused.' })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start every agent again?"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {onlyThePhone ? null : (
            <Button variant="primary" disabled={hold || start.isPending} onClick={() => start.mutate()}>
              Start them with your passkey
            </Button>
          )}
        </>
      }
    >
      <p>An agent you paused on its own stays paused.</p>
      {onlyThePhone ? <OnThePhone>Start your agents again on your phone with Face ID.</OnThePhone> : null}
      {start.isError ? <p role="alert">{refusal(start.error, 'Your agents are still paused.')}</p> : null}
    </Dialog>
  )
}
