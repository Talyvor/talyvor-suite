// B55.44 — the Pocket problems about what waits for a person: an expired approval (3), a prepared payment (5), one a
// signed permission covers (6), loosening an agent's rules (9), a mandate's pull while every agent is paused (10) and a
// decline (17). Money is asserted on Lens's accounts and payments, never a status code alone. Words from B55.7, B55.10,
// B55.19 and B55.22.

import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import { AgentBankScreen, badgeReaches, fail } from '../bank.ts'
import { RUN_SALT } from '../oracles.ts'
import { payInvoiceByCard } from '../payScreen.ts'
import { softPasskey } from '../payees.ts'
import { said } from '../routes.ts'
import type { Scenario, ScenarioCtx } from '../scenarios.ts'
import { BLANK, bothSizes, fileApproval, settled, step, turnOnPasskey } from './press.ts'

type Bare = Omit<Scenario, 'id' | 'items'>

interface Account { id: string; currency: string; agent_id?: string; test_minor: number }
interface Item { decision: string; pay_status?: string; payment_id?: string }
interface Prepared { id: string; status: string; items: Item[] | null }

/** The money terms accepted, as the app asks a person to before an account opens. */
export async function acceptMoneyTerms(ctx: ScenarioCtx, user = ctx.app.user): Promise<void> {
  const terms = await ctx.env.lens.act<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>(user, 'GET', '/v1/workspaces/{ws}/terms')
  if (!terms.ok) throw new Error(`reading the terms answered ${said(terms)}`)
  for (const t of (terms.value.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
    const ok = await ctx.env.lens.act(user, 'POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version })
    if (!ok.ok) throw new Error(`accepting ${t.capability}'s terms answered ${said(ok)}`)
  }
}

/** An account in `currency` (the company's, or `agent`'s), with `minor` of test money in it. */
export async function account(ctx: ScenarioCtx, currency: string, minor: number, agent?: string, user = ctx.app.user): Promise<Account> {
  const { lens } = ctx.env
  const opened = await lens.act<Account>(user, 'POST', '/v1/money/accounts', { currency, ...(agent === undefined ? {} : { agent_id: agent }) })
  ctx.evidence.push({ note: `${agent === undefined ? "the company's" : `${agent}'s`} ${currency} account`, answer: said(opened) })
  if (!opened.ok) throw new Error(`opening a ${currency} account answered ${said(opened)}`)
  if (minor > 0 && agent === undefined) {
    const funded = await lens.act(user, 'POST', `/v1/money/accounts/${opened.value.id}/test-money`, { amount_minor: minor, idempotency_key: `e2e-${randomUUID()}` })
    ctx.evidence.push({ note: `${minor} minor units of test money in it`, answer: said(funded) })
    if (!funded.ok) throw new Error(`putting test money in the ${currency} account answered ${said(funded)}`)
  } else if (minor > 0) {
    // Test money goes only into a company account; an agent's is funded as agent-wallet-kinds does: an invoice from it, paid by card.
    const invoice = await lens.act<{ pay_url?: string }>(user, 'POST', '/v1/money/invoices', { account_id: opened.value.id, customer_name: `Pocket ${RUN_SALT}`,
      lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: minor, vat_rate_bps: 0 }], due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true })
    ctx.evidence.push({ note: `an invoice of ${minor} minor units from ${agent}'s account, to fund it`, answer: said(invoice) })
    const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
    if (token === '') throw new Error(`issuing the funding invoice answered ${said(invoice)}`)
    const unpaid = await payInvoiceByCard(ctx, token)
    if (unpaid !== undefined) throw new Error(`paying the funding invoice by card: ${unpaid}`)
  }
  return opened.value
}

/** Lens's accounts now: the oracle for every amount that moves. */
export async function balances(ctx: ScenarioCtx, user = ctx.app.user): Promise<Map<string, number>> {
  const r = await ctx.env.lens.act<{ accounts: Account[] | null }>(user, 'GET', '/v1/money/accounts')
  if (!r.ok) throw new Error(`reading the accounts answered ${said(r)}`)
  return new Map((r.value.accounts ?? []).map((a) => [a.id, a.test_minor]))
}

/** A payee saved as the app saves one: an ordinary name, so the Test partner matches it. */
export async function payee(ctx: ScenarioCtx, name: string, accountNumber: string): Promise<string> {
  const p = await step<{ id: string }>(ctx, 'POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: accountNumber }, `the payee ${name}`)
  if (!p.ok) throw new Error(`saving ${name} answered ${said(p)}`)
  return p.value.id
}

/** Every Lens read the page makes answers `ids` as expired: what Lens answers the morning after an untouched request. */
async function morningAfter(page: Page, ids: readonly string[]): Promise<void> {
  const expire = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(expire)
    if (v === null || typeof v !== 'object') return v
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expire(x)]))
    return (ids.includes(String(o.id)) || ids.includes(String(o.approval_id))) && o.status === 'pending' ? { ...o, status: 'expired' } : o
  }
  await page.route((u) => u.pathname.startsWith('/api/'), async (route) => {
    const res = await route.fetch()
    const body = await res.text()
    if (!ids.some((id) => body.includes(id))) return route.fulfill({ response: res, body })
    let out = body
    try {
      out = JSON.stringify(expire(JSON.parse(body)))
    } catch { /* not JSON: as it came */ }
    await route.fulfill({ response: res, body: out })
  })
}

/** 3 — an expired approval says Expired on Approvals, Agent Wallets and its room's settings, and never blanks them (B55.7). */
export function expiredDraws(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Approvals',
    agents: 3,
    title: 'the morning after an untouched request, Approvals, Agent Wallets and the room\'s settings draw and say Expired',
    run: async (ctx) => {
      const { lens } = ctx.env
      const filed = await fileApproval(ctx, 'Expiry check')
      // A room's wallet files one too: the room's settings show its wallet's approvals.
      const room = await step<{ id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/rooms', { title: `Expiry room ${RUN_SALT}`, topic: `pocket-${RUN_SALT}`,
        visibility: 'private', description: 'A nightly test room.' }, 'the owner opens a private room')
      if (!room.ok) return fail(`opening a private room was refused: ${said(room)}`)
      const wallet = (await lens.room(ctx.app.user, room.value.id)).wallet
      if (wallet === undefined) return fail(`room ${room.value.id} shows its owner no wallet`)
      const wrong: string[] = []
      for (const [path, name] of [['/approvals', 'approvals'], ['/agents', 'agents'], [`/rooms/${room.value.id}/settings`, 'room-settings']] as const) {
        const page = await ctx.app.tab('/')
        try {
          await morningAfter(page, [filed.approval])
          await page.goto(new URL(path, page.url()).toString())
          for (const { width, text } of await bothSizes(ctx, page, `pocket-03-${name}`)) {
            if (BLANK.test(text)) wrong.push(`${path} at ${width}px could not be read`)
            // A room's wallet spends only through its room and files no approval of its own: its settings must draw.
            else if (name !== 'room-settings' && !/expired/i.test(text)) wrong.push(`${path} at ${width}px does not say Expired`)
          }
        } finally {
          await page.close()
        }
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'read as Lens answers it the morning after, the approval says Expired on Approvals and Agent Wallets, and the room\'s settings draw' }
    },
  }
}

/** A payment the assistant prepares in Chat: one item, to `to`. */
async function prepare(ctx: ScenarioCtx, to: string, minor: number, reference: string): Promise<Prepared> {
  const r = await ctx.env.lens.act<Prepared>(ctx.app.user, 'POST', '/v1/money/payment-requests',
    { client: 'chat', items: [{ payee_id: to, currency: 'GBP', amount_minor: minor, reference }] }, { 'Idempotency-Key': `e2e-${randomUUID()}` })
  ctx.evidence.push({ note: `the assistant prepares GBP ${(minor / 100).toFixed(2)} (${reference})`, answer: said(r) })
  if (!r.ok) throw new Error(`preparing the payment answered ${said(r)}`)
  return r.value
}

/** 5 — a prepared payment is on Approvals and Home with Review, and counted in the badge (B55.10). */
export function preparedListed(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Approvals',
    agents: 2,
    title: 'a payment the assistant prepares is listed on Approvals and Home with Review, and the badge counts it with an agent\'s approval',
    run: async (ctx) => {
      await acceptMoneyTerms(ctx)
      await account(ctx, 'GBP', 0)
      const name = `Acme Hosting ${RUN_SALT}`
      const req = await prepare(ctx, await payee(ctx, name, '31926819'), 34_000, `Hosting ${RUN_SALT}`)
      if (req.status !== 'pending_approval') return fail(`the prepared payment must wait for the person; Lens answered status ${req.status}`)
      await fileApproval(ctx, 'Badge check')
      const wrong: string[] = []
      for (const [path, shot] of [['/approvals', 'approvals'], ['/', 'home']] as const) {
        const page = await ctx.app.tab(path)
        try {
          await settled(page)
          for (const { width, text } of await bothSizes(ctx, page, `pocket-05-${shot}`)) {
            if (!text.includes(`prepared a payment to ${name}`)) wrong.push(`${path} at ${width}px does not list "Your assistant prepared a payment to ${name}"`)
          }
          const review = page.locator(`a[href$="/approve/${req.id}"]`).filter({ hasText: 'Review' })
          if ((await review.count()) === 0) wrong.push(`${path} has no Review opening /approve/${req.id}`)
          if (path === '/approvals') {
            const seen = await badgeReaches(page, 2, 5_000)
            if (seen !== 2) wrong.push(`with one agent's approval and one prepared payment waiting the Approvals badge reads ${seen}, not 2`)
          }
        } finally {
          await page.close()
        }
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `the prepared payment to ${name} is on Approvals and Home with Review, and the badge reads 2` }
    },
  }
}

/** 6 — a payment inside a permission the person signed is paid when it is prepared, and both sides are told (B55.21, B55.22). */
export function coveredPaid(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Approvals',
    title: 'a payment a signed permission covers is paid when the assistant prepares it, without a tap, and the person and the assistant are told',
    run: async (ctx) => {
      await acceptMoneyTerms(ctx)
      const from = await account(ctx, 'GBP', 20_000)
      const name = `Kite Accounting ${RUN_SALT}`
      const to = await payee(ctx, name, '42037920')
      const reg = await step<{ challenge: string; rp_id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const made = await step(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, `Pocket passkey ${RUN_SALT}`), 'the owner registers a passkey')
      if (made.status !== 201) return fail(`registering a passkey answered ${said(made)}`)
      const terms = await step<{ canonical: string; challenge: string }>(ctx, 'POST', '/v1/money/permission-mandates/prepare', {
        principal: { type: 'person', name: 'Pocket Person' }, clients: ['chat'], scope: { payees: [to], currencies: ['GBP'] },
        limits: { per_payment: { GBP: 10_000 } }, new_payee: { policy: 'confirmation_of_payee' }, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }, `the owner prepares a permission: Chat may pay ${name} up to £100 a payment`)
      if (!terms.ok) return fail(`preparing the permission answered ${said(terms)}`)
      const signed = await step<{ status: string }>(ctx, 'POST', '/v1/money/permission-mandates', { canonical: terms.value.canonical, assertion: key.assert(terms.value.challenge) }, 'the owner signs it')
      if (!signed.ok || signed.value.status !== 'active') return fail(`the signed permission must be active; Lens answered ${said(signed)}`)

      const before = (await balances(ctx)).get(from.id) ?? 0
      const req = await prepare(ctx, to, 4_000, `Books ${RUN_SALT}`)
      const after = (await balances(ctx)).get(from.id) ?? 0
      const payments = await step<{ payments: { amount_minor: number; reference?: string }[] | null }>(ctx, 'GET', '/v1/money/payments', undefined, 'the payments')
      const paid = (payments.ok ? payments.value.payments ?? [] : []).filter((p) => p.amount_minor === 4_000)
      const wrong: string[] = []
      if (before - after !== 4_000 || paid.length !== 1) {
        wrong.push(`£40.00 inside the signed permission must be paid when prepared: the account moved ${before - after} and Lens lists ${paid.length} payment(s) of 4000; the request is ${req.status}`)
      }
      const page = await ctx.app.tab(`/approve/${req.id}`)
      try {
        for (const { width, text } of await bothSizes(ctx, page, 'pocket-06-approve')) {
          if (!text.includes('Paid without asking you')) wrong.push(`/approve/${req.id} at ${width}px does not say "Paid without asking you"`)
        }
      } finally {
        await page.close()
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `£40.00 to ${name} was paid when prepared: one payment, the account down 4000; the Approve page says it was paid without asking` }
    },
  }
}

/** 9 — raising a limit asks for the passkey, lowering one saves at once (B55.13, B55.14). */
export function looseningSigned(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Agent Wallets',
    agents: 1,
    title: "with a passkey, raising an agent's daily limit is refused unsigned on Lens and asks for the passkey on the web; lowering it saves at once",
    run: async (ctx) => {
      const { lens } = ctx.env
      const bank = await AgentBankScreen.open(ctx.app)
      try {
        const made = await turnOnPasskey(ctx, bank.page)
        if (made !== undefined) return fail(made)
        const made2 = await lens.createAgent(ctx.app.user, `Loosen check ${RUN_SALT}`)
        const agent = (await lens.agentBook(ctx.app.user)).agents.find((a) => a.id === made2.id)
        if (agent === undefined) return fail(`the agent ${made2.id} is not in the workspace's book`)
        const rules = await lens.agentRules(ctx.app.user, agent.id)
        const wrong: string[] = []
        const raised = await step(ctx, 'PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...rules, daily_limit_ulxc: 50_000_000 }, 'raising the daily limit to 50 LXC, unsigned')
        if (raised.status !== 403) wrong.push(`raising the daily limit unsigned must be refused 403 once the workspace has a passkey; Lens answered ${said(raised)}`)
        // On the web: the raise must sign, the lower must not.
        const signedPuts: boolean[] = []
        bank.page.on('request', (r) => {
          if (r.method() === 'PUT' && r.url().includes(`/agents/${agent.id}/rules`)) signedPuts.push((r.postData() ?? '').includes('"assertion"'))
        })
        const up = await bank.setLimit(agent, 'Daily limit', 40_000_000)
        if (up !== undefined || signedPuts.at(-1) !== true) wrong.push(`raising the daily limit on the web must ask for the passkey and save signed; it ${up === undefined ? 'saved unsigned' : `said "${up}"`}`)
        const down = await bank.setLimit(agent, 'Daily limit', 1_000_000)
        if (down !== undefined || signedPuts.at(-1) !== false) wrong.push(`lowering the daily limit must save at once, unsigned; it ${down === undefined ? 'asked for the passkey' : `said "${down}"`}`)
        const kept = (await lens.agentRules(ctx.app.user, agent.id)).daily_limit_ulxc
        if (kept !== 1_000_000) wrong.push(`Lens holds a daily limit of ${kept} µLXC, not the 1 LXC saved last`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return { pass: true, detail: 'raising unsigned was refused 403; the web raised it signed and lowered it at once' }
      } finally {
        await bank.close()
      }
    },
  }
}

/** 10 — Pause every agent stops a payee's pull under a mandate until the agents start again (B55.23). */
export function pausedPull(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Agent Wallets',
    agents: 1,
    title: "with every agent paused, a payee's pull under a mandate is refused and moves nothing; started again, it is paid",
    run: async (ctx) => {
      const { lens } = ctx.env
      const owner = ctx.app.user
      await acceptMoneyTerms(ctx)
      const agent = await lens.createAgent(owner, `Mandate payer ${RUN_SALT}`)
      await account(ctx, 'GBP', 0)
      const from = await account(ctx, 'GBP', 10_000, agent.id)
      const [company] = await lens.createUsers(1)
      await acceptMoneyTerms(ctx, company)
      const into = await account(ctx, 'GBP', 0, undefined, company)
      const granted = await step<{ id: string }>(ctx, 'POST', '/v1/money/mandates', { account_id: from.id, payee_workspace_id: company.workspaceID, payee_name: 'Pocket Supplier',
        max_per_pull_minor: 1_000, max_per_month_minor: 10_000, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }, 'the owner grants the supplier a mandate on the agent\'s account')
      if (!granted.ok) return fail(`granting the mandate answered ${said(granted)}`)
      const pull = async (note: string) => {
        const r = await lens.act(company, 'POST', `/v1/money/mandates/${granted.value.id}/pull`, { amount_minor: 500, idempotency_key: `e2e-${randomUUID()}`, funding: 'test', memo: note })
        ctx.evidence.push({ note: `the supplier pulls £5.00, ${note}`, answer: said(r) })
        return r
      }
      const moved = async () => [(await balances(ctx)).get(from.id) ?? 0, (await balances(ctx, company)).get(into.id) ?? 0]
      const wrong: string[] = []
      const [a0, b0] = await moved()
      if (!(await pull('before the pause')).ok) return fail('the first pull under the mandate was refused, before any pause')
      const [a1, b1] = await moved()
      if (a0 - a1 !== 500 || b1 - b0 !== 500) return fail(`the first pull must move £5.00; the agent's account moved ${a0 - a1} and the supplier's ${b1 - b0}`)
      const paused = await step(ctx, 'POST', '/v1/workspaces/{ws}/agents/pause-all', {}, 'the owner pauses every agent')
      if (!paused.ok) return fail(`pausing every agent answered ${said(paused)}`)
      const refused = await pull('while every agent is paused')
      const [a2, b2] = await moved()
      if (refused.ok || a2 !== a1 || b2 !== b1) wrong.push(`with every agent paused the pull must be refused and move nothing; Lens answered ${said(refused)}, the accounts moved ${a1 - a2} and ${b2 - b1}`)
      const resumed = await step(ctx, 'POST', '/v1/workspaces/{ws}/agents/resume-all', {}, 'the owner starts every agent again')
      if (!resumed.ok) return fail(`starting every agent again answered ${said(resumed)}`)
      const again = await pull('once the agents are started again')
      const [a3] = await moved()
      if (!again.ok || a2 - a3 !== 500) wrong.push(`started again, the pull must be paid; Lens answered ${said(again)} and the account moved ${a2 - a3}`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'pulled £5.00, refused while every agent was paused with nothing moved, paid again once started' }
    },
  }
}

/** 17 — Decline with a reason: the same request is refused for 24 hours naming it, and the owner is not asked again (B55.18, B55.19). */
export function declineHolds(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Approvals',
    agents: 2,
    title: 'declined with a reason, the same payment is refused naming it with no new approval; Approvals says Decline and never Deny',
    run: async (ctx) => {
      const { lens } = ctx.env
      const filed = await fileApproval(ctx, 'Decline check')
      const wrong: string[] = []
      const page = await ctx.app.tab('/approvals')
      try {
        await settled(page)
        const shown = await bothSizes(ctx, page, 'pocket-17-approvals')
        if ((await page.getByRole('button', { name: /^Decline\b/ }).count()) === 0) wrong.push('Approvals has no Decline button on the waiting approval')
        for (const { width, text } of shown) if (/\bDen(y|ied)\b/.test(text)) wrong.push(`Approvals at ${width}px still says Deny or Denied`)
      } finally {
        await page.close()
      }
      const denied = await step(ctx, 'POST', `/v1/workspaces/{ws}/agents/approvals/${filed.approval}/deny`, { reason: 'not this month' }, 'the owner declines, "not this month"')
      if (!denied.ok) return fail(`declining with a reason answered ${said(denied)}`)
      const pending = async () => (await lens.agentApprovals(ctx.app.user)).filter((a) => a.agent_id === filed.payer.id && a.status === 'pending').length
      const retry = await filed.again()
      if (retry.ok || !said(retry).includes('not this month')) wrong.push(`the same payment after the decline must be refused naming "not this month"; Lens answered ${said(retry)}`)
      const waiting = await pending()
      if (waiting !== 0) wrong.push(`the retry filed ${waiting} new approval(s); the owner must not be asked again for 24 hours`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'Approvals says Decline; the same payment was refused naming the reason, with no new approval' }
    },
  }
}
