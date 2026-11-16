// B61.28 — THE TESTERS JOIN AND SIGN IN THE NEW WAY. A person meets the door by phone number (B61.25 the BFF, B61.26 the
// web): a code, in Sandbox shown on the screen under the Sandbox label, then a passcode, or a passkey. Once a run, one
// synthetic person comes in at the door, on a number from the range kept for tests and never a real one, and the six
// scenarios play its way in, one after another in one user's list:
//   door-join — a new number: the code read from the screen, a passcode chosen twice, sign-up's two steps on the screen;
//        the session is on the account it opened.
//   door-passcode — the number again, the code from the screen, the passcode: signed in on that account; "Sign in faster
//        next time" makes a passkey on the browser's virtual authenticator, and the BFF keeps it.
//   door-passkey — a browser holding only that passkey, nothing typed: "Sign in with a passkey" signs in on the account.
//   door-wrong-passcode — a wrong passcode is refused in Lens's words, nobody is signed in, and the right one straight
//        after, on the same code, signs in.
//   door-phone-lock — the phone's way through the BFF (no Origin, a Bearer token): a session that reads; closed, it
//        answers 423 on every route but unlock; a wrong passcode leaves it locked, the right one opens it.
//   door-wait — locked again, five wrong passcodes at the lock and Lens makes every try wait 15 minutes, the right
//        passcode included; the session stays locked.
// Nothing signs in through Google. A later scenario that needs what an earlier one made (the person, the passkey) is a
// SKIP naming it when that one did not make it, so one fault is filed once.
//
// LENS'S LIMITS ARE MET, NOT DODGED. One number gets a text at most every 30 seconds and one address 5 an hour
// (talyvor-lens phonesignin TextGap, LENS_PHONE_CHECKS_PER_ADDRESS_HOUR): the run asks for four codes, waits out a
// 30-second gap, and reports a longer wait as a SKIP with Lens's own sentence.

import { createHash, randomInt } from 'node:crypto'
import type { BrowserContext, CDPSession, Page, Response } from 'playwright'
import { fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/**
 * The numbers kept for tests: Ofcom's drama range, 07700 900000 to 07700 900999, set aside for fiction and never given to
 * a phone. Every number the testers type is one of these.
 */
export const TEST_PHONES = { prefix: '+447700900', count: 1000 } as const

/** The `n`th test number, wrapping round the range. */
export function testPhone(n: number): string {
  const i = ((Math.trunc(n) % TEST_PHONES.count) + TEST_PHONES.count) % TEST_PHONES.count
  return `${TEST_PHONES.prefix}${String(i).padStart(3, '0')}`
}

/** Whether `phone` is a test number. */
export function isTestPhone(phone: string): boolean {
  return phone.length === TEST_PHONES.prefix.length + 3 && phone.startsWith(TEST_PHONES.prefix) && /^\d{3}$/.test(phone.slice(-3))
}

/** The test numbers a run with `salt` tries, in order: one, and the next if a night before already joined it. */
export function doorPhones(salt: number): string[] {
  const first = Number.parseInt(createHash('sha256').update(`door-${salt}`).digest('hex').slice(0, 8), 16)
  return [testPhone(first), testPhone(first + 1)]
}

/** The national digits the door's field takes for a test number, under the country picker's United Kingdom. */
export const nationalOf = (phone: string): string => phone.replace(/^\+44/, '')

/** A passcode Lens takes (phonesignin.CheckPasscodeShape): six digits, not one repeated, not a run, not the number's end. */
export function passcodeFor(phone: string, draw: () => number = () => randomInt(0, 1_000_000)): string {
  for (;;) {
    const p = String(draw()).padStart(6, '0')
    const steps = [...p].slice(1).map((d, i) => Number(d) - Number(p[i]))
    if (new Set(p).size === 1 || steps.every((s) => s === 1) || steps.every((s) => s === -1) || phone.endsWith(p)) continue
    return p
  }
}

/** Another passcode Lens would take, never `right`. */
export function wrongPasscode(phone: string, right: string): string {
  return passcodeFor(phone, () => (Number(right) + 1 + randomInt(0, 999_998)) % 1_000_000)
}

/** apps/web Door.tsx DOOR_WORDS: what the screens say. */
const WORDS = {
  passkey: 'Sign in with a passkey',
  codeTitle: 'Enter the code',
  passcodeTitle: 'Enter your passcode',
  chooseTitle: 'Choose a passcode',
  againTitle: 'Type it again',
  fasterTitle: 'Sign in faster next time',
  makePasskey: 'Make a passkey',
  notNow: 'Not now',
}
/** Door.tsx DOOR_WORDS.sandboxCode. */
const SANDBOX_CODE = /In Sandbox no text is sent\. Your code is (\d{3}) (\d{3})\./
/** Lens's refusal of a wrong passcode (cmd/lens phone_signin_routes.go). */
const WRONG_PASSCODE = 'That passcode is not right.'
/** phonesignin.PasscodeWait. */
const WAIT_MS = 15 * 60_000
/** The longest of Lens's waits between codes the run sits out: TextGap, and a little. */
const GAP_MS = 45_000
const STEP_MS = 30_000

/** What one run's door person is: made by door-join, then used by every other door scenario. */
export interface DoorPerson {
  phone: string
  passcode: string
  accountID: string
}

/** A passkey as the browser's virtual authenticator holds it (CDP WebAuthn.Credential), carried to a fresh browser. */
interface HeldKey {
  credentialId: string
  isResidentCredential: boolean
  rpId?: string
  privateKey: string
  userHandle?: string
  signCount: number
}

/** A browser of its own, signed out, with a virtual authenticator that verifies the user — Face ID or Touch ID. */
interface Door {
  context: BrowserContext
  page: Page
  cdp: CDPSession
  authenticatorId: string
  origin: string
  close: () => Promise<void>
}

async function openDoor(ctx: ScenarioCtx, key?: HeldKey): Promise<Door> {
  const origin = new URL(ctx.app.page.url()).origin
  const browser = ctx.app.context.browser()
  if (browser === null) throw new Error('the synthetic user has no browser to open a door from')
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    if (key !== undefined) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: key })
    await page.goto(`${origin}/signin`, { waitUntil: 'domcontentloaded' })
    return { context, page, cdp, authenticatorId, origin, close: () => context.close().catch(() => undefined) }
  } catch (e) {
    await context.close().catch(() => undefined)
    throw e
  }
}

/** Who the browser is signed in as, from the BFF's /auth/me. */
async function whoAmI(page: Page): Promise<{ authenticated: boolean; workspace_id?: string; signup_unfinished?: boolean; google_signin?: boolean }> {
  return page.evaluate(async () => (await fetch('/auth/me', { headers: { Accept: 'application/json' } })).json())
}

/** The six digits typed into the boxes named `label` ("The code", "Passcode"), one a box, as a person types them. */
async function typeDigits(page: Page, label: string, digits: string): Promise<void> {
  const boxes = page.getByRole('group', { name: label }).locator('input')
  await boxes.first().waitFor({ timeout: STEP_MS })
  for (const [i, d] of [...digits].entries()) await boxes.nth(i).fill(d)
}

const posted = (page: Page, path: string) =>
  page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path, { timeout: STEP_MS })

async function bodyOf(r: Response): Promise<Record<string, unknown>> {
  try {
    return ((await r.json()) as Record<string, unknown> | null) ?? {}
  } catch {
    return {}
  }
}

/** Lens's wait in a 429, in milliseconds from now: Retry-After, else its retry_at. */
function waitOf(r: Response, body: Record<string, unknown>): number {
  const after = Number(r.headers()['retry-after'])
  if (Number.isFinite(after) && after > 0) return after * 1000
  const at = typeof body.retry_at === 'string' ? Date.parse(body.retry_at) : Number.NaN
  return Number.isFinite(at) ? at - Date.now() : Number.POSITIVE_INFINITY
}

/**
 * The number typed at the door and Continue pressed; the code read from the screen, under the Sandbox label, and typed
 * into its boxes. Answers whether the number already had a person (the next screen asks for its passcode).
 */
async function codeFromScreen(ctx: ScenarioCtx, page: Page, phone: string): Promise<{ hasPerson: boolean }> {
  if (!isTestPhone(phone)) throw new Error(`${phone} is not a test number`)
  await page.getByLabel('Your phone number').fill(nationalOf(phone), { timeout: STEP_MS })
  for (let tries = 0; ; tries++) {
    const [started] = await Promise.all([posted(page, '/auth/phone/start'), page.getByRole('button', { name: 'Continue' }).click()])
    if (started.status() === 200) break
    const body = await bodyOf(started)
    const said = typeof body.error === 'string' ? body.error : `${started.status()}`
    if (started.status() !== 429) throw new Error(`asking for a code for ${phone} was refused ${started.status()}: ${said}`)
    const wait = waitOf(started, body)
    if (tries > 0 || wait > GAP_MS) throw new CannotTest(`Lens limits the codes this run may ask for: "${said}"`)
    ctx.evidence.push({ note: `Lens asked the run to wait ${Math.ceil(wait / 1000)} s before another code for ${phone}: "${said}"` })
    await page.waitForTimeout(wait + 1_000)
  }
  await page.getByRole('heading', { name: WORDS.codeTitle }).waitFor({ timeout: STEP_MS })
  const line = page.getByText(SANDBOX_CODE)
  if (!(await line.isVisible().catch(() => false))) {
    throw new CannotTest('this server sends real texts, so there is no Sandbox code on the screen for the testers to read')
  }
  const m = SANDBOX_CODE.exec(await line.innerText())
  if (m === null) throw new Error(`the Sandbox code line reads "${await line.innerText()}"`)
  const code = m[1] + m[2]
  ctx.evidence.push({ note: `${phone}: the screen showed the Sandbox code ${m[1]} ${m[2]}` })
  const [finished] = await Promise.all([posted(page, '/auth/phone/finish'), typeDigits(page, 'The code', code)])
  if (finished.status() !== 200) throw new Error(`the code the screen showed was refused ${finished.status()}: ${JSON.stringify(await bodyOf(finished))}`)
  const next = await Promise.race([
    page.getByRole('heading', { name: WORDS.chooseTitle }).waitFor({ timeout: STEP_MS }).then(() => false),
    page.getByRole('heading', { name: WORDS.passcodeTitle }).waitFor({ timeout: STEP_MS }).then(() => true),
  ])
  return { hasPerson: next }
}

/** Shared by one run's door scenarios: what the earlier ones made. */
export interface DoorRun {
  person?: DoorPerson
  /** Why door-join made no person, for the SKIPs after it. */
  noPerson?: string
  key?: HeldKey
  noKey?: string
  /** The phone's session from door-phone-lock, for door-wait. */
  phoneToken?: string
}

function personOf(run: DoorRun): DoorPerson {
  if (run.person === undefined) throw new CannotTest(`door-join made no person this run${run.noPerson ? `: ${run.noPerson}` : ''}`)
  return run.person
}

/** One request as the phone app sends it: no Origin, no cookie, the session as a Bearer token. */
async function asPhone(origin: string, method: string, path: string, token: string | undefined, body?: unknown): Promise<{ status: number; body: Record<string, unknown>; retryAfter: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token !== undefined) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(STEP_MS) })
  let got: Record<string, unknown> = {}
  try {
    got = ((await res.json()) as Record<string, unknown> | null) ?? {}
  } catch { /* 204, or not JSON */ }
  return { status: res.status, body: got, retryAfter: res.headers.get('retry-after') ?? '' }
}

/** The phone app's sign-in through the BFF: a code (Sandbox's, in the answer the app shows), then the passcode. */
async function phoneSignIn(ctx: ScenarioCtx, origin: string, p: DoorPerson): Promise<string> {
  let started = await asPhone(origin, 'POST', '/auth/phone/start', undefined, { phone: p.phone })
  if (started.status === 429) {
    const wait = Number(started.retryAfter) * 1000
    if (!(wait > 0 && wait <= GAP_MS)) throw new CannotTest(`Lens limits the codes this run may ask for: "${String(started.body.error)}"`)
    ctx.evidence.push({ note: `Lens asked the phone to wait ${wait / 1000} s before another code: "${String(started.body.error)}"` })
    await new Promise((r) => setTimeout(r, wait + 1_000))
    started = await asPhone(origin, 'POST', '/auth/phone/start', undefined, { phone: p.phone })
  }
  if (started.status !== 200) throw new Error(`the phone's code was refused ${started.status}: ${JSON.stringify(started.body)}`)
  const code = started.body.sandbox_code
  if (typeof code !== 'string' || code === '') throw new CannotTest('this server sends real texts, so the phone is given no Sandbox code to read')
  const finished = await asPhone(origin, 'POST', '/auth/phone/finish', undefined, { phone: p.phone, code })
  if (finished.status !== 200 || typeof finished.body.check !== 'string') throw new Error(`the phone's code was refused at finish ${finished.status}: ${JSON.stringify(finished.body)}`)
  const signed = await asPhone(origin, 'POST', '/auth/phone/signin', undefined, { check: finished.body.check, passcode: p.passcode })
  if (signed.status !== 200 || typeof signed.body.token !== 'string') throw new Error(`the phone's sign-in with the passcode was refused ${signed.status}: ${JSON.stringify(signed.body)}`)
  return signed.body.token
}

function doorJoin(run: DoorRun): Scenario {
  return {
    id: 'door-join',
    owner: 'talyvor-suite',
    feature: 'Session and sign-in',
    items: ['B61.25', 'B61.26', 'B61.28'],
    title: 'a new test number joins at the door: the code read from the screen under the Sandbox label, a passcode chosen twice, ' +
      "sign-up's two steps, and the session is on the account it opened; nothing signs in through Google",
    run: async (ctx) => {
      const door = await openDoor(ctx)
      try {
        const page = door.page
        let phone = ''
        for (const candidate of doorPhones(RUN_SALT)) {
          if (!(await codeFromScreen(ctx, page, candidate)).hasPerson) {
            phone = candidate
            break
          }
          ctx.evidence.push({ note: `${candidate} joined on a night before; the next test number is tried` })
          await page.goto(`${door.origin}/signin`, { waitUntil: 'domcontentloaded' })
        }
        if (phone === '') {
          run.noPerson = 'both test numbers it tried had joined before'
          throw new CannotTest(`both test numbers this run tried (${doorPhones(RUN_SALT).join(', ')}) joined on a night before`)
        }
        const passcode = passcodeFor(phone)
        await typeDigits(page, 'Passcode', passcode)
        await page.getByRole('heading', { name: WORDS.againTitle }).waitFor({ timeout: STEP_MS })
        const [joined] = await Promise.all([posted(page, '/auth/phone/join'), typeDigits(page, 'Passcode', passcode)])
        const joinBody = await bodyOf(joined)
        ctx.evidence.push({ note: `POST /auth/phone/join: ${joined.status()} ${JSON.stringify({ ...joinBody, token: undefined })}` })
        if (joined.status() !== 200 || joinBody.signup_unfinished !== true) {
          run.noPerson = `the join answered ${joined.status()}`
          return fail(`joining ${phone} with a new passcode was answered ${joined.status()} ${JSON.stringify(joinBody)}, not a sign-up session`)
        }
        await page.waitForURL((u) => u.pathname === '/signup', { timeout: STEP_MS })

        // Sign-up's two steps, on the screen: who it is for, then the kind of money.
        const name = `Door tester ${RUN_SALT}`
        const pick = (name: string, value: string) => page.locator('label', { has: page.locator(`input[name="${name}"][value="${value}"]`) }).click({ timeout: STEP_MS })
        await pick('account_type', 'personal')
        await page.getByLabel('Your name').fill(name)
        await page.getByLabel('Country').selectOption('GB')
        await page.getByRole('button', { name: 'Continue' }).click()
        await pick('money_kind', 'fiat')
        const [opened] = await Promise.all([posted(page, '/auth/signup/account'), page.getByRole('button', { name: 'Continue' }).click()])
        const openBody = await bodyOf(opened)
        ctx.evidence.push({ note: `POST /auth/signup/account: ${opened.status()} ${JSON.stringify(openBody)}` })
        const accountID = typeof openBody.account_id === 'string' ? openBody.account_id : ''
        if (opened.status() !== 200 || accountID === '') {
          run.noPerson = `sign-up's account answered ${opened.status()}`
          return fail(`sign-up's account for ${phone} was answered ${opened.status()} ${JSON.stringify(openBody)}`)
        }
        const me = await whoAmI(page)
        ctx.evidence.push({ note: `after sign-up, /auth/me: ${JSON.stringify(me)}` })
        run.person = { phone, passcode, accountID }
        const wrong: string[] = []
        if (!me.authenticated || me.workspace_id !== accountID) wrong.push(`after sign-up the session is on ${me.workspace_id ?? 'nothing'}, not the account it opened (${accountID})`)
        if (me.signup_unfinished === true) wrong.push('after sign-up the session still says sign-up is unfinished')
        if (await page.getByRole('link', { name: 'Continue with Google' }).count() > 0) wrong.push('sign-up still offers Continue with Google')
        return verdictOf(wrong, `${phone} joined: the Sandbox code from the screen, a passcode chosen twice, and sign-up opened ${accountID}, the session's account`)
      } catch (e) {
        run.noPerson ??= e instanceof Error ? e.message.split('\n')[0] : String(e)
        throw e
      } finally {
        await door.close()
      }
    },
  }
}

function doorPasscode(run: DoorRun): Scenario {
  return {
    id: 'door-passcode',
    owner: 'talyvor-suite',
    feature: 'Session and sign-in',
    items: ['B61.25', 'B61.26', 'B61.28'],
    title: 'the number again, the code read from the screen and the passcode sign in on the account it opened; ' +
      '"Sign in faster next time" makes a passkey on the browser, and the BFF keeps it',
    run: async (ctx) => {
      const p = personOf(run)
      const door = await openDoor(ctx)
      try {
        const page = door.page
        const { hasPerson } = await codeFromScreen(ctx, page, p.phone)
        if (!hasPerson) return fail(`after joining, ${p.phone}'s code led to "${WORDS.chooseTitle}", as if it had no account`)
        const [signed] = await Promise.all([posted(page, '/auth/phone/signin'), typeDigits(page, 'Passcode', p.passcode)])
        const said = await bodyOf(signed)
        if (signed.status() !== 200) return fail(`the right passcode for ${p.phone} was refused ${signed.status()}: ${JSON.stringify(said)}`)
        const wrong: string[] = []
        const me = await whoAmI(page)
        if (!me.authenticated || me.workspace_id !== p.accountID) wrong.push(`signed in with the passcode, the session is on ${me.workspace_id ?? 'nothing'}, not ${p.accountID}`)
        await page.getByRole('heading', { name: WORDS.fasterTitle }).waitFor({ timeout: STEP_MS })
        const [made] = await Promise.all([posted(page, '/auth/passkey/register'), page.getByRole('button', { name: WORDS.makePasskey }).click()])
        ctx.evidence.push({ note: `POST /auth/passkey/register: ${made.status()}` })
        if (made.status() !== 201) {
          run.noKey = `the BFF answered ${made.status()} to the passkey`
          wrong.push(`the passkey made on "${WORDS.fasterTitle}" was answered ${made.status()} ${JSON.stringify(await bodyOf(made))}, not 201`)
        } else {
          const { credentials } = await door.cdp.send('WebAuthn.getCredentials', { authenticatorId: door.authenticatorId })
          if (credentials.length !== 1) wrong.push(`the browser's authenticator holds ${credentials.length} passkeys after one was made`)
          else run.key = credentials[0]
          await page.waitForURL((u) => u.pathname !== '/signin', { timeout: STEP_MS }).catch(() => wrong.push('after the passkey was kept the browser is still at the door'))
        }
        return verdictOf(wrong, `${p.phone} signed in with the code from the screen and the passcode on ${p.accountID}, and a passkey was made and kept`)
      } finally {
        run.noKey ??= run.key === undefined ? 'door-passcode made none' : undefined
        await door.close()
      }
    },
  }
}

function doorPasskey(run: DoorRun): Scenario {
  return {
    id: 'door-passkey',
    owner: 'talyvor-suite',
    feature: 'Session and sign-in',
    items: ['B61.25', 'B61.26', 'B61.28'],
    title: 'a browser holding only the passkey made at the passcode sign-in, nothing typed: "Sign in with a passkey" signs in on the account',
    run: async (ctx) => {
      const p = personOf(run)
      if (run.key === undefined) throw new CannotTest(`door-passcode left no passkey this run: ${run.noKey ?? 'it did not run'}`)
      const door = await openDoor(ctx, run.key)
      try {
        const page = door.page
        const before = await whoAmI(page)
        if (before.authenticated) return fail('a fresh browser is signed in before the passkey is used')
        const [finished] = await Promise.all([posted(page, '/auth/passkey/finish'), page.getByRole('button', { name: WORDS.passkey }).click({ timeout: STEP_MS })])
        const said = await bodyOf(finished)
        ctx.evidence.push({ note: `POST /auth/passkey/finish: ${finished.status()} ${JSON.stringify(said)}` })
        if (finished.status() !== 200) return fail(`the passkey sign-in was refused ${finished.status()}: ${JSON.stringify(said)}`)
        const me = await whoAmI(page)
        return verdictOf(!me.authenticated || me.workspace_id !== p.accountID ? [`signed in with the passkey, the session is on ${me.workspace_id ?? 'nothing'}, not ${p.accountID}`] : [],
          `the passkey alone signed ${p.phone} in on ${p.accountID}, with no number and no passcode typed`)
      } finally {
        await door.close()
      }
    },
  }
}

function doorWrongPasscode(run: DoorRun): Scenario {
  return {
    id: 'door-wrong-passcode',
    owner: 'talyvor-suite',
    feature: 'Session and sign-in',
    items: ['B61.23', 'B61.25', 'B61.26', 'B61.28'],
    title: `a wrong passcode at the door is refused in Lens's words ("${WRONG_PASSCODE}") and signs nobody in; the right one straight after, on the same code, signs in`,
    run: async (ctx) => {
      const p = personOf(run)
      const door = await openDoor(ctx)
      try {
        const page = door.page
        const { hasPerson } = await codeFromScreen(ctx, page, p.phone)
        if (!hasPerson) return fail(`${p.phone}'s code led to "${WORDS.chooseTitle}", as if it had no account`)
        const wrong: string[] = []
        const [refused] = await Promise.all([posted(page, '/auth/phone/signin'), typeDigits(page, 'Passcode', wrongPasscode(p.phone, p.passcode))])
        const said = await bodyOf(refused)
        ctx.evidence.push({ note: `a wrong passcode: ${refused.status()} ${JSON.stringify(said)}` })
        if (refused.status() !== 400 || said.reason !== 'wrong_passcode') wrong.push(`a wrong passcode was answered ${refused.status()} ${JSON.stringify(said)}, not 400 wrong_passcode`)
        const shown = await page.getByRole('alert').filter({ hasText: WRONG_PASSCODE }).waitFor({ timeout: STEP_MS }).then(() => true, () => false)
        if (!shown) wrong.push(`the screen does not say "${WRONG_PASSCODE}"`)
        if ((await whoAmI(page)).authenticated) wrong.push('a wrong passcode signed the browser in')
        const [signed] = await Promise.all([posted(page, '/auth/phone/signin'), typeDigits(page, 'Passcode', p.passcode)])
        if (signed.status() !== 200) wrong.push(`the right passcode after a wrong one was refused ${signed.status()}: ${JSON.stringify(await bodyOf(signed))}`)
        else {
          const me = await whoAmI(page)
          if (!me.authenticated || me.workspace_id !== p.accountID) wrong.push(`after the right passcode the session is on ${me.workspace_id ?? 'nothing'}, not ${p.accountID}`)
        }
        return verdictOf(wrong, `a wrong passcode was refused with "${WRONG_PASSCODE}" and signed nobody in; the right one on the same code signed in on ${p.accountID}`)
      } finally {
        await door.close()
      }
    },
  }
}

function doorPhoneLock(run: DoorRun): Scenario {
  return {
    id: 'door-phone-lock',
    owner: 'talyvor-suite',
    feature: 'Session and sign-in',
    items: ['B61.25', 'B61.28'],
    title: "the phone's sign-in through the BFF, with no Origin: a Bearer session reads; closed, it answers 423 on every route but unlock; " +
      'a wrong passcode leaves it locked and the right one opens it',
    run: async (ctx) => {
      const p = personOf(run)
      const origin = new URL(ctx.app.page.url()).origin
      const token = await phoneSignIn(ctx, origin, p)
      run.phoneToken = token
      const wrong: string[] = []
      const seen: string[] = []
      const step = async (what: string, method: string, path: string, want: number, body?: unknown) => {
        const r = await asPhone(origin, method, path, token, body)
        seen.push(`${what} ${r.status}`)
        if (r.status !== want) wrong.push(`${what} was answered ${r.status} ${JSON.stringify(r.body)}, not ${want}`)
        return r
      }
      await step('reading the agents', 'GET', '/api/agents', 200)
      await step('the app closing', 'POST', '/auth/lock', 204, { state: 'closed' })
      const locked = await step('reading the agents, locked', 'GET', '/api/agents', 423)
      if (locked.status === 423 && locked.body.reason !== 'locked') wrong.push(`the lock's 423 gives the reason ${String(locked.body.reason)}, not locked`)
      await step('who am I, locked', 'GET', '/auth/me', 423)
      await step('a wrong passcode at the lock', 'POST', '/auth/unlock', 400, { passcode: wrongPasscode(p.phone, p.passcode) })
      await step('reading the agents after it', 'GET', '/api/agents', 423)
      await step('the right passcode at the lock', 'POST', '/auth/unlock', 204, { passcode: p.passcode })
      await step('reading the agents, open', 'GET', '/api/agents', 200)
      ctx.evidence.push({ note: `the phone's session: ${seen.join(', ')}` })
      return verdictOf(wrong, `the phone signed in through the BFF and read; closed, it was 423 until the right passcode opened it (${seen.join(', ')})`)
    },
  }
}

function doorWait(run: DoorRun): Scenario {
  return {
    id: 'door-wait',
    owner: 'talyvor-lens',
    feature: 'Session and sign-in',
    items: ['B61.23', 'B61.25', 'B61.28'],
    title: 'five wrong passcodes at the phone\'s lock and Lens makes every try wait 15 minutes, the right passcode included, and the session stays locked',
    run: async (ctx) => {
      const p = personOf(run)
      const origin = new URL(ctx.app.page.url()).origin
      const token = run.phoneToken ?? await phoneSignIn(ctx, origin, p)
      const wrong: string[] = []
      const seen: string[] = []
      const closed = await asPhone(origin, 'POST', '/auth/lock', token, { state: 'closed' })
      if (closed.status !== 204) return fail(`closing the phone's session was answered ${closed.status} ${JSON.stringify(closed.body)}`)
      const bad = wrongPasscode(p.phone, p.passcode)
      let waitAt = Number.NaN
      for (let n = 1; n <= 5; n++) {
        const r = await asPhone(origin, 'POST', '/auth/unlock', token, { passcode: bad })
        seen.push(`wrong ${n}: ${r.status} ${String(r.body.reason)}`)
        const want = n < 5 ? 400 : 429
        if (r.status !== want) wrong.push(`wrong passcode ${n} at the lock was answered ${r.status} ${JSON.stringify(r.body)}, not ${want}`)
        if (n === 5) waitAt = typeof r.body.retry_at === 'string' ? Date.parse(r.body.retry_at) : Number.NaN
      }
      const right = await asPhone(origin, 'POST', '/auth/unlock', token, { passcode: p.passcode })
      seen.push(`the right passcode: ${right.status} ${String(right.body.reason)}`)
      if (right.status !== 429 || right.body.reason !== 'passcode_wait') wrong.push(`the right passcode during the wait was answered ${right.status} ${JSON.stringify(right.body)}, not 429 passcode_wait`)
      const ahead = waitAt - Date.now()
      if (!(ahead > WAIT_MS - 2 * 60_000 && ahead <= WAIT_MS + 60_000)) wrong.push(`Lens's wait ends ${Number.isFinite(ahead) ? `${Math.round(ahead / 60_000)} minutes` : 'at no time it gave'} from now, not 15`)
      const still = await asPhone(origin, 'GET', '/api/agents', token)
      seen.push(`reading the agents: ${still.status}`)
      if (still.status !== 423) wrong.push(`during the wait the session reads: ${still.status}`)
      await asPhone(origin, 'POST', '/auth/logout', token)
      ctx.evidence.push({ note: `at the lock: ${seen.join('; ')}` })
      return verdictOf(wrong, `after five wrong passcodes every try at the lock waits about 15 minutes, the right one too, and the session stayed locked (${seen.join('; ')})`)
    },
  }
}

/** The door's scenarios, once a run, in the order they build on each other. */
export function doorScenarios(): Scenario[] {
  const run: DoorRun = {}
  return [doorJoin(run), doorPasscode(run), doorPasskey(run), doorWrongPasscode(run), doorPhoneLock(run), doorWait(run)]
}

/** The ids, for the launch list (launch.ts). */
export const DOOR_SCENARIOS = ['door-join', 'door-passcode', 'door-passkey', 'door-wrong-passcode', 'door-phone-lock', 'door-wait'] as const
