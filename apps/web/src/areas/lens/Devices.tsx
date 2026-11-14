import { useEffect, useState } from 'react'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Crumb, Dialog, Facts, Icon, KindTile, Row, showSnack } from '@talyvor/ui/pocket'
import { StartEveryAgent, useAllPaused, usePauseEveryAgent } from '../../components/EveryAgent'
import { DEVICES_KEY, PASSKEYS_KEY, deviceText, useKeys } from './AgentBank'
import { GetAKeyBack, RecoveryCodeRow } from './KeyRecovery'
import { LAST_KEY, RemoveKeyDialog } from './RemoveKey'
import { agentBankApi, type ApprovalKey, type KeyEnrolment } from './agentBankApi'
import { formatDecided } from './format'
import { readFailure } from './WalletMoney'
import { letInKey, notifyThisDevice, passkeysSupported, pushSupported, registerThisDevice } from './passkeys'

// Devices.tsx — B57.43: /settings/devices, Approvals and devices, as Pocket's w-security draws it. Every passkey and the
// phone's key by name, removed after asking and never signed (B55.16; Lens refuses the last one); Add this device, signed
// by a passkey the workspace has or let in by the phone (B55.3); a phone waiting to be let in; an agent's approval; Stop
// everything. Lens decides who may add, remove and let in: this page only draws what it says.

export const APPROVAL_KEYS_KEY = ['approval-keys']
const ENROLMENTS_KEY = ['key-enrolments']

/** A card's title, as Pocket draws it (pocket.css .h3). */
function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-reading font-bold text-ink">{children}</h2>
}

/** B55.16 — "Passkey · added 14 Oct · last used 20 Oct", or "Phone key · …". */
function keyFacts(k: ApprovalKey): string {
  return [
    k.kind === 'phone' ? 'Phone key' : 'Passkey',
    `added ${formatDecided(k.created_at)}`,
    k.last_used_at ? `last used ${formatDecided(k.last_used_at)}` : 'never used',
  ].join(' · ')
}

const keyName = (k: ApprovalKey) => k.name || (k.kind === 'phone' ? 'Phone key' : 'Passkey')

/** Said when the workspace has no key at all. */
const NO_KEY = 'No key is registered, so nobody can approve. Add one.'

/** The card's line for every mix of keys: "2 passkeys and your phone’s key are registered. You approve with one of them; …". */
export function keysLine(keys: ApprovalKey[]): string {
  const phones = keys.filter((k) => k.kind === 'phone').length
  const passkeys = keys.length - phones
  const what = [
    passkeys === 0 ? '' : `${passkeys} passkey${passkeys === 1 ? '' : 's'}`,
    phones === 0 ? '' : phones === 1 ? 'your phone’s key' : `${phones} phone keys`,
  ]
    .filter((x) => x !== '')
    .join(' and ')
  const head = `${what.charAt(0).toUpperCase()}${what.slice(1)} ${keys.length === 1 ? 'is' : 'are'} registered.`
  return keys.length === 1
    ? `${head} You approve with it; nothing is approved without it.`
    : `${head} You approve with one of them; nothing is approved without one.`
}

export function DevicesScreen() {
  const keys = useKeys()
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Approvals and devices' }]} />
      <p className="max-w-3xl text-reading text-ink-2">Who can approve a payment, and how.</p>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid min-w-0 gap-4 wide:col-span-7">
          {/* B55.54 — with every key removed, the way to get one back; still today's design. */}
          {keys.noLiveKey ? (
            <div data-design="today">
              <GetAKeyBack />
            </div>
          ) : (
            <KeysCard />
          )}
          <section aria-label="An agent’s approval">
            <Card>
              <Title>An agent’s approval</Title>
              <Facts
                className="mt-2"
                on="cloud"
                facts={[
                  { label: 'One approval covers', value: 'That payment only' },
                  { label: 'Once you approve, it lasts', value: '24 hours' },
                  { label: 'A request you don’t answer', value: 'Expires after 24 hours' },
                ]}
              />
            </Card>
          </section>
          {keys.thisBrowserSigns ? (
            <div data-design="today">
              <RecoveryCodeRow />
            </div>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-4 wide:col-span-5">
          <StopEverything />
          <YourPhone />
        </div>
      </div>
    </div>
  )
}

/** "Approvals are signed": the line for the keys there are, each key with Remove, Add this device and Notify this device. */
function KeysCard() {
  const qc = useQueryClient()
  const mine = useKeys()
  // Lens lets only the owner or an admin read the keys; anyone else keeps the line without the list.
  const keys = useQuery({ queryKey: APPROVAL_KEYS_KEY, queryFn: agentBankApi.approvalKeys })
  const list = keys.data?.keys ?? []
  const [asking, setAsking] = useState<ApprovalKey | null>(null)
  const changed = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: APPROVAL_KEYS_KEY }),
      qc.invalidateQueries({ queryKey: PASSKEYS_KEY }),
      qc.invalidateQueries({ queryKey: DEVICES_KEY }),
    ])
  const remove = useMutation({
    // Removing needs no signature: stopping a key is instant, and Lens refuses the last one.
    mutationFn: async (k: ApprovalKey) => {
      await (k.kind === 'phone' ? agentBankApi.revokeDevice(k.id) : agentBankApi.removePasskey(k.id))
    },
    onSuccess: (_, k) => {
      setAsking(null)
      showSnack({ title: `Removed: ${keyName(k)}`, line: 'It can no longer approve anything.' })
    },
    onSettled: changed,
  })
  const ask = (k: ApprovalKey | null) => {
    remove.reset()
    setAsking(k)
  }
  const notify = useMutation({
    mutationFn: notifyThisDevice,
    onSuccess: () => showSnack({ title: 'This device is told when an agent asks for approval' }),
    onError: (err) => showSnack({ title: 'Notifications could not be turned on', line: deviceText(err, 'Try again.') }),
  })
  // Anyone but an owner or admin is refused the list, and is told what the workspace's passkeys and phone say instead.
  const line = mine.error
    ? readFailure(mine.error, 'Your keys')
    : keys.isSuccess
      ? list.length === 0
        ? NO_KEY
        : keysLine(list)
      : keys.isPending || !mine.isSuccess
        ? 'Reading…'
        : mine.signed && mine.passkeyCount === 0
          ? 'Approvals are signed on your phone. Nothing is approved without it.'
          : mine.signed
            ? `Approvals are signed with a passkey (${mine.passkeyCount} registered). Nothing is approved without one.`
            : NO_KEY
  return (
    <Card tone="white" aria-label="Approvals are signed">
      <div className="flex items-start gap-3">
        <KindTile icon={<Icon name="shield" />} className="bg-success-50 text-success" />
        <div className="grid min-w-0 gap-0.5 pt-1">
          <h2 className="font-display text-bar font-bold text-ink">Approvals are signed</h2>
          <p className="text-body text-ink-3">{line}</p>
        </div>
      </div>
      {list.length > 0 ? (
        <div className="mt-3" data-testid="approval-keys">
          {list.map((k) => (
            <Row
              key={`${k.kind}-${k.id}`}
              leading={<KindTile on="white" icon={<Icon name={k.kind === 'phone' ? 'phone' : 'key'} size={18} />} />}
              title={keyName(k)}
              line={keyFacts(k)}
              action={
                list.length === 1 ? null : (
                  <Button variant="secondary" size="sm" aria-label={`Remove ${keyName(k)}`} onClick={() => ask(k)}>
                    Remove
                  </Button>
                )
              }
            />
          ))}
        </div>
      ) : null}
      {list.length === 1 ? <p className="mt-2 text-body text-ink-3">{LAST_KEY}</p> : null}
      <RemoveKeyDialog
        name={asking ? keyName(asking) : null}
        pending={remove.isPending}
        error={remove.error}
        onKeep={() => ask(null)}
        onRemove={() => asking && remove.mutate(asking)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <AddThisDevice />
        {pushSupported() ? (
          <Button variant="secondary" icon={<Icon name="bell" size={16} />} disabled={notify.isPending} onClick={() => notify.mutate()}>
            Notify this device
          </Button>
        ) : (
          <p className="text-body text-ink-3">To be told on an iPhone, add Talyvor to the Home Screen (Share, then Add to Home Screen) and open it from there.</p>
        )}
      </div>
    </Card>
  )
}

/** Said once a passkey made here is registered, and the keys read again. */
function added(qc: QueryClient) {
  showSnack({ title: 'This browser now signs approvals', line: 'Face ID, Touch ID or this device’s PIN asks each time you approve or decline.' })
  return Promise.all([qc.invalidateQueries({ queryKey: PASSKEYS_KEY }), qc.invalidateQueries({ queryKey: APPROVAL_KEYS_KEY })])
}

/**
 * Add this device: a passkey made here, signed by one the workspace has (B50.22); with only the phone's key, Lens keeps
 * it waiting until the phone lets it in (B55.3), and this says so, with the code, until the phone answers.
 */
function AddThisDevice() {
  const qc = useQueryClient()
  const { isSuccess, onlyThePhone, passkeyCount } = useKeys()
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState<{ id: string; code: string } | null>(null)
  const register = useMutation({
    mutationFn: () => registerThisDevice(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device'),
    onSuccess: (enrolment) => {
      if (enrolment) return setWaiting(enrolment)
      setOpen(false)
      return added(qc)
    },
  })
  // Asked every 3 seconds while the phone decides; Lens expires the enrolment after 10 minutes, and so does this.
  const poll = useQuery({
    queryKey: ['key-enrolment', waiting?.id],
    queryFn: () => agentBankApi.enrolment(waiting!.id),
    enabled: waiting !== null,
    refetchInterval: 3000,
  })
  const status = waiting ? poll.data?.status : undefined
  useEffect(() => {
    if (!waiting) return
    const end = (yes: boolean) => {
      setWaiting(null)
      setOpen(false)
      if (yes) void added(qc)
      else showSnack({ title: 'This browser was not added', line: 'Nothing changed.' })
    }
    if (status === 'approved') return end(true)
    if (status === 'declined' || status === 'expired') return end(false)
    const timer = setTimeout(() => end(false), 10 * 60_000)
    return () => clearTimeout(timer)
  }, [waiting, status, qc])
  if (!passkeysSupported()) return <p className="text-body text-ink-3">This browser cannot make a passkey.</p>
  if (!isSuccess) return null
  const waitingLine = waiting ? (
    <>
      Waiting for your phone. Open Talyvor on your phone and let this browser in. The code there should be <span className="font-figure">{waiting.code}</span>.
    </>
  ) : null
  const close = () => {
    register.reset()
    setOpen(false)
  }
  return (
    <>
      <Button variant="secondary" icon={<Icon name="plus" size={16} />} disabled={waiting !== null} onClick={() => setOpen(true)}>
        Add this device
      </Button>
      {waiting && !open ? <p className="basis-full text-body text-ink">{waitingLine}</p> : null}
      <Dialog
        open={open}
        onClose={close}
        title="Add this device"
        actions={
          waiting ? (
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={register.isPending} onClick={close}>
                Cancel
              </Button>
              <Button icon={<Icon name="key" size={16} />} disabled={register.isPending} onClick={() => register.mutate()}>
                Make a passkey
              </Button>
            </>
          )
        }
      >
        <p>
          {waiting
            ? waitingLine
            : onlyThePhone
              ? 'This browser makes a passkey, and your phone lets it in: only your phone’s key can sign for it now.'
              : passkeyCount > 0
                ? 'This browser makes a passkey, and one you already have signs for it. From then on, Face ID, Touch ID or this device’s PIN asks each time you approve or decline.'
                : 'This browser makes a passkey. From then on, Face ID, Touch ID or this device’s PIN asks each time you approve or decline.'}
        </p>
        {register.isError ? <p role="alert">{deviceText(register.error, 'No passkey was made.')}</p> : null}
      </Dialog>
    </>
  )
}

/** Stop everything: Pause every agent at once, or while they are paused, Start every agent again, signed. */
function StopEverything() {
  const paused = useAllPaused()
  const pause = usePauseEveryAgent('paused from Approvals and devices')
  const [starting, setStarting] = useState(false)
  return (
    <section aria-label="Stop everything">
      <Card tone="white">
        <Title>Stop everything</Title>
        <p className="mt-1 text-body text-ink-3">
          Pause every agent at once. Each next request or payment is refused until you start them again, which needs your passkey or your phone.
        </p>
        <div className="mt-3">
          {paused ? (
            <Button icon={<Icon name="key" size={16} />} onClick={() => setStarting(true)}>
              Start every agent again
            </Button>
          ) : (
            <Button variant="danger" icon={<Icon name="pause" size={16} />} disabled={pause.isPending} onClick={() => pause.mutate()}>
              Pause every agent
            </Button>
          )}
        </div>
        <StartEveryAgent open={starting} onClose={() => setStarting(false)} />
      </Card>
    </section>
  )
}

/** Your phone: its key in the secure chip, used only with Face ID, and a phone waiting to be let in (B55.3). */
function YourPhone() {
  const { thisBrowserSigns } = useKeys()
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: agentBankApi.devices })
  const all = devices.data?.devices ?? []
  const live = all.some((d) => !d.revoked_at)
  return (
    <section aria-label="Your phone">
      <Card>
        <Title>Your phone</Title>
        {devices.isError ? (
          <p className="mt-1 text-body text-ink-3">{readFailure(devices.error, 'Your phone’s key')}</p>
        ) : devices.isSuccess ? (
          <p className="mt-1 text-body text-ink-3">
            {live
              ? 'On your phone, the Talyvor app keeps a key in its secure chip that only Face ID can use, and signs your approvals with it.'
              : all.length > 0
                ? 'Your phone’s key was removed, so the phone cannot approve. Turn approving on in the Talyvor app, then let it in here.'
                : 'Turn approving on in the Talyvor app, then let it in here.'}
          </p>
        ) : null}
        {/* Letting a phone in is signed by a passkey here, so only a browser that signs is shown who waits. */}
        {thisBrowserSigns ? <WaitingPhones /> : null}
      </Card>
    </section>
  )
}

/**
 * B55.3 — a phone waiting to approve payments too (Lens B55.1), let in by this browser's passkey signing its enrolment
 * challenge. Lens lets only an owner or admin read them, so for anyone else the list fails and nothing shows.
 */
function WaitingPhones() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ENROLMENTS_KEY, queryFn: agentBankApi.enrolments, refetchInterval: 3000 })
  const decide = useMutation({
    mutationFn: async ({ en, letIn }: { en: KeyEnrolment; letIn: boolean }) => {
      await (letIn ? letInKey(en.id) : agentBankApi.declineEnrolment(en.id))
    },
    onSuccess: (_, { en, letIn }) =>
      showSnack(
        letIn
          ? { title: `Your ${en.name} can approve now`, line: 'It signs approvals with Face ID.' }
          : { title: 'Not let in', line: 'The phone was not added. Nothing changed.' },
      ),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ENROLMENTS_KEY }),
        qc.invalidateQueries({ queryKey: DEVICES_KEY }),
        qc.invalidateQueries({ queryKey: APPROVAL_KEYS_KEY }),
      ]),
  })
  const phones = (list.data?.enrolments ?? []).filter((en) => en.kind === 'device' && en.status === 'waiting')
  return (
    <>
      {decide.isError ? (
        <p role="alert" className="mt-2 text-body text-ink">
          {deviceText(decide.error, `${decide.variables.en.name} was not added. Nothing changed.`)}
        </p>
      ) : null}
      {phones.map((en) => (
        <div key={en.id} className="mt-3 grid gap-2">
          <p className="text-body text-ink" data-testid="waiting-phone">
            <b className="font-semibold">Your {en.name} asks to approve payments too.</b> Let it in only if you are adding it now and its code is{' '}
            <span className="font-figure">{en.code}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Icon name="key" size={16} />} disabled={decide.isPending} onClick={() => decide.mutate({ en, letIn: true })}>
              Let it approve
            </Button>
            <Button variant="secondary" size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ en, letIn: false })}>
              Not this one
            </Button>
          </div>
        </div>
      ))}
    </>
  )
}
