// B17.558 — a payment whose payee changed after the owner approved it is stopped, and Approvals says so (Lens B62.1 and B62.9),
// once a run, on a workspace of its own. On Lens's API the owner opens the company's GBP account with £500.00 of test money,
// an agent's GBP account under it holding £300.00, two saved payees, and the agent's approval amount at 1,000 LXC. On its own
// key the agent pays the first payee £100.00: refused 403 naming an approval, which the owner approves. The payee is then
// changed before the payment posts: the synthetic key re-points the approval at the second payee (talyvor-lens B62.12), as a
// sheet tampered after the owner approved would, and the agent sends the same payment to the second payee. Lens must stop it
// with 403 "not the one you approved"; on the ledger the agent's account and its statement are exactly as they were, and no
// payment out of it exists to either payee. The approval reads back still approved and stopped {changed: "payee"}, and on
// Approvals its Decided row says "Stopped: the payee changed after you approved." A Lens without B62.12 is a SKIP, never a pass:
// the payee is in the approval's fingerprint, so neither a person nor an agent can change it there.

import { randomBytes } from 'node:crypto'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { refusalOf } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 50_000
const FUND_AGENT_MINOR = 30_000
const APPROVAL_ABOVE_ULXC = 1_000_000_000
const PAY_MINOR = 10_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
/** apps/web/src/areas/lens/PaymentProof.tsx stoppedSentence('payee') (B62.10). */
export const STOPPED_PAYEE = 'Stopped: the payee changed after you approved.'
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

interface Account { id: string; test_minor: number }
interface Statement { lines: { kind?: string; amount_minor: number }[] | null }
interface Payment { id: string; payee_id?: string; reference: string; status: string }
interface Approval { id: string; agent_id: string; status: string; stopped?: { changed: string; at: string } | null }

/** The Decided row of approval `id` on Approvals, as its text reads; '' when there is none. */
export type DecidedRow = (ctx: ScenarioCtx, id: string) => Promise<string>

/** On Approvals in a tab of the owner's own: the Decided row of the approval, once it is drawn. */
async function onScreen(ctx: ScenarioCtx, id: string): Promise<string> {
  const page = await ctx.app.tab('/approvals')
  try {
    const row = page.locator(`[data-decided="${id}"]`)
    await row.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
    return (await row.count()) === 0 ? '' : (await row.innerText()).replace(/\s+/g, ' ').trim()
  } finally {
    await page.close()
  }
}

export function approvalStoppedPayee(decidedRow: DecidedRow = onScreen): Scenario {
  return {
    id: 'approval-stopped-payee',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B62.9'],
    title: "an agent's approved £100.00 whose payee is changed before it posts is stopped with nothing on the ledger, and its approval " +
      'reads back stopped because the payee changed, on Lens and on Approvals',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, the company's GBP account with test money in it, and the agent's GBP account under it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_COMPANY_MINOR, idempotency_key: key() },
        `${gbp(FUND_COMPANY_MINOR)} of test money comes into the company's GBP account`)
      if (topped.status !== 201) return fail(`${gbp(FUND_COMPANY_MINOR)} of test money into the company's GBP account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Stopped payee ${RUN_SALT}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`)
      const from = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${from}/funding`, { direction: 'to_agent', amount_minor: FUND_AGENT_MINOR, idempotency_key: key() },
        `the owner gives ${agent.name} ${gbp(FUND_AGENT_MINOR)} from the company's GBP account`)
      if (given.status !== 201) return fail(`giving ${agent.name} ${gbp(FUND_AGENT_MINOR)} answered ${said(given)}`)

      // 2. Two saved payees, the agent's approval amount at 1,000 LXC and no other limit, and the agent's own key.
      const payee = async (name: string, account: string) => {
        const r = await step<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: account }, `the owner saves ${name}`)
        if (r.status !== 201 || r.value === undefined) throw new Error(`saving ${name} answered ${said(r)}`)
        return { id: r.value.id, name }
      }
      const approvedTo = await payee(`Nightly Approved Payee ${RUN_SALT} Ltd`, '55880011')
      const changedTo = await payee(`Nightly Other Payee ${RUN_SALT} Ltd`, '55880022')
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
        hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: APPROVAL_ABOVE_ULXC },
      `${agent.name} asks the owner above 1,000 LXC, with no other limit`)
      if (rules.status !== 200) return fail(`setting ${agent.name}'s approval amount to 1,000 LXC answered ${said(rules)}`)
      const issued = await step<{ key: string }>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'approval-stopped' }, `${agent.name}'s own key`)
      if (issued.status >= 300 || issued.value?.key === undefined) return fail(`issuing ${agent.name} a key answered ${said(issued)}`)
      const agentKey = issued.value.key

      const reference = `Nightly ${RUN_SALT} stopped`
      const payKey = key()
      /** The agent pays `to` £100.00 from its account, on its own key, under the one key. */
      const pay = async (to: { id: string; name: string }, note: string) => {
        const r = await lens.as(agentKey, 'POST', '/v1/money/payments', { payee_id: to.id, account_id: from, amount_minor: PAY_MINOR, currency: 'GBP',
          reference, idempotency_key: payKey })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
        return { status: r.status, error: r.status < 300 ? '' : refusalOf(r.text) }
      }
      /** The agent's account on the ledger: what it holds, its statement's lines, and its payments out under the reference. */
      const ledger = async (when: string) => {
        const list = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        const holds = (list.value?.accounts ?? []).find((a) => a.id === from)?.test_minor ?? Number.NaN
        const st = await step<Statement>('GET', `/v1/money/accounts/${from}/statement`, undefined, `${agent.name}'s statement ${when}`)
        if (st.status !== 200) throw new Error(`${agent.name}'s statement ${when} answered ${said(st)}`)
        const paid = await step<{ payments: Payment[] | null }>('GET', `/v1/money/payments?agent_id=${encodeURIComponent(agent.id)}`, undefined, `${agent.name}'s payments out ${when}`)
        if (paid.status !== 200) throw new Error(`listing ${agent.name}'s payments out ${when} answered ${said(paid)}`)
        return { holds, lines: (st.value?.lines ?? []).map((l) => `${l.kind ?? ''} ${l.amount_minor}`), payments: (paid.value?.payments ?? []).filter((p) => p.reference === reference) }
      }

      // 3. £100.00 to the first payee, above the approval amount: refused 403 naming an approval, which the owner approves.
      const seen = new Set((await lens.agentApprovals(user)).map((a) => a.id))
      const asked = await pay(approvedTo, `${agent.name} pays ${approvedTo.name} ${gbp(PAY_MINOR)}, above its 1,000 LXC approval amount`)
      const filed = (await lens.agentApprovals(user)).find((a) => a.agent_id === agent.id && a.status === 'pending' && !seen.has(a.id))
      if (asked.status !== 403 || !/approv/i.test(asked.error) || filed === undefined) {
        return fail(`${gbp(PAY_MINOR)} above ${agent.name}'s 1,000 LXC approval amount must be refused 403 naming an approval, and file a pending one; ` +
          `Lens answered ${asked.status} "${asked.error}"${filed === undefined ? ' and filed no pending approval' : ''}`)
      }
      const approved = await step('POST', `/v1/workspaces/{ws}/agents/approvals/${filed.id}/approve`, {}, `the owner approves ${filed.id}`)
      if (approved.status !== 200) return fail(`the owner's approval of ${filed.id} answered ${said(approved)}`)
      const before = await ledger('once the owner approved')
      if (before.holds !== FUND_AGENT_MINOR || before.payments.length !== 0) {
        return fail(`approved and not yet sent, ${agent.name}'s account must hold ${gbp(FUND_AGENT_MINOR)} with no payment out; it holds ${before.holds} with ${before.payments.length}`)
      }

      // 4. The payee is changed before it posts: the approval re-pointed at the second payee, and the same payment sent there.
      const repointed = await lens.repointApproval(user, filed.id, changedTo.id)
      ctx.evidence.push({ note: `the approval ${filed.id} re-pointed at ${changedTo.name} with the synthetic key`, answer: `${repointed.status} ${repointed.ok ? JSON.stringify(repointed.value) : repointed.error}` })
      if (repointed.status === 404 || repointed.status === 405) {
        throw new CannotTest(`Lens has no way for the testers to change an approved payment's payee (talyvor-lens B62.12, POST /v1/synthetic/workspaces/{ws}/agents/approvals/{id}/payee answered ${repointed.status}); ` +
          "the payee is in the approval's fingerprint, so neither a person nor an agent can change it there")
      }
      if (!repointed.ok) return fail(`re-pointing the approved ${filed.id} at ${changedTo.name} with the synthetic key must answer 200; Lens answered ${repointed.status} "${repointed.error}"`)
      const stopped = await pay(changedTo, `${agent.name} sends the approved ${gbp(PAY_MINOR)} to ${changedTo.name} instead`)
      const after = await ledger('after the changed payment')
      const moved: string[] = []
      if (after.holds !== before.holds) moved.push(`the account holds ${after.holds}, not ${before.holds}`)
      if (after.lines.join(', ') !== before.lines.join(', ')) moved.push(`its statement holds [${after.lines.join(', ')}], not [${before.lines.join(', ')}]`)
      if (after.payments.length !== 0) moved.push(`${after.payments.length} payment(s) out exist: ${after.payments.map((p) => `${p.id} to ${p.payee_id ?? '?'} ${p.status}`).join(', ')}`)
      if (stopped.status !== 403 || !/not the one you approved/i.test(stopped.error) || moved.length > 0) {
        return fail(`${gbp(PAY_MINOR)} approved for ${approvedTo.name} and sent to ${changedTo.name} must be stopped 403 as not the one approved, with nothing on the ledger ` +
          `(Lens B62.1); Lens answered ${stopped.status} "${stopped.error.slice(0, 200)}"${moved.length > 0 ? `; ${moved.join('; ')}` : ''}`)
      }

      // 5. The approval reads back stopped because the payee changed, on Lens and on Approvals.
      const read = await step<Approval>('GET', `/v1/workspaces/{ws}/agents/approvals/${filed.id}`, undefined, `the owner reads ${filed.id}`)
      if (read.status !== 200 || read.value?.status !== 'approved' || read.value.stopped?.changed !== 'payee' || !read.value.stopped.at) {
        return fail(`the stopped payment's approval must read back still approved and stopped {changed: "payee"} (Lens B62.9); Lens answered ${said(read)}`)
      }
      const row = await decidedRow(ctx, filed.id)
      ctx.evidence.push({ note: `the Decided row of ${filed.id} on Approvals`, answer: row === '' ? '(no row)' : row.slice(0, 300) })
      if (!row.includes(STOPPED_PAYEE)) return fail(`on Approvals the Decided row of ${filed.id} must say "${STOPPED_PAYEE}"; it reads "${row === '' ? '(no row)' : row.slice(0, 200)}"`)

      return {
        pass: true,
        detail: `${gbp(PAY_MINOR)} approved for ${approvedTo.name} and sent to ${changedTo.name} was stopped 403 with nothing on the ledger (${agent.name}'s account holds ` +
          `${gbp(after.holds)}, its statement unchanged, no payment out); the approval reads back approved and stopped because the payee changed, and Approvals says "${STOPPED_PAYEE}"`,
      }
    },
  }
}
