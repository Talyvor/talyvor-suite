import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Dialog, Icon, hideSnack, showSnack } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { BOOK_KEY, deviceText, useKeys } from '../areas/lens/AgentBank'
import { agentBankApi } from '../areas/lens/agentBankApi'
import { resumeEveryAgent } from '../areas/lens/passkeys'

/**
 * B57.8 — stopping every agent from the shell, on every signed-in page (Lens B19.7). Pausing is instant and needs no
 * passkey; starting them again is signed with the passkey over the resume-all challenge (B41.8, `resumeEveryAgent`),
 * so this file only draws it: it never decides who may resume.
 */

const PAUSED_FROM_THE_TOP_BAR = 'paused from the top bar'

/** Whether every agent is paused, from the agents' book every money screen already reads. Unknown is not paused. */
export function useAllPaused(): boolean {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  return Boolean(book.data?.all_paused_at)
}

/** Pause every agent at once: instant, no passkey (Lens B19.7), said in the snack. B57.43: also Approvals and devices'. */
export function usePauseEveryAgent(reason: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => agentBankApi.pauseAll(reason),
    onSuccess: () =>
      showSnack({ title: 'Every agent is paused', line: 'Talyvor refuses each one’s next request or payment until you start them again.' }),
    onError: (err) => showSnack({ title: 'Your agents were not paused', line: deviceText(err, 'Try again.') }),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
}

/** The top bar's switch: Pause every agent, or while they are paused, Start every agent again. */
export function EveryAgentSwitch() {
  const paused = useAllPaused()
  const [starting, setStarting] = useState(false)
  const pause = usePauseEveryAgent(PAUSED_FROM_THE_TOP_BAR)
  return (
    <>
      {paused ? (
        <Button variant="danger" size="sm" className="shrink-0" icon={<Icon name="key" size={16} />} onClick={() => setStarting(true)}>
          {/* Below 840 the words leave the bar so it fits 320; they stay the button's name. */}
          <span className="sr-only wide:not-sr-only">Start every agent again</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          icon={<Icon name="pause" size={16} />}
          disabled={pause.isPending}
          onClick={() => pause.mutate()}
        >
          <span className="sr-only wide:not-sr-only">Pause every agent</span>
        </Button>
      )}
      <StartEveryAgent open={starting} onClose={() => setStarting(false)} />
    </>
  )
}

/** The kill banner, at the top of every page while every agent is paused, with its own way to start them again. */
export function KillBanner() {
  const paused = useAllPaused()
  const [starting, setStarting] = useState(false)
  if (!paused) return null
  return (
    <div
      role="status"
      data-testid="kill-banner"
      className="mb-4.5 flex flex-wrap items-center justify-between gap-4 rounded-inset bg-danger-50 py-3.5 pl-4.5 pr-4"
    >
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body text-ink">
        <Icon name="pause" className="text-danger" />
        <b className="text-reading font-semibold text-ink">Every agent is paused.</b>
        <span>Talyvor refuses each one’s next request or payment until you start them again.</span>
      </p>
      <Button size="sm" icon={<Icon name="key" size={16} />} onClick={() => setStarting(true)}>
        Start every agent again
      </Button>
      <StartEveryAgent open={starting} onClose={() => setStarting(false)} />
    </div>
  )
}

/**
 * The killoff dialog. An agent paused on its own stays paused, and is named. With only the phone's key, the phone
 * starts them (B55.2) and this browser can be added; until the keys are read, nothing is offered to press.
 */
export function StartEveryAgent({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <StartEveryAgentDialog onClose={onClose} />
}

function StartEveryAgentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { hold, onlyThePhone, signed } = useKeys()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const pausedOnTheirOwn = (book.data?.agents ?? []).filter((a) => a.paused_at)
  // Below 840 the dialog is a sheet at the foot of the view, where the pause's confirmation would cover its buttons.
  useEffect(hideSnack, [])
  const start = useMutation({
    mutationFn: resumeEveryAgent,
    onSuccess: () => {
      showSnack({ title: 'Your agents can work again', line: 'An agent paused on its own stays paused.' })
      onClose()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Start every agent again?"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {onlyThePhone ? null : (
            <Button icon={<Icon name="key" size={16} />} disabled={hold || start.isPending} onClick={() => start.mutate()}>
              {signed ? 'Start them with your passkey' : 'Start every agent again'}
            </Button>
          )}
        </>
      }
    >
      <p>An agent you paused on its own stays paused.</p>
      {pausedOnTheirOwn.map((a) => (
        <p key={a.id} className="text-body text-ink-3">
          {a.name} stays paused until you resume it.
        </p>
      ))}
      {onlyThePhone ? (
        <p data-testid="on-the-phone">
          Start your agents again on your phone with Face ID.{' '}
          <Link className={cn(inlineLink, 'whitespace-nowrap font-semibold text-ink')} to="/settings/devices" onClick={onClose}>
            Add this browser
          </Link>
        </p>
      ) : null}
      {start.isError ? (
        <p role="alert" className="text-body text-ink">
          {deviceText(start.error, 'Your agents were not started again.')}
        </p>
      ) : null}
    </Dialog>
  )
}
