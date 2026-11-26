import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Logo, cn, playSound } from '@talyvor/ui'
import { Button, Field, Icon, Input, KindTile, PageBackground, Select, personalHues, pocketFocusRing, burst } from '@talyvor/ui/pocket'
import { CompanyLine } from '../../components/CompanyLine'
import { Waitlist } from '../../components/Waitlist'
import { SharedAnswersFact } from '../../components/StoredAnswersFacts'
import { StatusLabel } from '../../labels/StatusLabel'
import { WorkspaceStatus } from '../../labels/workspace'
import { useAuthMeReader } from '../../lib/authMe'
import { useSignupProbe } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { usePricing } from '../marketing/pricingApi'
import { AgentBankError, agentBankApi, type EnrolmentWaiting } from '../lens/agentBankApi'
import { openAccount } from '../lens/accountsApi'
import { DEVICES_KEY, PASSKEYS_KEY, deviceText } from '../lens/AgentBank'
import { passkeysSupported, registerThisDevice } from '../lens/passkeys'
import { showRecoveryCode } from '../lens/recoveryCodeStore'
import { IdentityChecks, OpenTheApp } from '../lens/IdentityChecks'
import { FindMeQuestion } from '../lens/FindMe'
import { Choice } from './Choice'
import { AccessLine, EntryFrame, PrivacyTerms, SignInCard, useReturnTo } from './Entry'
import { DoorError, makeSignInKey, rememberPasskeyHere, signupAccount, takePasscode, thisBrowserName } from './doorApi'
import { countryRefusal, useServedCountries } from './servedCountries'
import {
  ACCOUNT_TYPES,
  KIND_NOTE,
  MONEY_KINDS,
  PROFILE_ERRORS,
  PROFILE_LABELS,
  SIGNUP_STEPS,
  TYPE_NOTE,
  kindFor,
  type AccountType,
  type MoneyKind,
} from './signupWords'

// SignUp.tsx — B59.8: /signup asks who the account is for and the kind of money, then the identity provider, then a
// key (SPEC 3.2; the design's P1, P2 and W1, the web drawing step 2).
//
// B61.26 — a stranger meets the door first (Door.tsx): the phone number, the code and a passcode chosen twice. That
// opens a sign-up session (B61.25), which may only finish sign-up: steps 1 and 2 here, then Continue is the BFF's
// POST /auth/signup/account with the answers, which makes the account and lands on step 3, /signup/key.
//
// B61.20 — step 4, /signup/confirm, is the identity check (IdentityChecks): the account opens on Home once it passes.
//
// The name is the workspace's name. Country and a business's registration number ride the same query (B59.41), and
// Lens keeps them with the workspace as its sign-up profile (talyvor-lens B59.40).

/** Why Continue waits: nothing is picked yet. */
const PICK_TYPE = 'Pick who this account is for.'
const PICK_KIND = 'Pick the kind of money.'

export const SIGNUP_KEY_PATH = '/signup/key'
export const SIGNUP_CONFIRM_PATH = '/signup/confirm'

/** B61.9 — "Open another account": sign-up's steps for a person already signed in. The key step is left out: the
 *  person's passkey or phone is theirs already. */
export const ANOTHER_PATH = '/accounts/new'
export const ANOTHER_CONFIRM_PATH = '/accounts/new/confirm'
const ANOTHER_STEPS = [SIGNUP_STEPS[0], SIGNUP_STEPS[1], SIGNUP_STEPS[3]] as const

/** pocket.css's Sandbox label, read from Lens's labels for every money capability; nothing until Lens answers. */
function SandboxLabel() {
  const pricing = usePricing()
  const labels = pricing.status === 'ok' ? pricing.pricing.labels : undefined
  const keys = Object.keys(labels ?? {})
  return keys.length > 0 ? <StatusLabel capability={keys} labels={labels} /> : null
}

/** The web sign-up's page (W1): the logo and the Sandbox label across the top, the step under it. Step 3 has a
 *  workspace, so it passes that workspace's own label (B57.133), which says Status unknown when its read fails (S-06). */
function SignUpFrame({ children, label = <SandboxLabel /> }: { children: React.ReactNode; label?: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-page text-ink">
      {/* B61.70 — the moving background, as behind every page, in a Personal account's colours. */}
      <PageBackground hues={personalHues} />
      <header className="relative flex items-center justify-between gap-4 border-b border-line px-gutter py-4 wide:px-10">
        <a href="/marketing" aria-label="Talyvor website" className={cn('rounded-control', pocketFocusRing)}>
          <Logo width={144} />
        </a>
        {/* B57.58 — no theme control: Settings' Appearance is the one, and before you sign in the page follows the device. */}
        <div className="flex items-center gap-3">{label}</div>
      </header>
      <main className="relative mx-auto grid w-full max-w-5xl flex-1 content-start gap-5 px-gutter pb-16 pt-6 wide:px-10">
        {children}
        <CompanyLine onBackground className="mt-6" />
      </main>
    </div>
  )
}

/** W1's stepper: numbered dots, tangerine when done or current, a tick when done, every step in words. The disc is
 *  tangerine-50 with tangerine ink, as Pocket's Steps draws it: ink on full tangerine is not a scored pair.
 *  B57.133 — a narrow screen gets P1's step bars instead: a bar a step, tangerine once reached, then "Step n of 4". */
type StepAt = 1 | 2 | 3 | 4

/** B61.9 — the steps a page walks: sign-up's four, or another account's three (no key: the person has theirs). */
type Steps = readonly string[]

function Stepper({ at, steps = SIGNUP_STEPS }: { at: StepAt; steps?: Steps }) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-body font-semibold pk-on-bg wide:hidden">
        {steps.map((title, i) => (
          <span key={title} aria-hidden="true" data-step-bar={i < at ? 'reached' : 'ahead'} className={cn('h-1.5 w-7 rounded-pill', i < at ? 'bg-tangerine' : 'bg-cloud-2')} />
        ))}
        <span className="ml-2.5">{`Step ${at} of ${steps.length}`}</span>
      </p>
      <StepDots at={at} steps={steps} />
    </>
  )
}

function StepDots({ at, steps }: { at: StepAt; steps: Steps }) {
  return (
    <ol aria-label="Sign-up steps" className="hidden flex-wrap items-center gap-x-6 gap-y-2 wide:flex">
      {steps.map((title, i) => {
        const n = i + 1
        const reached = n <= at
        return (
          <li key={title} aria-current={n === at ? 'step' : undefined} className="flex items-center gap-2.5 text-body">
            <span
              aria-hidden="true"
              className={cn('inline-grid h-6 w-6 place-items-center rounded-pill font-figure text-caption font-bold', reached ? 'bg-tangerine-50 text-tangerine-ink' : 'bg-cloud-2 text-ink-2')}
            >
              {n < at ? <Icon name="check" size={14} /> : n}
            </span>
            <span className={cn(n === at ? 'font-semibold text-ink' : 'pk-on-bg')}>{title}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** W1's title: the display face at 40. */
function StepTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h1 id={id} className="font-display text-pocket-balance-sm font-extrabold text-ink">
      {children}
    </h1>
  )
}

/** Red text always has an icon beside it. */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-body text-danger">
      <Icon name="x" size={16} />
      {children}
    </p>
  )
}

interface Profile {
  name: string
  companyName: string
  registrationNumber: string
  country: string
}

const EMPTY: Profile = { name: '', companyName: '', registrationNumber: '', country: '' }

/** What step 1 still lacks, as P1's error lines, keyed by field. */
function missing(type: AccountType, p: Profile): Partial<Record<keyof Profile, string>> {
  const out: Partial<Record<keyof Profile, string>> = {}
  if (type === 'personal' && !p.name.trim()) out.name = PROFILE_ERRORS.name
  if (type === 'business' && !p.companyName.trim()) out.companyName = PROFILE_ERRORS.companyName
  if (type === 'business' && !p.registrationNumber.trim()) out.registrationNumber = PROFILE_ERRORS.registrationNumber
  if (!p.country) out.country = PROFILE_ERRORS.country
  return out
}

/** One profile field with its error under it. */
function ProfileField({ field, value, error, onChange, children }: {
  field: keyof Profile
  value: string
  error?: string
  onChange: (v: string) => void
  children?: React.ReactNode
}) {
  const errorId = `signup-${field}-error`
  const shared = { value, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }
  return (
    <div className="grid gap-1.5">
      <Field label={PROFILE_LABELS[field]}>
        {children ? (
          <Select {...shared} onChange={(e) => onChange(e.target.value)}>
            {children}
          </Select>
        ) : (
          <Input {...shared} autoComplete={field === 'name' ? 'name' : field === 'companyName' ? 'organization' : 'off'} maxLength={80} onChange={(e) => onChange(e.target.value)} />
        )}
      </Field>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
}

/** Step 1 (P1's words): who the account is for, and the profile for that type. */
function StepWho({ type, setType, profile, setProfile, onContinue, refused, setRefused, another = false }: {
  type: AccountType | null
  setType: (t: AccountType) => void
  profile: Profile
  setProfile: (p: Profile) => void
  onContinue: () => void
  /** B61.110 — Lens's sentence for the country it refused at Continue on step 2, until another is picked. */
  refused: string | null
  setRefused: (said: string | null) => void
  /** B61.9 — a signed-in person opening another account: no sign-in, waitlist or stranger's notes. */
  another?: boolean
}) {
  const { signup } = useSignupProbe()
  const countries = useServedCountries()
  const [tried, setTried] = useState(false)
  const errors = { ...(type && tried ? missing(type, profile) : {}), ...(refused ? { country: refused } : {}) }
  const set = (field: keyof Profile) => (v: string) => {
    if (field === 'country') setRefused(null)
    setProfile({ ...profile, [field]: v })
  }
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!type) return
        setTried(true)
        if (!Object.keys(missing(type, profile)).length && !refused) onContinue()
      }}
    >
      <Stepper at={1} steps={another ? ANOTHER_STEPS : SIGNUP_STEPS} />
      <StepTitle id="signup-who">{SIGNUP_STEPS[0]}</StepTitle>
      <div role="radiogroup" aria-labelledby="signup-who" className="grid gap-3 wide:grid-cols-2">
        {ACCOUNT_TYPES.map((t) => (
          <Choice key={t.value} name="account_type" value={t.value} picked={type === t.value} onPick={() => setType(t.value)} title={t.title} line={t.line} />
        ))}
      </div>
      {type ? (
        <div className="grid max-w-xl gap-4">
          {type === 'personal' ? (
            <ProfileField field="name" value={profile.name} error={errors.name} onChange={set('name')} />
          ) : (
            <>
              <ProfileField field="companyName" value={profile.companyName} error={errors.companyName} onChange={set('companyName')} />
              <ProfileField field="registrationNumber" value={profile.registrationNumber} error={errors.registrationNumber} onChange={set('registrationNumber')} />
            </>
          )}
          <ProfileField field="country" value={profile.country} error={errors.country} onChange={set('country')}>
            <option value="" hidden>
              {PROFILE_LABELS.country}
            </option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </ProfileField>
        </div>
      ) : null}
      <p className="text-body pk-on-bg">{TYPE_NOTE}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabledReason={type ? undefined : PICK_TYPE} reasonClassName="pk-on-bg">
          Continue
        </Button>
      </div>
      {another ? null : (
        <>
          <AccessLine state={signup} onBackground />
          {/* B44.1 — while sign-up is closed, a stranger can still leave an email. */}
          {/* B27.22 — sharing is on from the first request, so a stranger is told before they continue. */}
          <SharedAnswersFact className="text-body pk-on-bg" />
        </>
      )}
      <PrivacyTerms onBackground />
    </form>
  )
}

/** Step 2 (W1's words): the kind of money. Continue goes to the identity provider with every answer. */
function StepKind({ type, profile, kind, setKind, onBack, onCountryRefused, another = false }: {
  type: AccountType
  profile: Profile
  kind: MoneyKind | null
  setKind: (k: MoneyKind) => void
  onBack: () => void
  /** B61.110 — Lens does not serve the country: back to step 1, with Lens's sentence on the country field. */
  onCountryRefused: (said: string) => void
  /** B61.9 — Continue opens another account for the person signed in, rather than going to the identity provider. */
  another?: boolean
}) {
  const name = (type === 'personal' ? profile.name : profile.companyName).trim()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const registration = type === 'business' ? { registration_number: profile.registrationNumber.trim() } : {}
  const open = useMutation({
    // B61.26 — sign-up's session makes its account at the BFF's /auth/signup/account; another account at /api/accounts.
    mutationFn: (k: MoneyKind) =>
      another
        ? openAccount({ type, kind: k, name, country: profile.country, ...registration })
        : signupAccount({ account_type: type, money_kind: k, name, country: profile.country, ...registration }),
    onSuccess: async () => {
      playSound('celebrate')
      burst()
      navigate(another ? ANOTHER_CONFIRM_PATH : SIGNUP_KEY_PATH)
      // The session is on the new account: nothing read for the one it left is kept.
      await qc.resetQueries()
    },
    onError: (err) => {
      const said = countryRefusal(err)
      if (said) onCountryRefused(said)
    },
  })
  return (
    <div className="grid gap-5">
      <Stepper at={2} steps={another ? ANOTHER_STEPS : SIGNUP_STEPS} />
      <StepTitle id="signup-kind">{SIGNUP_STEPS[1]}</StepTitle>
      <p className="text-reading text-ink-2">{kindFor(name, type)}</p>
      <div role="radiogroup" aria-labelledby="signup-kind" className="grid gap-4 wide:grid-cols-3">
        {MONEY_KINDS.map((k) => (
          <Choice key={k.value} name="money_kind" value={k.value} picked={kind === k.value} onPick={() => setKind(k.value)} title={k.title} line={k.line}>
            <ul className="mt-3 grid gap-2 border-t border-line pt-3 text-body text-ink">
              {k.list(type).map((item) => (
                <li key={item} className="flex gap-2">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </Choice>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-body pk-on-bg">{KIND_NOTE}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          {kind ? (
            <Button disabled={open.isPending} onClick={() => open.mutate(kind)}>
              {open.isPending ? 'Opening…' : 'Continue'}
            </Button>
          ) : (
            <Button disabledReason={PICK_KIND}>Continue</Button>
          )}
        </div>
      </div>
      {open.isError ? <FieldError id="signup-open-error">{openFailure(open.error)}</FieldError> : null}
    </div>
  )
}

/** Lens's own sentence for a refusal it worded (the eleventh account), and otherwise one of ours. */
function openFailure(err: unknown): string {
  if (err instanceof DoorError && err.status > 0 && err.status < 500) return err.message
  return err instanceof AgentBankError && err.sentence && err.status < 500 ? err.sentence : 'The account didn’t open. Try again.'
}

// ─── /signup ────────────────────────────────────────────────────────────────

export function SignUp() {
  const me = useAuthMeReader()
  const { signup } = useSignupProbe()
  const [step, setStep] = useState<1 | 2>(1)
  const [type, setType] = useState<AccountType | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [kind, setKind] = useState<MoneyKind | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const authenticated = me.data?.authenticated === true
  const joining = authenticated && me.data?.signup_unfinished === true
  const returnTo = useReturnTo()
  // B64.12 — someone who ARRIVES with a session goes straight in (to a same-site returnTo or Home), as on /signin. Decided
  // on the first answer this page sees: a person whose account opens here (step 2) becomes signed in on this page, and
  // their step is already moving them on to the key; sending them Home would race it and skip the key.
  const arrivedSignedIn = useRef<boolean | null>(null)
  if (me.data && arrivedSignedIn.current === null) arrivedSignedIn.current = authenticated && !joining
  useDocumentTitle('Create a workspace')
  if (arrivedSignedIn.current && authenticated && !joining) return <Navigate to={returnTo ?? '/'} replace />
  // B61.26 — a stranger: the door, drawn while /auth/me is still answering too, as most who open /signup are strangers.
  // A new number's session comes back here for steps 1 and 2, and stays on them while its account opens.
  if (!authenticated && me.data?.mode !== 'disabled') {
    return (
      <EntryFrame>
        <SignInCard
          foot={
            <>
              <AccessLine state={signup} />
              {/* B44.1 — while sign-up is closed, a stranger can still leave an email. */}
              {signup === 'closed' && <Waitlist pocket className="w-full" />}
            </>
          }
        />
      </EntryFrame>
    )
  }
  return (
    <SignUpFrame>
      {step === 1 || !type ? (
        <StepWho type={type} setType={setType} profile={profile} setProfile={setProfile} onContinue={() => setStep(2)} refused={refused} setRefused={setRefused} />
      ) : (
        <StepKind
          type={type}
          profile={profile}
          kind={kind}
          setKind={setKind}
          onBack={() => setStep(1)}
          onCountryRefused={(said) => {
            setRefused(said)
            setStep(1)
          }}
        />
      )}
    </SignUpFrame>
  )
}

// ─── /signup/key ────────────────────────────────────────────────────────────

/**
 * Step 3, after the identity provider: a passkey made in this browser, or the phone's key. Either one signs this
 * workspace's approvals and payments (B58.7 asks for one before a person's first live payment). Not behind AuthGate:
 * the gate sends a brand-new workspace to Home for its sharing choice, and this step comes first.
 */
export function SignUpKey() {
  const me = useAuthMeReader()
  useDocumentTitle(SIGNUP_STEPS[2])
  if (me.isLoading) return <SignUpFrame label={null}>{null}</SignUpFrame>
  if (me.data?.mode === 'oidc' && !me.data.authenticated) {
    return (
      <EntryFrame>
        <SignInCard returnTo={SIGNUP_KEY_PATH} />
      </EntryFrame>
    )
  }
  return (
    <SignUpFrame label={<WorkspaceStatus />}>
      <Stepper at={3} />
      <StepTitle id="signup-key">{SIGNUP_STEPS[2]}</StepTitle>
      <KeyChoices />
    </SignUpFrame>
  )
}

/** One way to sign, drawn as W1's kind option: a tile where W1 has card art, the title and its line, then under a
 *  hairline what to do or that it is done. A key that is here turns its card on: white with the ink ring. */
function KeyOption({ id, icon, title, line, done, children }: {
  id: string
  icon: 'key' | 'phone'
  title: string
  line: string
  done: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('grid content-start gap-1.5 rounded-card p-5', done ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud')}
    >
      <KindTile icon={<Icon name={icon} size={20} />} on={done ? 'white' : 'cloud'} className="mb-3" />
      <h2 id={id} className="font-display text-bar font-bold text-ink">
        {title}
      </h2>
      <p className="text-body text-ink-2">{line}</p>
      <div className="mt-3 grid gap-3 border-t border-line pt-4">{children}</div>
    </section>
  )
}

/** A key that is here: the word and a tick, never the colour alone. */
function KeyDone({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-body font-semibold text-success">
      <Icon name="check" size={16} />
      {children}
    </p>
  )
}

/**
 * B61.26 — a person who joined by phone makes one passkey for both: the BFF's key challenge is the account's approval
 * challenge too (B61.25), so the same key is kept as their sign-in key (proved by the passcode they just chose, held in
 * memory from the door) and given to the account's approvals. Without that passcode it is the approval key alone, and
 * "Sign in faster next time" offers the sign-in key at the next sign-in.
 */
async function makeKeyHere(person: boolean): Promise<EnrolmentWaiting | null> {
  const passcode = person ? takePasscode() : undefined
  if (!passcode) return registerThisDevice(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device')
  const key = await makeSignInKey(thisBrowserName(), passcode)
  rememberPasskeyHere()
  const registered = await agentBankApi.registerPasskey(key)
  if ('enrolment' in registered) return registered.enrolment
  if (registered.recovery_code) showRecoveryCode(registered.recovery_code)
  return null
}

function KeyChoices() {
  const qc = useQueryClient()
  const me = useAuthMeReader()
  const person = me.data?.user?.sub.startsWith('person:') === true
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  // Asked every 3 seconds until a key is here, so the phone's key shows up the moment the app makes it.
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: agentBankApi.devices, refetchInterval: (q) => ((q.state.data?.devices ?? []).length > 0 ? false : 3000) })
  const [said, setSaid] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: () => makeKeyHere(person),
    onSuccess: () => setSaid(null),
    onError: (err) => setSaid(err instanceof DoorError ? err.message : deviceText(err, 'No passkey was made.')),
    onSettled: () => qc.invalidateQueries({ queryKey: PASSKEYS_KEY }),
  })
  const hasPasskey = (passkeys.data?.passkeys ?? []).length > 0
  const hasPhone = (devices.data?.devices ?? []).length > 0
  const done = hasPasskey || hasPhone
  const [supported, setSupported] = useState(true)
  useEffect(() => setSupported(passkeysSupported()), [])
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 wide:grid-cols-2">
        <KeyOption
          id="key-passkey"
          icon="key"
          title="With your passkey"
          line="This browser makes a passkey. From then on, Face ID, Touch ID or this device’s PIN asks each time you approve or decline."
          done={hasPasskey}
        >
          {hasPasskey ? (
            <KeyDone>This browser now signs approvals.</KeyDone>
          ) : supported ? (
            <Button className="justify-self-start" icon={<Icon name="key" size={18} />} disabled={make.isPending || !passkeys.isSuccess} onClick={() => make.mutate()}>
              {make.isPending ? 'Saving…' : 'Make a passkey'}
            </Button>
          ) : null}
          {said ? <FieldError id="key-passkey-error">{said}</FieldError> : null}
        </KeyOption>
        <KeyOption
          id="key-phone"
          icon="phone"
          title="On your phone"
          line="On your phone, the Talyvor app keeps a key in its secure chip that only Face ID can use, and signs your approvals with it."
          done={hasPhone}
        >
          {hasPhone ? (
            <KeyDone>Your phone now signs approvals.</KeyDone>
          ) : (
            <p className="text-body text-ink">Open Talyvor on your phone, sign in with this account and turn on Approve with Face ID.</p>
          )}
        </KeyOption>
      </div>
      {/* W1's foot: the step's buttons at the right; on a narrow screen one full-width button, as P1 and P2 draw it. */}
      <div className="grid wide:flex wide:justify-end">
        {/* B61.20 — then the identity check, step 4, with a key or without one */}
        {done ? (
          <Button asChild>
            <a href={SIGNUP_CONFIRM_PATH}>Continue</a>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <a href={SIGNUP_CONFIRM_PATH}>Do this later</a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── /signup/confirm ────────────────────────────────────────────────────────

/**
 * B61.20 — step 4, "Confirm who you are": Lens's checks for the account's level, shown as each passes, then Home. A
 * Business gives its company details and the people with control here (B59.31's form). Not behind AuthGate, as step 3.
 */
export function SignUpConfirm() {
  const me = useAuthMeReader()
  useDocumentTitle(SIGNUP_STEPS[3])
  const navigate = useNavigate()
  const openHome = useCallback(() => navigate('/', { replace: true }), [navigate])
  if (me.isLoading) return <SignUpFrame label={null}>{null}</SignUpFrame>
  if (me.data?.mode === 'oidc' && !me.data.authenticated) {
    return (
      <EntryFrame>
        <SignInCard returnTo={SIGNUP_CONFIRM_PATH} />
      </EntryFrame>
    )
  }
  return (
    <SignUpFrame label={<WorkspaceStatus />}>
      <Stepper at={4} />
      <StepTitle id="signup-confirm">{SIGNUP_STEPS[3]}</StepTitle>
      {/* B65.2 — the identity partner sends the person back here, and a pass after it opens Home */}
      <IdentityChecks
        returnTo="signup"
        onPassed={openHome}
        done={
          // B61.93 — the end of sign-up asks once whether people may pay you by your name or phone number.
          <FindMeQuestion
            then={<OpenTheApp />}
          />
        }
      />
    </SignUpFrame>
  )
}

// ─── /accounts/new and /accounts/new/confirm ───────────────────────────────

/** Someone not signed in has no account to open another beside: they sign in, and come back here. */
function useSignedIn(returnTo: string): React.ReactNode | null {
  const me = useAuthMeReader()
  if (me.isLoading) return <SignUpFrame label={null}>{null}</SignUpFrame>
  if (me.data?.mode === 'oidc' && !me.data.authenticated) {
    return (
      <EntryFrame>
        <SignInCard returnTo={returnTo} />
      </EntryFrame>
    )
  }
  return null
}

/**
 * B61.9 — "Open another account", from Your accounts: who it is for and the kind of money, as sign-up asks them, then
 * the BFF's POST /api/accounts (B61.8) opens it and moves the session there, and the identity check runs for it.
 */
export function OpenAnotherAccount() {
  const [step, setStep] = useState<1 | 2>(1)
  const [type, setType] = useState<AccountType | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [kind, setKind] = useState<MoneyKind | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  useDocumentTitle('Open another account')
  const gate = useSignedIn(ANOTHER_PATH)
  if (gate) return gate
  return (
    <SignUpFrame label={<WorkspaceStatus />}>
      {step === 1 || !type ? (
        <StepWho another type={type} setType={setType} profile={profile} setProfile={setProfile} onContinue={() => setStep(2)} refused={refused} setRefused={setRefused} />
      ) : (
        <StepKind
          another
          type={type}
          profile={profile}
          kind={kind}
          setKind={setKind}
          onBack={() => setStep(1)}
          onCountryRefused={(said) => {
            setRefused(said)
            setStep(1)
          }}
        />
      )}
    </SignUpFrame>
  )
}

/** B61.9 — the new account's identity check, its last step; then its Home. */
export function OpenAnotherConfirm() {
  useDocumentTitle(SIGNUP_STEPS[3])
  const gate = useSignedIn(ANOTHER_CONFIRM_PATH)
  if (gate) return gate
  return (
    <SignUpFrame label={<WorkspaceStatus />}>
      <Stepper at={3} steps={ANOTHER_STEPS} />
      <StepTitle id="signup-confirm">{SIGNUP_STEPS[3]}</StepTitle>
      <IdentityChecks
        done={<OpenTheApp />}
      />
    </SignUpFrame>
  )
}
