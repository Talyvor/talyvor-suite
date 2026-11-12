import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Logo, ThemeToggle, cn } from '@talyvor/ui'
import { Button, Field, Icon, Input, Select, pocketFocusRing } from '@talyvor/ui/pocket'
import { CompanyLine } from '../../components/CompanyLine'
import { Waitlist } from '../../components/Waitlist'
import { SharedAnswersFact } from '../../components/StoredAnswersFacts'
import { StatusLabel } from '../../labels/StatusLabel'
import { useAuthMeReader } from '../../lib/authMe'
import { useSignupProbe } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { usePricing } from '../marketing/pricingApi'
import { agentBankApi } from '../lens/agentBankApi'
import { DEVICES_KEY, PASSKEYS_KEY, deviceText } from '../lens/AgentBank'
import { passkeysSupported, registerThisDevice } from '../lens/passkeys'
import { CompanyDetailsSection } from '../lens/CompanyDetails'
import { AccessLine, AlreadyIn, EntryFrame, PrivacyTerms, SignInCard } from './Entry'
import {
  ACCOUNT_TYPES,
  COUNTRIES,
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
// Steps 1 and 2 are asked BEFORE the identity provider, because Lens sets the type and the kind only on the call that
// makes the workspace. Step 2's Continue is a link to the BFF's /auth/login with the answers in its query: the BFF holds them with the login in progress and sends them to Lens's POST /v1/provision at the callback, and it
// refuses a sign-up without both. The callback lands on step 3, /signup/key, with a session.
//
// The name is the workspace's name. Country and a business's registration number ride the same query (B59.41), and
// Lens keeps them with the workspace as its sign-up profile (talyvor-lens B59.40).

/** Why Continue waits: nothing is picked yet. */
const PICK_TYPE = 'Pick who this account is for.'
const PICK_KIND = 'Pick the kind of money.'

export const SIGNUP_KEY_PATH = '/signup/key'

/** The BFF's sign-up entry: /auth/login with the answers, landing on step 3. */
function signupLoginHref(type: AccountType, kind: MoneyKind, profile: Profile): string {
  const name = (type === 'personal' ? profile.name : profile.companyName).trim()
  const q = new URLSearchParams({ account_type: type, money_kind: kind, name, country: profile.country })
  if (type === 'business') q.set('registration_number', profile.registrationNumber.trim())
  q.set('return_to', SIGNUP_KEY_PATH)
  return `/auth/login?${q.toString()}`
}

/** pocket.css's Sandbox label, read from Lens's labels for every money capability; nothing until Lens answers. */
function SandboxLabel() {
  const pricing = usePricing()
  const labels = pricing.status === 'ok' ? pricing.pricing.labels : undefined
  const keys = Object.keys(labels ?? {})
  return keys.length > 0 ? <StatusLabel capability={keys} labels={labels} /> : null
}

/** The web sign-up's page (W1): the logo and the Sandbox label across the top, the step under it. */
function SignUpFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-line px-gutter py-4 wide:px-10">
        <a href="/marketing" aria-label="Talyvor website" className={cn('rounded-control', pocketFocusRing)}>
          <Logo width={144} />
        </a>
        <div className="flex items-center gap-3">
          <SandboxLabel />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-5 px-gutter pb-16 pt-6 wide:px-10">
        {children}
        <CompanyLine className="mt-6" />
      </main>
    </div>
  )
}

/** W1's stepper: numbered dots, tangerine when done or current, a tick when done, every step in words. The disc is
 *  tangerine-50 with tangerine ink, as Pocket's Steps draws it: ink on full tangerine is not a scored pair. */
function Stepper({ at }: { at: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Sign-up steps" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {SIGNUP_STEPS.map((title, i) => {
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
            <span className={cn(n === at ? 'font-semibold text-ink' : 'text-ink-2')}>{title}</span>
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

/** The choice card (P1, P2, W1): radio semantics; cloud when off, white with a 2px ink ring when on. */
function Choice({ name, value, picked, onPick, title, line, children }: {
  name: string
  value: string
  picked: boolean
  onPick: () => void
  title: string
  line: string
  children?: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'relative grid cursor-pointer content-start gap-1.5 rounded-card-tight p-5 transition-colors duration-200',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tangerine',
        picked ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud',
      )}
    >
      <input type="radio" name={name} value={value} checked={picked} onChange={onPick} className={cn('sr-only', pocketFocusRing)} />
      <span
        aria-hidden="true"
        className={cn('absolute right-5 top-5 inline-grid h-5 w-5 place-items-center rounded-pill shadow-edge', picked && 'bg-ink')}
      >
        {picked ? <span className="h-2 w-2 rounded-pill bg-page" /> : null}
      </span>
      <span className="pr-8 text-head text-ink">{title}</span>
      <span className="text-body text-ink-2">{line}</span>
      {children}
    </label>
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
function StepWho({ type, setType, profile, setProfile, onContinue }: {
  type: AccountType | null
  setType: (t: AccountType) => void
  profile: Profile
  setProfile: (p: Profile) => void
  onContinue: () => void
}) {
  const { signup } = useSignupProbe()
  const [tried, setTried] = useState(false)
  const errors = type && tried ? missing(type, profile) : {}
  const set = (field: keyof Profile) => (v: string) => setProfile({ ...profile, [field]: v })
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!type) return
        setTried(true)
        if (!Object.keys(missing(type, profile)).length) onContinue()
      }}
    >
      <Stepper at={1} />
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
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </ProfileField>
        </div>
      ) : null}
      <p className="text-body text-ink-3">{TYPE_NOTE}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabledReason={type ? undefined : PICK_TYPE}>
          Continue
        </Button>
        <a href="/signin" className={cn('text-reading font-semibold text-ink', pocketFocusRing)}>
          Sign in instead
        </a>
      </div>
      <AccessLine state={signup} />
      {/* B44.1 — while sign-up is closed, a stranger can still leave an email. */}
      {signup === 'closed' && <Waitlist pocket className="w-full max-w-md" />}
      {/* B27.22 — sharing is on from the first request, so a stranger is told before they continue. */}
      <SharedAnswersFact className="text-body text-ink-3" />
      <PrivacyTerms />
    </form>
  )
}

/** Step 2 (W1's words): the kind of money. Continue goes to the identity provider with every answer. */
function StepKind({ type, profile, kind, setKind, onBack }: {
  type: AccountType
  profile: Profile
  kind: MoneyKind | null
  setKind: (k: MoneyKind) => void
  onBack: () => void
}) {
  const name = (type === 'personal' ? profile.name : profile.companyName).trim()
  return (
    <div className="grid gap-5">
      <Stepper at={2} />
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
        <p className="text-body text-ink-3">{KIND_NOTE}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          {kind ? (
            <Button asChild>
              <a href={signupLoginHref(type, kind, profile)}>Continue</a>
            </Button>
          ) : (
            <Button disabledReason={PICK_KIND}>Continue</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── /signup ────────────────────────────────────────────────────────────────

export function SignUp() {
  const { authenticated } = useSignupProbe()
  const [step, setStep] = useState<1 | 2>(1)
  const [type, setType] = useState<AccountType | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [kind, setKind] = useState<MoneyKind | null>(null)
  useDocumentTitle(authenticated ? 'You’re signed in' : 'Create a workspace')
  if (authenticated) {
    return (
      <EntryFrame>
        <AlreadyIn />
      </EntryFrame>
    )
  }
  return (
    <SignUpFrame>
      {step === 1 || !type ? (
        <StepWho type={type} setType={setType} profile={profile} setProfile={setProfile} onContinue={() => setStep(2)} />
      ) : (
        <StepKind
          type={type}
          profile={profile}
          kind={kind}
          setKind={setKind}
          onBack={() => setStep(1)}
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
  if (me.isLoading) return <SignUpFrame>{null}</SignUpFrame>
  if (me.data?.mode === 'oidc' && !me.data.authenticated) {
    return (
      <EntryFrame>
        <SignInCard returnTo={SIGNUP_KEY_PATH} />
      </EntryFrame>
    )
  }
  return (
    <SignUpFrame>
      <Stepper at={3} />
      <StepTitle id="signup-key">{SIGNUP_STEPS[2]}</StepTitle>
      <KeyChoices>
        {/* B59.31 — a Business adds its company details and the people with control here, or later in Settings. */}
        <CompanyDetailsSection titled />
      </KeyChoices>
    </SignUpFrame>
  )
}

function KeyChoices({ children }: { children?: React.ReactNode }) {
  const qc = useQueryClient()
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  // Asked every 3 seconds until a key is here, so the phone's key shows up the moment the app makes it.
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: agentBankApi.devices, refetchInterval: (q) => ((q.state.data?.devices ?? []).length > 0 ? false : 3000) })
  const [said, setSaid] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: () => registerThisDevice(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device'),
    onSuccess: () => setSaid(null),
    onError: (err) => setSaid(deviceText(err, 'No passkey was made.')),
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
        <section aria-labelledby="key-passkey" className="grid content-start gap-3 rounded-card bg-cloud p-5">
          <h2 id="key-passkey" className="font-display text-bar font-bold text-ink">
            With your passkey
          </h2>
          <p className="text-body text-ink-2">This browser makes a passkey. From then on, Face ID, Touch ID or this device’s PIN asks each time you approve or decline.</p>
          {hasPasskey ? (
            <p className="flex items-center gap-1.5 text-body font-semibold text-success">
              <Icon name="check" size={16} />
              This browser now signs approvals.
            </p>
          ) : supported ? (
            <Button className="justify-self-start" icon={<Icon name="key" size={18} />} disabled={make.isPending || !passkeys.isSuccess} onClick={() => make.mutate()}>
              {make.isPending ? 'Saving…' : 'Make a passkey'}
            </Button>
          ) : null}
          {said ? <FieldError id="key-passkey-error">{said}</FieldError> : null}
        </section>
        <section aria-labelledby="key-phone" className="grid content-start gap-3 rounded-card bg-cloud p-5">
          <h2 id="key-phone" className="font-display text-bar font-bold text-ink">
            On your phone
          </h2>
          <p className="text-body text-ink-2">On your phone, the Talyvor app keeps a key in its secure chip that only Face ID can use, and signs your approvals with it.</p>
          {hasPhone ? (
            <p className="flex items-center gap-1.5 text-body font-semibold text-success">
              <Icon name="check" size={16} />
              Your phone now signs approvals.
            </p>
          ) : (
            <p className="text-body text-ink">Open Talyvor on your phone, sign in with this account and turn on Approve with Face ID.</p>
          )}
        </section>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-4">
        {done ? (
          <Button asChild>
            <a href="/">Open the app</a>
          </Button>
        ) : (
          <a href="/" className={cn('text-reading font-semibold text-ink', pocketFocusRing)}>
            Do this later
          </a>
        )}
      </div>
    </div>
  )
}
