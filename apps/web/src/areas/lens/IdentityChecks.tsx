import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@talyvor/ui'
import { Button, Card, Chip, Field, Icon, Input, Select, type ChipTone } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { useAuthMeReader } from '../../lib/authMe'
import { WorkspaceStatus } from '../../labels/workspace'
import { IDENTITY_ERRORS, IDENTITY_WORDS } from '../auth/signupWords'
import { countryRefusal, useServedCountries } from '../auth/servedCountries'
import { CompanyDetailsSection } from './CompanyDetails'
import { type CompanyDetails, useCompanyDetails } from './companyDetailsApi'
import {
  type VerificationBody,
  type VerificationCheck,
  type WorkspaceVerification,
  AgentBankError,
  agentBankApi,
  useAccount,
} from './agentBankApi'

// IdentityChecks.tsx — B61.20: "Confirm who you are", the last step of sign-up (/signup/confirm) and the top of
// Settings, Verification. It runs Lens's checks in order (B30.4: email and phone, then the person, then for a Business
// its company, from the company details B59.31 saved) and shows each as it passes. No document is asked for: the
// document step is the place the identity partner's own screen will open, and in Sandbox it collects nothing.
//
// B61.46: the person gives their home address with the identity check (Lens B61.45 passes it to the provider and keeps
// none of it); its country is the one they live in.
//
// A Personal account is confirmed at L2, a Business at L3. Until then Home says so in one sentence (IdentityGate).

export const VERIFICATION_KEY = ['verification']

export const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const

/** 0 to 3 for "L0" to "L3"; -1 for anything else. */
export function rank(level: string | undefined): number {
  return LEVELS.indexOf(level as (typeof LEVELS)[number])
}

type Subject = 'contact' | 'person' | 'company'

const STEPS: readonly { subject: Subject; level: number; kind: VerificationBody['kind'] }[] = [
  { subject: 'contact', level: 1, kind: 'contact' },
  { subject: 'person', level: 2, kind: 'identity' },
  { subject: 'company', level: 3, kind: 'company' },
]

/** The level that confirms an account: a person's identity, and for a Business its company too. */
export const neededLevel = (type: 'personal' | 'business') => (type === 'business' ? 3 : 2)

/** Lens's own check of a phone number (economy.e164). */
const E164 = /^\+[1-9][0-9]{7,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A check the provider has not decided yet, for the level after the one reached. */
const waitingOnNext = (v: WorkspaceVerification | undefined) =>
  (v?.checks ?? []).some((c) => c.status === 'pending' && rank(c.level) === rank(v?.level) + 1)

/** Lens's record, asked again every 5 seconds while the next check waits on the provider. */
export const useVerification = () =>
  useQuery({ queryKey: VERIFICATION_KEY, queryFn: agentBankApi.verification, refetchInterval: (q) => (waitingOnNext(q.state.data) ? 5000 : false) })

/** The newest check Lens has for a level. */
function latest(v: WorkspaceVerification | undefined, level: number): VerificationCheck | undefined {
  return (v?.checks ?? []).find((c) => rank(c.level) === level)
}

/** What a step's row says, in words, and its chip's tone. */
function stateOf(v: WorkspaceVerification | undefined, level: number, running: boolean): { text: string; tone: ChipTone } {
  const c = latest(v, level)
  if (rank(v?.level) >= level) return c?.test === false ? { text: IDENTITY_WORDS.passed, tone: 'good' } : { text: IDENTITY_WORDS.passedSandbox, tone: 'good' }
  if (running) return { text: IDENTITY_WORDS.checking, tone: 'wait' }
  if (c?.status === 'pending') return { text: IDENTITY_WORDS.waiting, tone: 'wait' }
  if (c?.status === 'failed' || c?.status === 'returned') return { text: IDENTITY_WORDS.notPassed, tone: 'bad' }
  return { text: IDENTITY_WORDS.notYet, tone: 'plain' }
}

/** A check that did not pass, in words: what to fix. */
export function failedText(c: VerificationCheck): string {
  if (/expired/i.test(c.detail ?? '')) return IDENTITY_ERRORS.expired
  const subject = c.subject as Subject
  return IDENTITY_ERRORS.failed[subject] ?? IDENTITY_ERRORS.unknown
}

/** Lens's refusal of a check, in words. */
function refusedText(err: unknown, subject: Subject): string {
  if (isSessionExpired(err)) return 'Nothing changed. Sign in again.'
  const country = countryRefusal(err)
  if (country) return country
  if (err instanceof AgentBankError && err.status < 500) return IDENTITY_ERRORS.failed[subject]
  return IDENTITY_ERRORS.unknown
}

const tidy = (s: string) => s.trim().split(/\s+/).join(' ').toLowerCase()

/** Whether the saved company details can go to the company check: a director, and the person checked among them. */
function companyProblem(saved: CompanyDetails | null | undefined, person: string): string | null {
  if (!saved || !saved.company_name.trim() || !saved.people.some((p) => p.role === 'director' && p.name.trim())) return IDENTITY_ERRORS.companyFirst
  if (person && !saved.people.some((p) => tidy(p.name) === tidy(person))) return IDENTITY_ERRORS.named(person.trim())
  return null
}

interface Draft {
  email: string
  phone: string
  name: string
  dob: string
  line1: string
  line2: string
  town: string
  postcode: string
  country: string
}

type Errors = Partial<Record<keyof Draft, string>>

function missing(d: Draft, level: number): Errors {
  const out: Errors = {}
  if (level < 1 && !EMAIL.test(d.email.trim())) out.email = IDENTITY_ERRORS.email
  if (level < 1 && !E164.test(d.phone.replace(/\s/g, ''))) out.phone = IDENTITY_ERRORS.phone
  if (level < 2 && !d.name.trim()) out.name = IDENTITY_ERRORS.legalName
  if (level < 2 && !/^\d{4}-\d{2}-\d{2}$/.test(d.dob)) out.dob = IDENTITY_ERRORS.dateOfBirth
  if (level < 2 && !d.line1.trim()) out.line1 = IDENTITY_ERRORS.addressLine1
  if (level < 2 && !d.town.trim()) out.town = IDENTITY_ERRORS.town
  if (level < 2 && !d.postcode.trim()) out.postcode = IDENTITY_ERRORS.postcode
  if (level < 2 && !d.country) out.country = IDENTITY_ERRORS.country
  return out
}

function bodyFor(kind: VerificationBody['kind'], d: Draft): VerificationBody {
  if (kind === 'contact') return { kind, email: d.email.trim(), phone: d.phone.replace(/\s/g, '') }
  if (kind === 'identity') {
    const lines = [d.line1, d.line2].map((l) => l.trim()).filter(Boolean)
    const address = { lines, town: d.town.trim(), postcode: d.postcode.trim(), country: d.country }
    return { kind, name: d.name.trim(), country: d.country, date_of_birth: d.dob, address }
  }
  // Lens fills an empty company check from the saved company details (talyvor-lens B59.30).
  return { kind, name: '', country: '', company_number: '', directors: [], people_with_significant_control: [] }
}

/** Red text always has an icon beside it; a field's error is said as it appears. */
function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role={id ? 'alert' : undefined} className="flex items-center gap-1.5 text-body text-danger">
      <Icon name="x" size={16} />
      {children}
    </p>
  )
}

/** B61.118 — the line under the way into the app while the next check waits on the provider or did not pass; null
 *  while nothing has been asked of the provider yet. */
function wayInLine(v: WorkspaceVerification): string | null {
  const c = latest(v, rank(v.level) + 1)
  if (c?.status === 'pending') return IDENTITY_WORDS.openWaiting
  if (c?.status === 'failed' || c?.status === 'returned') return IDENTITY_WORDS.openNotPassed
  return null
}

/** The checks for this account, the fields the next ones need, and the document step. `done` is drawn once they pass,
 *  and (B61.118) also while a check waits or after one did not pass, with a line that says so, so sign-up's last step
 *  always has a way into the app; `note` goes on the end of the line under the title, and `aside` under the checks,
 *  beside the form (B57.173). */
export function IdentityChecks({ done, note, aside }: { done?: React.ReactNode; note?: string; aside?: React.ReactNode }) {
  const qc = useQueryClient()
  const { account, shows } = useAccount()
  const type = account?.account_type ?? (shows ? 'business' : null)
  const me = useAuthMeReader()
  const [running, setRunning] = useState<Subject | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  // B61.110 — Lens's sentence for the country it refused, on the country field until another is picked.
  const [countrySaid, setCountrySaid] = useState<string | null>(null)
  const countries = useServedCountries()
  const [tried, setTried] = useState(false)
  // The email starts as the one signed in with, until the person types their own (null: not typed yet).
  const [typedEmail, setTypedEmail] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<Draft, 'email'>>({ phone: '', name: '', dob: '', line1: '', line2: '', town: '', postcode: '', country: '' })
  const v = useVerification()
  const company = useCompanyDetails(type === 'business')
  if (v.isError) return <p className="text-body text-ink-2">Your checks could not be read just now.</p>
  if (v.isPending || type === null) return <p className="text-body text-ink-2">Reading…</p>

  const level = rank(v.data.level)
  const need = neededLevel(type)
  const steps = STEPS.filter((s) => s.level <= need)
  const d: Draft = { ...draft, email: typedEmail ?? me.data?.user?.email ?? '' }
  const errors: Errors = { ...(tried ? missing(d, level) : {}), ...(countrySaid ? { country: countrySaid } : {}) }
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (k === 'country') setCountrySaid(null)
    if (k === 'email') setTypedEmail(e.target.value)
    else setDraft({ ...draft, [k]: e.target.value })
  }
  const wayIn = done && level < need && running === null ? wayInLine(v.data) : null
  const personName = level >= 2 ? latest(v.data, 2)?.verified_name ?? '' : d.name

  async function run() {
    setTried(true)
    setSaid(null)
    if (Object.keys(missing(d, level)).length > 0) return
    if (type === 'business') {
      const problem = companyProblem(company.data, personName)
      if (problem) return setSaid(problem)
    }
    for (const s of steps) {
      if (s.level <= level) continue
      setRunning(s.subject)
      try {
        const ans = await agentBankApi.verify(bodyFor(s.kind, d))
        qc.setQueryData(VERIFICATION_KEY, ans.verification)
        if (ans.check.status !== 'completed') {
          if (ans.check.status !== 'pending') setSaid(failedText(ans.check))
          break
        }
      } catch (err) {
        const country = s.subject === 'person' ? countryRefusal(err) : null
        if (country) setCountrySaid(country)
        else setSaid(refusedText(err, s.subject))
        break
      }
    }
    setRunning(null)
  }

  const field = (k: keyof Draft, label: string, input: React.ReactNode, hint?: string) => (
    <div className="grid content-start gap-1.5">
      <Field label={label}>{input}</Field>
      {hint && !errors[k] ? <p className="text-caption text-ink-3">{hint}</p> : null}
      {errors[k] ? <FieldError id={`identity-${k}-error`}>{errors[k]}</FieldError> : null}
    </div>
  )
  const invalid = (k: keyof Draft) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `identity-${k}-error` : undefined })

  return (
    <div className="grid gap-5">
      <p className="max-w-2xl text-reading text-ink-2">{note ? `${IDENTITY_WORDS.intro[type]} ${note}` : IDENTITY_WORDS.intro[type]}</p>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div data-testid="identity-aside" className="grid gap-4 wide:col-span-5 wide:col-start-8 wide:row-start-1">
        <section aria-labelledby="identity-checks">
          <Card tone="white">
            <h2 id="identity-checks" className="font-display text-reading font-bold text-ink">
              {IDENTITY_WORDS.checks}
            </h2>
            <ul className="mt-2">
              {steps.map((s) => {
                const st = stateOf(v.data, s.level, running === s.subject)
                return (
                  <li key={s.subject} data-testid={`identity-${s.subject}`} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      {rank(v.data.level) >= s.level ? <Icon name="check" size={16} className="text-success" /> : null}
                      {IDENTITY_WORDS[s.subject]}
                    </span>
                    <Chip tone={st.tone}>{st.text}</Chip>
                  </li>
                )
              })}
            </ul>
          </Card>
        </section>
        {aside}
        </div>
        <div className="grid min-w-0 gap-4 wide:col-span-7 wide:col-start-1 wide:row-start-1">
          {level >= need ? (
            <div className="grid justify-items-start gap-3" role="status">
              <p className="flex items-center gap-2 text-reading font-semibold text-success">
                <Icon name="check" size={18} />
                {IDENTITY_WORDS.done}
              </p>
              {done}
            </div>
          ) : (
            <>
              {level < 2 ? (
                <section aria-label={IDENTITY_WORDS.you}>
                  <Card tone="white" className="grid gap-4">
                    <h3 className="font-display text-reading font-bold text-ink">{IDENTITY_WORDS.you}</h3>
                    <div className="grid gap-4 wide:grid-cols-2">
                      {level < 1 ? (
                        <>
                          {field('email', IDENTITY_WORDS.email, <Input type="email" autoComplete="email" value={d.email} onChange={set('email')} {...invalid('email')} />)}
                          {field(
                            'phone',
                            IDENTITY_WORDS.phone,
                            <Input type="tel" autoComplete="tel" className="font-figure" value={d.phone} onChange={set('phone')} {...invalid('phone')} />,
                            IDENTITY_WORDS.phoneHint,
                          )}
                        </>
                      ) : null}
                      {field('name', IDENTITY_WORDS.legalName, <Input autoComplete="name" maxLength={200} value={d.name} onChange={set('name')} {...invalid('name')} />, IDENTITY_WORDS.legalNameHint)}
                      {field('dob', IDENTITY_WORDS.dateOfBirth, <Input type="date" autoComplete="bday" className="font-figure" value={d.dob} onChange={set('dob')} {...invalid('dob')} />)}
                      <h4 className="font-display text-body font-bold text-ink wide:col-span-2">{IDENTITY_WORDS.homeAddress}</h4>
                      {field('line1', IDENTITY_WORDS.addressLine1, <Input autoComplete="address-line1" maxLength={200} value={d.line1} onChange={set('line1')} {...invalid('line1')} />)}
                      {field('line2', IDENTITY_WORDS.addressLine2, <Input autoComplete="address-line2" maxLength={200} value={d.line2} onChange={set('line2')} />)}
                      {field('town', IDENTITY_WORDS.town, <Input autoComplete="address-level2" maxLength={100} value={d.town} onChange={set('town')} {...invalid('town')} />)}
                      {field('postcode', IDENTITY_WORDS.postcode, <Input autoComplete="postal-code" maxLength={20} className="font-figure" value={d.postcode} onChange={set('postcode')} {...invalid('postcode')} />)}
                      {field(
                        'country',
                        IDENTITY_WORDS.country,
                        <Select value={d.country} onChange={set('country')} {...invalid('country')}>
                          <option value="" hidden>
                            {IDENTITY_WORDS.country}
                          </option>
                          {countries.map(([code, name]) => (
                            <option key={code} value={code}>
                              {name}
                            </option>
                          ))}
                        </Select>,
                      )}
                    </div>
                  </Card>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
      {level < need ? (
        <>
          {/* the company form is as wide as the page, as in Settings: its people's rows need the room */}
          {type === 'business' ? <CompanyDetailsSection titled /> : null}
          <DocumentStep />
          {said ? (
            <div role="alert">
              <FieldError>{said}</FieldError>
            </div>
          ) : null}
          <div className="grid wide:flex wide:justify-end">
            {/* B57.192 — once there is a way in, it is the page's one primary action and trying again steps back */}
            <Button variant={wayIn ? 'outline' : 'primary'} disabled={running !== null} onClick={() => void run()}>
              {running ? IDENTITY_WORDS.running : IDENTITY_WORDS.run}
            </Button>
          </div>
          {wayIn ? (
            // B57.192 — drawn as Home's one sentence is (IdentityGate): a white card, the line, then the way on.
            <Card tone="white" data-testid="identity-way-in" role="status" className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-2xl text-reading text-ink">{wayIn}</p>
              {done}
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Where the identity partner's own screen will open for a photo of the ID. It collects nothing. */
function DocumentStep() {
  return (
    <section aria-labelledby="identity-document" className={cn('grid gap-1.5 rounded-card bg-cloud p-5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="identity-document" className="font-display text-reading font-bold text-ink">
          {IDENTITY_WORDS.documentTitle}
        </h3>
        <WorkspaceStatus />
      </div>
      <p className="text-body text-ink-2">{IDENTITY_WORDS.documentLine}</p>
    </section>
  )
}

/** Home's one sentence while the account is not confirmed yet, with the way back to the step. */
export function IdentityGate() {
  const { account } = useAccount()
  const v = useVerification()
  if (!account || !v.isSuccess || rank(v.data.level) < 0 || rank(v.data.level) >= neededLevel(account.account_type)) return null
  return (
    <Card tone="white" data-testid="identity-gate" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-reading text-ink">{IDENTITY_WORDS.gate}</p>
      <Button asChild size="sm">
        <Link to="/signup/confirm">{IDENTITY_WORDS.finish}</Link>
      </Button>
    </Card>
  )
}
