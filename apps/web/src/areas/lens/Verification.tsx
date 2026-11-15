import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Field, Input, type ChipTone } from '@talyvor/ui/pocket'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, Note, readFailure } from './WalletMoney'
import {
  type VerificationBody,
  type VerificationCheck,
  type WorkspaceVerification,
  agentBankApi,
  refusalText,
} from './agentBankApi'

// Verification.tsx — B30.116: the owner's verification level (Lens B30.4). The level the checks reach and the live
// level live money is judged by, the next check as a form, every check on the record with its status and evidence
// reference, and beside each capability the level its live money needs. Lens decides the order and what a check
// counts for; the screen shows Lens's record and, on a refusal, Lens's own sentence.

export const VERIFICATION_KEY = ['verification']

const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
const MEANING: Record<string, string> = {
  L0: 'signed in',
  L1: 'email and phone confirmed',
  L2: 'identity checked',
  L3: 'company checked',
}

/** 0 to 3 for "L0" to "L3"; -1 for anything else. */
function rank(level: string | undefined): number {
  return LEVELS.indexOf(level as (typeof LEVELS)[number])
}

const SUBJECT: Record<string, string> = { contact: 'Email and phone', person: 'Identity', company: 'Company' }

const STATUS: Record<VerificationCheck['status'], { text: string; tone: ChipTone }> = {
  completed: { text: 'Passed', tone: 'good' },
  pending: { text: 'Pending', tone: 'wait' },
  failed: { text: 'Not passed', tone: 'bad' },
  returned: { text: 'Withdrawn', tone: 'bad' },
}

/** A card's title, as Pocket draws it (pocket.css .h3). */
function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-reading font-bold text-ink">{children}</h3>
}

const useVerification = () => useQuery({ queryKey: VERIFICATION_KEY, queryFn: agentBankApi.verification })
const useCapabilities = () => useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })

export function VerificationScreen() {
  const v = useVerification()
  const level = rank(v.data?.level)
  // B57.42 — Pocket's w-verification: the crumb, the level and the next check beside every check, then the levels.
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Verification' }]} />
      <div className="grid max-w-3xl gap-1">
        <h2 className="font-display text-bar font-bold text-ink">What Talyvor has checked about you</h2>
        <p className="text-reading text-ink-2">
          Each level lets your agents do more with live money. Talyvor checks one level at a time and keeps the level, who checked it, when,
          and the checker’s reference as its evidence, never a copy of a document.
        </p>
      </div>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid gap-4 wide:col-span-7">
          {v.isError ? (
            <p className="text-body text-ink-2">{readFailure(v.error, 'Your verification')}</p>
          ) : v.isPending ? (
            <p className="text-body text-ink-2">Reading…</p>
          ) : (
            <>
              <LevelCard v={v.data} />
              <section aria-label="Next check" className="grid gap-2">
                <h3 className="font-display text-reading font-bold text-ink">
                  {level >= 3 ? 'Every level is reached' : `Reach ${LEVELS[level + 1]}: ${MEANING[LEVELS[level + 1]]}`}
                </h3>
                <NextCheck v={v.data} />
              </section>
            </>
          )}
        </div>
        {v.isSuccess ? (
          <section aria-label="Checks" className="wide:col-span-5">
            <CheckList />
          </section>
        ) : null}
      </div>
      <section aria-label="Levels" className="grid gap-3">
        <h2 className="font-display text-bar font-bold text-ink">The level each capability needs for live money</h2>
        <div className="grid items-start gap-4 wide:grid-cols-3">
          <CapabilityLevels />
        </div>
      </section>
    </div>
  )
}

function LevelCard({ v }: { v: WorkspaceVerification }) {
  const level = rank(v.level)
  const live = rank(v.live_level)
  return (
    <Card tone="white">
      <Title>Your level</Title>
      <div className="mt-2 flex flex-col gap-3">
        <dl className="flex flex-col gap-2">
          <div className="flex items-baseline gap-4">
            <dt className="w-24 shrink-0 text-body text-ink-3">Level</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3" data-testid="verification-level">
              <span className="font-figure text-reading font-semibold text-ink">{v.level}</span>
              <span className="text-body text-ink">{v.meaning || MEANING[v.level]}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-4">
            <dt className="w-24 shrink-0 text-body text-ink-3">Live level</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3" data-testid="verification-live-level">
              <span className="font-figure text-reading font-semibold text-ink">{v.live_level}</span>
              <span className="text-body text-ink">{v.live_meaning || MEANING[v.live_level]}</span>
            </dd>
          </div>
        </dl>
        <p className="text-body text-ink-3">Live money is judged by your live level, which counts only checks a real provider passed.</p>
        {level > live ? (
          <p className="text-body text-ink-3" data-testid="verification-test-only">
            Your checks above {v.live_level} were passed by the Test provider, so they do not count for live money.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/** The form for the check that reaches the next level. */
function NextCheck({ v }: { v: WorkspaceVerification }) {
  const qc = useQueryClient()
  const level = rank(v.level)
  const [f, setF] = useState({ email: '', phone: '', name: '', country: '', dob: '', number: '', directors: '', psc: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const check = useMutation({
    mutationFn: (body: VerificationBody) => agentBankApi.verify(body),
    onSuccess: (ans) => qc.setQueryData(VERIFICATION_KEY, ans.verification),
  })
  if (level >= 3) {
    return <p className="text-body text-ink-2">Your company is checked: there is no further level to reach.</p>
  }
  const names = (s: string) => s.split(',').map((n) => n.trim()).filter((n) => n !== '')
  const country = f.country.trim().toUpperCase()
  const body: VerificationBody | null =
    level === 0
      ? f.email.trim() && f.phone.trim()
        ? { kind: 'contact', email: f.email.trim(), phone: f.phone.trim() }
        : null
      : level === 1
        ? f.name.trim() && country && f.dob
          ? { kind: 'identity', name: f.name.trim(), country, date_of_birth: f.dob }
          : null
        : f.name.trim() && country && f.number.trim() && names(f.directors).length > 0
          ? {
              kind: 'company',
              name: f.name.trim(),
              country,
              company_number: f.number.trim(),
              directors: names(f.directors),
              people_with_significant_control: names(f.psc),
            }
          : null
  const pending = (v.checks ?? []).find((c) => rank(c.level) === level + 1 && c.status === 'pending')
  const field = (label: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}>
      <Input value={f[k]} onChange={set(k)} {...props} />
    </Field>
  )
  return (
    <Card>
      <Title>{level === 0 ? 'Email and phone' : level === 1 ? 'Identity' : 'Company'}</Title>
      <form
        aria-label="Next check"
        className="mt-2 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (body && !check.isPending) check.mutate(body)
        }}
      >
        <p className="text-body text-ink-2">
          {level === 0
            ? 'Talyvor confirms your email address and phone number with the checking provider and keeps neither.'
            : level === 1
              ? 'Your name, country and date of birth go to the checking provider; Talyvor keeps your verified name, country and the provider’s reference, not your date of birth.'
              : 'Your company’s name, country, number, directors and the people with significant control go to the checking provider. Separate several names with commas.'}
        </p>
        {pending ? (
          <Note ok>
            Your {SUBJECT[pending.subject]?.toLowerCase() ?? pending.subject} check is pending with the provider; this page
            asks again each time you open it.
          </Note>
        ) : null}
        <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
          {level === 0 ? (
            <>
              {field('Email', 'email', { type: 'email', autoComplete: 'email' })}
              {field('Phone, in international form', 'phone', {
                type: 'tel',
                autoComplete: 'tel',
                placeholder: '+447700900123',
                className: 'font-figure',
              })}
            </>
          ) : level === 1 ? (
            <>
              {field('Full name', 'name', { autoComplete: 'name' })}
              {field('Country', 'country', {
                placeholder: 'GB',
                maxLength: 2,
                className: 'font-figure',
              })}
              {field('Date of birth', 'dob', {
                type: 'date',
                className: 'font-figure',
              })}
            </>
          ) : (
            <>
              {field('Company name', 'name', { autoComplete: 'organization' })}
              {field('Country', 'country', {
                placeholder: 'GB',
                maxLength: 2,
                className: 'font-figure',
              })}
              {field('Company number', 'number', { className: 'font-figure' })}
              {field('Directors', 'directors')}
              {field('People with significant control', 'psc')}
            </>
          )}
        </div>
        <div>
          <Button type="submit" disabled={check.isPending} disabledReason={body ? undefined : 'Fill in every field first.'}>
            {check.isPending ? 'Checking…' : level === 0 ? 'Check email and phone' : level === 1 ? 'Check identity' : 'Check company'}
          </Button>
        </div>
        {check.isSuccess ? <CheckOutcome c={check.data.check} /> : null}
        {check.isError ? <Note ok={false}>{refusalText(check.error)}</Note> : null}
      </form>
    </Card>
  )
}

function CheckOutcome({ c }: { c: VerificationCheck }) {
  const what = `${c.level} (${MEANING[c.level] ?? c.level})`
  if (c.status === 'completed') {
    return <Note ok>{c.test ? `Passed by the Test provider: ${what}. It does not count for live money.` : `Passed: ${what}.`}</Note>
  }
  if (c.status === 'pending') return <Note ok>The check for {what} is pending with the provider.</Note>
  return <Note ok={false}>The check for {what} did not pass{c.detail ? `: ${c.detail}` : '.'}</Note>
}

function CheckList() {
  const v = useVerification()
  if (v.isError) return <p className="text-body text-ink-2">{readFailure(v.error, 'Your checks')}</p>
  if (v.isPending) return <p className="text-body text-ink-2">Reading…</p>
  const checks = v.data.checks ?? []
  if (checks.length === 0) {
    return (
      <p className="text-body text-ink-2">No check yet: you are signed in, which is L0. Each check appears here when you start it above.</p>
    )
  }
  return (
    <Card tone="white">
      <Title>Every check on your record</Title>
      <ul className="mt-2">
        {checks.map((c) => {
          const s = STATUS[c.status] ?? {
            text: c.status,
            tone: 'plain' as const,
          }
          return (
            <li
              key={`${c.evidence_ref}-${c.started_at}`}
              className="flex flex-col gap-1 border-t border-line py-2.5 first:border-t-0"
              data-testid="verification-check"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">
                  <span className="font-figure">{c.level}</span> · {SUBJECT[c.subject] ?? c.subject}
                  {c.verified_name ? ` · ${c.verified_name}` : ''}
                </span>
                <Chip tone={s.tone}>{s.text}</Chip>
              </div>
              <p className="text-body text-ink-3">
                Checked by {c.method === 'test' ? 'the Test provider' : c.method} ·{' '}
                <span className="font-figure">{formatWhen(c.checked_at)}</span>
                {c.country ? ` · ${c.country}` : ''}
              </p>
              {c.test ? <p className="text-body text-ink-3">Test check: not counted for live money</p> : null}
              <p className="text-body text-ink-3">
                Evidence reference <span className="break-all font-figure text-ink">{c.evidence_ref}</span>
              </p>
              {c.detail ? <p className="text-body text-ink">{c.detail}</p> : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Each level, what it means, whether this workspace reaches it, and beside each capability the level it needs. */
function CapabilityLevels() {
  const caps = useCapabilities()
  const v = useVerification().data
  if (caps.isError) return <p className="text-body text-ink-2">{readFailure(caps.error, 'The capabilities')}</p>
  if (caps.isPending) return <p className="text-body text-ink-2">Reading…</p>
  const leveled = (caps.data.capabilities ?? []).filter((c) => rank(c.level_needed) >= 0)
  if (leveled.length === 0) {
    return <p className="text-body text-ink-2">This deployment does not say yet which level each capability needs.</p>
  }
  const level = rank(v?.level)
  const live = rank(v?.live_level)
  const groups = LEVELS.map((l, n) => ({ l, n, here: leveled.filter((c) => c.level_needed === l) })).filter((g) => g.here.length > 0)
  return (
    <>
      {groups.map(({ l, n, here }) => {
        const state: { text: string; tone: ChipTone } | null = !v
          ? null
          : live >= n
            ? { text: 'Reached for live money', tone: 'good' }
            : level >= n
              ? { text: 'Reached with test checks only', tone: 'wait' }
              : { text: 'Not reached yet', tone: 'plain' }
        return (
          <Card key={l} tone="white" data-testid={`verification-needs-${l}`}>
            <Title>
              <span className="font-figure">{l}</span> · {MEANING[l]}
            </Title>
            {state ? (
              <p className="mt-1">
                <Chip tone={state.tone}>{state.text}</Chip>
              </p>
            ) : null}
            <ul className="mt-2">
              {here.map((c) => (
                <li
                  key={c.capability}
                  className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 first:border-t-0"
                  data-testid={`capability-level-${c.capability}`}
                >
                  <span className="min-w-0 text-body font-semibold text-ink">{c.name}</span>
                  <span className="shrink-0 font-figure text-body text-ink-3">{c.level_needed}</span>
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
    </>
  )
}
