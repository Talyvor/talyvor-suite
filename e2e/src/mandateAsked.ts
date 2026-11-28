// B55.56 — a mandate an agent asked for, once a run, on a workspace of its own (registered by B17.559). The owner adds
// £100.00 to the agent's GBP account from the company's, and the agent's own key asks Lens for a mandate on it, to another
// Talyvor company: Lens records it requested, and the company's pull is refused with nothing moved. With a passkey on, the
// owner's unsigned approval is refused on Lens. B55.40: the request waits on Approvals in words, and the owner's Review then
// Approve there goes up signed; Lens records the mandate active. The company then pulls £5.00: one mandate_pull entry on the
// ledger, the agent's account −500 and the company's +500, the accounts holding exactly that, and the mandate counts £5.00
// pulled this month.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { acceptMoneyTerms, account, balances } from './pocketProblems/approvals.ts'
import { settled, step, turnOnPasskey } from './pocketProblems/press.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { said } from './routes.ts'

const PULL_MINOR = 500

interface Mandate { id: string; status: string; pulled_this_month_minor: number }
/** One pull as Lens answers it (economy.MandatePull): its entry's postings are the ledger's rows. */
interface Pull { entry?: { kind: string; postings: { account_id: string; amount_minor: number }[] | null } }

/**
 * The owner turns on a passkey, `unsigned` then checks Lens refuses an unsigned approval, and the owner approves the request
 * signed with that passkey: a reason when any of it does not hold.
 */
export type ApproveAsked = (ctx: ScenarioCtx, id: string, asker: string, unsigned: () => Promise<string | undefined>) => Promise<string | undefined>

/** ApproveAsked on the web app's Approvals, with the browser's virtual passkey. */
export const onApprovals: ApproveAsked = async (ctx, id, asker, unsigned) => {
  const page = await ctx.app.tab('/approvals')
  try {
    const made = await turnOnPasskey(ctx, page)
    if (made !== undefined) return made
    const refused = await unsigned()
    if (refused !== undefined) return refused
    const signed: boolean[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/api/money/mandates/${id}/approve`)) signed.push((r.postData() ?? '').includes('"assertion"'))
    })
    await page.goto(new URL('/approvals', page.url()).toString())
    await settled(page)
    const row = page.locator(`[data-mandate="${id}"]`)
    const words = (await row.innerText().catch(() => '')).trim()
    ctx.evidence.push({ note: `the request on Approvals: ${words.slice(0, 300)}` })
    if (!words.includes(`${asker} asks to let Asked Supplier ${RUN_SALT} pull up to £100.00 a month`)) {
      return `Approvals does not list the agent's mandate request in words; its row reads "${words.slice(0, 200)}"`
    }
    await row.getByRole('button', { name: 'Review' }).click()
    const approve = row.getByRole('button', { name: 'Approve' })
    if (!(await approve.isVisible().catch(() => false))) return `Review on Approvals shows no Approve for the asked mandate; its row reads "${(await row.innerText().catch(() => '')).slice(0, 200)}"`
    await approve.click()
    await page.getByText(/^Approved\. .* can pull from /).waitFor({ timeout: 30_000 }).catch(() => undefined)
    ctx.evidence.push({ note: `Approvals after Approve: ${(await page.locator('main').innerText().catch(() => '')).trim().slice(0, 300)}` })
    if (signed.at(-1) !== true) return `Approve on Approvals must go up signed with the passkey; it ${signed.length === 0 ? 'sent nothing' : 'went up unsigned'}`
    return undefined
  } finally {
    await page.close()
  }
}

export function mandateAsked(approve: ApproveAsked = onApprovals): Scenario {
  return {
    id: 'mandate-asked',
    owner: 'talyvor-suite',
    own: true,
    items: ['B55.56', 'B55.40', 'B17.559'],
    feature: 'Agent wallets',
    agents: 1,
    title: "an agent's own key asks for a mandate and nothing can be pulled; the owner approves it from Approvals, signed with " +
      'the passkey, and the payee\'s £5.00 pull moves £5.00 out of the agent\'s account and into the payee\'s',
    run: async (ctx) => {
      const { lens } = ctx.env
      const owner = ctx.app.user
      await acceptMoneyTerms(ctx)
      const agent = await lens.createAgent(owner, `Mandate asker ${RUN_SALT}`)
      const k = await step<{ key: string }>(ctx, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'mandate-asked' }, `${agent.name} is issued its own key`)
      if (!k.ok) return fail(`issuing ${agent.name} a key answered ${said(k)}`)
      // The company's £100.00 moved into the agent's account with Add money (Lens B61.66), as agent-funding does.
      await account(ctx, 'GBP', 10_000)
      const from = await account(ctx, 'GBP', 0, agent.id)
      const funded = await step(ctx, 'POST', `/v1/money/accounts/${from.id}/funding`, { direction: 'to_agent', amount_minor: 10_000, idempotency_key: `e2e-${randomUUID()}` },
        `the owner adds £100.00 to ${agent.name}'s account`)
      if (!funded.ok) return fail(`adding £100.00 to ${agent.name}'s account answered ${said(funded)}`)
      const [company] = await lens.createUsers(1)
      await acceptMoneyTerms(ctx, company)
      const into = await account(ctx, 'GBP', 0, undefined, company)

      // The agent's own key asks: Lens records it requested, and nothing can be pulled within it.
      const grant = { account_id: from.id, payee_workspace_id: company.workspaceID, payee_name: `Asked Supplier ${RUN_SALT}`,
        max_per_pull_minor: 1_000, max_per_month_minor: 10_000, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }
      const asked = await lens.as(k.value.key, 'POST', '/v1/money/mandates', { grant })
      ctx.evidence.push({ note: `${agent.name}'s own key asks for a mandate`, answer: `${asked.status} ${asked.text.slice(0, 300)}` })
      let m: Mandate
      try { m = JSON.parse(asked.text) as Mandate } catch { return fail(`the agent's ask answered ${asked.status} ${asked.text.slice(0, 200)}`) }
      if (asked.status !== 201 || m.status !== 'requested') return fail(`the agent's ask must be recorded requested; Lens answered ${asked.status}, ${m.status}`)
      const pull = async (note: string) => {
        const r = await lens.act<Pull>(company, 'POST', `/v1/money/mandates/${m.id}/pull`, { amount_minor: PULL_MINOR, idempotency_key: `e2e-${randomUUID()}`, funding: 'test', memo: note })
        ctx.evidence.push({ note: `the payee pulls £5.00, ${note}`, answer: said(r) })
        return r
      }
      const moved = async () => [(await balances(ctx)).get(from.id) ?? 0, (await balances(ctx, company)).get(into.id) ?? 0]
      const [a0, b0] = await moved()
      const early = await pull('before the owner approves')
      const [a1, b1] = await moved()
      if (early.ok || a1 !== a0 || b1 !== b0) return fail(`a requested mandate must pull nothing; Lens answered ${said(early)} and the accounts moved ${a0 - a1} and ${b1 - b0}`)

      const unsigned = async () => {
        const r = await step(ctx, 'POST', `/v1/money/mandates/${m.id}/approve`, {}, 'the owner approves on Lens, unsigned')
        return r.status === 403 ? undefined : `with a passkey, an unsigned approval must be refused 403; Lens answered ${said(r)}`
      }
      const approved = await approve(ctx, m.id, agent.name, unsigned)
      if (approved !== undefined) return fail(approved)

      const listed = await step<{ granted: Mandate[] | null }>(ctx, 'GET', '/v1/money/mandates?status=active', undefined, 'Lens\'s record of the active mandates')
      if (!listed.ok || !(listed.value.granted ?? []).some((x) => x.id === m.id)) return fail(`Lens does not list the approved mandate active: ${said(listed)}`)
      const paid = await pull('once the owner approved')
      const [a2, b2] = await moved()
      if (!paid.ok || a1 - a2 !== PULL_MINOR || b2 - b1 !== PULL_MINOR) {
        return fail(`approved, the £5.00 pull must move £5.00; Lens answered ${said(paid)}, the agent's account moved ${a1 - a2} and the payee's ${b2 - b1}`)
      }
      // The ledger's rows for the pull: one entry, the agent's account −£5.00 and the payee's +£5.00, and nothing else.
      const posted = paid.value
      const rows = (posted.entry?.postings ?? []).map((p) => `${p.account_id} ${p.amount_minor}`).sort()
      const want = [`${from.id} ${-PULL_MINOR}`, `${into.id} ${PULL_MINOR}`].sort()
      if (posted.entry?.kind !== 'mandate_pull' || rows.join() !== want.join()) {
        return fail(`the pull's ledger entry must be one mandate_pull posting ${want.join(' and ')}; Lens posted ${posted.entry?.kind} ${rows.join(' and ') || 'nothing'}`)
      }
      const after = await step<{ granted: Mandate[] | null }>(ctx, 'GET', '/v1/money/mandates', undefined, 'Lens\'s record of the mandate after the pull')
      const counted = after.ok ? (after.value.granted ?? []).find((x) => x.id === m.id)?.pulled_this_month_minor : undefined
      if (counted !== PULL_MINOR) return fail(`the mandate counts ${counted} pulled this month, not ${PULL_MINOR}`)
      return { pass: true, detail: `the agent's ask was recorded requested and its pull refused; the unsigned approval was refused 403; it waited on Approvals in words and Approve there went up signed; the £5.00 pull moved the agent's account ${a1} → ${a2} and the payee's ${b1} → ${b2}` }
    },
  }
}
