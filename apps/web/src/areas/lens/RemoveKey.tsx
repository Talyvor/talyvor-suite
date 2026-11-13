import { Button, Dialog } from '@talyvor/ui/pocket'
import { AgentBankError, refusalText } from './agentBankApi'

/** B55.16 — what the owner is told on the workspace's last key, and when Lens refuses one as the last (409). */
export const LAST_KEY = 'It is your last key. With none, nobody could approve, so add another first.'

/** B55.16 — Lens refused the removal because nothing else could approve (its economy.LastKeySentence). */
export const isLastKeyRefusal = (err: unknown) => err instanceof AgentBankError && err.status === 409 && /last key/i.test(err.sentence)

/**
 * B55.16 — "Remove “{name}”?" before a passkey or a phone key stops approving, on Approvals and devices and on Keys.
 * The last key offers no Remove; if Lens still refuses one as the last (409), it says why and offers only Keep it.
 */
export function RemoveKeyDialog({
  name,
  pending,
  error,
  onKeep,
  onRemove,
}: {
  /** null keeps the dialog closed. */
  name: string | null
  pending: boolean
  error: unknown
  onKeep: () => void
  onRemove: () => void
}) {
  const lastKey = isLastKeyRefusal(error)
  return (
    <Dialog
      open={name !== null}
      onClose={onKeep}
      title={`Remove “${name ?? ''}”?`}
      actions={
        <>
          <Button variant="secondary" disabled={pending} onClick={onKeep}>
            Keep it
          </Button>
          {lastKey ? null : (
            <Button variant="danger" disabled={pending} onClick={onRemove}>
              {pending ? 'Removing…' : 'Remove it'}
            </Button>
          )}
        </>
      }
    >
      <p>{lastKey ? LAST_KEY : 'It can no longer approve anything.'}</p>
      {error && !lastKey ? <p role="alert">{refusalText(error)}</p> : null}
    </Dialog>
  )
}
