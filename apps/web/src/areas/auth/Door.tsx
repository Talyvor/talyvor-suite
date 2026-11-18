import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Logo, cn, inlineLink } from '@talyvor/ui'
import { Button, Icon, Input, Select, pocketFocusRing } from '@talyvor/ui/pocket'
import { StatusLabel } from '../../labels/StatusLabel'
import {
  DoorError,
  DOOR_FAILED,
  doorNav,
  holdPasscode,
  makeSignInKey,
  passkeyHere,
  passkeySignIn,
  passkeysSupported,
  phoneFinish,
  phoneJoin,
  phoneSignIn,
  phoneStart,
  rememberPasskeyHere,
  rememberSignedInHere,
  signedInHere,
  thisBrowserName,
  type SignedIn,
} from './doorApi'

// Door.tsx — B61.26: the web's one door (REFERENCE Pocket Live, the phone's `su` steps, one question per page).
//
//   1. "What’s your phone number?" with the country picker, one field, one button. Above it, "Sign in with a passkey",
//      offered first to anyone who has signed in on this browser before. It is the only way in: Google sign-in is gone
//      (B61.29).
//   2. The code: six boxes; a paste or the browser's fill from the text lands in all six; "Send again" after 30 seconds.
//      In Sandbox the code is on the screen, under the Sandbox label.
//   3. A known number: the passcode. A new number: choose a passcode, typed twice, then sign-up's steps (SignUp.tsx).
//   4. After a sign-in without a passkey: "Sign in faster next time" offers to make one here, and can be skipped.
//
// There is no password anywhere: the passcode is six numeric digits, masked, and it is the only secret typed here.
// Every refusal is Lens's own sentence (relayed by the BFF), which says what to do next.

/** The country picker: each country sign-up offers, and its calling code. */
export const PHONE_COUNTRIES: readonly (readonly [string, string, string])[] = [
  ['GB', 'United Kingdom', '44'], ['US', 'United States', '1'], ['AU', 'Australia', '61'], ['AT', 'Austria', '43'],
  ['BE', 'Belgium', '32'], ['BR', 'Brazil', '55'], ['BG', 'Bulgaria', '359'], ['CA', 'Canada', '1'], ['HR', 'Croatia', '385'],
  ['CY', 'Cyprus', '357'], ['CZ', 'Czechia', '420'], ['DK', 'Denmark', '45'], ['EE', 'Estonia', '372'], ['FI', 'Finland', '358'],
  ['FR', 'France', '33'], ['DE', 'Germany', '49'], ['GR', 'Greece', '30'], ['HU', 'Hungary', '36'], ['IS', 'Iceland', '354'],
  ['IN', 'India', '91'], ['IE', 'Ireland', '353'], ['IL', 'Israel', '972'], ['IT', 'Italy', '39'], ['JP', 'Japan', '81'],
  ['LV', 'Latvia', '371'], ['LI', 'Liechtenstein', '423'], ['LT', 'Lithuania', '370'], ['LU', 'Luxembourg', '352'],
  ['MT', 'Malta', '356'], ['MX', 'Mexico', '52'], ['MD', 'Moldova', '373'], ['NL', 'Netherlands', '31'],
  ['NZ', 'New Zealand', '64'], ['NO', 'Norway', '47'], ['PL', 'Poland', '48'], ['PT', 'Portugal', '351'], ['RO', 'Romania', '40'],
  ['SG', 'Singapore', '65'], ['SK', 'Slovakia', '421'], ['SI', 'Slovenia', '386'], ['ZA', 'South Africa', '27'],
  ['ES', 'Spain', '34'], ['SE', 'Sweden', '46'], ['CH', 'Switzerland', '41'], ['AE', 'United Arab Emirates', '971'],
]

/** The door's words (Pocket Live's texts.json, the phone's su0 to su2 and lock; the rest are listed on the PR). */
export const DOOR_WORDS = {
  passkey: 'Sign in with a passkey',
  phoneTitle: 'What’s your phone number?',
  phoneLead: 'We text you a code to check it’s yours.',
  phoneLabel: 'Your phone number',
  country: 'Country',
  phoneNeeded: 'Type your phone number.',
  codeTitle: 'Enter the code',
  sentTo: (shown: string) => `We sent it to ${shown}.`,
  sandboxCode: (code: string) => `In Sandbox no text is sent. Your code is ${code.slice(0, 3)} ${code.slice(3)}.`,
  sendAgain: 'Send again',
  sendAgainIn: (s: number) => `You can ask for a new code in ${s} seconds.`,
  sentAgain: 'A new code is on its way.',
  otherNumber: 'Use another number',
  passcodeTitle: 'Enter your passcode',
  chooseTitle: 'Choose a passcode',
  chooseLead: '6 digits. You type it each time you sign in to Talyvor.',
  againTitle: 'Type it again',
  againLead: 'The same 6 digits, to be sure.',
  different: 'Those two were not the same. Choose a passcode again.',
  fasterTitle: 'Sign in faster next time',
  fasterLead: 'Make a passkey on this browser. Next time Face ID, Touch ID or this device’s PIN signs you in, with no code.',
  makePasskey: 'Make a passkey',
  notNow: 'Not now',
} as const

/** The digits a box can hold: everything else typed or pasted is dropped. */
const digitsOf = (s: string) => s.replace(/\D/g, '')

/**
 * Six boxes for a code or the passcode. A paste, or the browser's fill from the text into the first box, lands in all
 * six; typing moves on a box, Backspace moves back. The passcode's boxes are masked. Six digits send at once.
 */
export function DigitBoxes({ label, masked = false, oneTimeCode = false, disabled = false, onDone, resetKey }: {
  label: string
  masked?: boolean
  oneTimeCode?: boolean
  disabled?: boolean
  onDone: (digits: string) => void
  /** A new value clears the boxes (after a refusal) and puts the cursor in the first. */
  resetKey?: unknown
}) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  useEffect(() => {
    setDigits(['', '', '', '', '', ''])
    boxes.current[0]?.focus()
  }, [resetKey])
  const put = (from: number, typed: string) => {
    const got = digitsOf(typed)
    if (!got) return
    const next = [...digits]
    // More than one digit is a paste or the browser's fill: it starts at the first box when it is a whole code.
    const start = got.length >= 6 ? 0 : from
    for (let i = 0; i < got.length && start + i < 6; i++) next[start + i] = got[i]
    setDigits(next)
    const filled = next.findIndex((d) => d === '')
    boxes.current[filled === -1 ? 5 : filled]?.focus()
    if (filled === -1) onDone(next.join(''))
  }
  return (
    <div role="group" aria-label={label} className="grid w-full max-w-xs grid-cols-6 gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          aria-label={`${label}, digit ${i + 1} of 6`}
          type={masked ? 'password' : 'text'}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={oneTimeCode && i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 && oneTimeCode ? 6 : 1}
          value={d}
          disabled={disabled}
          className={cn(
            'h-12 w-full min-w-0 rounded-control bg-page text-center font-figure text-title font-semibold text-ink shadow-edge',
            'transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
            pocketFocusRing,
          )}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') {
              const next = [...digits]
              next[i] = ''
              setDigits(next)
              return
            }
            put(i, v)
          }}
          onFocus={(e) => e.target.select()}
          onPaste={(e) => {
            e.preventDefault()
            put(i, e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) {
              const next = [...digits]
              next[i - 1] = ''
              setDigits(next)
              boxes.current[i - 1]?.focus()
            }
          }}
        />
      ))}
    </div>
  )
}

/** A refusal, in Lens's words. */
function Said({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-body text-danger">
      <Icon name="x" size={16} />
      {children}
    </p>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="mt-4 font-display text-title font-bold text-ink">{children}</h1>
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-reading text-ink-2">{children}</p>
}

const quietButton = cn('text-body font-semibold text-ink', inlineLink)

const sentence = (err: unknown) => (err instanceof Error && err.message ? err.message : DOOR_FAILED)

type Step =
  | { at: 'phone' }
  | { at: 'code'; phone: string; shown: string; sandboxCode?: string; sentAt: number }
  | { at: 'passcode'; check: string }
  | { at: 'choose'; check: string }
  | { at: 'again'; check: string; first: string }
  | { at: 'faster'; passcode: string }

/** Seconds before "Send again" is offered. */
const SEND_AGAIN_AFTER = 30

export interface DoorProps {
  /** Where a sign-in lands: the page the person was trying to reach, or Home. */
  returnTo?: string
  /** What the door shows under its button, for a stranger (the access line on /signup). */
  foot?: React.ReactNode
}

/** The door, drawn in the auth card (Entry.tsx's EntryFrame, or AuthGate's card in place). */
export function Door({ returnTo, foot }: DoorProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>({ at: 'phone' })
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const [dial, setDial] = useState('GB')
  const [national, setNational] = useState('')
  const [canKey, setCanKey] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setCanKey(passkeysSupported()), [])
  useEffect(() => {
    if (step.at !== 'code') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step.at])

  const go = (next: Step) => {
    setSaid(null)
    setStep(next)
  }
  /** Runs one call to the door; a refusal is shown in Lens's words and, when the check has ended, starts again. */
  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    setSaid(null)
    try {
      await call()
    } catch (err) {
      if (err instanceof DoorError && err.reason === 'ticket_ended') setStep({ at: 'phone' })
      setSaid(sentence(err))
      setTries((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }
  /** Signed in: the session is new, so nothing read before it is kept, and the person goes where they were going. An
   *  assistant's Connect page (/oauth/) is the BFF's, not the app's, so it is a page load. */
  const land = async (to: string) => {
    if (to.startsWith('/oauth/')) {
      doorNav.leave(to)
      return
    }
    navigate(to, { replace: true })
    await qc.resetQueries()
  }
  const signedIn = async (got: SignedIn, passcode?: string) => {
    rememberSignedInHere()
    if (got.signup_unfinished) {
      holdPasscode(passcode)
      await land('/signup')
    } else if (passcode && canKey && !passkeyHere()) {
      go({ at: 'faster', passcode })
    } else {
      await land(returnTo ?? '/')
    }
  }

  const phone = `+${(PHONE_COUNTRIES.find(([c]) => c === dial) ?? PHONE_COUNTRIES[0])[2]}${digitsOf(national).replace(/^0+/, '')}`
  const shown = `+${(PHONE_COUNTRIES.find(([c]) => c === dial) ?? PHONE_COUNTRIES[0])[2]} ${national.trim().replace(/^0+/, '')}`
  const sendCode = () =>
    run(async () => {
      const started = await phoneStart(phone)
      go({ at: 'code', phone, shown, sandboxCode: started.sandbox ? started.sandbox_code : undefined, sentAt: Date.now() })
      setNow(Date.now())
    })

  const finishWith = (check: string, passcode: string, join: boolean) =>
    run(async () => {
      await signedIn(await (join ? phoneJoin(check, passcode) : phoneSignIn(check, passcode)), passcode)
    })

  const logo = (
    <a href="/marketing" aria-label="Talyvor website" className={cn('rounded-control', pocketFocusRing)}>
      <Logo width={144} />
    </a>
  )

  if (step.at === 'code') {
    const wait = Math.max(0, SEND_AGAIN_AFTER - Math.floor((now - step.sentAt) / 1000))
    return (
      <>
        {logo}
        <Title>{DOOR_WORDS.codeTitle}</Title>
        <Lead>{DOOR_WORDS.sentTo(step.shown)}</Lead>
        {step.sandboxCode ? (
          <div className="grid justify-items-start gap-1.5">
            <StatusLabel legend="sandbox" />
            <p className="text-body text-ink-2">{DOOR_WORDS.sandboxCode(step.sandboxCode)}</p>
          </div>
        ) : null}
        <DigitBoxes
          label="The code"
          oneTimeCode
          disabled={busy}
          resetKey={tries}
          onDone={(code) =>
            run(async () => {
              const checked = await phoneFinish(step.phone, code)
              go(checked.has_person ? { at: 'passcode', check: checked.check } : { at: 'choose', check: checked.check })
            })
          }
        />
        {said ? <Said>{said}</Said> : null}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button
            variant="outline"
            disabled={busy}
            disabledReason={wait > 0 ? DOOR_WORDS.sendAgainIn(wait) : undefined}
            onClick={() =>
              run(async () => {
                const started = await phoneStart(step.phone)
                setStep({ ...step, sandboxCode: started.sandbox ? started.sandbox_code : undefined, sentAt: Date.now() })
                setNow(Date.now())
                setSaid(null)
              })
            }
          >
            {DOOR_WORDS.sendAgain}
          </Button>
          <button type="button" className={quietButton} onClick={() => go({ at: 'phone' })}>
            {DOOR_WORDS.otherNumber}
          </button>
        </div>
      </>
    )
  }

  if (step.at === 'passcode' || step.at === 'choose' || step.at === 'again') {
    const words =
      step.at === 'passcode'
        ? { title: DOOR_WORDS.passcodeTitle, lead: null }
        : step.at === 'choose'
          ? { title: DOOR_WORDS.chooseTitle, lead: DOOR_WORDS.chooseLead }
          : { title: DOOR_WORDS.againTitle, lead: DOOR_WORDS.againLead }
    return (
      <>
        {logo}
        <Title>{words.title}</Title>
        {words.lead ? <Lead>{words.lead}</Lead> : null}
        <DigitBoxes
          key={step.at}
          label="Passcode"
          masked
          disabled={busy}
          resetKey={tries}
          onDone={(digits) => {
            if (step.at === 'passcode') void finishWith(step.check, digits, false)
            else if (step.at === 'choose') go({ at: 'again', check: step.check, first: digits })
            else if (digits !== step.first) {
              setStep({ at: 'choose', check: step.check })
              setSaid(DOOR_WORDS.different)
            } else
              void run(async () => {
                try {
                  await signedIn(await phoneJoin(step.check, digits), digits)
                } catch (err) {
                  // A passcode Lens will not take is chosen again; anything else stays on this step.
                  if (err instanceof DoorError && err.reason === 'weak_passcode') setStep({ at: 'choose', check: step.check })
                  throw err
                }
              })
          }}
        />
        {said ? <Said>{said}</Said> : null}
      </>
    )
  }

  if (step.at === 'faster') {
    return (
      <>
        {logo}
        <Title>{DOOR_WORDS.fasterTitle}</Title>
        <Lead>{DOOR_WORDS.fasterLead}</Lead>
        {said ? <Said>{said}</Said> : null}
        <Button
          size="lg"
          className="w-full"
          icon={<Icon name="key" size={18} />}
          disabled={busy}
          onClick={() =>
            run(async () => {
              await makeSignInKey(thisBrowserName(), step.passcode)
              rememberPasskeyHere()
              await land(returnTo ?? '/')
            })
          }
        >
          {busy ? 'Saving…' : DOOR_WORDS.makePasskey}
        </Button>
        <Button variant="outline" size="lg" className="w-full" disabled={busy} onClick={() => void land(returnTo ?? '/')}>
          {DOOR_WORDS.notNow}
        </Button>
      </>
    )
  }

  // The phone number: one field and one button. The passkey is the main action once this browser has signed in.
  const keyFirst = canKey && signedInHere()
  return (
    <>
      {logo}
      {canKey ? (
        <Button
          variant={keyFirst ? 'primary' : 'outline'}
          size="lg"
          className="mt-4 w-full"
          icon={<Icon name="key" size={18} />}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const got = await passkeySignIn()
              rememberPasskeyHere()
              await signedIn(got)
            })
          }
        >
          {DOOR_WORDS.passkey}
        </Button>
      ) : null}
      <form
        noValidate
        className="grid w-full gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (digitsOf(national)) void sendCode()
        }}
      >
        <Title>{DOOR_WORDS.phoneTitle}</Title>
        <Lead>{DOOR_WORDS.phoneLead}</Lead>
        <div className="grid gap-1.5">
          <label htmlFor="door-phone" className="text-body font-semibold text-ink-2">
            {DOOR_WORDS.phoneLabel}
          </label>
          <div className="flex gap-2">
            <Select aria-label={DOOR_WORDS.country} value={dial} onChange={(e) => setDial(e.target.value)} className="w-28 shrink-0">
              {PHONE_COUNTRIES.map(([code, name, calling]) => (
                <option key={code} value={code} aria-label={`${name}, +${calling}`}>
                  {`${code} +${calling}`}
                </option>
              ))}
            </Select>
            <Input
              id="door-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={national}
              maxLength={20}
              onChange={(e) => setNational(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>
        {said ? <Said>{said}</Said> : null}
        <Button
          type="submit"
          variant={keyFirst ? 'outline' : 'primary'}
          size="lg"
          className="w-full"
          disabled={busy}
          disabledReason={digitsOf(national) ? undefined : DOOR_WORDS.phoneNeeded}
        >
          {busy ? 'Sending…' : 'Continue'}
        </Button>
      </form>
      {foot}
    </>
  )
}
