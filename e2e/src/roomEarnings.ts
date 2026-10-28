// B46.21 — a Room's earnings split and paid out on the money layer (Lens B46.11), on Lens's API, once a run, on workspaces of its
// own.
//
// The owner, on Team, opens a private room whose split rule is equal, and two more companies join it through an invite link.
// Each of the three saves GBP payout details (PUT /v1/money/payout-details); the third's holder is named "TESTPENDING …", so the
// sandbox's partner leaves its verification pending. The room's wallet gets a GBP account, funded £10.00 by an invoice paid by
// card, and the owner pays out £10.00 (POST /v1/rooms/{id}/payouts with an Idempotency-Key). Lens's earnings_payout rows (GET
// /v1/money/earnings-payouts) are the oracle: £3.34 to the owner, who joined first, and £3.33 to each member, summing to £10.00,
// every one a room_split under "room <id> terms v1 equal" — the two verified completed by the partner, the pending one held and
// never sent — and the wallet's account down from 1000 to 0 minor. The same request again makes no new payout and moves nothing.

import { fail } from './bank.ts'
import type { Answered, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

interface Account { id: string; agent_id?: string; test_minor: number }
interface Details { asset: string; holder: string; status: string }
interface Payout { id: string; kind: string; source: string; agreement?: string; recipient_workspace_id: string; amount_minor: number; currency: string
  funding: string; status: string; partner_ref?: string }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const PAYOUT_MINOR = 1_000
/** A valid UK IBAN (the standard example); the sandbox pays to any IBAN whose checks pass. */
const IBAN = 'GB82WEST12345698765432'

export function roomEarnings(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'room-earnings-payout',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Rooms',
    plan: 'team',
    items: ['B46.21'],
    title: "a Room's £10.00 split equally among its three members is £3.34, £3.33 and £3.33 in three earnings_payout rows under the room's " +
      'terms: the two with verified payout details completed, the pending one held; the same payout again makes nothing new',
    run: async (ctx) => {
      const { lens } = ctx.env
      const owner = ctx.app.user
      const call = async <T>(who: SyntheticUser, method: string, path: string, body: object | undefined, note: string, headers?: Record<string, string>): Promise<Answered<T>> => {
        const got = await lens.act<T>(who, method, path, body, headers)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const acceptTerms = async (who: SyntheticUser): Promise<string | undefined> => {
        const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>(who, 'GET', '/v1/workspaces/{ws}/terms', undefined, `${who.workspaceID} reads the terms`)
        if (!terms.ok) return `reading ${who.workspaceID}'s terms answered ${said(terms)}`
        for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
          const ok = await call(who, 'POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `${who.workspaceID} accepts ${t.capability}'s terms`)
          if (ok.status !== 201) return `${who.workspaceID} accepting ${t.capability}'s terms answered ${said(ok)}`
        }
        return undefined
      }

      // A private room on Team, split equally, and two companies joined through an invite link.
      const made = await call<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
        title: `Earnings check ${RUN_SALT}`, topic: `e2e-room-earnings-${RUN_SALT}`, visibility: 'private', terms: { split_rule: 'equal' },
      }, 'the owner opens a private room split equally')
      if (!made.ok) return fail(`opening a private room on Team was refused: ${said(made)}`)
      const id = made.value.id
      const room = `/v1/rooms/${encodeURIComponent(id)}`
      const first = await lens.room(owner, id)
      const wallet = first.wallet?.agent_id ?? ''
      if (wallet === '' || first.terms.split_rule !== 'equal') return fail(`room ${id} reads wallet "${wallet}" and split rule ${first.terms.split_rule}, not a wallet split equally`)
      const link = await call<{ token?: string }>(owner, 'POST', `${room}/invites`, { max_uses: 2, expires_at: new Date(Date.now() + 86_400_000).toISOString() }, 'the owner makes an invite link of 2 uses')
      if (!link.ok || link.value.token === undefined) return fail(`making an invite link was refused or carried no token: ${said(link)}`)
      const members = await lens.createUsers(2)
      for (const m of members) {
        const joined = await call(m, 'POST', `/v1/room-invites/${encodeURIComponent(link.value.token)}/join`, { terms_version: first.terms.version }, `${m.workspaceID} joins through the link`)
        if (!joined.ok) return fail(`${m.workspaceID} joining through the invite link was refused: ${said(joined)}`)
      }
      const [member, pending] = members

      // Each saves GBP payout details; the TESTPENDING holder's verification stays pending.
      const holders: [SyntheticUser, string, string][] = [[owner, `Nightly Room Owner ${RUN_SALT}`, 'verified'], [member, `Nightly Room Member ${RUN_SALT}`, 'verified'],
        [pending, `TESTPENDING Nightly Room Editor ${RUN_SALT}`, 'pending']]
      for (const [who, holder, want] of holders) {
        const unaccepted = await acceptTerms(who)
        if (unaccepted !== undefined) return fail(unaccepted)
        const saved = await call<Details>(who, 'PUT', '/v1/money/payout-details', { asset: 'GBP', holder, iban: IBAN, country: 'GB' }, `${who.workspaceID} saves GBP payout details for ${holder}`)
        if (!saved.ok || saved.value.status !== want) return fail(`${who.workspaceID}'s GBP payout details for ${holder} must answer 200 ${want}; Lens answered ${said(saved)}`)
      }

      // The room's wallet, its GBP account funded £10.00 by card.
      const company = await call<Account>(owner, 'POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201 || !company.ok) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)
      const opened = await call<Account>(owner, 'POST', '/v1/money/accounts', { currency: 'GBP', agent_id: wallet }, "the owner opens the room wallet's GBP account")
      if (opened.status !== 201 || !opened.ok) return fail(`opening the room wallet's GBP account must answer 201; Lens answered ${said(opened)}`)
      const acct = opened.value.id
      const invoice = await call<{ pay_url?: string }>(owner, 'POST', '/v1/money/invoices', {
        account_id: acct, customer_name: `Room earnings ${RUN_SALT}`, lines: [{ description: 'Room earnings', quantity: 1, unit_amount_minor: PAYOUT_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true,
      }, `the owner sends a ${PAYOUT_MINOR} minor invoice from the room wallet's account, to fund it`)
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const unpaid = await fund(ctx, token)
      if (unpaid !== undefined) return fail(unpaid)
      const held = async (note: string) => {
        const accounts = await call<{ accounts: Account[] | null }>(owner, 'GET', '/v1/money/accounts', undefined, `${note}: the accounts`)
        if (!accounts.ok) throw new Error(`reading the accounts ${note} answered ${said(accounts)}`)
        return (accounts.value.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? -1
      }
      const rows = async (note: string) => {
        const list = await call<{ payouts: Payout[] | null }>(owner, 'GET', '/v1/money/earnings-payouts', undefined, `${note}: the earnings payouts`)
        if (!list.ok) throw new Error(`reading the earnings payouts ${note} answered ${said(list)}`)
        return (list.value.payouts ?? []).filter((p) => p.source.startsWith(`room:${id}:`))
      }

      try {
        const before = await held('before the payout')
        if (before !== PAYOUT_MINOR) return fail(`the funding invoice was paid by card, but the room wallet's GBP account holds ${before} minor, not ${PAYOUT_MINOR}`)

        // The owner pays out £10.00, split as the room's terms agree.
        const key = `e2e-room-earnings-${id}`
        const pay = () => call<{ agreement: string; payouts: Payout[] | null }>(owner, 'POST', `${room}/payouts`, { amount_minor: PAYOUT_MINOR, currency: 'GBP' },
          `the owner pays out ${PAYOUT_MINOR} GBP minor from the room`, { 'Idempotency-Key': key })
        const paid = await pay()
        if (!paid.ok) return fail(`the room's payout must answer 200; Lens answered ${said(paid)}`)
        const split = await rows('after the payout')
        const agreement = `room ${id} terms v${first.terms.version} equal`
        const by = new Map(split.map((p) => [p.recipient_workspace_id, p]))
        const want: [SyntheticUser, number, string][] = [[owner, 334, 'completed'], [member, 333, 'completed'], [pending, 333, 'held']]
        const wrong: string[] = []
        if (split.length !== 3 || split.reduce((s, p) => s + p.amount_minor, 0) !== PAYOUT_MINOR) {
          wrong.push(`the payout must be 3 earnings_payout rows summing to ${PAYOUT_MINOR}; Lens lists ${JSON.stringify(split)}`)
        }
        for (const [who, minor, status] of want) {
          const p = by.get(who.workspaceID)
          const sent = (p?.partner_ref ?? '') !== ''
          if (p === undefined || p.amount_minor !== minor || p.currency !== 'GBP' || p.status !== status || p.kind !== 'room_split' || p.agreement !== agreement ||
            p.funding !== 'test' || sent !== (status === 'completed')) {
            wrong.push(`${who.workspaceID}'s row must be ${minor} GBP minor, ${status}${status === 'held' ? ' and never sent' : ' by the partner'}, a room_split under "${agreement}"; Lens lists ${JSON.stringify(p)}`)
          }
        }
        const after = await held('after the payout')
        if (after !== 0) wrong.push(`the room wallet's account went from ${PAYOUT_MINOR} to ${after} minor, not to 0: the split's money must all leave it, the held share on hold`)

        // The same request again: no new payout, nothing moves.
        const replay = await pay()
        if (!replay.ok) wrong.push(`the same payout again must answer 200 with the payouts first made; Lens answered ${said(replay)}`)
        const again = await rows('after the same payout again')
        const ids = (l: Payout[]) => l.map((p) => `${p.id} ${p.status}`).sort().join(', ')
        if (ids(again) !== ids(split)) wrong.push(`the same payout again changed the rows: ${ids(split)} → ${ids(again)}`)
        const last = await held('after the same payout again')
        if (last !== after) wrong.push(`the same payout again moved money: the room wallet's account ${after} → ${last} minor`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `room ${id}'s £10.00 was paid out as ${want.map(([w]) => `${by.get(w.workspaceID)?.amount_minor} ${by.get(w.workspaceID)?.status}`).join(', ')} under "${agreement}"; ` +
            `the wallet's account ${before} → ${after} minor; the same payout again made nothing new`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
