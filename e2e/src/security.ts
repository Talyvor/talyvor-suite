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
//   csrf-every-write — every write route the BFF registers (apps/bff lens.go), sent once with the session cookie from
//        another site: each is refused 403 before any handler runs, except the machine endpoints the BFF names exempt.
//   xss-shown-back — an agent's name, a saved payee's name and an invoice's customer and line, each carrying an event
//        handler and a <script>, are shown on their screens and nothing in them runs. A field Lens refuses the payload
//        for is safe too, and says so.
// Prompt injection by a web page and by a Room message is injection.ts's scenario on those two channels.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Dialog } from 'playwright'
import { fail } from './bank.ts'
import { bffRoutesFrom } from './coverage.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'
import { FLAG, ran, runnable, sendAs, SESSION_COOKIE } from './session.ts'

const SEED_ULXC = 50_000
const KEYED_ULXC = 3_101

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
