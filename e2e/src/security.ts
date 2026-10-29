// B50.7 — THE SECURITY RED TEAM, EVERY NIGHT. The families the red-team chain (deep.ts) did not yet play, each on a
// workspace of its own, at gentle volume — one request per attempt, nothing sent at once:
//   money-tampered — an agent funded once under an Idempotency-Key, then the same key with the amount changed, and
//        fundings whose amount is negative, zero, a fraction, a string, past int64 or missing: the changed body never
//        lands, each tampered one is refused 4xx, and the agent's postings are exactly the seed and the one keyed move.
//        A GBP payment request with a made-up currency, a currency in the wrong case, a negative, fractional or
//        string amount is refused 4xx, and no payment is made.
//   approval-reused — two payment requests, A and B, each needing the owner's approval. A's signed approval presented
//        at B, and B's own statement signed over A's challenge, are each refused; B is still pending_approval, holds no
//        payment and no payment out exists. The control: A's own approval at A is taken.
//   approval-own-request (B50.19) — an agent's two held payments to one payee for one amount: approving one on Approvals
//        pays that one only, and approving a third with always allow still leaves the other waiting; the payee's statement.
//   passkey-enrol-signed (B50.22) — with passkey A registered, a passkey B sent through the web app's own calls with no
//        signature is refused, and B's signature cannot approve an agent's held payment; signed by A, B registers and
//        its approval pays. The approval row and the payee's statement.
//   csrf-every-write — every write route the BFF registers (apps/bff lens.go), sent once with the session cookie from
//        another site: each is refused 403 before any handler runs, except the machine endpoints the BFF names exempt.
//   xss-shown-back — an agent's name, a saved payee's name and an invoice's customer and line, each carrying an event
//        handler and a <script>, are shown on their screens and nothing in them runs. A field Lens refuses the payload
//        for is safe too, and says so.
// Prompt injection by a web page and by a Room message is injection.ts's scenario on those two channels.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Dialog } from 'playwright'
import { ACTION_TIMEOUT_MS, approveRow, fail } from './bank.ts'
import { bffRoutesFrom } from './coverage.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { FLAG, ran, runnable, sendAs, SESSION_COOKIE } from './session.ts'

const SEED_ULXC = 50_000
const KEYED_ULXC = 3_101
const OWN_FUND_ULXC = 1_000_000
const OWN_PAY_ULXC = 300_000

/** The amounts a tampered funding carries, each with why it must be refused. */
export const TAMPERED_AMOUNTS: [string, unknown][] = [
  ['negative', -1_000], ['zero', 0], ['a fraction', 1.5], ['a string', '1000'], ['past int64', 9_223_372_036_854_775_808],
  ['a float past int64', 1e21], ['null', null], ['missing', undefined],
]

/** A GBP payment request item, tampered: each must be refused before a request is made. */
export const TAMPERED_ITEMS: [string, Record<string, unknown>][] = [
  ['a made-up currency', { currency: 'XQZ', amount_minor: 100 }],
  ['a lower-case currency', { currency: 'gbp', amount_minor: 100 }],
  ['an empty currency', { currency: '', amount_minor: 100 }],
  ['a negative amount', { currency: 'GBP', amount_minor: -100 }],
  ['a fractional amount', { currency: 'GBP', amount_minor: 0.5 }],
  ['a string amount', { currency: 'GBP', amount_minor: '100' }],
]

/** A refusal: 4xx. A 2xx took it and a 5xx is a crash, both wrong. */
export const refused = (status: number): boolean => status >= 400 && status < 500

const done = (wrong: string[], pass: string): Verdict => (wrong.length > 0 ? fail(wrong.join('; ')) : { pass: true, detail: pass })

interface Payment { id: string; payee_id: string }
interface Request { id: string; status: string; items: { position: number; decision: string; payment_id?: string; pay_status?: string }[] | null }

/** An owner's call, recorded as evidence. */
function caller(ctx: ScenarioCtx) {
  return async <T>(method: string, path: string, body: object | undefined, note: string, headers: Record<string, string> = {}): Promise<Answered<T>> => {
    const got = await ctx.env.lens.act<T>(ctx.app.user, method, path, body, headers)
    ctx.evidence.push({ note, answer: said(got) })
    return got
  }
}

/** A GBP account and a saved payee, the least a payment request needs; a setup Lens refuses is an ERROR, never a finding. */
async function payeeReady(ctx: ScenarioCtx, name: string): Promise<string> {
  const call = caller(ctx)
  const opened = await call('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account')
  if (opened.status !== 201) throw new Error(`opening a GBP account answered ${said(opened)}`)
  const p = await call<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: '35792461' }, `the owner saves ${name}`)
  if (p.status !== 201 || !p.ok) throw new Error(`saving ${name} answered ${said(p)}`)
  return p.value.id
}

export function moneyTampered(): Scenario {
  return {
    id: 'money-tampered',
    owner: 'talyvor-lens',
    own: true,
    plan: 'team',
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B50.7'],
    title: 'an Idempotency-Key sent again with a changed amount never lands; fundings with a negative, zero, fractional, string, past-int64 or missing ' +
      'amount and GBP payment requests with a made-up or mis-cased currency or a negative, fractional or string amount are each refused 4xx; ' +
      "the agent's postings are the seed and the one keyed move, and no payment is made",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const wrong: string[] = []
      const agent = await lens.createAgent(user, `Tamper ${RUN_SALT}`)
      const fund = (amount: unknown, key: string) =>
        lens.act(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/fund`, amount === undefined ? {} : { amount_ulxc: amount }, { 'Idempotency-Key': key })
      const seeded = await fund(SEED_ULXC, randomUUID())
      if (!seeded.ok) throw new Error(`funding ${agent.name} answered ${said(seeded)}`)

      // The same key with a changed body: the first lands, the second must not.
      const key = randomUUID()
      const first = await fund(KEYED_ULXC, key)
      if (!first.ok) throw new Error(`the keyed funding answered ${said(first)}`)
      const changed = await fund(KEYED_ULXC * 2, key)
      ctx.evidence.push({ note: `the same Idempotency-Key with ${KEYED_ULXC * 2} µLXC in place of ${KEYED_ULXC}`, answer: said(changed) })
      for (const [why, amount] of TAMPERED_AMOUNTS) {
        const got = await fund(amount, randomUUID())
        ctx.evidence.push({ note: `a funding whose amount is ${why}`, answer: said(got) })
        if (!refused(got.status)) wrong.push(`a funding whose amount is ${why} answered ${said(got)}, not a refusal`)
      }

      // The ledger: the agent's postings are the seed and the keyed move, once.
      const lines = await lens.agentLines(user, agent.id)
      const amounts = lines.map((l) => l.amount_ulxc).sort((a, b) => a - b)
      ctx.evidence.push({ note: `${agent.name}'s postings: ${amounts.join(', ') || 'none'}` })
      if (amounts.join() !== [KEYED_ULXC, SEED_ULXC].join()) {
        wrong.push(`${agent.name}'s postings are ${amounts.join(', ') || 'none'} µLXC, not the seed ${SEED_ULXC} and the keyed ${KEYED_ULXC} once` +
          (amounts.includes(KEYED_ULXC * 2) ? ': the changed body under a used key landed' : ''))
      }

      // Tampered payment requests: refused, and nothing paid.
      const call = caller(ctx)
      const payee = await payeeReady(ctx, `Nightly Tamper Ltd ${RUN_SALT}`)
      for (const [why, tamper] of TAMPERED_ITEMS) {
        const got = await call('POST', '/v1/money/payment-requests', { client: 'chat', items: [{ payee_id: payee, reference: 'TAMPER', ...tamper }] },
          `a payment request with ${why}`, { 'Idempotency-Key': randomUUID() })
        if (!refused(got.status)) wrong.push(`a payment request with ${why} answered ${said(got)}, not a refusal`)
      }
      const payments = await call<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, 'the owner lists the payments')
      if (!payments.ok) throw new Error(`listing the payments answered ${said(payments)}`)
      if ((payments.value.payments ?? []).length > 0) wrong.push(`tampered requests made ${(payments.value.payments ?? []).length} payment(s)`)
      return done(wrong, `the changed body under a used key did not land; ${TAMPERED_AMOUNTS.length} tampered fundings and ${TAMPERED_ITEMS.length} tampered ` +
        `payment requests refused 4xx; ${agent.name} holds the seed and the keyed move once; no payment made`)
    },
  }
}

export function approvalReused(): Scenario {
  return {
    id: 'approval-reused',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B50.7'],
    title: "a payment request's signed approval presented at another request, and that request's statement signed over the first's challenge, " +
      "are each refused; the other request stays pending_approval with no payment and no payment out exists; the approval's own request takes it",
    run: async (ctx) => {
      const call = caller(ctx)
      const wrong: string[] = []
      const payee = await payeeReady(ctx, `Nightly Approval Ltd ${RUN_SALT}`)
      const pk = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!pk.ok) throw new Error(`the passkey challenge answered ${said(pk)}`)
      const key = softPasskey(pk.value.rp_id)
      const made = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(pk.value.challenge, 'Nightly approval passkey'), 'the owner registers a passkey')
      if (made.status !== 201) throw new Error(`registering a passkey answered ${said(made)}`)

      const prepare = async (amount: number, ref: string) => {
        const r = await call<Request>('POST', '/v1/money/payment-requests', { client: 'chat', items: [{ payee_id: payee, currency: 'GBP', amount_minor: amount, reference: ref }] },
          `chat prepares ${amount} minor to the payee`, { 'Idempotency-Key': randomUUID() })
        if (!r.ok || r.value.status !== 'pending_approval') throw new Error(`a request needing approval answered ${said(r)}`)
        return r.value.id
      }
      const a = await prepare(1_200, 'APPROVAL-A')
      const b = await prepare(90_000, 'APPROVAL-B')
      const toSign = async (id: string) => {
        const s = await call<{ statement: string; challenge: string }>('POST', `/v1/money/payment-requests/${id}/approval`, {}, `the statement approving ${id}`)
        if (!s.ok) throw new Error(`the statement for ${id} answered ${said(s)}`)
        return s.value
      }
      const sa = await toSign(a)
      const approvalA = { statement: sa.statement, assertion: key.assert(sa.challenge) }
      const atB = await call('POST', `/v1/money/payment-requests/${b}/approve`, approvalA, "A's signed approval presented at B")
      if (!refused(atB.status)) wrong.push(`A's signed approval presented at B answered ${said(atB)}, not a refusal`)
      const sb = await toSign(b)
      const crossed = await call('POST', `/v1/money/payment-requests/${b}/approve`, { statement: sb.statement, assertion: approvalA.assertion }, "B's statement with A's signature")
      if (!refused(crossed.status)) wrong.push(`B's statement signed over A's challenge answered ${said(crossed)}, not a refusal`)

      // The control: A's approval at A is taken; then B again, after A has used it.
      const atA = await call('POST', `/v1/money/payment-requests/${a}/approve`, approvalA, "A's own approval at A")
      if (atA.status !== 200) throw new Error(`the control, A's own approval at A, answered ${said(atA)}`)
      const later = await call('POST', `/v1/money/payment-requests/${b}/approve`, approvalA, "A's used approval at B")
      if (!refused(later.status)) wrong.push(`A's used approval presented at B answered ${said(later)}, not a refusal`)

      // The oracle: B is untouched and no payment of B's exists.
      const readB = await call<Request>('GET', `/v1/money/payment-requests/${b}`, undefined, 'the owner reads B')
      if (!readB.ok) throw new Error(`reading B answered ${said(readB)}`)
      const paidB = (readB.value.items ?? []).filter((it) => (it.payment_id ?? '') !== '')
      if (readB.value.status !== 'pending_approval' || paidB.length > 0) wrong.push(`B reads ${readB.value.status} with ${paidB.length} item(s) paid, not pending_approval and unpaid`)
      const payments = await call<{ payments: (Payment & { amount_minor: number })[] | null }>('GET', '/v1/money/payments', undefined, 'the owner lists the payments')
      if (!payments.ok) throw new Error(`listing the payments answered ${said(payments)}`)
      const ofB = (payments.value.payments ?? []).filter((p) => p.amount_minor === 90_000)
      if (ofB.length > 0) wrong.push(`${ofB.length} payment(s) of B's 90,000 minor exist: ${ofB.map((p) => p.id).join(', ')}`)
      return done(wrong, "A's approval refused at B before and after A used it, B's statement over A's signature refused; B pending and unpaid, no payment of B's; A's own approval taken")
    },
  }
}

/** How the owner decides one held payment, found by its memo: plain Approve, or "Approve and always allow" up to `allowLXC` a month. */
export type Decide = (ctx: ScenarioCtx, memo: string, allowLXC?: number) => Promise<string>

/** The nightly's way: on /approvals in a tab of its own, the row whose words carry `memo`; the line the screen then shows. */
export const onApprovals: Decide = async (ctx, memo, allowLXC) => {
  const page = await ctx.app.tab('/approvals')
  try {
    await page.getByRole('heading', { level: 1, name: 'Approvals' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
    if (allowLXC === undefined) return await approveRow(page, memo)
    const row = page.locator('[data-approval]').filter({ hasText: memo }).first()
    await row.getByRole('button', { name: 'Approve and always allow this…' }).click({ timeout: ACTION_TIMEOUT_MS })
    await row.getByLabel(/^Always allow .* up to, in LXC$/).fill(String(allowLXC))
    await row.getByLabel('Each').selectOption('month')
    await row.getByRole('button', { name: 'Preview', exact: true }).click()
    await row.getByTestId('always-allow-preview').or(row.getByRole('alert')).first().waitFor({ timeout: ACTION_TIMEOUT_MS })
    await row.getByRole('button', { name: /^Approve and always allow( with Face ID)?$/ }).click()
    const said = page.getByRole('status').filter({ hasText: /From now on/ }).or(page.getByRole('alert')).first()
    await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await said.innerText()).trim()
  } finally {
    await page.close()
  }
}

/**
 * B50.19 — an approval approves only its own request (Lens B50.18). An agent above its approval amount pays one payee
 * one amount twice, A and B, under different memos; the owner approves A on /approvals. The agent sends both again:
 * A pays, B is refused and still waits. Then a third, C, is approved with "always allow" for that payee, which B would
 * fit under; B sent again is still refused and waits for its own tap. The oracle is the payee's statement: A and C in,
 * nothing of B's.
 */
export function approvalOwnRequest(decide: Decide = onApprovals): Scenario {
  return {
    id: 'approval-own-request',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B50.19'],
    title: "two held payments to one payee for one amount: approving one on Approvals pays only that one, the other is refused on retry and " +
      "still waits; approving a third with always allow leaves it waiting; the payee's statement holds the two approved and nothing of the other",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const wrong: string[] = []
      const payer = await lens.createAgent(user, `Own approval payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Own approval payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < OWN_FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${OWN_FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, OWN_FUND_ULXC)
      const ruled = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { approval_above_ulxc: OWN_PAY_ULXC / 2 })
      if (!ruled.ok) throw new Error(`setting ${payer.name}'s approval amount answered ${said(ruled)}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'approval-own-request' })
      if (!k.ok) throw new Error(`issuing ${payer.name} a key answered ${said(k)}`)
      const memo = (x: string) => `own approval ${x} ${RUN_SALT}`
      const pay = async (x: string) => {
        const got = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, OWN_PAY_ULXC, memo(x))
        ctx.evidence.push({ note: `${payer.name} pays ${OWN_PAY_ULXC} µLXC, "${memo(x)}"`, answer: said(got) })
        return got
      }
      const statusOf = async (x: string) => (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.memo === memo(x))?.status ?? 'none'
      const held = async (x: string) => {
        const got = await pay(x)
        if (got.ok || (await statusOf(x)) !== 'pending') throw new Error(`a payment above the approval amount was not held: ${said(got)}`)
      }
      const decided = async (x: string, allowLXC?: number) => {
        const line = await decide(ctx, memo(x), allowLXC)
        ctx.evidence.push({ note: `the owner ${allowLXC === undefined ? 'approves' : `approves with always allow up to ${allowLXC} LXC a month`} "${memo(x)}": ${line}` })
        if ((await statusOf(x)) !== 'approved') throw new Error(`approving "${memo(x)}" left it ${await statusOf(x)} in Lens: "${line}"`)
      }
      const stillWaits = async (when: string) => {
        const again = await pay('B')
        if (again.ok) wrong.push(`${when}, B sent again was paid: ${said(again)}`)
        const now = await statusOf('B')
        if (now !== 'pending') wrong.push(`${when}, B's approval is ${now}, not pending`)
      }

      await held('A')
      await held('B')
      await decided('A')
      const paidA = await pay('A')
      if (!paidA.ok) throw new Error(`A, approved, sent again was refused: ${said(paidA)}`)
      await stillWaits('after A was approved')
      await held('C')
      await decided('C', 3 * OWN_PAY_ULXC / 1e6)
      await stillWaits('after C was approved with always allow')
      const paidC = await pay('C')
      if (!paidC.ok) wrong.push(`C, approved, sent again was refused: ${said(paidC)}`)

      // The oracle: the payee's statement holds A and C in, nothing more.
      const into = (await lens.agentLines(user, payee.id)).map((l) => l.amount_ulxc)
      ctx.evidence.push({ note: `${payee.name}'s postings: ${JSON.stringify(into)}` })
      if (into.join() !== [OWN_PAY_ULXC, OWN_PAY_ULXC].join()) {
        wrong.push(`${payee.name}'s statement holds ${JSON.stringify(into)}, not A's and C's ${OWN_PAY_ULXC} each and nothing of B's`)
      }
      return done(wrong, `A approved on Approvals paid; B, the same payee and amount, refused when sent again and still pending; C approved with ` +
        `always allow paid and B still refused and pending; ${payee.name}'s statement holds ${OWN_PAY_ULXC} twice, nothing of B's`)
    },
  }
}

/** The BFF's write routes, from its registrations: each method that writes, a route open to any method as POST, `{x}` filled in. */
export function writeRoutes(lensGo: string): { method: string; path: string }[] {
  const out = new Map<string, { method: string; path: string }>()
  for (const e of bffRoutesFrom(lensGo)) {
    const method = e.method === 'ANY' ? 'POST' : e.method
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue
    const path = e.path.replace(/\{[^}]+\}/g, 'b507').replace(/\/$/, '/b507')
    out.set(`${method} ${path}`, { method, path })
  }
  return [...out.values()]
}

/** The writes apps/bff lens.go originExemptPath lets through without an Origin: machine callers that authenticate themselves. */
export const ORIGIN_EXEMPT = new Set(['/oauth/register', '/oauth/token', '/oauth/revoke', '/mcp', '/auth/mobile/session'])

export function csrfEveryWrite(): Scenario {
  return {
    id: 'csrf-every-write',
    owner: 'talyvor-suite',
    own: true,
    feature: 'Session and sign-in',
    items: ['B50.7'],
    title: 'every write route the BFF registers, sent once with the session cookie from another site, is refused 403 before any handler runs',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const session = (await ctx.app.context.cookies(origin)).find((c) => c.name === SESSION_COOKIE)
      if (session === undefined) throw new Error('the browser holds no session cookie')
      const routes = writeRoutes(await readFile(new URL('../../apps/bff/lens.go', import.meta.url), 'utf8')).filter((r) => !ORIGIN_EXEMPT.has(r.path))
      const taken: string[] = []
      for (const r of routes) {
        const got = await sendAs(`${origin}${r.path}`, r.method, `${SESSION_COOKIE}=${session.value}`, 'https://evil.example', {})
        if (got.status !== 403 || !got.text.includes('cross-origin write refused')) taken.push(`${r.method} ${r.path} → ${got.status} ${got.text.slice(0, 80)}`)
      }
      ctx.evidence.push({ note: `${routes.length} write routes sent from https://evil.example with the session cookie; ${taken.length} not refused` })
      return done(taken.length > 0 ? [`${taken.length} of ${routes.length} BFF write routes were not refused from another site: ${taken.slice(0, 8).join('; ')}`] : [],
        `all ${routes.length} BFF write routes refused 403 from another site`)
    },
  }
}

/** A name that runs if a screen ever renders it as HTML; `marker` finds it on the screen. */
export const xssName = (marker: string, where: string) => `${marker} <img src=x onerror="window.${FLAG}='${where}'"><script>window.${FLAG}='${where} script'</script>`

export function xssShownBack(): Scenario {
  return {
    id: 'xss-shown-back',
    owner: 'talyvor-suite',
    own: true,
    plan: 'team',
    agents: 1,
    items: ['B50.7'],
    title: "an agent's name, a saved payee's name and an invoice's customer and line, each carrying an event handler and a <script>, are shown on " +
      'their screens and nothing runs: no flag, no dialog, no script or handler on the page; a field Lens refuses the payload for is safe too',
    run: async (ctx) => {
      const { app } = ctx
      const call = caller(ctx)
      const marker = `b507xss${RUN_SALT}`.replace(/[^a-z0-9]/gi, '').slice(0, 20)
      const wrong: string[] = []
      const shown: { screen: string; field: string }[] = []
      const kept = (field: string, got: Answered<unknown>, screen: string) => {
        if (got.ok) shown.push({ screen, field })
        else if (got.status >= 500) wrong.push(`saving ${field} with the payload answered ${said(got)}`)
        else ctx.evidence.push({ note: `${field}: Lens refused the payload at entry (${got.status}), so it is never shown` })
      }
      const agent = await call('POST', '/v1/workspaces/{ws}/agents', { name: xssName(marker, 'agent name') }, 'an agent named with the payload')
      kept('the agent name', agent, '/agents')
      await call('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account')
      const payee = await call('POST', '/v1/money/payees', { name: xssName(marker, 'payee name'), country: 'GB', sort_code: '040004', account_number: '35792462' },
        'a payee named with the payload')
      kept('the payee name', payee, '/money/pay')
      const accounts = await call<{ accounts: { id: string }[] | null }>('GET', '/v1/money/accounts', undefined, 'the accounts')
      const invoice = await call('POST', '/v1/money/invoices', {
        account_id: accounts.ok ? accounts.value.accounts?.[0]?.id : '', customer_name: xssName(marker, 'invoice customer'),
        lines: [{ description: xssName(marker, 'invoice line'), quantity: 1, unit_amount_minor: 100, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      }, 'an invoice whose customer and line carry the payload')
      kept('the invoice customer and line', invoice, '/money/invoices')

      for (const screen of [...new Set(shown.map((s) => s.screen))]) {
        const page = await app.tab(screen)
        const dialogs: string[] = []
        page.on('dialog', (d: Dialog) => {
          dialogs.push(d.message())
          void d.dismiss().catch(() => undefined)
        })
        try {
          // A screen that never shows the field proves nothing: an ERROR, not a pass.
          await page.getByText(marker).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {
            throw new Error(`${screen} never showed ${shown.filter((s) => s.screen === screen).map((s) => s.field).join(' and ')}`)
          })
          await page.waitForTimeout(1_500)
          const flags = await ran(page)
          const live = await runnable(page.locator('main'))
          ctx.evidence.push({ note: `${screen}: flags ${flags.join(', ') || 'none'}; dialogs ${dialogs.length}; runnable ${live.join(' ') || 'none'}` })
          if (flags.length > 0) wrong.push(`${screen} ran the payload: ${flags.join(', ')}`)
          if (dialogs.length > 0) wrong.push(`${screen} opened ${dialogs.length} dialog(s)`)
          if (live.length > 0) wrong.push(`${screen} holds ${live.slice(0, 4).join(' ')}`)
        } finally {
          await page.close()
        }
      }
      return done(wrong, `${shown.map((s) => s.field).join(', ') || 'no field'} shown on ${[...new Set(shown.map((s) => s.screen))].join(', ') || 'no screen'} with nothing run`)
    },
  }
}

const ENROL_PAY_ULXC = 200_000

/** How a scenario sends the web app's own POST to the BFF: `path` under /api, as the signed-in owner. */
export type Post = (ctx: ScenarioCtx, path: string, body: unknown) => Promise<{ status: number; text: string }>

/** The nightly's way: from the owner's signed-in browser, as the page's own fetch would. */
export const throughApp: Post = async (ctx, path, body) => {
  const origin = new URL(ctx.app.page.url()).origin
  const r = await ctx.app.page.request.post(`${origin}${path}`, { headers: { Origin: origin }, data: body ?? {} })
  return { status: r.status(), text: await r.text() }
}

/**
 * B50.22 — a second passkey is signed by one the workspace has (Lens B50.20). Through the web app's own BFF calls: the
 * owner registers passkey A, free as the first; passkey B, sent with no signature, is refused, and B's signature over an
 * agent's held payment is refused too — the approval row stays pending and the payee's statement empty. B signed by A
 * over B's own challenge registers, and B then approves: the row reads approved and the payment, sent again, lands.
 */
export function passkeyEnrolSigned(post: Post = throughApp): Scenario {
  return {
    id: 'passkey-enrol-signed',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B50.22'],
    title: "with a passkey registered, a second one with no signature is refused and cannot approve an agent's payment; signed by the first, " +
      "it registers and its approval pays: the approval row and the payee's statement",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const wrong: string[] = []
      const bff = async <T>(path: string, body: unknown, note: string): Promise<{ status: number; value: T }> => {
        const { status, text } = await post(ctx, path, body)
        ctx.evidence.push({ note, answer: `${status} ${text.slice(0, 300)}` })
        let value = {} as T
        try { value = JSON.parse(text) as T } catch { /* a refusal's body is shown in the evidence */ }
        return { status, value }
      }
      type Challenge = { challenge: string; rp_id: string; credential_ids?: string[] | null }
      const challenge = async (why: string) => {
        const c = await bff<Challenge>('/api/agents/passkeys/challenge', {}, `the owner asks to register a passkey: ${why}`)
        if (c.status !== 200 || !c.value.challenge) throw new Error(`the passkey challenge answered ${c.status}`)
        return c.value
      }
      const listed = async (): Promise<{ credential_id: string }[]> => {
        const got = await lens.act<{ passkeys: { credential_id: string }[] | null }>(user, 'GET', '/v1/workspaces/{ws}/agents/passkeys', undefined)
        if (!got.ok) throw new Error(`listing the passkeys answered ${said(got)}`)
        return got.value.passkeys ?? []
      }

      const c1 = await challenge('the first')
      const a = softPasskey(c1.rp_id)
      const b = softPasskey(c1.rp_id)
      const first = await bff('/api/agents/passkeys', a.register(c1.challenge, 'Nightly enrol A'), 'the owner registers passkey A, the first')
      if (first.status !== 201) throw new Error(`the first passkey, free, answered ${first.status}`)

      const c2 = await challenge('a second, B')
      if (!(c2.credential_ids ?? []).includes(a.credentialID)) wrong.push(`the challenge for a second passkey lists ${JSON.stringify(c2.credential_ids)}, not A to sign with`)
      const unsigned = await bff('/api/agents/passkeys', b.register(c2.challenge, 'Nightly enrol B, unsigned'), 'passkey B with no signature')
      if (!refused(unsigned.status)) wrong.push(`passkey B with no signature answered ${unsigned.status}, not a refusal`)
      if ((await listed()).some((k) => k.credential_id === b.credentialID)) wrong.push('passkey B, sent with no signature, is listed on the workspace')

      // An agent above its approval amount pays another; B tries to approve it.
      const payer = await lens.createAgent(user, `Enrol payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Enrol payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < ENROL_PAY_ULXC * 2) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${ENROL_PAY_ULXC * 2} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, ENROL_PAY_ULXC * 2)
      const ruled = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { approval_above_ulxc: ENROL_PAY_ULXC / 2 })
      if (!ruled.ok) throw new Error(`setting ${payer.name}'s approval amount answered ${said(ruled)}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'passkey-enrol-signed' })
      if (!k.ok) throw new Error(`issuing ${payer.name} a key answered ${said(k)}`)
      const memo = `enrol signed ${RUN_SALT}`
      const pay = async (note: string) => {
        const got = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, ENROL_PAY_ULXC, memo)
        ctx.evidence.push({ note: `${payer.name} pays ${ENROL_PAY_ULXC} µLXC: ${note}`, answer: said(got) })
        return got
      }
      await pay('held for a person')
      const held = (await lens.agentApprovals(user)).find((x) => x.agent_id === payer.id && x.memo === memo)
      if (held?.status !== 'pending') throw new Error(`a payment above the approval amount was not held: its approval is ${held?.status ?? 'missing'}`)
      const row = async () => (await lens.agentApprovals(user)).find((x) => x.id === held.id)
      const approveWith = async (key: ReturnType<typeof softPasskey>, note: string) => {
        const ch = await bff<{ challenge: string }>(`/api/agents/approvals/${held.id}/challenge`, {}, `the approval's challenge, for ${note}`)
        return bff(`/api/agents/approvals/${held.id}/approve`, { assertion: key.assert(ch.value.challenge ?? '') }, `approve, signed by ${note}`)
      }
      const byUnsigned = await approveWith(b, 'the refused passkey B')
      if (!refused(byUnsigned.status)) wrong.push(`an approval signed by the refused passkey B answered ${byUnsigned.status}, not a refusal`)
      const after = await row()
      if (after?.status !== 'pending') wrong.push(`after B's signature, the approval row reads ${after?.status ?? 'missing'}, not pending`)
      const early = await pay('sent again after B tried to approve')
      if (early.ok) wrong.push(`the payment, sent again after B tried to approve, was paid: ${said(early)}`)
      const before = (await lens.agentLines(user, payee.id)).map((l) => l.amount_ulxc)
      if (before.length > 0) wrong.push(`${payee.name}'s statement holds ${JSON.stringify(before)} before any approval, not nothing`)

      // The control: B signed by A over B's own challenge registers, and then approves.
      const c3 = await challenge('B again, signed by A')
      const signed = await bff('/api/agents/passkeys', { ...b.register(c3.challenge, 'Nightly enrol B'), assertion: a.assert(c3.challenge) }, 'passkey B signed by A')
      if (signed.status !== 201) throw new Error(`passkey B signed by A over its own challenge answered ${signed.status}`)
      const byB = await approveWith(b, 'passkey B, registered')
      if (byB.status !== 200) wrong.push(`an approval signed by the registered passkey B answered ${byB.status}`)
      const approved = await row()
      if (approved?.status !== 'approved') wrong.push(`after B, registered, approved, the approval row reads ${approved?.status ?? 'missing'}, not approved`)
      const paid = await pay('sent again once approved')
      if (!paid.ok) wrong.push(`the payment, approved by B, sent again was refused: ${said(paid)}`)
      const into = (await lens.agentLines(user, payee.id)).map((l) => l.amount_ulxc)
      ctx.evidence.push({ note: `${payee.name}'s postings: ${JSON.stringify(into)}` })
      if (into.join() !== String(ENROL_PAY_ULXC)) wrong.push(`${payee.name}'s statement holds ${JSON.stringify(into)}, not the one approved ${ENROL_PAY_ULXC}`)
      return done(wrong, `passkey B with no signature refused and not listed; its approval refused, the row pending and ${payee.name}'s statement empty; ` +
        `signed by A, B registered, approved the row and the payment landed once (${ENROL_PAY_ULXC} µLXC)`)
    },
  }
}
