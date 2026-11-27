// B32.71 — the seats gate, end to end. The owner of a synthetic workspace adds people on Members as a person
// does (apps/web/src/areas/lens/Members.tsx). The BFF adds them to the session's Track workspace (POST
// /api/members), and Track asks Lens, before each add, whether the plan of the Lens workspace the BFF names has
// a seat for one more (B32.70, B32.73). The oracles are what Track answered and its roster read back after,
// never the screen alone: a Studio workspace's second member is refused in Lens's own plain sentence (internal/plans
// RefuseCount, B55.29), "Studio allows 1 seat, and it is taken. Company allows 5.", and the roster still lists the
// owner alone; on Company the last seat it allows is filled and the next refused, naming the plan that allows more.
// B17.548 — since B57.44 Members draws no form once every seat is taken: it shows the seats and See plans, and the one more
// is sent to the BFF as the screen's own add sends it.
// B61.90 — each on a workspace made on its plan (talyvor-lens B61.57), and every seat count and plan name is Lens's
// own (GET /v1/public/plans).

import type { Locator, Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { PublicPlan } from './lens.ts'
import { allowingMore, businessStep } from './pricing.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

/** Lens's sentence for one member past what `plan` allows (internal/plans RefuseCount), from Lens's own figures. */
export function seatsRefusal(ladder: readonly PublicPlan[], plan: PublicPlan): { want: string; allows: string } {
  const limit = plan.people
  const allows = allowingMore(ladder, plan, (p) => p.people)
  const said = limit === 1 ? `${plan.name} allows 1 seat, and it is taken.` : `${plan.name} allows ${limit} seats, and all ${limit} are taken.`
  const more = allows === undefined ? ' A contract with Talyvor sets more.' : allows.people === -1 ? ` ${allows.name} allows unlimited seats.` : ` ${allows.name} allows ${allows.people}.`
  return { want: said + more, allows: allows?.id ?? '' }
}

/** Track's memberView, as GET /api/members relays it. */
interface Member { id: string; email: string; role: string }

/** Track's answer to an add, as the BFF relays it: the member on 201, else {error, code, plan, limit, allows}. */
interface AddAnswer { email?: string; error?: string; code?: string; plan?: string; limit?: number; allows?: string }

export interface Added { status: number; body: AddAnswer; shown: string; plansLink: boolean }

/** The roster, read back through the BFF as the Members screen reads it. */
async function roster(page: Page): Promise<Member[]> {
  const res = await page.request.get(new URL('/api/members', page.url()).toString())
  const text = await res.text()
  if (!res.ok()) throw new Error(`the roster could not be read: GET /api/members answered ${res.status()} ${text.slice(0, 200)}`)
  return (JSON.parse(text) as Member[] | null) ?? []
}

/** B57.44 — Members' Add a member dialog, opened as a person opens it. */
async function addDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add a member', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  // It reads the plan's seats first, and draws the form only while one is free.
  await dialog.getByText('Reading your plan’s seats…').waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS })
  return dialog
}

/** Adds `email` as a member on the Members screen: what Track answered, and what the screen says. */
async function addOnScreen(page: Page, email: string): Promise<Added> {
  const dialog = await addDialog(page)
  await dialog.getByLabel('Email', { exact: true }).fill(email)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/members', { timeout: ACTION_TIMEOUT_MS }),
    dialog.getByRole('button', { name: 'Add member', exact: true }).click(),
  ])
  const body = (await res.json().catch(() => ({}))) as AddAnswer
  const said = res.ok() ? page.getByRole('status').filter({ hasText: email }) : dialog.getByTestId('member-add-refusal')
  const shown = await said.first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => said.first().innerText(), () => '')
  const plansLink = !res.ok() && (await dialog.getByRole('link', { name: 'See plans' }).count()) > 0
  if (!res.ok()) await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  return { status: res.status(), body, shown: shown.trim(), plansLink }
}

/**
 * B17.548 — with every seat taken, Members' Add a member shows the plan's seats and See plans, and no form, so nothing is
 * sent (B57.44). Track's answer to one more is then read straight from the BFF, with the body the screen's own add sends
 * (apps/web/src/areas/lens/membersApi.ts).
 */
async function addPastTheSeats(page: Page, email: string): Promise<Added & { form: boolean }> {
  const dialog = await addDialog(page)
  const shown = ((await dialog.getByTestId('member-seats').innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')) ?? '').trim()
  const form = (await dialog.getByLabel('Email', { exact: true }).count()) > 0
  const plansLink = (await dialog.getByRole('link', { name: 'See plans' }).count()) > 0
  // B17.580 — the dialog's round x is named Close too (CloseX's aria-label); the one with the word is its action.
  const leave = form ? 'Cancel' : 'Close'
  await dialog.getByRole('button', { name: leave, exact: true }).filter({ hasText: leave }).click()
  const origin = new URL(page.url()).origin
  const res = await page.request.post(`${origin}/api/members`, { headers: { Origin: origin }, data: { email, role: 'member' } })
  const body = (await res.json().catch(() => ({}))) as AddAnswer
  return { status: res.status(), body, shown, plansLink, form }
}

/** Why Track's refusal of one member too many is not the plan's, in Lens's sentence `want`; undefined when it is. */
export function notThePlansRefusal(add: Added, plan: string, allows: string, want: string): string | undefined {
  if (add.status === 201) return `the member was added (201)`
  if (add.status !== 402) return `Track answered ${add.status} ${add.body.code ?? ''} "${add.body.error ?? ''}", not the plan's refusal (402)`
  if (add.body.error !== want) return `the refusal "${add.body.error}" is not Lens's "${want}"`
  if (add.body.plan !== plan || add.body.allows !== allows) return `the refusal reads plan "${add.body.plan}" allowing "${add.body.allows}", not ${plan} allowing ${allows}`
  if (!add.plansLink) return `Members shows "${add.shown}" with no link to /plans`
  return undefined
}

const newEmail = (seed: number, n: number): string => `seat-${seed}-${n}-${Date.now().toString(36)}@example.com`

/** Adds one member too many and checks the refusal and the roster after it; the verdict, or undefined when both hold. */
async function oneTooMany(page: Page, ctx: ScenarioCtx, email: string, before: Member[],
  plan: string, allows: string, want: string): Promise<Verdict | undefined> {
  const add = await addPastTheSeats(page, email)
  ctx.evidence.push({ note: `Add a member with ${before.length} on the roster: Members shows "${add.shown}"${add.form ? ' and the form' : ''}; ` +
    `Track answers ${email} with ${add.status}`, answer: JSON.stringify(add.body) })
  if (add.form) return fail(`on ${plan}, with ${before.length} on the roster, Members still offers the form to add one more; it reads "${add.shown}"`)
  const wrong = notThePlansRefusal(add, plan, allows, want)
  if (wrong !== undefined) return fail(`on ${plan}, adding member ${before.length + 1}: ${wrong}`)
  const after = await roster(page)
  ctx.evidence.push({ note: `the roster after: ${after.map((m) => `${m.email} (${m.role})`).join(', ')}` })
  if (after.length !== before.length || after.some((m) => m.email === email)) {
    return fail(`refused, yet the roster lists ${after.length} where it listed ${before.length}${after.some((m) => m.email === email) ? `, ${email} among them` : ''}`)
  }
  return undefined
}

export function seatsStudio(seed: number): Scenario {
  return {
    id: 'seats-studio',
    owner: 'talyvor-track',
    // B35.7 — Studio's own gate, on a workspace of its own: the users that run it are on paid plans for their others.
    plan: 'business_studio',
    own: true,
    title: "a Studio workspace's owner adds a member past the seats Lens states Studio allows on Members: Track refuses it in Lens's words, naming Studio and the plan that allows more, and the roster keeps what it had",
    feature: 'Members',
    run: async (ctx) => {
      const { ladder, step } = await businessStep(ctx, 'business_studio')
      if (step.people !== 1) throw new CannotTest(`Lens states ${step.name} allows ${step.people} people; this scenario adds the second member to a workspace of one`)
      const { want, allows } = seatsRefusal(ladder, step)
      const page = await ctx.app.tab('/members')
      try {
        const before = await roster(page)
        ctx.evidence.push({ note: `the roster before: ${before.map((m) => `${m.email} (${m.role})`).join(', ') || 'nobody'}` })
        if (before.length !== 1) throw new Error(`a new workspace's roster lists ${before.length} members; Track's bootstrap makes its owner the one`)
        const email = newEmail(seed, 2)
        const wrong = await oneTooMany(page, ctx, email, before, step.id, allows, want)
        return wrong ?? { pass: true, detail: `a second member on ${step.name} was shown on Members as its seats taken with See plans and no form, refused by Track in Lens's words, and the roster still lists its owner alone` }
      } finally {
        await page.close()
      }
    },
  }
}

/** On Company, made on it, the owner adds members until the roster holds the seats Lens states Company allows, each read back; the next is refused. */
export function seatsCompany(seed: number): Scenario {
  return {
    id: 'seats-company',
    owner: 'talyvor-track',
    // B35.7 — on a workspace of its own; B61.90 — made on Company itself.
    plan: 'business_company',
    own: true,
    title: "on Company the owner adds members on Members up to the seats Lens states Company allows, each read back on the roster; the next is refused in Lens's words, naming Company and the plan that allows more",
    feature: 'Members',
    run: async (ctx) => {
      const { ladder, step } = await businessStep(ctx, 'business_company')
      if (step.people === -1) throw new CannotTest(`Lens states ${step.name} allows unlimited people, so there is no member past it to refuse`)
      const seats = step.people
      const { want, allows } = seatsRefusal(ladder, step)
      const page = await ctx.app.tab('/members')
      try {
        let members = await roster(page)
        ctx.evidence.push({ note: `on ${step.name}, the roster before: ${members.map((m) => `${m.email} (${m.role})`).join(', ')}` })
        if (members.length === 0 || members.length >= seats) throw new Error(`the roster lists ${members.length} before any add on ${step.name}`)
        while (members.length < seats) {
          const email = newEmail(seed, members.length + 1)
          const add = await addOnScreen(page, email)
          ctx.evidence.push({ note: `Add member ${email} with ${members.length} on the roster: ${add.status}; Members shows "${add.shown}"`, answer: JSON.stringify(add.body) })
          if (add.status !== 201) return fail(`on ${step.name}, member ${members.length + 1} of ${seats} was refused: ${add.status} ${add.body.code ?? ''} "${add.body.error ?? ''}"`)
          const after = await roster(page)
          if (after.length !== members.length + 1 || !after.some((m) => m.email === email)) {
            return fail(`on ${step.name}, ${email} was added (201) and the roster lists ${after.length}: ${after.map((m) => m.email).join(', ')}`)
          }
          members = after
        }
        const wrong = await oneTooMany(page, ctx, newEmail(seed, seats + 1), members, step.id, allows, want)
        return wrong ?? { pass: true, detail: `on ${step.name} the roster took its member ${seats}; Members then shows its seats taken with See plans and no form, Track refuses the next in Lens's words, and the roster still lists ${seats}` }
      } finally {
        await page.close()
      }
    },
  }
}
