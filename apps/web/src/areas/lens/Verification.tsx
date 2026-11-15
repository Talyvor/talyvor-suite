import { useQuery } from '@tanstack/react-query'
import { Card, Chip, Crumb, type ChipTone } from '@talyvor/ui/pocket'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, readFailure } from './WalletMoney'
import { type VerificationCheck, agentBankApi } from './agentBankApi'
import { IDENTITY_WORDS, SIGNUP_STEPS } from '../auth/signupWords'
import { IdentityChecks, LEVELS, failedText, rank, useVerification } from './IdentityChecks'

// Verification.tsx — B30.116: the owner's verification (Lens B30.4). B61.20 redraws it with sign-up's step 4, the same
// parts and words (IdentityChecks): the checks for the account and the fields the next one needs, then every check on
// the record in words, and beside each capability what it needs for live money. The provider's reference is behind
// "Reference for support" (B60.5); no provider or state name reaches the page.

export { VERIFICATION_KEY } from './IdentityChecks'

const MEANING: Record<string, string> = {
  L0: 'Signed in',
  L1: 'Email and phone confirmed',
  L2: 'Identity checked',
  L3: 'Company checked',
}

const SUBJECT: Record<string, string> = { contact: IDENTITY_WORDS.contact, person: IDENTITY_WORDS.person, company: IDENTITY_WORDS.company }

/** A check's status in words: a pass in Sandbox says so. */
function statusOf(c: VerificationCheck): { text: string; tone: ChipTone } {
  if (c.status === 'completed') return { text: c.test ? IDENTITY_WORDS.passedSandbox : IDENTITY_WORDS.passed, tone: 'good' }
  if (c.status === 'pending') return { text: IDENTITY_WORDS.waiting, tone: 'wait' }
  if (c.status === 'returned') return { text: 'Withdrawn', tone: 'bad' }
  return { text: IDENTITY_WORDS.notPassed, tone: 'bad' }
}

/** A card's title, as Pocket draws it (pocket.css .h3). */
function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-reading font-bold text-ink">{children}</h3>
}

const useCapabilities = () => useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })

export function VerificationScreen() {
  const v = useVerification()
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Verification' }]} />
      <div className="grid gap-1">
        <h2 className="font-display text-bar font-bold text-ink">{SIGNUP_STEPS[3]}</h2>
        <p className="max-w-3xl text-body text-ink-3">
          Talyvor keeps what each check found, who checked it and when, never a copy of a document.
        </p>
      </div>
      <IdentityChecks />
      {v.isSuccess ? (
        <section aria-label="Every check" className="grid max-w-3xl gap-3">
          <CheckList />
        </section>
      ) : null}
      <section aria-label="What each part needs" className="grid gap-3">
        <h2 className="font-display text-bar font-bold text-ink">What live money needs</h2>
        <div className="grid items-start gap-4 wide:grid-cols-3">
          <CapabilityLevels />
        </div>
      </section>
    </div>
  )
}

function CheckList() {
  const v = useVerification()
  if (v.isError) return <p className="text-body text-ink-2">{readFailure(v.error, 'Your checks')}</p>
  const checks = v.data?.checks ?? []
  if (checks.length === 0) return null
  return (
    <Card tone="white">
      <Title>Every check on your record</Title>
      <ul className="mt-2">
        {checks.map((c) => {
          const s = statusOf(c)
          return (
            <li key={`${c.evidence_ref}-${c.started_at}`} className="grid gap-1 border-t border-line py-2.5 first:border-t-0" data-testid="verification-check">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">
                  {SUBJECT[c.subject] ?? 'A check'}
                  {c.verified_name ? ` · ${c.verified_name}` : ''}
                </span>
                <Chip tone={s.tone}>{s.text}</Chip>
              </div>
              <p className="text-body text-ink-3">
                <span className="font-figure">{formatWhen(c.checked_at)}</span>
              </p>
              {c.status === 'failed' || c.status === 'returned' ? <p className="text-body text-ink">{failedText(c)}</p> : null}
              <details className="text-body text-ink-3">
                <summary className="cursor-pointer">Reference for support</summary>
                <span className="break-all font-figure text-ink">{c.evidence_ref}</span>
              </details>
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
              ? { text: 'Reached in Sandbox', tone: 'wait' }
              : { text: 'Not reached yet', tone: 'plain' }
        return (
          <Card key={l} tone="white" data-testid={`verification-needs-${l}`}>
            <Title>{MEANING[l]}</Title>
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
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
    </>
  )
}
