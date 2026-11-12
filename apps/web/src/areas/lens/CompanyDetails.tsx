import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Crumb, Field, Icon, Input, Select, showSnack } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { COUNTRIES, PROFILE_ERRORS, PROFILE_LABELS } from '../auth/signupWords'
import { useAccount } from './agentBankApi'
import {
  COMPANY_KEY,
  COMPANY_WORDS,
  CompanyRefusedError,
  ROLE_LABEL,
  type CompanyDetails,
  type ControlRole,
  saveCompanyDetails,
  shareBps,
  shareText,
  useCompanyDetails,
} from './companyDetailsApi'

// CompanyDetails.tsx — B59.31: a Business workspace's company name, registration number and country, and the people
// with control, each with a name, a role and a share (SPEC 6 (4)). In Settings (/settings/company) and at the end of
// sign-up (/signup/key). They go to the partner's identity check later; no document is uploaded. A Personal account
// never sees it: no Settings entry, and its address opens Home.

/** One person as typed: the share is the words in the box, in percent. */
interface PersonDraft {
  /** The row's own key on this screen: a person has no id until Lens keeps them. */
  key: number
  name: string
  role: ControlRole
  share: string
}

interface Draft {
  companyName: string
  registrationNumber: string
  country: string
  people: PersonDraft[]
}

const draftOf = (d: CompanyDetails): Draft => ({
  companyName: d.company_name,
  registrationNumber: d.registration_number,
  country: d.country,
  people: d.people.map((p, i) => ({ key: i, name: p.name, role: p.role, share: p.share_bps ? shareText(p.share_bps) : '' })),
})

type Errors = Partial<Record<'companyName' | 'registrationNumber' | 'country' | 'shares', string>> & { people?: Record<number, { name?: string; share?: string }> }

/** What the draft still lacks, keyed by field; empty when it can be sent. */
function check(d: Draft): Errors {
  const out: Errors = {}
  if (!d.companyName.trim()) out.companyName = PROFILE_ERRORS.companyName
  if (!d.registrationNumber.trim()) out.registrationNumber = PROFILE_ERRORS.registrationNumber
  if (!d.country) out.country = PROFILE_ERRORS.country
  let total = 0
  d.people.forEach((p, i) => {
    const bps = shareBps(p.share)
    const e: { name?: string; share?: string } = {}
    if (!p.name.trim()) e.name = COMPANY_WORDS.personName
    if (bps === null) e.share = COMPANY_WORDS.shareRange
    else total += bps
    if (e.name || e.share) out.people = { ...out.people, [i]: e }
  })
  if (total > 10000) out.shares = COMPANY_WORDS.sharesTotal
  return out
}

/** The body the BFF is sent: names tidied, shares in hundredths of a percent. */
function bodyOf(d: Draft): CompanyDetails {
  return {
    company_name: d.companyName.trim(),
    registration_number: d.registrationNumber.trim(),
    country: d.country,
    people: d.people.map((p) => ({ name: p.name.trim(), role: p.role, share_bps: shareBps(p.share) ?? 0 })),
  }
}

/** Red text always has an icon beside it. */
function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-body text-danger">
      <Icon name="x" size={16} />
      {children}
    </p>
  )
}

function refusal(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing changed. Sign in again.'
  if (err instanceof CompanyRefusedError && err.status === 400 && err.sentence) {
    const s = err.sentence.replace(/^economy: invalid business details: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return COMPANY_WORDS.failed
}

/** The form itself, filled from what was saved. */
function CompanyForm({ saved }: { saved: CompanyDetails }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved))
  const [tried, setTried] = useState(false)
  const save = useMutation({
    mutationFn: saveCompanyDetails,
    onSuccess: (got) => {
      qc.setQueryData(COMPANY_KEY, got)
      showSnack({ title: COMPANY_WORDS.saved, line: COMPANY_WORDS.line })
    },
  })
  const errors = tried ? check(draft) : {}
  const set = (field: 'companyName' | 'registrationNumber' | 'country') => (v: string) => setDraft({ ...draft, [field]: v })
  const setPerson = (i: number, p: Partial<PersonDraft>) => setDraft({ ...draft, people: draft.people.map((q, j) => (j === i ? { ...q, ...p } : q)) })
  return (
    <form
      noValidate
      aria-label={COMPANY_WORDS.title}
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (save.isPending || Object.keys(check(draft)).length > 0) return
        save.mutate(bodyOf(draft))
      }}
    >
      <div className="grid max-w-xl gap-4">
        <div className="grid gap-1.5">
          <Field label={PROFILE_LABELS.companyName}>
            <Input value={draft.companyName} maxLength={200} autoComplete="organization" aria-invalid={errors.companyName ? true : undefined} onChange={(e) => set('companyName')(e.target.value)} />
          </Field>
          {errors.companyName ? <FieldError>{errors.companyName}</FieldError> : null}
        </div>
        <div className="grid gap-1.5">
          <Field label={PROFILE_LABELS.registrationNumber}>
            <Input value={draft.registrationNumber} maxLength={64} autoComplete="off" aria-invalid={errors.registrationNumber ? true : undefined} onChange={(e) => set('registrationNumber')(e.target.value)} />
          </Field>
          {errors.registrationNumber ? <FieldError>{errors.registrationNumber}</FieldError> : null}
        </div>
        <div className="grid gap-1.5">
          <Field label={PROFILE_LABELS.country}>
            <Select value={draft.country} aria-invalid={errors.country ? true : undefined} onChange={(e) => set('country')(e.target.value)}>
              {/* hidden, not disabled: a disabled option greys the whole box (Select's has-[:disabled]) */}
              <option value="" hidden>
                {PROFILE_LABELS.country}
              </option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          {errors.country ? <FieldError>{errors.country}</FieldError> : null}
        </div>
      </div>
      <section aria-labelledby="company-people" className="grid gap-3">
        <div>
          <h3 id="company-people" className="font-display text-reading font-bold text-ink">
            {COMPANY_WORDS.people}
          </h3>
          <p className="text-body text-ink-2">{COMPANY_WORDS.peopleLine}</p>
        </div>
        <ul className="grid gap-3">
          {draft.people.map((p, i) => {
            const e = errors.people?.[i] ?? {}
            return (
              <li key={p.key} data-testid={`person-${i}`} className="grid gap-3 border-b border-line pb-3 last:border-b-0 wide:grid-cols-12 wide:items-start">
                <div className="grid gap-1.5 wide:col-span-4">
                  <Field label={COMPANY_WORDS.name}>
                    <Input value={p.name} maxLength={200} autoComplete="off" aria-invalid={e.name ? true : undefined} onChange={(ev) => setPerson(i, { name: ev.target.value })} />
                  </Field>
                  {e.name ? <FieldError>{e.name}</FieldError> : null}
                </div>
                <div className="wide:col-span-3">
                  <Field label={COMPANY_WORDS.role}>
                    <Select value={p.role} onChange={(ev) => setPerson(i, { role: ev.target.value as ControlRole })}>
                      {(Object.keys(ROLE_LABEL) as ControlRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-1.5 wide:col-span-3">
                  <Field label={COMPANY_WORDS.share}>
                    <Input value={p.share} inputMode="decimal" unit="%" aria-invalid={e.share ? true : undefined} onChange={(ev) => setPerson(i, { share: ev.target.value })} />
                  </Field>
                  {e.share ? <FieldError>{e.share}</FieldError> : null}
                </div>
                <div className="wide:col-span-2 wide:pt-7">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${COMPANY_WORDS.remove} ${p.name.trim() || `person ${i + 1}`}`}
                    onClick={() => setDraft({ ...draft, people: draft.people.filter((_, j) => j !== i) })}
                  >
                    {COMPANY_WORDS.remove}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        {errors.shares ? <FieldError>{errors.shares}</FieldError> : null}
        <div>
          <Button type="button" variant="secondary" icon={<Icon name="plus" size={18} />} onClick={() => setDraft({ ...draft, people: [...draft.people, { key: Math.max(-1, ...draft.people.map((q) => q.key)) + 1, name: '', role: 'director', share: '' }] })}>
            {COMPANY_WORDS.add}
          </Button>
        </div>
      </section>
      {save.isError ? (
        <p role="alert" className="text-body text-danger">
          {refusal(save.error)}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? COMPANY_WORDS.saving : COMPANY_WORDS.save}
        </Button>
      </div>
    </form>
  )
}

/**
 * The company details for a Business account; nothing at all for a Personal one, or while either is read. `titled` gives
 * the card its own heading, for sign-up; in Settings the page's heading already names it.
 */
export function CompanyDetailsSection({ titled = false }: { titled?: boolean }) {
  const business = useAccount().account?.account_type === 'business'
  const details = useCompanyDetails(business)
  if (!business || details.isPending || details.data === null) return null
  return (
    <Card tone="white" className="grid gap-4">
      <div className="grid gap-1">
        {titled ? <h2 className="font-display text-bar font-bold text-ink">{COMPANY_WORDS.title}</h2> : null}
        <p className="text-body text-ink-2">{COMPANY_WORDS.line}</p>
      </div>
      {details.data ? <CompanyForm saved={details.data} /> : <p className="text-body text-ink-2">{COMPANY_WORDS.readFailed}</p>}
    </Card>
  )
}

/** /settings/company — Business only: a Personal account's address opens Home. */
export function CompanyDetailsScreen() {
  const { account } = useAccount()
  if (account?.account_type === 'personal') return <Navigate to="/" replace />
  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: COMPANY_WORDS.title }]} />
      <CompanyDetailsSection />
    </div>
  )
}
