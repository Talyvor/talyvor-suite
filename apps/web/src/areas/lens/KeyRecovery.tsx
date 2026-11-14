import { useId, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button as UiButton, CardHeader, Input, inlineLink } from '@talyvor/ui'
import { Button, CodeBox, Dialog } from '@talyvor/ui/pocket'
import { Card } from './walletBrand'
import { AgentBankError, agentBankApi, type KeyRecovery } from './agentBankApi'
import { DEVICES_KEY, Note, PASSKEYS_KEY, deviceText } from './AgentBank'
import { getAKeyBack, makeNewRecoveryCode, passkeysSupported } from './passkeys'
import { forgetRecoveryCode, onRecoveryCode, recoveryCodeShown } from './recoveryCodeStore'

// KeyRecovery.tsx — B55.54: the web's half of Lens's B55.48. A workspace's first key comes with a recovery code, shown
// once; Approvals and devices makes a new one, signed as any key change is. A workspace whose every key was removed
// gets one back with that code at once, or after 72 hours that everyone in the workspace is told about, on every page,
// and that any owner or admin can cancel. Lens decides who may do each; this screen offers them to the signed-in person
// and shows Lens's sentence when it refuses.

export const RECOVERY_KEY = ['key-recovery']

/** Lens's (and the BFF's) refusal for a sign-in older than 10 minutes. */
const SIGN_IN_AGAIN = 'Sign in again, then try again.'

const NO_LIVE_KEY = 'Every key of this workspace was removed, so nothing can approve.'

const deviceName = () => (navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device')

/** The code as Lens writes it, in five groups of four, however it arrives. */
const grouped = (code: string) => code.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')

/** When a waiting recovery's key can be added: "14 Nov 2026 at 15:04", in this browser's time. */
function readyWords(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

/**
 * What went wrong, in words; a sign-in too old for a recovery says so with the click that fixes it. The click asks
 * for a real sign-in (reauth=1), not the one the identity provider remembers (B50.49).
 */
function Refused({ error, fallback }: { error: unknown; fallback: string }) {
  if (error instanceof AgentBankError && error.sentence === SIGN_IN_AGAIN) {
    const returnTo = window.location.pathname + window.location.search
    return (
      <p role="alert" className="text-caption text-ink">
        {SIGN_IN_AGAIN}{' '}
        <a className={inlineLink} href={`/auth/login?reauth=1&return_to=${encodeURIComponent(returnTo)}`}>
          Sign in again
        </a>
      </p>
    )
  }
  return <Note ok={false}>{deviceText(error, fallback)}</Note>
}

/** Every read a new key changes: the keys, and the waiting recovery it ends. */
function useKeyChanged() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: PASSKEYS_KEY }),
      qc.invalidateQueries({ queryKey: DEVICES_KEY }),
      qc.invalidateQueries({ queryKey: RECOVERY_KEY }),
    ])
}

/**
 * The recovery code, shown once: when Lens answers one (the workspace's first key, a new code, a key got back) this
 * sheet shows it until "I saved it". It is held in memory only (recoveryCodeStore.ts), so a reload never shows it again.
 */
export function RecoveryCodeSheet() {
  const code = useSyncExternalStore(onRecoveryCode, recoveryCodeShown)
  return (
    <Dialog
      open={code !== null}
      onClose={forgetRecoveryCode}
      title="Save your recovery code"
      actions={<Button onClick={forgetRecoveryCode}>I saved it</Button>}
    >
      <p>If you ever lose every passkey and phone, this code lets you add a new key at once. We show it only now.</p>
      {code !== null ? <CodeBox code={grouped(code)} /> : null}
    </Dialog>
  )
}

/** Approvals and devices: the recovery code row. A new one is signed with a passkey here; the old one stops working. */
export function RecoveryCodeRow() {
  const make = useMutation({ mutationFn: makeNewRecoveryCode })
  return (
    <Card>
      <CardHeader>Recovery code</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-body text-muted">If you ever lose every passkey and phone, this code lets you add a new key at once.</p>
        {make.isError ? <Refused error={make.error} fallback="No new recovery code was made." /> : null}
        <div>
          <UiButton className="h-12 w-full wide:h-8 wide:w-auto" disabled={make.isPending} onClick={() => make.mutate()}>
            Make a new recovery code
          </UiButton>
        </div>
      </div>
    </Card>
  )
}

/** Said in place of an approve or resume control while no key is live, with the two ways back (on Approvals itself, below). */
export function NoLiveKey({ here }: { here: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink" data-testid="no-live-key">
      <span>{NO_LIVE_KEY}</span>
      {here ? null : (
        <>
          <Link className={inlineLink} to="/approvals#get-a-key-back">
            Use your recovery code
          </Link>
          <Link className={inlineLink} to="/approvals#get-a-key-back">
            Wait 72 hours
          </Link>
        </>
      )}
    </p>
  )
}

/**
 * Approvals and devices, when every key of the workspace was removed: the recovery code adds a new passkey made here at
 * once; without it, a recovery waits 72 hours, and every page then shows it (KeyRecoveryNotice).
 */
export function GetAKeyBack() {
  const changed = useKeyChanged()
  const [code, setCode] = useState('')
  const hint = useId()
  const waiting = useQuery({ queryKey: RECOVERY_KEY, queryFn: agentBankApi.waitingRecovery, retry: false })
  const withCode = useMutation({
    mutationFn: () => getAKeyBack(deviceName(), code),
    onSuccess: () => setCode(''),
    onSettled: changed,
  })
  const wait = useMutation({ mutationFn: agentBankApi.startRecovery, onSettled: changed })
  return (
    <Card id="get-a-key-back">
      <CardHeader>Face ID and notifications</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <p role="alert" className="text-body text-ink">
          {NO_LIVE_KEY}
        </p>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            withCode.mutate()
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-muted">
            Recovery code
            <Input className="font-figure" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <p id={hint} className="text-caption text-muted">
            {passkeysSupported() ? 'Type the code you saved, then make the new passkey on this device.' : 'This browser cannot make a passkey.'}
          </p>
          {withCode.isError ? <Refused error={withCode.error} fallback="No key was added." /> : null}
          <div>
            <UiButton
              type="submit"
              aria-describedby={hint}
              className="h-12 w-full wide:h-8 wide:w-auto"
              disabled={!passkeysSupported() || code.trim() === '' || withCode.isPending}
            >
              Use your recovery code
            </UiButton>
          </div>
        </form>
        {waiting.data?.recovery ? null : (
          <div className="flex flex-col gap-2 border-t border-rule pt-3">
            <p className="text-body text-muted">
              We wait 72 hours before you can add a new key, and tell everyone in your workspace. Anyone in it can cancel in that time.
            </p>
            {wait.isError ? <Refused error={wait.error} fallback="No recovery was started." /> : null}
            <div>
              <UiButton className="h-12 w-full wide:h-8 wide:w-auto" disabled={wait.isPending} onClick={() => wait.mutate()}>
                Wait 72 hours
              </UiButton>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * On every page while a recovery waits: who started it and from when a key can be added, Cancel recovery (Lens lets any
 * owner or admin), and from that time, for the person who started it, Add your new key.
 */
export function KeyRecoveryNotice() {
  const changed = useKeyChanged()
  const read = useQuery({ queryKey: RECOVERY_KEY, queryFn: agentBankApi.waitingRecovery, retry: false, refetchInterval: 60_000 })
  const cancel = useMutation({ mutationFn: agentBankApi.cancelRecovery, onSettled: changed })
  const add = useMutation({ mutationFn: () => getAKeyBack(deviceName()), onSettled: changed })
  const r: KeyRecovery | null | undefined = read.data?.recovery
  if (!r || r.status !== 'waiting') return null
  const { date, time } = readyWords(r.ready_at)
  const ready = Date.now() >= Date.parse(r.ready_at)
  const failed = cancel.isError ? cancel.error : add.isError ? add.error : null
  return (
    <div role="status" data-design="pocket" data-testid="key-recovery-notice" className="mb-gutter flex flex-col gap-2 rounded-card-tight bg-cloud px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3.5">
        <p className="min-w-0 flex-1 text-body text-ink">
          {r.mine ? 'You' : 'The owner'} started a recovery. A new key can be added from <span className="font-figure">{date}</span> at{' '}
          <span className="font-figure">{time}</span>.
        </p>
        {r.mine && ready && passkeysSupported() ? (
          <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
            Add your new key
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel recovery
        </Button>
      </div>
      {failed ? <Refused error={failed} fallback="Nothing changed." /> : null}
    </div>
  )
}
