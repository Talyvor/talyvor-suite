// B57.87 — Pocket's journeys on the phone, end to end. talyvor-mobile's web export, built once a run from the checkout
// E2E_MOBILE_SRC names (packages installed) as a development build with its software test key (EXPO_PUBLIC_TALYVOR_TEST_KEYS=1,
// B57.130), is driven at 390x844, signed in with the BFF's synthetic phone session (POST /auth/synthetic/mobile, B57.86).
// Every request it sends to its BFF is sent on to the real one through Playwright's route.fetch, with no Origin, as a phone
// sends it, so no CORS change is needed. Its keychain is phone/keychain.cjs, the tab's sessionStorage (phone/metro.config.cjs).
// Four journeys, each on a workspace of its own:
//   phone-approve        — the phone's key turned on in Approvals; an agent's payment above its approval amount files an
//                          approval; opened at the Live Activity's link (talyvor://approvals/<id>), Approve with Face ID signs
//                          it with the phone's key, and Lens holds it approved.
//   phone-pay-payee      — a saved payee paid £12.50 from the company GBP account: Pay opens the confirm step, nothing is
//                          sent until Pay with Face ID, and the payment goes signed by the phone's key; Lens lists it once
//                          and the account holds £12.50 less.
//   phone-widget-pause   — the widget's pause link (talyvor://widget?do=pause&agent=…&t=<the widget's token>) pauses the
//                          agent and lands on its page; Resume with Face ID there resumes it, signed. Lens holds each.
//   phone-stop-everything — Home's Pause every agent, then Pause every agent on its sheet: Lens holds every agent paused.
// Signing needs Lens to take the test key (LENS_DEVICE_TEST_ATTESTATION=true): on the Mac's local stack every step runs;
// where Lens refuses it (production) each journey runs as far as it can and then SKIPs, naming the steps it could not.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

export const PHONE_SIZE = { width: 390, height: 844 }
/** The BFF the export is built against: never reached, every request to it is sent on to the run's BFF. */
const PHONE_BFF = 'https://bff.phone.invalid'
const KEYCHAIN = 'talyvor.e2e-keychain.'
const HERE = dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 30_000
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }
/** Lens's refusal of a "test" platform key (B40.28), and what a journey says when it meets it. */
export const TEST_KEY_REFUSED = /test device keys are not accepted/
const NEEDS_TEST_KEYS = 'it needs LENS_DEVICE_TEST_ATTESTATION=true in lens.env'

/** One request the phone sent to its BFF, as the BFF answered it. */
export interface Sent {
  method: string
  path: string
  body: string
  status: number
  answer: string
}

/** The phone app, open on one page of its own, and what it has sent. */
export interface Phone {
  page: Page
  sent: Sent[]
  /** A value the app keeps in its keychain, or null. */
  keychain: (key: string) => Promise<string | null>
  open: (path: string) => Promise<void>
  close: () => Promise<void>
}

let exported: { src: string; dir: Promise<string> } | undefined

/** The web export of the checkout at `src`, built once a run into `outDir`. */
export function phoneExport(src: string, outDir: string): Promise<string> {
  if (exported?.src === src) return exported.dir
  const dir = join(outDir, 'phone-export')
  const done = new Promise<string>((ok, no) => {
    const child = spawn('npx', ['expo', 'export', '--platform', 'web', '--dev', '--output-dir', dir, '--clear'], {
      cwd: src,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        E2E_PHONE_ROOT: src,
        EXPO_OVERRIDE_METRO_CONFIG: resolve(HERE, '../phone/metro.config.cjs'),
        EXPO_PUBLIC_TALYVOR_TEST_KEYS: '1',
        EXPO_PUBLIC_BFF_URL: PHONE_BFF,
        // A development export names every route's chunk alike, so they would overwrite each other: one bundle.
        EXPO_NO_BUNDLE_SPLITTING: '1',
        CI: '1',
      },
    })
    let log = ''
    child.stdout.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4000) })
    child.stderr.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4000) })
    child.on('error', no)
    child.on('exit', (code) => (code === 0 ? ok(dir) : no(new Error(`exporting the phone app for the web exited ${code}: ${log.slice(-1500)}`))))
  })
  exported = { src, dir: done }
  return done
}

function serve(dir: string): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      let file = join(dir, path)
      if (!file.startsWith(dir) || !extname(file) || !existsSync(file)) file = existsSync(join(dir, `${path}.html`)) ? join(dir, `${path}.html`) : join(dir, 'index.html')
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(await readFile(file))
    })().catch(() => res.writeHead(500).end())
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

/** The phone app signed in to the scenario's workspace, at 390x844, its BFF the run's. */
export async function openPhone(ctx: ScenarioCtx): Promise<Phone> {
  const src = process.env.E2E_MOBILE_SRC ?? ''
  if (src === '') throw new CannotTest('no phone app to drive: set E2E_MOBILE_SRC to a talyvor-mobile checkout with its packages installed (npm ci)')
  if (!existsSync(join(src, 'node_modules', 'expo'))) throw new CannotTest(`${src} has no packages installed: run npm ci in it`)
  const browser = ctx.app.context.browser()
  if (browser === null) throw new Error('the run has no browser to open the phone app in')
  const app = new URL(ctx.app.page.url()).origin
  const u = ctx.app.user
  const signIn = await fetch(`${app}/auth/synthetic/mobile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Talyvor-Synthetic-Key': process.env.LENS_SYNTHETIC_KEY ?? '' },
    body: JSON.stringify({ workspace_id: u.workspaceID, token: u.token, expires_at: u.expiresAt }),
  })
  const session = await signIn.text()
  ctx.evidence.push({ note: 'the phone signs in: POST /auth/synthetic/mobile', answer: `${signIn.status}` })
  if (signIn.status === 404) throw new CannotTest('this BFF has no synthetic phone sign-in (POST /auth/synthetic/mobile, B57.86)')
  if (signIn.status !== 200) throw new Error(`POST /auth/synthetic/mobile answered ${signIn.status}`)
  const server = await serve(await phoneExport(src, ctx.env.outDir))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const context: BrowserContext = await browser.newContext({ viewport: PHONE_SIZE, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const sent: Sent[] = []
  await context.route(`${PHONE_BFF}/**`, async (route) => {
    const r = route.request()
    const url = new URL(r.url())
    const headers = { ...r.headers() }
    delete headers.origin
    delete headers.referer
    try {
      const got = await route.fetch({ url: app + url.pathname + url.search, headers })
      const answer = await got.text()
      sent.push({ method: r.method(), path: url.pathname, body: r.postData() ?? '', status: got.status(), answer: answer.slice(0, 600) })
      await route.fulfill({ response: got, body: answer, headers: { ...got.headers(), 'access-control-allow-origin': '*' } })
    } catch {
      // the phone was closed with this request still on its way
    }
  })
  await context.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value)
  }, { key: `${KEYCHAIN}talyvor.session`, value: session })
  const page = await context.newPage()
  page.setDefaultTimeout(TIMEOUT_MS)
  return {
    page,
    sent,
    keychain: (key) => page.evaluate((k) => sessionStorage.getItem(k), KEYCHAIN + key),
    open: async (path) => {
      await page.goto(base + path)
    },
    close: async () => {
      await context.close().catch(() => undefined)
      server.close()
    },
  }
}

/** The phone's own steps, in words, for the evidence: what it sent and what the BFF answered. */
export const sentWords = (sent: Sent[]): string => sent.filter((s) => s.method !== 'GET').map((s) => `${s.method} ${s.path} ${s.status}`).join(', ') || 'nothing but reads'

/** B55.4 — Approvals' Turn on: this phone's key, registered as platform "test". Its device id, or why Lens refused it. */
export async function turnOnPhoneKey(phone: Phone): Promise<{ device?: string; refused?: string }> {
  await phone.open('/approvals')
  await phone.page.getByRole('button', { name: 'Turn on', exact: true }).click()
  // The workspace's first key answers its recovery code, shown once.
  const saved = phone.page.getByRole('button', { name: 'I saved it' })
  const until = Date.now() + TIMEOUT_MS
  while (Date.now() < until) {
    const reg = phone.sent.find((s) => s.method === 'POST' && s.path === '/api/money/devices')
    if (reg !== undefined && reg.status >= 300) return { refused: `${reg.status} ${reg.answer}` }
    if (await saved.isVisible().catch(() => false)) await saved.click()
    const device = await phone.keychain('talyvor.device-key')
    if (device !== null) return { device }
    await phone.page.waitForTimeout(250)
  }
  return { refused: `no key after ${TIMEOUT_MS / 1000}s; the phone sent ${sentWords(phone.sent)}` }
}

/** The key's refusal, as a journey's SKIP or its FAIL: Lens refusing the "test" platform is a SKIP, never a pass. */
function keyRefused(refused: string, ran: string[], skipped: string): never | Verdict {
  if (TEST_KEY_REFUSED.test(refused)) {
    throw new CannotTest(`${ran.length ? `ran: ${ran.join('; ')}. ` : ''}SKIPPED: ${skipped}, as Lens refuses the phone's test key (${refused.slice(0, 160)}) — ${NEEDS_TEST_KEYS}`)
  }
  return fail(`turning on this phone's key failed: ${refused}`)
}

/** The body the phone sent, read as JSON. */
const bodyOf = (s: Sent | undefined): Record<string, unknown> => {
  try {
    return s === undefined ? {} : (JSON.parse(s.body) as Record<string, unknown>)
  } catch {
    return {}
  }
}
const signedBy = (s: Sent | undefined): string => ((bodyOf(s).assertion as { device_id?: string } | undefined)?.device_id ?? '')

/** An agent with an approval amount, and a key to spend as it; the owner's book has room to fund it. */
async function agentWithApprovals(ctx: ScenarioCtx, name: string) {
  const { lens } = ctx.env
  const user = ctx.app.user
  const payer = await lens.createAgent(user, name)
  const payee = await lens.createAgent(user, `${name} payee`)
  const book = await lens.agentBook(user)
  if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
  await lens.fundAgent(user, payer.id, FUND_ULXC)
  const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'phone-approve' })
  if (!k.ok) throw new Error(`issuing ${payer.name} a key was refused: ${k.status} ${k.error}`)
  const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
  if (!rules.ok) throw new Error(`saving ${payer.name}'s approval amount was refused: ${rules.status} ${rules.error}`)
  return { payer, payee, key: k.value.key }
}

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000
const ASK_ULXC = 200_000

/** phone-approve: what the phone sent and what Lens holds after. */
export interface ApproveSeen {
  /** the approval sheet's Approve button was pressed */
  pressed: boolean
  /** the phone's approve, as the BFF answered it */
  approve?: Sent
  device: string
  /** the approval's status on Lens afterwards */
  status: string
}

export function phoneApproveVerdict(seen: ApproveSeen): Verdict {
  const wrong: string[] = []
  if (!seen.pressed) wrong.push('the approval opened at its Live Activity link showed no Approve with Face ID')
  if (seen.approve === undefined) wrong.push('the phone sent no approve')
  else {
    if (seen.approve.status !== 200) wrong.push(`the phone's approve answered ${seen.approve.status} ${seen.approve.answer.slice(0, 160)}`)
    if (signedBy(seen.approve) !== seen.device) wrong.push(`the approve was signed by "${signedBy(seen.approve)}", not this phone's key ${seen.device}`)
  }
  if (seen.status !== 'approved') wrong.push(`the approval is ${seen.status || 'missing'} on Lens, not approved`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `opened at its Live Activity link, Approve with Face ID sent the approval signed by this phone's key ${seen.device}, and Lens holds it approved` }
}

export function phoneApprove(): Scenario {
  return {
    id: 'phone-approve',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Approvals',
    items: ['B57.87'],
    title: "on the phone, an agent's approval opened at its Live Activity's link is approved with Face ID, signed by the phone's key: Lens holds it approved",
    run: async (ctx) => {
      const phone = await openPhone(ctx)
      try {
        const { lens } = ctx.env
        const user = ctx.app.user
        const ran: string[] = []
        const key = await turnOnPhoneKey(phone)
        ctx.evidence.push({ note: "Approvals' Turn on, on the phone", answer: key.device ?? key.refused ?? '' })
        const { payer, payee, key: agentKey } = await agentWithApprovals(ctx, `Phone payer ${RUN_SALT}`)
        const r = await lens.payAsAgent(agentKey, user.workspaceID, payer.id, payee.id, ASK_ULXC, `phone ${RUN_SALT}`)
        const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === ASK_ULXC && a.status === 'pending')?.id
        ctx.evidence.push({ note: `${payer.name} pays ${ASK_ULXC} µLXC, above its ${APPROVAL_ABOVE_ULXC} µLXC approval amount`, answer: r.ok ? 'paid' : `${r.status} ${r.error}; approval ${id}` })
        if (r.ok || id === undefined) return fail(`a ${ASK_ULXC} µLXC payment above the approval amount must be held and file a pending approval; Lens answered ${r.ok ? 'paid' : `${r.status} ${r.error}`}`)
        // The Live Activity's tap opens talyvor://approvals/<id>.
        await phone.open(`/approvals/${encodeURIComponent(id)}`)
        await phone.page.getByText(`${payer.name} is waiting for you`).first().waitFor()
        ran.push(`approval ${id} opened at its Live Activity link`)
        if (key.device === undefined) return keyRefused(key.refused ?? '', ran, 'Approve with Face ID')
        const button = phone.page.getByRole('button', { name: /^Approve with (Face ID|your fingerprint)$/ }).first()
        const pressed = await button.waitFor().then(() => true, () => false)
        if (pressed) {
          await button.click()
          await phone.page.waitForResponse((res) => res.url().endsWith(`/api/agents/approvals/${encodeURIComponent(id)}/approve`)).catch(() => undefined)
        }
        const approve = phone.sent.find((s) => s.method === 'POST' && s.path === `/api/agents/approvals/${id}/approve`)
        const status = (await lens.agentApprovals(user)).find((a) => a.id === id)?.status ?? ''
        ctx.evidence.push({ note: 'the phone approves with Face ID', answer: `${sentWords(phone.sent)}; Lens holds ${status}` })
        return phoneApproveVerdict({ pressed, approve, device: key.device, status })
      } finally {
        await phone.close()
      }
    },
  }
}

const PAY_MINOR = 1_250
const FUND_MINOR = 100_000
/** The phone's first-payment questions (talyvor-mobile components/pay-sheet.tsx, the web's SCAM_QUESTIONS). */
const FIRST_PAYMENT_QUESTIONS = ['Were you told to pay urgently?', 'Did the bank details arrive by email or chat?']

interface Account { id: string; currency: string; test_minor: number }
interface Payment { id: string; payee_id: string; amount_minor: number; status: string }

/** phone-pay-payee: what the phone showed and sent, and what Lens holds after. */
export interface PaySeen {
  /** Pay opened the confirm step, with Pay with Face ID on it */
  confirmStep: boolean
  /** payments the phone sent before Pay with Face ID was pressed */
  sentEarly: number
  /** the phone's payment, as the BFF answered it */
  payment?: Sent
  device: string
  /** the payments to the payee Lens lists afterwards */
  listed: Payment[]
  /** what the account held before and after */
  before: number
  after: number
}

export function phonePayVerdict(seen: PaySeen): Verdict {
  const wrong: string[] = []
  if (!seen.confirmStep) wrong.push('Pay opened no confirm step with Pay with Face ID')
  if (seen.sentEarly > 0) wrong.push(`the phone sent ${seen.sentEarly} payment(s) before Pay with Face ID was pressed`)
  if (seen.payment === undefined) wrong.push('the phone sent no payment')
  else {
    if (seen.payment.status !== 201 && seen.payment.status !== 200) wrong.push(`the phone's payment answered ${seen.payment.status} ${seen.payment.answer.slice(0, 160)}`)
    if (signedBy(seen.payment) !== seen.device) wrong.push(`the payment was signed by "${signedBy(seen.payment)}", not this phone's key ${seen.device}`)
  }
  const ours = seen.listed.filter((p) => p.amount_minor === PAY_MINOR)
  if (ours.length !== 1) wrong.push(`Lens lists ${ours.length} payments of ${PAY_MINOR} minor to the payee, not one`)
  if (seen.before - seen.after !== PAY_MINOR) wrong.push(`the account held ${seen.before} minor before and ${seen.after} after: it moved ${seen.before - seen.after}, not ${PAY_MINOR}`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `Pay opened the confirm step and sent nothing; Pay with Face ID sent £12.50 signed by this phone's key ${seen.device}; Lens lists it once (${ours[0]?.status}) and the account moved ${PAY_MINOR} minor` }
}

export function phonePayPayee(): Scenario {
  return {
    id: 'phone-pay-payee',
    owner: 'talyvor-suite',
    own: true,
    feature: 'Payees',
    items: ['B57.87'],
    title: "on the phone, a saved payee is paid £12.50: Pay opens the confirm step and sends nothing, Pay with Face ID sends it signed by the phone's key; Lens lists it once and the account holds £12.50 less",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const opened = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening the company GBP account answered ${said(opened)}`)
      const acct = opened.value.id
      const funded = await step('POST', `/v1/money/accounts/${acct}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: `e2e-phone-${RUN_SALT}-${acct}` }, 'GBP 1,000.00 in it')
      if (funded.status !== 201) return fail(`putting money in the company GBP account answered ${said(funded)}`)
      const name = `Nightly Phone Joinery ${RUN_SALT}`
      const saved = await step<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: '13572468' }, `the payee ${name}`)
      if (saved.status !== 201 || saved.value === undefined) return fail(`saving ${name} answered ${said(saved)}`)
      const payee = saved.value.id
      const ledger = async (note: string) => {
        const a = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the account ${note}`)
        const p = await step<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, `the payments ${note}`)
        return { holds: (a.value?.accounts ?? []).find((x) => x.id === acct)?.test_minor ?? -1, listed: (p.value?.payments ?? []).filter((x) => x.payee_id === payee) }
      }

      const phone = await openPhone(ctx)
      try {
        const ran: string[] = []
        const key = await turnOnPhoneKey(phone)
        ctx.evidence.push({ note: "Approvals' Turn on, on the phone", answer: key.device ?? key.refused ?? '' })
        const before = await ledger('before the phone pays')
        // The widget's payee row opens talyvor://payees/<id>.
        await phone.open(`/payees/${encodeURIComponent(payee)}`)
        await phone.page.getByLabel('Amount in GBP').fill('12.50')
        await phone.page.getByLabel('Reference').fill(`Phone ${RUN_SALT}`)
        await phone.page.getByRole('button', { name: 'Pay £12.50', exact: true }).click()
        const confirm = phone.page.getByRole('button', { name: /^Pay with (Face ID|your fingerprint)$/ }).first()
        // With no key on this phone, the confirm step offers to turn it on in its place.
        const step = key.device === undefined ? phone.page.getByRole('button', { name: 'Approvals on this phone', exact: true }) : confirm
        const confirmStep = await step.waitFor().then(() => true, () => false)
        const paid = () => phone.sent.filter((s) => s.method === 'POST' && s.path === '/api/money/payments')
        const sentEarly = paid().length
        ran.push(`Pay opened ${confirmStep ? 'the confirm step' : 'no confirm step'} and sent ${sentEarly} payment(s)`)
        if (key.device === undefined) {
          if (!confirmStep || sentEarly > 0) return fail(`with no key on this phone, ${ran[0]}: it must open the confirm step and send nothing`)
          return keyRefused(key.refused ?? '', ran, 'Pay with Face ID and the payment it signs')
        }
        if (confirmStep) {
          // The first payment to a payee asks two questions first: no to each.
          for (const q of FIRST_PAYMENT_QUESTIONS) await phone.page.getByRole('button', { name: `${q} No`, exact: true }).click()
          await confirm.click()
          await phone.page.waitForResponse((res) => res.url().endsWith('/api/money/payments') && res.request().method() === 'POST').catch(() => undefined)
        }
        const after = await ledger('after the phone paid')
        ctx.evidence.push({ note: 'the phone pays with Face ID', answer: sentWords(phone.sent) })
        return phonePayVerdict({ confirmStep, sentEarly, payment: paid()[0], device: key.device, listed: after.listed, before: before.holds, after: after.holds })
      } finally {
        await phone.close()
      }
    },
  }
}

/** phone-widget-pause: what the phone sent and what Lens holds after each step. */
export interface WidgetSeen {
  /** the widget's link token was in the keychain once Home had drawn */
  token: boolean
  /** the agent's paused_at on Lens after the widget's link, and after Resume */
  pausedAfterLink: boolean
  /** the widget's link landed on the agent's page */
  landed: boolean
  resume?: Sent
  device: string
  pausedAfterResume: boolean
}

export function phoneWidgetVerdict(seen: WidgetSeen): Verdict {
  const wrong: string[] = []
  if (!seen.token) wrong.push("Home kept no widget link token, so the widget's pause link cannot be made")
  if (!seen.pausedAfterLink) wrong.push("after the widget's pause link the agent is not paused on Lens")
  if (!seen.landed) wrong.push("the widget's pause link did not land on the agent's page")
  if (!seen.pausedAfterLink || !seen.landed) return fail(wrong.join('; '))
  if (seen.resume === undefined) wrong.push('the phone sent no resume')
  else {
    if (seen.resume.status !== 200) wrong.push(`the phone's resume answered ${seen.resume.status} ${seen.resume.answer.slice(0, 160)}`)
    if (signedBy(seen.resume) !== seen.device) wrong.push(`the resume was signed by "${signedBy(seen.resume)}", not this phone's key ${seen.device}`)
  }
  if (seen.pausedAfterResume) wrong.push('after Resume with Face ID the agent is still paused on Lens')
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `the widget's pause link paused the agent on Lens and landed on its page; Resume with Face ID sent the resume signed by this phone's key ${seen.device}, and Lens holds it active` }
}

export function phoneWidgetPause(): Scenario {
  return {
    id: 'phone-widget-pause',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B57.87'],
    title: "on the phone, the home-screen widget's pause link pauses an agent and lands on its page, and Resume with Face ID there resumes it, signed by the phone's key: Lens holds each",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Phone widget ${RUN_SALT}`)
      const paused = async () => (await lens.agentBook(user)).agents.find((a) => a.id === agent.id)?.paused_at !== undefined
      const phone = await openPhone(ctx)
      try {
        const ran: string[] = []
        const key = await turnOnPhoneKey(phone)
        ctx.evidence.push({ note: "Approvals' Turn on, on the phone", answer: key.device ?? key.refused ?? '' })
        // Home puts the agents on the widget, and keeps the token its links carry.
        await phone.open('/')
        await phone.page.getByText(agent.name).first().waitFor()
        let token: string | null = null
        for (let i = 0; i < 40 && token === null; i++) {
          token = await phone.keychain('talyvor.widget.token')
          if (token === null) await phone.page.waitForTimeout(250)
        }
        if (token === null) return phoneWidgetVerdict({ token: false, pausedAfterLink: false, landed: false, device: '', pausedAfterResume: true })
        await phone.open(`/widget?${new URLSearchParams({ do: 'pause', agent: agent.id, t: token })}`)
        const landed = await phone.page.waitForURL((u) => u.pathname === `/agents/${agent.id}`).then(() => true, () => false)
        const pausedAfterLink = await paused()
        ctx.evidence.push({ note: "the widget's pause link", answer: `${sentWords(phone.sent)}; landed ${landed}; Lens holds paused ${pausedAfterLink}` })
        ran.push(`the widget's pause link: Lens holds the agent paused ${pausedAfterLink}, landed on its page ${landed}`)
        if (!pausedAfterLink || !landed) return phoneWidgetVerdict({ token: true, pausedAfterLink, landed, device: key.device ?? '', pausedAfterResume: pausedAfterLink })
        if (key.device === undefined) return keyRefused(key.refused ?? '', ran, 'Resume with Face ID')
        await phone.page.getByRole('button', { name: /^Resume with (Face ID|your fingerprint)$/ }).first().click()
        // Its sheet asks once more before the phone signs.
        const sheet = phone.page.getByRole('button', { name: /^Resume with (Face ID|your fingerprint)$/ })
        if ((await sheet.count()) > 1) await sheet.last().click()
        await phone.page.waitForResponse((res) => res.url().endsWith(`/api/agents/${agent.id}/resume`)).catch(() => undefined)
        const resume = phone.sent.find((s) => s.method === 'POST' && s.path === `/api/agents/${agent.id}/resume`)
        const pausedAfterResume = await paused()
        ctx.evidence.push({ note: 'Resume with Face ID on the agent\'s page', answer: `${sentWords(phone.sent)}; Lens holds paused ${pausedAfterResume}` })
        return phoneWidgetVerdict({ token: true, pausedAfterLink, landed, resume, device: key.device, pausedAfterResume })
      } finally {
        await phone.close()
      }
    },
  }
}

/** phone-stop-everything: what the phone showed and what Lens holds after. */
export interface StopSeen {
  pauseAll?: Sent
  /** the sheet said every agent is paused */
  said: boolean
  allPausedAt?: string
  /** each agent's payment after, as Lens answered it */
  refused: number
  agents: number
}

export function phoneStopVerdict(seen: StopSeen): Verdict {
  const wrong: string[] = []
  if (seen.pauseAll === undefined) wrong.push('the phone sent no pause-all')
  else if (seen.pauseAll.status !== 200) wrong.push(`the phone's pause-all answered ${seen.pauseAll.status} ${seen.pauseAll.answer.slice(0, 160)}`)
  if (!seen.said) wrong.push('the sheet did not say "Every agent is paused"')
  if (seen.allPausedAt === undefined) wrong.push('Lens holds no all_paused_at for the workspace')
  if (seen.refused !== seen.agents) wrong.push(`${seen.agents - seen.refused} of ${seen.agents} agents could still pay`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `Home's Pause every agent and its sheet sent pause-all; the sheet said every agent is paused, Lens holds the workspace paused since ${seen.allPausedAt}, and all ${seen.agents} agents' payments were refused` }
}

export function phoneStopEverything(): Scenario {
  return {
    id: 'phone-stop-everything',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B57.87'],
    title: "on the phone, Home's Pause every agent and its sheet stop every agent: Lens holds the workspace paused, and each agent's payment is refused",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const one = await lens.createAgent(user, `Phone stop ${RUN_SALT}`)
      const two = await lens.createAgent(user, `Phone stop two ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < 2 * FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${2 * FUND_ULXC} µLXC its agents are funded`)
      const keys: string[] = []
      for (const a of [one, two]) {
        await lens.fundAgent(user, a.id, FUND_ULXC)
        const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${a.id}/keys`, { name: 'phone-stop-everything' })
        if (!k.ok) return fail(`issuing ${a.name} a key was refused: ${k.status} ${k.error}`)
        keys.push(k.value.key)
      }
      const phone = await openPhone(ctx)
      try {
        await phone.open('/')
        await phone.page.getByRole('link', { name: 'Pause every agent' }).click()
        await phone.page.getByRole('button', { name: 'Pause every agent', exact: true }).click()
        const said = await phone.page.getByText('Every agent is paused').first().waitFor().then(() => true, () => false)
        const pauseAll = phone.sent.find((s) => s.method === 'POST' && s.path === '/api/agents/pause-all')
        const allPausedAt = (await lens.agentBook(user)).all_paused_at
        let refused = 0
        for (const [i, a] of [one, two].entries()) {
          const r = await lens.payAsAgent(keys[i], user.workspaceID, a.id, (i === 0 ? two : one).id, 1_000, `phone stop ${RUN_SALT}`)
          if (!r.ok) refused++
          ctx.evidence.push({ note: `${a.name} pays after Pause every agent`, answer: r.ok ? 'paid' : `${r.status} ${r.error}` })
        }
        ctx.evidence.push({ note: 'Pause every agent, on the phone', answer: `${sentWords(phone.sent)}; Lens all_paused_at ${allPausedAt ?? 'none'}` })
        return phoneStopVerdict({ pauseAll, said, allPausedAt, refused, agents: 2 })
      } finally {
        await phone.close()
      }
    },
  }
}

/** The four, in the order the nightly plays them. */
export const phoneJourneys = (): Scenario[] => [phoneApprove(), phonePayPayee(), phoneWidgetPause(), phoneStopEverything()]
