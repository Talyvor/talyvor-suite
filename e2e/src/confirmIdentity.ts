// B61.51 — the testers' people confirm who they are before they move money.
//
// Sign-up ends at the identity check (B61.20, B61.21), and an account that has not passed it can look around but moves no
// money (Lens B61.52). So every synthetic user passes the Sandbox check its account needs before any journey, through the
// calls the app makes: its email and phone (L1), then its identity (L2), and for a Business its saved company details and
// the company check (L3), which Lens fills from those details as the app's empty company check asks it to (Lens B59.30).
// Personal reaches L2, Business L3, as the apps' neededLevel has it. The verification scenarios keep users of their own
// that start unconfirmed (UNCONFIRMED_SCENARIOS, and createUsers' `confirm: false`). A user that cannot pass is that
// user's failure, named, and never stops the run.

// Types only from lens.ts, which calls confirmIdentity from createUsers.
import type { Answered, LensClient, SyntheticUser, VerificationCheck, WorkspaceVerification } from './lens.ts'

/** The scenarios whose workspace of its own starts unconfirmed: they play the identity check themselves. */
export const UNCONFIRMED_SCENARIOS: ReadonlySet<string> = new Set(['verification-levels', 'verification-screen', 'identity-gate'])

/** A person the Test provider passes: no TESTFAIL, TESTSANCTION, TESTRETURN or TESTPENDING in the name. */
export const PERSON = { name: 'Nightly Confirmed Owner', country: 'GB', date_of_birth: '1990-04-12' }
/** How many users confirm at once in a run's set-up. */
const WIDTH = 8

interface CheckAnswer { check: VerificationCheck; verification: WorkspaceVerification }

/** The level an account of `accountType` needs to move money (the apps' neededLevel): a Business L3, a Personal L2. */
export function neededLevel(accountType: string): 'L2' | 'L3' {
  return accountType === 'business' ? 'L3' : 'L2'
}

/** What one user's confirmation came to: the level it reached, or why it could not. */
export type Confirmed = { ok: true; level: string } | { ok: false; why: string }

/** `user` passes the Sandbox identity check its account needs, as the app asks for it; the checks it already passed are not asked again. */
export async function confirmIdentity(lens: LensClient, user: SyntheticUser): Promise<Confirmed> {
  const no = (step: string, got: Answered<unknown>): Confirmed => ({ ok: false, why: `${step}: ${got.ok ? got.status : `refused ${got.status}: ${got.error}`}` })
  const account = await lens.act<{ account_type: string }>(user, 'GET', '/v1/workspaces/{ws}/account')
  if (!account.ok) return no('reading the account', account)
  const needs = neededLevel(account.value.account_type)
  const record = await lens.act<WorkspaceVerification>(user, 'GET', '/v1/workspaces/{ws}/verification')
  if (!record.ok) return no('reading the verification record', record)
  let level = record.value.level
  const check = async (kind: string, body: object): Promise<Confirmed | undefined> => {
    const got = await lens.act<CheckAnswer>(user, 'POST', `/v1/workspaces/{ws}/verification/${kind}`, body)
    if (!got.ok) return no(`the ${kind} check`, got)
    if (got.value.check.status !== 'completed') return { ok: false, why: `the ${kind} check is ${got.value.check.status}, not completed` }
    level = got.value.verification.level
    return undefined
  }
  if (level < 'L1') {
    const bad = await check('contact', { email: `nightly-${user.workspaceID}@example.com`, phone: '+447700900123' })
    if (bad !== undefined) return bad
  }
  if (level < 'L2') {
    const bad = await check('identity', PERSON)
    if (bad !== undefined) return bad
  }
  if (needs === 'L3' && level < 'L3') {
    const saved = await lens.act(user, 'PUT', '/v1/workspaces/{ws}/business', { company_name: `Nightly Company ${user.workspaceID}`,
      registration_number: '00000000', country: PERSON.country, people: [{ name: PERSON.name, role: 'director', share_bps: 10000 }] })
    if (!saved.ok) return no('saving the company details', saved)
    const bad = await check('company', { name: '', country: '', company_number: '', directors: [], people_with_significant_control: [] })
    if (bad !== undefined) return bad
  }
  return level >= needs ? { ok: true, level } : { ok: false, why: `the checks passed and the account is at ${level}, not the ${needs} it needs` }
}

/** What a set of users' confirmations came to: how many passed, and each that did not, by name. */
export interface Confirmations { asked: number; confirmed: number; failed: { user: SyntheticUser; why: string }[] }

/** Every one of `users` confirms, a few at once; one that cannot is named in `failed`, never thrown. */
export async function confirmAll(lens: LensClient, users: readonly SyntheticUser[]): Promise<Confirmations> {
  const out: Confirmations = { asked: users.length, confirmed: 0, failed: [] }
  let next = 0
  const worker = async () => {
    while (next < users.length) {
      const user = users[next++]
      const got = await confirmIdentity(lens, user).catch((e: unknown): Confirmed => ({ ok: false, why: e instanceof Error ? e.message : String(e) }))
      if (got.ok) out.confirmed++
      else out.failed.push({ user, why: got.why })
    }
  }
  await Promise.all(Array.from({ length: Math.min(WIDTH, users.length) }, worker))
  return out
}

/** The run's set-up line: how many users confirmed who they are, and each that could not. */
export function confirmLine(c: Confirmations, unconfirmed: number): string {
  return `identity: confirmed ${c.confirmed} of ${c.asked} synthetic user(s) (a Business to L3, a Personal to L2)` +
    (unconfirmed > 0 ? `; ${unconfirmed} workspace(s) of their own start unconfirmed for ${[...UNCONFIRMED_SCENARIOS].join(' and ')}` : '') +
    c.failed.map((f) => `; user ${f.user.index} (${f.user.workspaceID}) could not confirm: ${f.why}`).join('')
}
