// B61.48 — Instant transfer (the launch version's 'instant-transfer' area), once a run each, on a workspace of its own. A synthetic
// workspace is Hybrid, as Lens makes one (migration 0373), so it may send one.
//
// instant-transfer-quote, on Lens's API: the owner opens the company's USD account and two agents' USD accounts, and turns on the
// sender's "Can use Instant transfer". A quote for USD 5.00 to the other agent's account shows what leaves, the fee (Lens's fee_bps
// of it, rounded up), the rate and what arrives, and is locked for exactly its 30 seconds: a send at it inside them is not refused
// as expired, and a send at it once they are over is refused in words that say it expired and to ask for a new one.
//
// instant-transfer-send (B61.67), on Lens's API: the owner registers a test device key (as device-key-approval does), puts
// USD 50.00 of Sandbox money into the company's USD account and gives the sender USD 30.00 of it (Lens B61.66), never through
// Stripe's form, so a launch run plays it. A send of USD 5.00 to the other agent's account, which it never sent one to, waits
// for the owner's key with nothing moved; signed by the device, it is sent again at a new quote and arrives once: the sender's
// account down by send_minor, the receiver's up by receive_minor, and the transfer reads received. The same Idempotency-Key
// again answers the same transfer and moves nothing. With "ask me above" under what USD 10.00 is worth (read from the first
// approval's amount_ulxc), a send of USD 10.00 waits for the owner's key with nothing moved, and an unsigned decision on it is
// refused. Judged on the accounts' balances and the transfer, never a status code alone.
//
// instant-transfer-offered, in the app: the Hybrid account's Pay offers Instant transfer and its page draws the form; told by the
// BFF that the account is Fiat only (a synthetic workspace cannot be made one: only Talyvor's operator changes a kind), Pay
// offers no Instant transfer and its address goes back to Pay.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { softDevice } from './deviceKeyApproval.ts'
import type { AgentApproval } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const SEND_MINOR = 500
const QUOTE_LIFE_MS = 30_000

/** An Instant transfer quote as Lens answers it (economy.InstantQuote). */
export interface InstantQuote {
  id: string
  send_minor: number
  send_currency: string
  fee_bps: number
  fee_minor: number
  rate: string
  receive_minor: number
  receive_currency: string
  expires_at: string
  created_at: string
}

/** What is wrong with a quote for `sendMinor` of `currency`: what leaves, the fee, the rate, what arrives and its 30 seconds. */
export function quoteFaults(q: InstantQuote, sendMinor: number, currency: string): string[] {
  const faults: string[] = []
  if (q.send_minor !== sendMinor || q.send_currency !== currency) faults.push(`the quote must send ${sendMinor} ${currency}; it sends ${q.send_minor} ${q.send_currency}`)
  if (!Number.isInteger(q.fee_bps) || q.fee_bps <= 0) faults.push(`the quote must show its fee; its fee_bps is ${q.fee_bps}`)
  else if (q.fee_minor !== Math.ceil((sendMinor * q.fee_bps) / 10_000)) {
    faults.push(`the fee is ${q.fee_bps} basis points of ${sendMinor}, rounded up: ${Math.ceil((sendMinor * q.fee_bps) / 10_000)}; the quote shows ${q.fee_minor}`)
  }
  if (!(Number(q.rate) > 0)) faults.push(`the quote must show its rate; it shows "${q.rate}"`)
  if (!Number.isInteger(q.receive_minor) || q.receive_minor <= 0 || q.receive_currency !== currency) {
    faults.push(`the quote must show what arrives in ${currency}; it shows ${q.receive_minor} ${q.receive_currency}`)
  }
  const life = Date.parse(q.expires_at) - Date.parse(q.created_at)
  if (life !== QUOTE_LIFE_MS) faults.push(`a quote is locked for 30 seconds; this one for ${Number.isNaN(life) ? `"${q.created_at}" to "${q.expires_at}"` : `${life / 1000} seconds`}`)
  return faults
}

/** Whether Lens's refusal says the quote expired and to ask for a new one, in words. */
export const saysExpired = (error: string): boolean => /\bexpired\b/i.test(error) && /\bnew one\b/i.test(error)

export function instantTransferQuote(): Scenario {
  return {
    id: 'instant-transfer-quote',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    items: ['B61.48', 'B59.14', 'B59.15'],
    feature: 'Instant transfer',
    title: 'instant transfer: a quote shows what leaves, the fee, the rate and what arrives, holds for its 30 seconds, and once they are over a send at it is refused in words',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const { lens } = ctx.env
      const user = ctx.app.user
      // 1. The terms, the company's USD account, and the two agents' USD accounts under it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD' }, "the company's USD account")
      if (company.status !== 201) return fail(`opening the company's USD account answered ${said(company)}`)
      const sender = await lens.createAgent(user, `Instant sender ${RUN_SALT}`)
      const receiver = await lens.createAgent(user, `Instant receiver ${RUN_SALT}`)
      const accounts: Record<string, string> = {}
      for (const a of [sender, receiver]) {
        const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD', agent_id: a.id }, `${a.name}'s USD account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${a.name}'s USD account answered ${said(opened)}`)
        accounts[a.id] = opened.value.id
      }
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${sender.id}/rules`, { ...await lens.agentRules(user, sender.id), may_instant_transfer: true },
        `${sender.name} may use Instant transfer`)
      if (rules.status !== 200) return fail(`turning on ${sender.name}'s "Can use Instant transfer" answered ${said(rules)}`)

      // 2. The quote.
      const quoted = await step<InstantQuote>('POST', '/v1/workspaces/{ws}/money/instant-transfers/quote',
        { send_minor: SEND_MINOR, send_currency: 'USD', receive_currency: 'USD', to: 'talyvor_account' }, `a quote for USD 5.00 to ${receiver.name}'s account`)
      if (quoted.status !== 201 || quoted.value === undefined) return fail(`a Hybrid account's quote for USD 5.00 to a Talyvor account must answer 201; Lens answered ${said(quoted)}`)
      const q = quoted.value
      const faults = quoteFaults(q, SEND_MINOR, 'USD')
      if (faults.length > 0) return fail(faults.join('; '))
      const send = (note: string) => step('POST', `/v1/workspaces/{ws}/agents/${sender.id}/money/instant-transfers`,
        { quote_id: q.id, to_account_id: accounts[receiver.id], idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, note)

      // 3. Inside its 30 seconds it holds: a send at it is answered for something else (the new account, or the money), never its expiry.
      const inside = await send(`${sender.name} sends at the quote inside its 30 seconds`)
      if (Date.now() < Date.parse(q.expires_at) && saysExpired(inside.error)) return fail(`inside its 30 seconds the quote must hold; Lens refused a send at it as expired: ${said(inside)}`)

      // 4. Once they are over, a send at it is refused in words.
      const wait = Date.parse(q.expires_at) + 1500 - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      const late = await send(`${sender.name} sends at the quote once its 30 seconds are over`)
      if (late.status < 400 || late.status >= 500) return fail(`a send at a quote past its 30 seconds must be refused; Lens answered ${said(late)}`)
      if (!saysExpired(late.error)) return fail(`the refusal of a send at an expired quote must say it expired and to ask for a new one; Lens said "${late.error}"`)
      return {
        pass: true,
        detail: `USD 5.00 quoted at a fee of ${q.fee_minor} (${q.fee_bps} bps), rate ${q.rate}, ${q.receive_minor} arriving, locked 30 seconds; inside them a send ` +
          `answered ${inside.status}, after them refused ${late.status} "${late.error.slice(0, 160)}"`,
      }
    },
  }
}

/** An Instant transfer as Lens answers it (economy.InstantTransfer): what it sent, what arrived, and where it stands. */
export interface InstantTransfer {
  id: string
  agent_id: string
  quote_id: string
  from_account_id: string
  to_account_id: string
  send_minor: number
  receive_minor: number
  status: string
}

const FUND_COMPANY_MINOR = 5000
const FUND_SENDER_MINOR = 3000

export function instantTransferSend(): Scenario {
  return {
    id: 'instant-transfer-send',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    items: ['B61.67', 'B59.15', 'B61.66'],
    feature: 'Instant transfer',
    title: "instant transfer: a send to a new account waits for the owner's key and, signed, arrives once on both sides; the same key again sends nothing; " +
      'above "ask me above" a send waits with nothing moved and an unsigned decision is refused',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const { lens } = ctx.env
      const user = ctx.app.user
      // 1. The terms, the company's USD account with Sandbox money in it, and the two agents' USD accounts under it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD' }, "the company's USD account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's USD account answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_COMPANY_MINOR, idempotency_key: `e2e-${RUN_SALT}-company` },
        "USD 50.00 of Sandbox money into the company's USD account")
      if (topped.status !== 201) return fail(`Sandbox money into the company's USD account answered ${said(topped)}`)
      const sender = await lens.createAgent(user, `Instant sender ${RUN_SALT}`)
      const receiver = await lens.createAgent(user, `Instant receiver ${RUN_SALT}`)
      const accounts: Record<string, string> = {}
      for (const a of [sender, receiver]) {
        const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD', agent_id: a.id }, `${a.name}'s USD account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${a.name}'s USD account answered ${said(opened)}`)
        accounts[a.id] = opened.value.id
      }
      const from = accounts[sender.id]
      const to = accounts[receiver.id]
      const funded = await step('POST', `/v1/money/accounts/${from}/funding`, { direction: 'to_agent', amount_minor: FUND_SENDER_MINOR, idempotency_key: `e2e-${RUN_SALT}-sender` },
        `the owner gives ${sender.name} USD 30.00 from the company's account`)
      if (funded.status !== 201) return fail(`giving ${sender.name} USD 30.00 from the company's USD account answered ${said(funded)}`)
      // Turned on before the device key is registered: a looser rule is signed once the workspace has a key.
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${sender.id}/rules`, { ...await lens.agentRules(user, sender.id), may_instant_transfer: true },
        `${sender.name} may use Instant transfer`)
      if (rules.status !== 200) return fail(`turning on ${sender.name}'s "Can use Instant transfer" answered ${said(rules)}`)

      // 2. The owner's key: a test device key, as the phone's.
      const ch = await step<{ challenge: string }>('POST', '/v1/money/devices/challenge', {}, 'the owner asks to register a device key')
      if (ch.status !== 200 || ch.value === undefined) return fail(`the device registration challenge answered ${said(ch)}`)
      const phone = softDevice()
      const reg = await step<{ id: string }>('POST', '/v1/money/devices', phone.register(ch.value.challenge, 'Nightly phone'), 'the owner registers a test device key')
      if (reg.status === 400 && reg.error.includes('test device keys are not accepted')) {
        throw new CannotTest(`Lens refuses the "test" device platform: ${reg.error} — it needs LENS_DEVICE_TEST_ATTESTATION=true in lens.env`)
      }
      if (reg.status !== 201 || reg.value === undefined) return fail(`registering a test device key answered ${said(reg)}`)
      const device = reg.value.id

      const balances = async (note: string): Promise<{ from: number; to: number }> => {
        const r = await step<{ accounts: { id: string; test_minor: number }[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const of = (id: string) => (r.value?.accounts ?? []).find((a) => a.id === id)?.test_minor
        const got = { from: of(from), to: of(to) }
        if (got.from === undefined || got.to === undefined) throw new Error(`the accounts read back without both agents' USD accounts: ${said(r)}`)
        return got as { from: number; to: number }
      }
      const quote = async (minor: number): Promise<InstantQuote> => {
        const q = await step<InstantQuote>('POST', '/v1/workspaces/{ws}/money/instant-transfers/quote',
          { send_minor: minor, send_currency: 'USD', receive_currency: 'USD', to: 'talyvor_account' }, `a quote for ${minor} cents to ${receiver.name}'s account`)
        if (q.status !== 201 || q.value === undefined) throw new Error(`a quote for ${minor} cents to a Talyvor account answered ${said(q)}`)
        return q.value
      }
      const send = async (q: InstantQuote, key: string, note: string) => {
        const r = await lens.act<InstantTransfer>(user, 'POST', `/v1/workspaces/{ws}/agents/${sender.id}/money/instant-transfers`,
          { quote_id: q.id, to_account_id: to }, { 'Idempotency-Key': key })
        ctx.evidence.push({ note, answer: r.ok ? `${r.status} ${JSON.stringify(r.value).slice(0, 300)}` : `${r.status} "${r.error}"` })
        return r
      }
      const pending = async (seen: Set<string>): Promise<AgentApproval | undefined> =>
        (await lens.agentApprovals(user)).find((a) => a.agent_id === sender.id && a.status === 'pending' && !seen.has(a.id))
      const decide = async (approval: string, signed: boolean, note: string) => {
        const c = await step<{ challenge: string }>('POST', `/v1/workspaces/{ws}/agents/approvals/${approval}/challenge`, {}, `the owner asks for ${approval}'s challenge`)
        if (c.value?.challenge === undefined) throw new Error(`approval ${approval}'s challenge answered ${said(c)}`)
        return step('POST', `/v1/workspaces/{ws}/agents/approvals/${approval}/approve`, signed ? { assertion: phone.assert(device, c.value.challenge) } : {}, note)
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const moved = (was: { from: number; to: number }, now: { from: number; to: number }) => now.from !== was.from || now.to !== was.to

      try {
        // 3. A send to an account it never sent one to waits for the owner's key, with nothing moved.
        const start = await balances('both accounts before the first send')
        if (start.from !== FUND_SENDER_MINOR) return fail(`given USD 30.00 from the company's account, ${sender.name}'s USD account holds ${start.from} cents`)
        const seen = new Set((await lens.agentApprovals(user)).map((a) => a.id))
        const first = await send(await quote(SEND_MINOR), key(), `${sender.name} sends USD 5.00 to ${receiver.name}'s account, new to it`)
        const asked = await pending(seen)
        const waited = await balances('both accounts after the first send')
        if (first.ok || asked === undefined) {
          return fail(`a first Instant transfer to an account the agent never sent one to must wait for the owner's approval; Lens answered ` +
            `${first.ok ? `${first.status}, sent` : `${first.status} "${first.error}"`}${asked === undefined ? ' and filed no pending approval' : ''}`)
        }
        if (moved(start, waited)) return fail(`a send waiting for the owner's key moved money: ${sender.name} ${start.from} → ${waited.from}, ${receiver.name} ${start.to} → ${waited.to}`)
        seen.add(asked.id)

        // 4. Signed by the owner's key, sent again at a new quote: it arrives once, on both sides.
        const approved = await decide(asked.id, true, "the owner approves with the device key")
        if (approved.status !== 200) return fail(`approving the Instant transfer with the device's signature answered ${said(approved)}`)
        const q = await quote(SEND_MINOR)
        const retryKey = key()
        const sent = await send(q, retryKey, `${sender.name} sends USD 5.00 again, approved`)
        if (!sent.ok) return fail(`once the owner approved it, the Instant transfer must be sent; Lens answered ${sent.status} "${sent.error}"`)
        const t = sent.value
        const after = await balances('both accounts after the approved send')
        const got = await step<InstantTransfer>('GET', `/v1/workspaces/{ws}/money/instant-transfers/${t.id}`, undefined, 'the receipt')
        const wrong: string[] = []
        if (after.from !== start.from - q.send_minor) wrong.push(`${sender.name}'s account must be down by the ${q.send_minor} cents sent: ${start.from} → ${after.from}`)
        if (after.to !== start.to + q.receive_minor) wrong.push(`${receiver.name}'s account must be up by the ${q.receive_minor} cents that arrive: ${start.to} → ${after.to}`)
        if (got.value?.id !== t.id || got.value.status !== 'received') wrong.push(`the transfer ${t.id} must read received; GET answered ${said(got)}`)
        if (wrong.length > 0) return fail(wrong.join('; '))

        // 5. The same Idempotency-Key again answers the same transfer and moves nothing.
        const again = await send(q, retryKey, `${sender.name} sends again under the same Idempotency-Key`)
        const still = await balances('both accounts after the same key again')
        if (!again.ok || again.value.id !== t.id) return fail(`the same Idempotency-Key again must answer transfer ${t.id}; Lens answered ${again.ok ? `transfer ${again.value.id}` : `${again.status} "${again.error}"`}`)
        if (moved(after, still)) return fail(`the same Idempotency-Key again moved money: ${sender.name} ${after.from} → ${still.from}, ${receiver.name} ${after.to} → ${still.to}`)

        // 6. Above "ask me above" a send waits for the owner's key, with nothing moved, and an unsigned decision is refused.
        const above = asked.amount_ulxc
        const tighter = await step('PUT', `/v1/workspaces/{ws}/agents/${sender.id}/rules`, { ...await lens.agentRules(user, sender.id), approval_above_ulxc: above },
          `${sender.name} asks the owner above ${above} µLXC, what USD 5.00 is worth`)
        if (tighter.status !== 200) return fail(`setting ${sender.name}'s "ask me above" to ${above} µLXC answered ${said(tighter)}`)
        const big = await send(await quote(2 * SEND_MINOR), key(), `${sender.name} sends USD 10.00 to ${receiver.name}'s account, above "ask me above"`)
        const held = await pending(seen)
        const left = await balances('both accounts after the send above "ask me above"')
        if (big.ok || held === undefined) {
          return fail(`a send of USD 10.00 above an "ask me above" of ${above} µLXC must wait for the owner's key; Lens answered ` +
            `${big.ok ? `${big.status}, sent` : `${big.status} "${big.error}"`}${held === undefined ? ' and filed no pending approval' : ''}`)
        }
        if (moved(still, left)) return fail(`a send above "ask me above" moved money: ${sender.name} ${still.from} → ${left.from}, ${receiver.name} ${still.to} → ${left.to}`)
        const unsigned = await decide(held.id, false, 'the owner approves with no signature')
        const status = (await lens.agentApprovals(user)).find((a) => a.id === held.id)?.status
        if (unsigned.status !== 403 || status !== 'pending') {
          return fail(`an unsigned decision on approval ${held.id} must be refused 403 and leave it pending; Lens answered ${said(unsigned)}, and it is ${status}`)
        }
        return {
          pass: true,
          detail: `USD 5.00 to a new account waited for the owner's key (${asked.id}), then arrived once: ${sender.name} ${start.from} → ${after.from}, ` +
            `${receiver.name} ${start.to} → ${after.to}, ${t.id} received; the same key again answered ${t.id} and moved nothing; USD 10.00 above ` +
            `${above} µLXC waited (${held.id}) with nothing moved, and an unsigned decision was refused 403`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}

/** What is wrong with what Pay offers an account of `kind`: Instant transfer for Hybrid alone, and its page only there. */
export function offeredFaults(kind: 'hybrid' | 'fiat', s: { payLinks: string[]; formDrawn: boolean; landedOn: string }): string[] {
  const offered = s.payLinks.some((l) => /instant transfer/i.test(l))
  if (kind === 'hybrid') {
    return [
      ...(offered ? [] : [`a Hybrid account's Pay must offer Instant transfer; its links read ${JSON.stringify(s.payLinks).slice(0, 200)}`]),
      ...(s.formDrawn ? [] : [`a Hybrid account's /money/pay/instant-transfer must draw the form; it landed on ${s.landedOn} without it`]),
    ]
  }
  return [
    ...(offered ? [`a Fiat only account's Pay must offer no Instant transfer; it offers ${JSON.stringify(s.payLinks.filter((l) => /instant/i.test(l)))}`] : []),
    ...(s.formDrawn || s.landedOn !== '/money/pay' ? [`a Fiat only account's /money/pay/instant-transfer must go back to Pay; it landed on ${s.landedOn}${s.formDrawn ? ' with the form' : ''}`] : []),
  ]
}

async function whatPayOffers(ctx: ScenarioCtx, kind: 'hybrid' | 'fiat'): Promise<{ payLinks: string[]; formDrawn: boolean; landedOn: string }> {
  const page = await ctx.app.tab('/money')
  try {
    if (kind === 'fiat') {
      await page.route('**/api/workspace/account', async (route) => {
        const real = await route.fetch()
        const body = (await real.json()) as Record<string, unknown>
        await route.fulfill({ response: real, json: { ...body, money_kind: 'fiat' } })
      })
    }
    await page.goto(new URL('/money/pay', page.url()).href)
    // "Also on Pay" is drawn once the account's kind is read, with Standing orders for every kind.
    await page.locator('main a[href="/money/pay/standing-orders"]').first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
    const payLinks = (await page.locator('main a').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    await page.goto(new URL('/money/pay/instant-transfer', page.url()).href)
    const form = page.getByTestId('instant-transfer-form')
    const formDrawn = await form.waitFor({ timeout: kind === 'hybrid' ? TIMEOUT_MS : 5000 }).then(() => true, () => false)
    if (kind === 'fiat') await page.waitForURL((u) => u.pathname === '/money/pay', { timeout: TIMEOUT_MS }).catch(() => undefined)
    return { payLinks, formDrawn, landedOn: new URL(page.url()).pathname }
  } finally {
    await page.close()
  }
}

export function instantTransferOffered(): Scenario {
  return {
    id: 'instant-transfer-offered',
    owner: 'talyvor-suite',
    own: true,
    items: ['B61.48', 'B59.19'],
    feature: 'Instant transfer',
    title: "instant transfer: a Hybrid account's Pay offers it and its page draws the form; a Fiat only account is offered no Instant transfer and its address goes back to Pay",
    run: async (ctx) => {
      const faults: string[] = []
      const seen: string[] = []
      for (const kind of ['hybrid', 'fiat'] as const) {
        const s = await whatPayOffers(ctx, kind)
        ctx.evidence.push({ note: `Pay, for a ${kind} account`, answer: JSON.stringify(s).slice(0, 600) })
        faults.push(...offeredFaults(kind, s))
        seen.push(`${kind}: ${s.formDrawn ? 'form drawn' : `back on ${s.landedOn}`}`)
      }
      return faults.length > 0 ? fail(faults.join('; ')) : { pass: true, detail: `Instant transfer offered to the Hybrid account alone (${seen.join('; ')})` }
    },
  }
}
