// B30.138 — agents' monthly allowances (Lens B30.27), on Lens's API, once a run, on a workspace of its own. The owner opens the
// company's GBP account with £500.00 of test money in it, opens an agent's GBP account under it and gives the agent £7.50 of its
// own — money that is not an allowance, as money it earned would be — and sets the agent £20.00 a month with sweep-back on, on
// today's day of the month (PUT /v1/money/allowances; 1–28, so the scenario SKIPs on the 29th to the 31st). Lens's minute tick
// pays it today: one run for this month, funded, that swept back the agent's whole £7.50 first (sweep_back returns everything the
// agent's account holds in that funding, not only an unspent allowance) and paid in £20.00. Judged on both accounts' ledgers: the
// agent's statement holds one allowance line of +£20.00 and one allowance_sweep of −£7.50, the company's the same two the other
// way, and the balances are £20.00 and £480.00. Stopped (DELETE), GET shows stopped_at; set again the same day, Lens runs the
// month again and pays nothing twice: still one run, the same lines and balances. Then it is stopped for good.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 50_000
const HELD_MINOR = 750
const ALLOWANCE_MINOR = 2_000
const CAPABILITIES = ['currency_accounts', 'payments_in']
const gbp = (minor: number): string => `${minor < 0 ? '−' : ''}£${(Math.abs(minor) / 100).toFixed(2)}`

/** An allowance as Lens answers it (economy.MoneyAllowance), and one month of it (economy.MoneyAllowanceRun). */
interface Allowance { id: string; agent_id: string; currency: string; amount_minor: number; day_of_month: number; sweep_back: boolean; funding: string
  next_run_at: string; stopped_at?: string | null }
interface Run { allowance_id: string; period: string; swept_minor: number; funded_minor: number; sweep_entry_id?: string; fund_entry_id?: string; status: string; detail?: string }
interface Account { id: string; test_minor: number }
interface Statement { lines: { kind?: string; amount_minor: number }[] | null }

/** `waitMs` is how long the scenario waits for Lens's minute tick each time; `now` is the runner's clock, whose UTC day it sets. */
export function allowances({ waitMs = 150_000, pollMs = 5_000, now = () => new Date() }: { waitMs?: number; pollMs?: number; now?: () => Date } = {}): Scenario {
  return {
    id: 'agent-allowances',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.27', 'B30.138'],
    title: "monthly allowances: an agent's £20.00 a month with sweep-back, set on today's day, is paid once by Lens's minute tick — " +
      "the agent's own £7.50 swept back to the company first, then £20.00 in from the company's account, on both statements — " +
      'and set again after it was stopped, the month pays nothing twice',
    run: async (ctx) => {
      const today = now()
      const day = today.getUTCDate()
      if (day > 28) throw new CannotTest(`an allowance is paid on a day from the 1st to the 28th, and today is the ${day}th in UTC`)
      const period = today.toISOString().slice(0, 7)
      const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day)
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      // 1. The terms, the company's GBP account with £500.00 of test money, and the agent's GBP account holding £7.50 of its own.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account on test money must answer 201; Lens answered ${said(company)}`)
      const companyID = company.value.id
      const topped = await step('POST', `/v1/money/accounts/${companyID}/test-money`, { amount_minor: FUND_COMPANY_MINOR, idempotency_key: key() },
        `${gbp(FUND_COMPANY_MINOR)} of test money comes into the company's GBP account`)
      if (topped.status !== 201) return fail(`${gbp(FUND_COMPANY_MINOR)} of test money into the company's GBP account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Allowances ${RUN_SALT}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`)
      const agentID = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${agentID}/funding`, { direction: 'to_agent', amount_minor: HELD_MINOR, idempotency_key: key() },
        `${agent.name}'s account holds ${gbp(HELD_MINOR)} that is not an allowance before the month's is paid`)
      if (given.status !== 201) return fail(`giving ${agent.name} ${gbp(HELD_MINOR)} answered ${said(given)}`)

      const balances = async (note: string): Promise<{ company: number; agent: number }> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const of = (id: string) => {
          const a = (r.value?.accounts ?? []).find((x) => x.id === id)
          if (a === undefined) throw new Error(`the GBP account ${id} is not on the list: ${said(r)}`)
          return a.test_minor
        }
        return { company: of(companyID), agent: of(agentID) }
      }
      /** The account's allowance and allowance_sweep lines, by kind. */
      const allowanceLines = async (id: string, whose: string, note: string): Promise<{ allowance: number[]; sweep: number[] }> => {
        const st = await step<Statement>('GET', `/v1/money/accounts/${id}/statement`, undefined, note)
        if (st.status !== 200) throw new Error(`${whose} statement answered ${said(st)}`)
        const lines = st.value?.lines ?? []
        return { allowance: lines.filter((l) => l.kind === 'allowance').map((l) => l.amount_minor), sweep: lines.filter((l) => l.kind === 'allowance_sweep').map((l) => l.amount_minor) }
      }
      const set = () => step<Allowance>('PUT', '/v1/money/allowances', { agent_id: agent.id, currency: 'GBP', amount_minor: ALLOWANCE_MINOR, day_of_month: day,
        sweep_back: true, funding: 'test' }, `the owner sets ${agent.name} ${gbp(ALLOWANCE_MINOR)} a month on day ${day}, sweep-back on`)
      const listed = async (id: string, note: string): Promise<Allowance | undefined> => {
        const r = await step<{ allowances: Allowance[] | null }>('GET', `/v1/money/allowances?agent_id=${encodeURIComponent(agent.id)}`, undefined, note)
        if (r.status !== 200) throw new Error(`listing ${agent.name}'s allowances answered ${said(r)}`)
        return (r.value?.allowances ?? []).find((a) => a.id === id)
      }
      const stop = async (id: string, note: string): Promise<string | undefined> => {
        const r = await step('DELETE', `/v1/money/allowances/${id}`, undefined, note)
        if (r.status !== 204) return `stopping the allowance must answer 204; Lens answered ${said(r)}`
        const a = await listed(id, `${agent.name}'s allowances after it is stopped`)
        if (a?.stopped_at == null) return `stopped, the allowance must show stopped_at; Lens lists ${JSON.stringify(a ?? null)}`
        return undefined
      }

      try {
        const start = await balances('both accounts before the allowance')
        if (start.company !== FUND_COMPANY_MINOR - HELD_MINOR || start.agent !== HELD_MINOR) {
          return fail(`before the allowance the company's account must hold ${gbp(FUND_COMPANY_MINOR - HELD_MINOR)} and ${agent.name}'s ${gbp(HELD_MINOR)}; they hold ${gbp(start.company)} and ${gbp(start.agent)}`)
        }

        // 2. £20.00 a month on today's day, sweep-back on: due since midnight, so Lens's next minute tick pays it.
        const made = await set()
        if (made.status !== 200 || made.value === undefined) return fail(`setting ${agent.name}'s allowance must answer 200; Lens answered ${said(made)}`)
        const a = made.value
        if (a.amount_minor !== ALLOWANCE_MINOR || a.currency !== 'GBP' || a.day_of_month !== day || !a.sweep_back || a.funding !== 'test' || Date.parse(a.next_run_at) !== midnight) {
          return fail(`the allowance must be ${gbp(ALLOWANCE_MINOR)} in GBP on day ${day}, sweep-back on, test money, next paid ${new Date(midnight).toISOString()}; Lens set ${made.text.slice(0, 300)}`)
        }

        // 3. Lens's minute tick runs this month: one run, funded, the agent's £7.50 swept back and £20.00 paid in.
        const runsOf = async (note: string): Promise<Run[]> => {
          const r = await step<{ runs: Run[] | null }>('GET', `/v1/money/allowances/${a.id}/runs`, undefined, note)
          if (r.status !== 200) throw new Error(`the allowance's runs answered ${said(r)}`)
          return r.value?.runs ?? []
        }
        let runs: Run[] = []
        for (let waited = 0; ; waited += pollMs) {
          runs = await runsOf(`the allowance's runs after ${Math.round(waited / 1000)} s`)
          if (runs.length > 0 || waited >= waitMs) break
          await wait(pollMs)
        }
        if (runs.length === 0) return fail(`the allowance was due ${new Date(midnight).toISOString()} and Lens's minute tick ran nothing in ${Math.round(waitMs / 1000)} s`)
        const r = runs[0]
        if (runs.length !== 1 || r.period !== period || r.status !== 'funded' || r.funded_minor !== ALLOWANCE_MINOR || r.swept_minor !== HELD_MINOR || !r.fund_entry_id || !r.sweep_entry_id) {
          return fail(`this month, ${period}, must run once, funded ${gbp(ALLOWANCE_MINOR)} after sweeping back the ${gbp(HELD_MINOR)} the agent held, naming both entries; ` +
            `the allowance's runs are ${JSON.stringify(runs).slice(0, 400)}`)
        }

        // 4. On the ledger: one allowance and one sweep on each account, and the balances they leave.
        const want = { company: start.company + HELD_MINOR - ALLOWANCE_MINOR, agent: ALLOWANCE_MINOR }
        const ledger = async (when: string): Promise<string | undefined> => {
          const got = await balances(`both accounts ${when}`)
          const onAgent = await allowanceLines(agentID, `${agent.name}'s`, `${agent.name}'s statement ${when}`)
          const onCompany = await allowanceLines(companyID, "the company's", `the company's statement ${when}`)
          const wrong: string[] = []
          if (JSON.stringify(onAgent) !== JSON.stringify({ allowance: [ALLOWANCE_MINOR], sweep: [-HELD_MINOR] })) {
            wrong.push(`${agent.name}'s statement must hold one allowance of ${gbp(ALLOWANCE_MINOR)} and one allowance_sweep of ${gbp(-HELD_MINOR)}; it holds ` +
              `allowance ${onAgent.allowance.map(gbp).join(', ') || 'none'} and allowance_sweep ${onAgent.sweep.map(gbp).join(', ') || 'none'}`)
          }
          if (JSON.stringify(onCompany) !== JSON.stringify({ allowance: [-ALLOWANCE_MINOR], sweep: [HELD_MINOR] })) {
            wrong.push(`the company's statement must hold one allowance of ${gbp(-ALLOWANCE_MINOR)} and one allowance_sweep of ${gbp(HELD_MINOR)}; it holds ` +
              `allowance ${onCompany.allowance.map(gbp).join(', ') || 'none'} and allowance_sweep ${onCompany.sweep.map(gbp).join(', ') || 'none'}`)
          }
          if (got.agent !== want.agent || got.company !== want.company) {
            wrong.push(`the balances must be ${gbp(want.agent)} for ${agent.name} and ${gbp(want.company)} for the company; they are ${gbp(got.agent)} and ${gbp(got.company)}`)
          }
          return wrong.length === 0 ? undefined : wrong.join('; ')
        }
        const paid = await ledger('after the tick')
        if (paid !== undefined) return fail(`the month's allowance is wrong on the ledger: ${paid}`)

        // 5. Stopped: GET shows stopped_at.
        const stopped = await stop(a.id, `the owner stops ${agent.name}'s allowance`)
        if (stopped !== undefined) return fail(stopped)

        // 6. Set again the same day: due at midnight again, so the tick runs this month again — and must pay nothing twice.
        const again = await set()
        if (again.status !== 200 || again.value?.id !== a.id || again.value.stopped_at != null) {
          return fail(`setting the stopped allowance again must answer 200 with it running again; Lens answered ${said(again)}`)
        }
        let seen = again.value
        for (let waited = 0; Date.parse(seen.next_run_at) <= now().getTime() && waited < waitMs; waited += pollMs) {
          await wait(pollMs)
          seen = await listed(a.id, `${agent.name}'s allowance after ${Math.round((waited + pollMs) / 1000)} s set again`) ?? seen
        }
        if (Date.parse(seen.next_run_at) <= now().getTime()) {
          return fail(`set again, the allowance was due ${seen.next_run_at} and Lens's minute tick did not run it in ${Math.round(waitMs / 1000)} s`)
        }
        const runsAgain = await runsOf("the allowance's runs after it ran again")
        const twice = await ledger('after the month ran again')
        if (runsAgain.length !== 1 || twice !== undefined) {
          return fail(`set again in a month that already ran, the allowance paid again: its runs are ${JSON.stringify(runsAgain).slice(0, 400)}${twice === undefined ? '' : `; ${twice}`}`)
        }

        // 7. Stopped for good.
        const end = await stop(a.id, `the owner stops ${agent.name}'s allowance for good`)
        if (end !== undefined) return fail(end)
        return {
          pass: true,
          detail: `${agent.name}'s ${gbp(ALLOWANCE_MINOR)} a month on day ${day} ran once for ${period}: the ${gbp(HELD_MINOR)} it held swept back, then ${gbp(ALLOWANCE_MINOR)} in ` +
            `from the company's account, one line of each on both statements, leaving ${gbp(want.agent)} and ${gbp(want.company)}; stopped, it shows stopped_at; ` +
            `set again, the month ran again and paid nothing twice; then stopped for good`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
