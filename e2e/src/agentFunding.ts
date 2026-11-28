// B17.557 — Add money and Take back (B61.84, on Lens B61.66), once a run, on a workspace of its own. On Lens's API the owner
// opens the company's USD account and an agent's USD account under it, and $20.00 of test money comes into the company's. On
// the agent's page in the app the owner presses Add money, types $10.00, Continue, then Move $10.00: the BFF's answer is 201,
// and on the ledger the company's statement has exactly one agent_funding of −1000 and the agent's exactly one of +1000. The
// owner presses Take back, types $4.00, Continue, then Take back $4.00: one agent_funding_back of +400 on the company's and
// one of −400 on the agent's, and the accounts hold $14.00 and $6.00. A person the owner gave the Viewer role (not the owner,
// not an admin, not Finance) moving $1.00 to the agent is refused 403 by Lens, and both statements are as they were. A run
// without the provisioning secret is a SKIP, never a pass.

import { randomBytes } from 'node:crypto'
import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { call, said } from './settings.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
const CURRENCY = 'USD'
const COMPANY_START_MINOR = 2000
const ADD_MINOR = 1000
const TAKE_MINOR = 400
const VIEWER_MINOR = 100

interface Account { id: string; currency: string; purpose: string; agent_id?: string; test_minor: number }
interface Statement { lines: { kind: string; amount_minor: number }[] | null }

export type Direction = 'to_agent' | 'to_company'

/** Add money or Take back as the owner presses it: the answer to the move it sent, for `amount` typed in dollars ("10.00"). */
export type Press = (agent: { id: string; name: string }, direction: Direction, amount: string) => Promise<{ status: number; text: string }>

const dollars = (minor: number) => `$${(minor / 100).toFixed(2)}`

/** On the agent's page: Add money or Take back, the amount, Continue, then the button that moves it, and the BFF's answer. */
async function pressOnPage(page: Page, agent: { id: string; name: string }, direction: Direction, amount: string): Promise<{ status: number; text: string }> {
  const opens = direction === 'to_agent' ? `Add money to ${agent.name}` : `Take back from ${agent.name}`
  await page.getByRole('button', { name: opens, exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: opens })
  await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  // The fields are drawn once the accounts are read; the agent may hold more than one currency, so USD is picked.
  const typed = dialog.getByLabel('Amount', { exact: true })
  await typed.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  const currency = dialog.getByLabel('Currency', { exact: true })
  if ((await currency.count()) > 0) await currency.selectOption(CURRENCY)
  await typed.fill(amount)
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /^\/api\/money\/accounts\/[^/]+\/funding$/.test(new URL(r.url()).pathname), { timeout: ACTION_TIMEOUT_MS }),
    dialog.getByRole('button', { name: direction === 'to_agent' ? /^Move\b/ : /^Take back\b/ }).click({ timeout: ACTION_TIMEOUT_MS }),
  ])
  const out = { status: res.status(), text: await res.text().catch(() => '') }
  if (res.ok()) await dialog.waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  return out
}

/** The agent's page in a tab of the owner's own, pressed there. */
async function onScreen(ctx: ScenarioCtx, agentID: string): Promise<{ press: Press; close: () => Promise<void> }> {
  const page = await ctx.app.tab(`/agents/${agentID}`)
  return { press: (a, d, amount) => pressOnPage(page, a, d, amount), close: () => page.close() }
}

export function agentFunding(open: typeof onScreen = onScreen): Scenario {
  return {
    id: 'agent-funding',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    feature: 'Agent wallets',
    items: ['B61.84'],
    title: "on the agent's page the owner adds $10.00 from the company's account and both statements show it once, takes $4.00 back " +
      "and both show that once, and a Viewer's move is refused 403 by Lens with nothing on either statement",
    run: async (ctx) => {
      const { lens, provisionSecret } = ctx.env
      const user = ctx.app.user
      if (provisionSecret === '') throw new CannotTest('the Viewer signs in to the account with their role on LENS_PROVISION_SECRET, which this run was not given')
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // 1. On Lens's API: the company's USD account holding $20.00, and the agent's USD account under it at zero.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const agent = await lens.createAgent(user, `Funded agent ${RUN_SALT}`)
      const accounts = async (when: string) => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        if (r.status !== 200) throw new Error(`reading the accounts ${when} answered ${said(r)}`)
        return r.value?.accounts ?? []
      }
      const ids = { company: '', agent: '' }
      for (const [whose, extra] of [['company', {}], ['agent', { agent_id: agent.id }]] as const) {
        const had = (await accounts(`before ${whose === 'company' ? "the company's" : `${agent.name}'s`} ${CURRENCY} account`))
          .find((a) => a.currency === CURRENCY && (whose === 'company' ? a.purpose === 'company' : a.agent_id === agent.id))
        if (had !== undefined) {
          ids[whose] = had.id
          continue
        }
        const opened = await step<Account>('POST', '/v1/money/accounts', { currency: CURRENCY, ...extra }, `${whose === 'company' ? "the company's" : `${agent.name}'s`} ${CURRENCY} account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening the ${whose}'s ${CURRENCY} account answered ${said(opened)}`)
        ids[whose] = opened.value.id
      }
      const topped = await step('POST', `/v1/money/accounts/${ids.company}/test-money`, { amount_minor: COMPANY_START_MINOR, idempotency_key: key() },
        `${dollars(COMPANY_START_MINOR)} into the company's ${CURRENCY} account`)
      if (topped.status !== 201) return fail(`${dollars(COMPANY_START_MINOR)} into the company's account answered ${said(topped)}`)

      /** Both accounts' funding lines and what each holds, as the ledger has them. */
      const ledger = async (when: string) => {
        const lines = async (id: string, whose: string) => {
          const st = await step<Statement>('GET', `/v1/money/accounts/${id}/statement`, undefined, `${whose} statement ${when}`)
          if (st.status !== 200) throw new Error(`${whose} statement ${when} answered ${said(st)}`)
          return (st.value?.lines ?? []).filter((l) => l.kind === 'agent_funding' || l.kind === 'agent_funding_back').map((l) => `${l.kind} ${l.amount_minor}`)
        }
        const list = await accounts(when)
        const holds = (id: string) => list.find((a) => a.id === id)?.test_minor ?? Number.NaN
        return { company: await lines(ids.company, "the company's"), agent: await lines(ids.agent, `${agent.name}'s`), companyHolds: holds(ids.company), agentHolds: holds(ids.agent) }
      }
      type Ledger = Awaited<ReturnType<typeof ledger>>
      const faults = (got: Ledger, company: string[], own: string[], companyHolds: number, agentHolds: number): string | undefined => {
        const out: string[] = []
        if (got.company.join(', ') !== company.join(', ')) out.push(`the company's statement must hold [${company.join(', ')}]; it holds [${got.company.join(', ')}]`)
        if (got.agent.join(', ') !== own.join(', ')) out.push(`${agent.name}'s statement must hold [${own.join(', ')}]; it holds [${got.agent.join(', ')}]`)
        if (got.companyHolds !== companyHolds || got.agentHolds !== agentHolds) {
          out.push(`the company's account must hold ${companyHolds} and ${agent.name}'s ${agentHolds}; they hold ${got.companyHolds} and ${got.agentHolds}`)
        }
        return out.length === 0 ? undefined : out.join('; ')
      }

      const screen = await open(ctx, agent.id)
      try {
        // 2. Add money: $10.00 from the company's account, one posting on each statement.
        const added = await screen.press(agent, 'to_agent', (ADD_MINOR / 100).toFixed(2))
        ctx.evidence.push({ note: `on ${agent.name}'s page the owner adds ${dollars(ADD_MINOR)}`, answer: `${added.status} ${added.text.slice(0, 300)}` })
        if (added.status !== 201) return fail(`Move ${dollars(ADD_MINOR)} on ${agent.name}'s page must answer 201; the BFF answered ${added.status} ${added.text.slice(0, 200)}`)
        const afterAdd = await ledger('after Add money')
        const addLines = { company: [`agent_funding ${-ADD_MINOR}`], agent: [`agent_funding ${ADD_MINOR}`] }
        const add = faults(afterAdd, addLines.company, addLines.agent, COMPANY_START_MINOR - ADD_MINOR, ADD_MINOR)
        if (add !== undefined) return fail(`after Add money ${dollars(ADD_MINOR)}: ${add}`)

        // 3. Take back: $4.00 back to the company's account, one posting more on each.
        const taken = await screen.press(agent, 'to_company', (TAKE_MINOR / 100).toFixed(2))
        ctx.evidence.push({ note: `on ${agent.name}'s page the owner takes back ${dollars(TAKE_MINOR)}`, answer: `${taken.status} ${taken.text.slice(0, 300)}` })
        if (taken.status !== 201) return fail(`Take back ${dollars(TAKE_MINOR)} on ${agent.name}'s page must answer 201; the BFF answered ${taken.status} ${taken.text.slice(0, 200)}`)
        const afterTake = await ledger('after Take back')
        const both = { company: [...addLines.company, `agent_funding_back ${TAKE_MINOR}`], agent: [...addLines.agent, `agent_funding_back ${-TAKE_MINOR}`] }
        const companyEnd = COMPANY_START_MINOR - ADD_MINOR + TAKE_MINOR
        const agentEnd = ADD_MINOR - TAKE_MINOR
        const take = faults(afterTake, both.company, both.agent, companyEnd, agentEnd)
        if (take !== undefined) return fail(`after Take back ${dollars(TAKE_MINOR)}: ${take}`)
      } finally {
        await screen.close()
      }

      // 4. A Viewer — not the owner, not an admin, not Finance — is refused, and nothing moves.
      const email = `viewer-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase()
      const given = await step('PUT', '/v1/workspaces/{ws}/roles', { email, role: 'viewer' }, `the owner gives ${email} the viewer role`)
      if (given.status !== 200) return fail(`the owner giving ${email} the viewer role must answer 200; Lens answered ${said(given)}`)
      const session = await lens.as('', 'POST', '/v1/provision/roles',
        { identity: `e2e-agent-funding-viewer-${RUN_SALT}-${user.workspaceID}`, email, mode: 'session', account_id: user.workspaceID, ttl_hours: 1 },
        { [PROVISION_HEADER]: provisionSecret })
      ctx.evidence.push({ note: `${email} signs in to the account as viewer`, answer: `${session.status} ${session.status === 200 ? '(token withheld)' : session.text.slice(0, 200)}` })
      if (session.status === 401) throw new CannotTest("Lens refused this run's LENS_PROVISION_SECRET: it is not the value Lens boots with")
      let token = ''
      try {
        token = session.status === 200 ? (JSON.parse(session.text) as { token?: string }).token ?? '' : ''
      } catch {
        token = ''
      }
      if (token === '') return fail(`${email} signing in as viewer must answer 200 with a session; Lens answered ${session.status} ${session.text.slice(0, 200)}`)
      const byViewer = await lens.as(token, 'POST', `/v1/money/accounts/${ids.agent}/funding`, { direction: 'to_agent', amount_minor: VIEWER_MINOR, idempotency_key: key() })
      ctx.evidence.push({ note: `the viewer moves ${dollars(VIEWER_MINOR)} to ${agent.name}`, answer: `${byViewer.status} ${byViewer.text.slice(0, 300)}` })
      const afterViewer = await ledger("after the Viewer's move")
      const still = faults(afterViewer, [`agent_funding ${-ADD_MINOR}`, `agent_funding_back ${TAKE_MINOR}`], [`agent_funding ${ADD_MINOR}`, `agent_funding_back ${-TAKE_MINOR}`],
        COMPANY_START_MINOR - ADD_MINOR + TAKE_MINOR, ADD_MINOR - TAKE_MINOR)
      if (byViewer.status !== 403 || still !== undefined) {
        return fail(`a Viewer moving ${dollars(VIEWER_MINOR)} between the company's account and ${agent.name}'s must be refused 403 with nothing posted (Lens B61.66: the owner, ` +
          `an admin or Finance); Lens answered ${byViewer.status} ${byViewer.text.slice(0, 160)}${still === undefined ? '' : `; ${still}`}`)
      }

      return {
        pass: true,
        detail: `on ${agent.name}'s page Add money ${dollars(ADD_MINOR)} posted one agent_funding on each statement and Take back ${dollars(TAKE_MINOR)} one agent_funding_back on each; ` +
          `the company's account holds ${dollars(COMPANY_START_MINOR - ADD_MINOR + TAKE_MINOR)} and ${agent.name}'s ${dollars(ADD_MINOR - TAKE_MINOR)}; a Viewer's ${dollars(VIEWER_MINOR)} was refused 403 with nothing posted`,
      }
    },
  }
}
