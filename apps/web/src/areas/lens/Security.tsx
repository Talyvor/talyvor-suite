import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Crumb, Dialog, Icon, type IconName, Input, KindTile, Row, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { formatDecided } from './format'
import { CountryPicker, DigitBoxes, DOOR_WORDS, Note, PHONE_COUNTRIES, Said, digitsOf } from '../auth/Door'
import {
  DOOR_FAILED,
  DoorError,
  changeNumber,
  changePasscode,
  makeSignInKey,
  passkeysSupported,
  phoneFinish,
  phoneStart,
  rememberPasskeyHere,
  removeSignInKey,
  signInKeys,
  thisBrowserName,
  type SignInKey,
} from '../auth/doorApi'

// Security.tsx — B61.106: /settings/security, how a person signs in (REFERENCE Pocket Live `wb sheet:sub:security`):
//
//   · your passkeys: each sign-in key by name, removed with the passcode (Lens refuses the last way in), and a passkey
//     added on this browser with the passcode;
//   · your passcode: the old one, then the new one typed twice;
//   · your phone number: the new number, its texted code (the door's six boxes and its Sandbox code), then the passcode.
//
// B57.203 — drawn as Pocket Live's web panel: one card of rows that open their sheet (Add a passkey on this browser, then
// the phone's Change passcode and B61.106's Change number), "Your devices" with each key as a row pressed to remove it,
// and the passcode note under them.
//
// Lens holds every rule and the BFF (B61.105) relays its words: each refusal shown here is Lens's own sentence.

export const SECURITY_PATH = '/settings/security'
export const SIGN_IN_KEYS_KEY = ['sign-in-keys']

/** The page's words (Pocket Live's security sheet where it has them; the rest are listed on the PR). */
export const SECURITY_WORDS = {
  title: 'Security',
  devicesTitle: 'Your devices',
  noKeys: 'You have no passkey yet. You sign in with your phone number and passcode.',
  addKey: 'Add a passkey on this browser',
  addKeyLine: 'It signs you in here, with no code',
  addKeyLead: 'Your browser asks for your fingerprint or face, then the passkey is added.',
  added: 'Passkey added',
  addedLine: 'Next time this browser signs you in with no code.',
  noKeysHere: 'This browser cannot make a passkey. Try another browser.',
  remove: (name: string) => `Remove “${name}”?`,
  removeLead: 'It can no longer sign you in. Enter your passcode to remove it.',
  removed: (name: string) => `Removed: ${name}`,
  removedLine: 'It can no longer sign you in.',
  keep: 'Keep it',
  changePasscode: 'Change passcode',
  passcodeLine: '6 digits, asked each time you sign in to Talyvor',
  oldPasscode: 'Enter your passcode',
  oldLead: 'The one you have now.',
  newPasscode: 'Choose a new passcode',
  passcodeChanged: 'Your passcode is changed',
  passcodeChangedLine: 'Use the new one next time you sign in.',
  changeNumber: 'Change number',
  numberLine: 'We text a code to the new number, then ask your passcode',
  newNumber: 'Your new phone number',
  sendCode: 'Send code',
  numberPasscodeLead: 'To move your account to the new number.',
  numberChanged: (phone: string) => `Your number is now ${phone}`,
  numberChangedLine: 'Sign in with it from now on.',
  approvals: 'Approvals and devices',
  approvalsLine: 'The passkeys and the phone that approve payments',
  passcodeNote: 'Your passcode opens the phone app. It never approves a payment.',
} as const

const sentence = (err: unknown) => (err instanceof Error && err.message ? err.message : DOOR_FAILED)
const reasonOf = (err: unknown) => (err instanceof DoorError ? err.reason : '')

/** Pocket Live's device line: "Passkey · last used 20 Oct", or "Phone key · added 15 Oct" for one never used. */
function keyFacts(k: SignInKey): string {
  return [
    k.kind === 'device' ? 'Phone key' : 'Passkey',
    k.last_used_at ? `last used ${formatDecided(k.last_used_at)}` : `added ${formatDecided(k.created_at)}`,
  ].join(' · ')
}

const keyName = (k: SignInKey) => k.name || (k.kind === 'device' ? 'Phone key' : 'Passkey')

export function SecurityScreen() {
  const [open, setOpen] = useState<'passcode' | 'number' | null>(null)
  const close = () => setOpen(null)
  return (
    <div data-design="pocket" className="grid min-w-0 max-w-2xl gap-4">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: SECURITY_WORDS.title }]} />
      <Card>
        <AddKeyRow />
        <SheetRow title={SECURITY_WORDS.changePasscode} line={SECURITY_WORDS.passcodeLine} onOpen={() => setOpen('passcode')} />
        <SheetRow title={SECURITY_WORDS.changeNumber} line={SECURITY_WORDS.numberLine} onOpen={() => setOpen('number')} />
      </Card>
      {open === 'passcode' ? <ChangePasscodeDialog onClose={close} /> : null}
      {open === 'number' ? <ChangeNumberDialog onClose={close} /> : null}
      <YourDevices />
      <Note icon="shield">{SECURITY_WORDS.passcodeNote}</Note>
    </div>
  )
}

/** pocket.css .li as a press: the whole row is one control, named by `label` (else its title), its line read with it;
 *  an empty button over the row, so the line wraps as the row's words and not as a button's label. No `onOpen`, no press. */
function SheetRow({ icon, title, line, label, onOpen }: { icon?: IconName; title: string; line: React.ReactNode; label?: string; onOpen?: () => void }) {
  const lineId = useId()
  return (
    <div className="relative flex w-full items-center gap-3 rounded-control border-t border-line py-2.5 text-reading first:border-t-0">
      {icon ? <KindTile icon={<Icon name={icon} size={18} />} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span id={lineId} className="block text-body font-normal text-ink-3">
          {line}
        </span>
      </span>
      {onOpen ? (
        <>
          <Icon name="chev" size={16} className="shrink-0 text-ink-3" />
          <button
            type="button"
            className={`absolute inset-0 rounded-control ${pocketFocusRing}`}
            onClick={onOpen}
            aria-haspopup="dialog"
            aria-label={label ?? title}
            aria-describedby={lineId}
          />
        </>
      ) : null}
    </div>
  )
}

// ─── your passkeys ─────────────────────────────────────────────────────────

/** "Add a passkey on this browser", proved by the passcode; a browser that cannot make one says so and offers nothing. */
function AddKeyRow() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [canKey, setCanKey] = useState(false)
  useEffect(() => setCanKey(passkeysSupported()), [])
  return (
    <>
      <SheetRow
        title={SECURITY_WORDS.addKey}
        line={canKey ? SECURITY_WORDS.addKeyLine : SECURITY_WORDS.noKeysHere}
        onOpen={canKey ? () => setAdding(true) : undefined}
      />
      {adding ? (
        <AddKeyDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            showSnack({
              title: SECURITY_WORDS.added,
              line: SECURITY_WORDS.addedLine,
            })
            setAdding(false)
            void qc.invalidateQueries({ queryKey: SIGN_IN_KEYS_KEY })
          }}
        />
      ) : null}
    </>
  )
}

/** "Your devices": each sign-in key, pressed to remove it with the passcode; then the keys that approve payments. */
function YourDevices() {
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: SIGN_IN_KEYS_KEY, queryFn: signInKeys })
  const [removing, setRemoving] = useState<SignInKey | null>(null)
  const list = keys.data ?? []
  return (
    <section aria-label={SECURITY_WORDS.devicesTitle} className="grid gap-2.5">
      <h2 className="px-0.5 pt-1.5 font-display text-bar font-bold text-ink">{SECURITY_WORDS.devicesTitle}</h2>
      <Card>
        {keys.error ? (
          <p className="pb-2 text-body text-danger" role="alert">
            {sentence(keys.error)}
          </p>
        ) : keys.isPending ? (
          <p className="pb-2 text-body text-ink-3">Reading…</p>
        ) : list.length === 0 ? (
          <p className="pb-2 text-body text-ink-3">{SECURITY_WORDS.noKeys}</p>
        ) : (
          <div data-testid="sign-in-keys">
            {list.map((k) => (
              <SheetRow
                key={k.id}
                icon={k.kind === 'device' ? 'phone' : 'key'}
                title={keyName(k)}
                line={keyFacts(k)}
                label={`Remove ${keyName(k)}`}
                onOpen={() => setRemoving(k)}
              />
            ))}
          </div>
        )}
        <Row
          href="/settings/devices"
          leading={<KindTile icon={<Icon name="faceid" size={18} />} />}
          title={SECURITY_WORDS.approvals}
          line={SECURITY_WORDS.approvalsLine}
        />
      </Card>
      {removing ? (
        <RemoveKeyDialog
          k={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            showSnack({
              title: SECURITY_WORDS.removed(keyName(removing)),
              line: SECURITY_WORDS.removedLine,
            })
            setRemoving(null)
            void qc.invalidateQueries({ queryKey: SIGN_IN_KEYS_KEY })
          }}
        />
      ) : null}
    </section>
  )
}

/** "Remove “{name}”?": the passcode proves it is them; Lens refuses the last way in, in its own words. */
function RemoveKeyDialog({ k, onClose, onRemoved }: { k: SignInKey; onClose: () => void; onRemoved: () => void }) {
  const [tries, setTries] = useState(0)
  const remove = useMutation({
    mutationFn: (passcode: string) => removeSignInKey(k.id, passcode),
    onSuccess: onRemoved,
    onError: () => setTries((n) => n + 1),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={SECURITY_WORDS.remove(keyName(k))}
      actions={
        <Button variant="secondary" disabled={remove.isPending} onClick={onClose}>
          {SECURITY_WORDS.keep}
        </Button>
      }
    >
      <p>{SECURITY_WORDS.removeLead}</p>
      <DigitBoxes label="Passcode" masked disabled={remove.isPending} resetKey={tries} onDone={(p) => remove.mutate(p)} />
      {remove.error ? <Said>{sentence(remove.error)}</Said> : null}
    </Dialog>
  )
}

/** A passkey made on this browser and kept as a sign-in key, proved by the passcode. */
function AddKeyDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [tries, setTries] = useState(0)
  const add = useMutation({
    mutationFn: (passcode: string) => makeSignInKey(thisBrowserName(), passcode),
    onSuccess: () => {
      rememberPasskeyHere()
      onAdded()
    },
    onError: () => setTries((n) => n + 1),
  })
  return (
    <Dialog open onClose={onClose} title={SECURITY_WORDS.addKey}>
      <p>{SECURITY_WORDS.addKeyLead}</p>
      <DigitBoxes label="Passcode" masked disabled={add.isPending} resetKey={tries} onDone={(p) => add.mutate(p)} />
      {add.isPending ? <p role="status">Saving…</p> : null}
      {add.error ? <Said>{sentence(add.error)}</Said> : null}
    </Dialog>
  )
}

// ─── your passcode ─────────────────────────────────────────────────────────

type PasscodeStep = { at: 'old' } | { at: 'new'; old: string } | { at: 'again'; old: string; first: string }

/** The old passcode, then the new one typed twice. A wrong old one is asked again; a new one Lens will not take is chosen again. */
function ChangePasscodeDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<PasscodeStep>({ at: 'old' })
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = (next: PasscodeStep, words: string | null = null) => {
    setStep(next)
    setSaid(words)
  }
  const done = async (digits: string) => {
    if (step.at === 'old') return go({ at: 'new', old: digits })
    if (step.at === 'new') return go({ at: 'again', old: step.old, first: digits })
    if (digits !== step.first) return go({ at: 'new', old: step.old }, DOOR_WORDS.different)
    setBusy(true)
    try {
      await changePasscode(step.old, digits)
      showSnack({
        title: SECURITY_WORDS.passcodeChanged,
        line: SECURITY_WORDS.passcodeChangedLine,
      })
      onClose()
    } catch (err) {
      const reason = reasonOf(err)
      if (reason === 'weak_passcode') go({ at: 'new', old: step.old }, sentence(err))
      else go({ at: 'old' }, sentence(err))
    } finally {
      setBusy(false)
    }
  }
  const words =
    step.at === 'old'
      ? { title: SECURITY_WORDS.oldPasscode, lead: SECURITY_WORDS.oldLead }
      : step.at === 'new'
        ? { title: SECURITY_WORDS.newPasscode, lead: DOOR_WORDS.chooseLead }
        : { title: DOOR_WORDS.againTitle, lead: DOOR_WORDS.againLead }
  return (
    <Dialog open onClose={onClose} title={words.title}>
      <p>{words.lead}</p>
      <DigitBoxes key={step.at} label="Passcode" masked disabled={busy} onDone={(d) => void done(d)} />
      {said ? <Said>{said}</Said> : null}
    </Dialog>
  )
}

// ─── your phone number ─────────────────────────────────────────────────────

type NumberStep =
  | { at: 'phone' }
  | {
      at: 'code'
      phone: string
      shown: string
      sandboxCode?: string
      sentAt: number
    }
  | { at: 'passcode'; check: string }

/** Seconds before "Send again" is offered, as at the door. */
const SEND_AGAIN_AFTER = 30

/** The new number, its texted code in the door's six boxes, then the passcode. */
function ChangeNumberDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<NumberStep>({ at: 'phone' })
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const [dial, setDial] = useState('GB')
  const [national, setNational] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (step.at !== 'code') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step.at])
  const go = (next: NumberStep) => {
    setSaid(null)
    setStep(next)
  }
  /** One call; a refusal is shown in Lens's words, and sends the person back to the step it is about. */
  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    setSaid(null)
    try {
      await call()
    } catch (err) {
      const reason = reasonOf(err)
      if (['ticket_ended', 'held', 'same_number', 'number_moved'].includes(reason)) setStep({ at: 'phone' })
      setSaid(sentence(err))
      setTries((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }
  const calling = (PHONE_COUNTRIES.find(([c]) => c === dial) ?? PHONE_COUNTRIES[0])[2]
  const phone = `+${calling}${digitsOf(national).replace(/^0+/, '')}`
  const shown = `+${calling} ${national.trim().replace(/^0+/, '')}`
  const send = (to: string, label: string) =>
    run(async () => {
      const started = await phoneStart(to)
      go({
        at: 'code',
        phone: to,
        shown: label,
        sandboxCode: started.sandbox ? started.sandbox_code : undefined,
        sentAt: Date.now(),
      })
      setNow(Date.now())
    })

  if (step.at === 'code') {
    const wait = Math.max(0, SEND_AGAIN_AFTER - Math.floor((now - step.sentAt) / 1000))
    return (
      <Dialog open onClose={onClose} title={DOOR_WORDS.codeTitle}>
        <p>{DOOR_WORDS.sentTo(step.shown)}</p>
        <DigitBoxes
          key="code"
          label="The code"
          oneTimeCode
          disabled={busy}
          resetKey={tries}
          onDone={(code) =>
            run(async () => {
              const checked = await phoneFinish(step.phone, code)
              go({ at: 'passcode', check: checked.check })
            })
          }
        />
        {step.sandboxCode ? <Note icon="message">{DOOR_WORDS.sandboxCode(step.sandboxCode)}</Note> : null}
        {said ? <Said>{said}</Said> : null}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" disabled={busy} onClick={() => go({ at: 'phone' })}>
            {DOOR_WORDS.back}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            disabledReason={wait > 0 ? DOOR_WORDS.sendAgainIn(wait) : undefined}
            onClick={() => void send(step.phone, step.shown)}
          >
            {DOOR_WORDS.sendAgain}
          </Button>
        </div>
      </Dialog>
    )
  }

  if (step.at === 'passcode') {
    return (
      <Dialog open onClose={onClose} title={SECURITY_WORDS.oldPasscode}>
        <p>{SECURITY_WORDS.numberPasscodeLead}</p>
        {/* Its own boxes: the code's would carry their six digits into the passcode (B17.556). */}
        <DigitBoxes
          key="passcode"
          label="Passcode"
          masked
          disabled={busy}
          resetKey={tries}
          onDone={(passcode) =>
            run(async () => {
              const out = await changeNumber(step.check, passcode)
              showSnack({
                title: SECURITY_WORDS.numberChanged(out.phone || shown),
                line: SECURITY_WORDS.numberChangedLine,
              })
              onClose()
            })
          }
        />
        {said ? <Said>{said}</Said> : null}
      </Dialog>
    )
  }

  return (
    <Dialog open onClose={onClose} title={SECURITY_WORDS.newNumber}>
      <form
        noValidate
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (digitsOf(national)) void send(phone, shown)
        }}
      >
        <label htmlFor="security-phone" className="sr-only">
          {SECURITY_WORDS.newNumber}
        </label>
        <div className="flex gap-2">
          <CountryPicker value={dial} onChange={setDial} />
          <Input
            id="security-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={national}
            maxLength={20}
            placeholder={dial === 'GB' ? DOOR_WORDS.phoneExample : undefined}
            onChange={(e) => setNational(e.target.value)}
            className="flex-1"
          />
        </div>
        {said ? <Said>{said}</Said> : null}
        <Button type="submit" className="justify-self-end" disabled={busy} disabledReason={digitsOf(national) ? undefined : DOOR_WORDS.phoneNeeded}>
          {busy ? 'Sending…' : SECURITY_WORDS.sendCode}
        </Button>
      </form>
    </Dialog>
  )
}
