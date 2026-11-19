// B30.116 — the Verification screen (/settings/verification), once a run, in the browser, on a workspace of its own so
// it starts at L0 every night.
//
// B17.486 — the screen is sign-up's step 4 now, "Confirm who you are" (B61.20, laid out as Pocket's w-verification by
// B57.173): one form, no "Reach L1" or "Reach L2" headings and no level in letters. The workspace is a Business, so the
// owner saves its company details with itself as director, then fills the one form and presses "Confirm who I am", which
// runs the checks in order on the Test provider: email and phone (L1), who you are (L2), the company (L3). The screen must
// then say the account is confirmed, mark each check passed in Sandbox, list the three on the record newest first, each
// with its reference for support, and under "What live money needs" show L0 reached for live money and every level above
// it reached in Sandbox only, since a Test pass does not count for live money; payments_out sits under L2 and b2b_credit
// under L3. No disclaimer line (B49.2). Screenshots at 1440 and 390.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { DISCLAIMER, fail } from './bank.ts'
import type { Scenario } from './scenarios.ts'
import { LEVELS_NEEDED } from './verification.ts'

const TIMEOUT_MS = 20_000

/** The screen's words (apps/web signupWords.ts IDENTITY_WORDS, Verification.tsx). */
const WORDS = {
  confirm: 'Confirm who I am',
  done: 'You’re confirmed. Your account is open.',
  passedSandbox: 'Passed in Sandbox',
  reference: 'Reference for support',
  live: 'Reached for live money',
  sandbox: 'Reached in Sandbox',
} as const

/** The three checks a Business passes, as the screen names them, newest first. */
const CHECKS_NEWEST_FIRST = [
  { subject: 'company', level: 'L3', words: 'Your company' },
  { subject: 'person', level: 'L2', words: 'Who you are' },
  { subject: 'contact', level: 'L1', words: 'Email and phone' },
] as const

const OWNER = 'Nightly Screen Owner'

/** What the screen shows once the checks have run. */
export interface VerificationScreenRead {
  /** Each check's row in "The checks", by subject: contact, person, company. */
  steps: Record<string, string>
  /** "Every check on your record", top to bottom, each row's whole text (the reference behind its fold included). */
  checks: string[]
  /** "What live money needs", by level: the card's chip and the capabilities listed under it. */
  needs: Record<string, { state: string; capabilities: string[] }>
  /** The page's text, for a disclaimer line. */
  body: string
}

/** What is wrong with the screen after a Business passed every check on the Test provider: undefined when nothing. */
export function verificationScreenFaults(read: VerificationScreenRead): string | undefined {
  for (const c of CHECKS_NEWEST_FIRST) {
    const row = read.steps[c.subject]
    if (row === undefined) return `"The checks" has no row for ${c.words}`
    if (!row.includes(WORDS.passedSandbox)) return `"The checks" says "${row}" for ${c.words}, not "${WORDS.passedSandbox}"`
  }
  if (read.checks.length !== CHECKS_NEWEST_FIRST.length) {
    return `the record lists ${read.checks.length} checks, not the ${CHECKS_NEWEST_FIRST.length} that passed: ${read.checks.join(' | ')}`
  }
  for (const [i, c] of CHECKS_NEWEST_FIRST.entries()) {
    const row = read.checks[i]
    if (!row.startsWith(c.words)) return `check ${i + 1} on the record, newest first, is "${row}", not ${c.words} (${c.level})`
    if (!row.includes(WORDS.passedSandbox)) return `the ${c.level} check on the record is not marked "${WORDS.passedSandbox}": "${row}"`
    if (!new RegExp(`${WORDS.reference}\\s*\\S+`).test(row)) return `the ${c.level} check on the record shows no reference for support: "${row}"`
  }
  const levels = Object.keys(read.needs).sort()
  if (levels.length === 0) return 'the screen lists no level under "What live money needs"'
  for (const level of levels) {
    const { state } = read.needs[level]
    // Live money is judged by the live level, which counts only checks a real provider passed: L0 after Test checks.
    const want = level === 'L0' ? WORDS.live : WORDS.sandbox
    if (state !== want) {
      return level === 'L0'
        ? `the L0 card says "${state}", not "${want}": a signed-in owner reaches L0 for live money`
        : `the ${level} card says "${state}", not "${want}": a Test pass must not count for live money`
    }
  }
  for (const [key, want] of Object.entries(LEVELS_NEEDED)) {
    const at = levels.find((l) => read.needs[l].capabilities.includes(key))
    if (at === undefined) return `the screen lists ${key} under no level`
    if (at !== want) return `the screen lists ${key} under ${at}; its live money needs ${want}`
  }
  const onScreen = read.body.match(DISCLAIMER)
  if (onScreen) return `the Verification screen carries a disclaimer line: "${onScreen[0]}"`
  return undefined
}

/** Waits for `next`; on a refusal, what the screen said instead. */
async function reached(page: Page, next: Locator, what: string): Promise<string | undefined> {
  const refused = page.getByRole('alert')
  await next.or(refused).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
  if (await next.first().isVisible()) return undefined
  const said = (await refused.allTextContents()).join(' ').trim()
  return said === '' ? `the screen never showed ${what}` : `the screen said "${said}" instead of showing ${what}`
}

async function readScreen(page: Page): Promise<VerificationScreenRead> {
  const text = async (l: Locator) => ((await l.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const steps: Record<string, string> = {}
  for (const c of CHECKS_NEWEST_FIRST) {
    const row = page.getByTestId(`identity-${c.subject}`)
    if ((await row.count()) > 0) steps[c.subject] = await text(row.first())
  }
  const checks: string[] = []
  for (const row of await page.getByTestId('verification-check').all()) checks.push(await text(row))
  const needs: VerificationScreenRead['needs'] = {}
  for (const level of ['L0', 'L1', 'L2', 'L3']) {
    const card = page.getByTestId(`verification-needs-${level}`)
    if ((await card.count()) === 0) continue
    const state = (await card.first().locator('p').first().textContent().catch(() => '')) ?? ''
    const capabilities: string[] = []
    for (const row of await card.first().locator('[data-testid^="capability-level-"]').all()) {
      capabilities.push(((await row.getAttribute('data-testid')) ?? '').replace(/^capability-level-/, ''))
    }
    needs[level] = { state: state.trim(), capabilities }
  }
  return { steps, checks, needs, body: await page.locator('body').innerText() }
}

export function verificationScreen(): Scenario {
  return {
    id: 'verification-screen',
    owner: 'talyvor-suite',
    own: true,
    items: ['B30.116'],
    title: 'the Verification screen: a Business owner saves its company details and confirms who it is from the screen\'s form on the Test provider, ' +
      'and sees email and phone, who you are and the company each passed in Sandbox with its reference for support, L0 reached for live money ' +
      'and every level above it in Sandbox only, payments_out under L2 and b2b_credit under L3',
    run: async (ctx) => {
      const page = await ctx.app.tab('/settings/verification')
      try {
        await page.locator('main h1').filter({ hasText: 'Verification' }).waitFor({ timeout: TIMEOUT_MS })
        const confirm = page.getByRole('button', { name: WORDS.confirm, exact: true })
        const atL0 = await reached(page, confirm, `"${WORDS.confirm}"`)
        if (atL0 !== undefined) return fail(`a new workspace on the Verification screen: ${atL0}`)

        // The company check reads the saved company details, with the person checked among its directors.
        const company = page.getByRole('form', { name: 'Company details' })
        if ((await company.count()) === 0) return fail('a new Business workspace on the Verification screen: no "Company details" form for the company check')
        await company.getByLabel('Company name', { exact: true }).fill(`Nightly Screen Company ${ctx.app.user.workspaceID}`)
        await company.getByLabel('Registration number', { exact: true }).fill('00000000')
        await company.getByLabel('Country', { exact: true }).selectOption('GB')
        await company.getByRole('button', { name: 'Add a person', exact: true }).click()
        await company.getByLabel('Name', { exact: true }).last().fill(OWNER)
        await company.getByLabel('Share', { exact: true }).last().fill('100')
        const saving = page.waitForResponse((r) => r.url().includes('/api/workspace/business') && r.request().method() === 'PUT', { timeout: TIMEOUT_MS })
        await company.getByRole('button', { name: 'Save', exact: true }).click()
        const saved = await saving.catch(() => undefined)
        ctx.evidence.push({ note: `the company details saved from the screen: ${saved ? saved.status() : 'no answer'}` })
        if (!saved?.ok()) return fail(`saving the company details from the screen answered ${saved ? saved.status() : 'nothing'}`)

        await page.getByLabel('Email', { exact: true }).fill(`nightly-screen-${ctx.app.user.workspaceID}@example.com`)
        await page.getByLabel('Phone number', { exact: true }).fill('+447700900123')
        await page.getByLabel('Legal name', { exact: true }).fill(OWNER)
        await page.getByLabel('Date of birth', { exact: true }).fill('1990-04-12')
        await page.getByLabel('Address line 1', { exact: true }).fill('1 Nightly Street')
        await page.getByLabel('Town or city', { exact: true }).fill('London')
        await page.getByLabel('Postcode', { exact: true }).fill('SW1A 1AA')
        await page.getByLabel('Country you live in', { exact: true }).selectOption('GB')
        await confirm.click()
        const done = await reached(page, page.getByRole('status').filter({ hasText: WORDS.done }), `"${WORDS.done}"`)
        ctx.evidence.push({ note: `"${WORDS.confirm}" pressed: ${done ?? 'the account is confirmed'}` })
        if (done !== undefined) return fail(`after "${WORDS.confirm}": ${done}`)

        // The record and the capability levels are read again once the checks have run.
        await page.getByTestId('verification-check').nth(CHECKS_NEWEST_FIRST.length - 1).waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        const read = await readScreen(page)
        ctx.evidence.push({ note: `the checks listed: ${read.checks.join(' | ')}` })
        ctx.evidence.push({ note: `what live money needs: ${Object.entries(read.needs).map(([l, n]) => `${l} ${n.state} (${n.capabilities.join(', ')})`).join('; ')}` })
        const fault = verificationScreenFaults(read)
        if (fault !== undefined) return fail(fault)

        const { outDir } = ctx.env
        await mkdir(outDir, { recursive: true })
        const wide = join(outDir, `verification-1440px-user${ctx.app.user.index}.png`)
        const narrow = join(outDir, `verification-390px-user${ctx.app.user.index}.png`)
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.screenshot({ path: wide, fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.screenshot({ path: narrow, fullPage: true })
        ctx.evidence.push({ note: `the Verification screen confirmed, at 1440px: ${wide}; at 390px: ${narrow}` })
        return {
          pass: true,
          detail: 'from the screen\'s forms: company details saved, then email and phone, who you are and the company each passed in Sandbox ' +
            'with its reference for support; L0 reached for live money and every level above it in Sandbox only; no disclaimer line; ' +
            'payments_out under L2 and b2b_credit under L3',
        }
      } finally {
        await page.close()
      }
    },
  }
}
