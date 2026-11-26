// B30.119 — transaction monitoring (Lens B30.7), on Lens's API, once a run, on two workspaces of its own. Each owner opens a
// GBP account on test money and puts £2,000.00 in it, then pays one saved payee four times through the Test partner.
//
// The watched workspace pays £100.00 four times within the hour. After the second payment no monitoring case is open on it;
// the third opens one (GET /v1/admin/screening?status=open: kind monitoring, status open) carrying one round_amounts alert
// (GET /v1/admin/compliance/alerts?case_id=) whose payment is the newest of the three it names; the fourth adds a second
// round_amounts alert to the same case, naming the first three and itself. The ordinary workspace pays £12.34, £23.45, £34.56
// and £45.67 and has no monitoring case and no alert. On both, the account's statement holds exactly the £2,000.00 in and
// one line out for each payment made, and the account holds what came in less what was paid: a hit moves no money.
//
// The cases and alerts are on the operator read key: without LENS_OPERATOR_READ_KEY the scenario cannot test and SKIPs.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered, SyntheticUser, WorkspaceTerms } from './lens.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** A currency account as Lens answers it (economy.CurrencyAccount). */
interface Account { id: string; currency: string; balance_minor: number; test_minor: number }
/** A payment out as Lens answers it (economy.OutsidePayment). */
interface Payment { id: string; amount_minor: number; currency: string; funding: string; status: string }
/** A compliance case as the operator reads it (screening.Case). */
interface Case { id: string; workspace_id: string; kind: string; status: string }
/** An alert transaction monitoring raised (monitoring.Alert). */
interface Alert { id: string; case_id: string; workspace_id: string; rule: string; entry_id: string; currency: string; funding: string; entries: string[] | null; summary: string }
/** One line of an account's statement (economy.MoneyStatementLine). */
interface Line { entry_id: string; amount_minor: number }

const TERMS = '/v1/workspaces/{ws}/terms'
const FUND_MINOR = 200_000
const ROUND_MINOR = [10_000, 10_000, 10_000, 10_000]
const ORDINARY_MINOR = [1234, 2345, 3456, 4567]
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

export function monitoring(): Scenario {
  return {
    id: 'monitoring',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.7', 'B30.119'],
    title: 'monitoring: the third £100.00 paid out within the hour opens a monitoring compliance case with one round_amounts alert ' +
      'naming that payment, the fourth extends the same case, ordinary amounts open none, and the ledger holds exactly the payments made',
    run: async (ctx): Promise<Verdict> => {
      const { lens, operatorReadKey } = ctx.env
      if (operatorReadKey === '') throw new CannotTest('the monitoring cases and alerts are read on the operator read key: no LENS_OPERATOR_READ_KEY')
      const [watched, ordinary] = await lens.createUsers(2)
      const call = async <T>(user: SyntheticUser, method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const admin = async <T>(path: string, note: string): Promise<T | Verdict> => {
        const res = await lens.as(operatorReadKey, 'GET', path)
        ctx.evidence.push({ note, answer: `${res.status} ${res.text.slice(0, 400)}` })
        if (res.status !== 200) return fail(`GET ${path} on the operator read key answered ${res.status}: ${res.text.slice(0, 200)}`)
        return JSON.parse(res.text) as T
      }
      const isVerdict = (v: unknown): v is Verdict => typeof v === 'object' && v !== null && 'pass' in v && 'detail' in v
      /** The open monitoring cases on `user`'s workspace. */
      const casesOf = async (user: SyntheticUser, when: string): Promise<Case[] | Verdict> => {
        const got = await admin<{ cases: Case[] | null }>('/v1/admin/screening?status=open', `the operator reads the open cases ${when}`)
        if (isVerdict(got)) return got
        return (got.cases ?? []).filter((c) => c.workspace_id === user.workspaceID && c.kind === 'monitoring')
      }
      const alertsOn = async (caseID: string, when: string): Promise<Alert[] | Verdict> => {
        const got = await admin<{ alerts: Alert[] | null }>(`/v1/admin/compliance/alerts?case_id=${encodeURIComponent(caseID)}`, `the operator reads case ${caseID}'s alerts ${when}`)
        return isVerdict(got) ? got : (got.alerts ?? [])
      }

      // Each workspace: the terms, a GBP account with £2,000.00 of test money in it, and one saved payee.
      const open = async (user: SyntheticUser, who: string): Promise<{ account: Account; payeeID: string } | Verdict> => {
        const terms = await call<{ terms: WorkspaceTerms[] | null }>(user, 'GET', TERMS, undefined, `the ${who} owner reads the workspace's terms`)
        if (!terms.ok) return fail(`reading the ${who} workspace's terms was refused: ${said(terms)}`)
        for (const t of (terms.value.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
          const accepted = await call(user, 'POST', `${TERMS}/${t.capability}/accept`, { version: t.version }, `the ${who} owner accepts ${t.capability}'s terms`)
          if (accepted.status !== 201) return fail(`accepting ${t.capability}'s terms must answer 201; Lens answered ${said(accepted)}`)
        }
        const opened = await call<Account>(user, 'POST', '/v1/money/accounts', { currency: 'GBP' }, `the ${who} owner opens a GBP account on test money`)
        if (opened.status !== 201 || !opened.ok) return fail(`opening a GBP account on test money must answer 201; Lens answered ${said(opened)}`)
        const funded = await call(user, 'POST', `/v1/money/accounts/${opened.value.id}/test-money`, { amount_minor: FUND_MINOR,
          idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `${gbp(FUND_MINOR)} of test money into the ${who} account`)
        if (funded.status !== 201) return fail(`putting ${gbp(FUND_MINOR)} of test money in the ${who} GBP account answered ${said(funded)}`)
        const payee = await call<{ id: string }>(user, 'POST', '/v1/money/payees', { name: `Nightly Monitoring Supplies ${who} Ltd`, country: 'GB',
          sort_code: '040004', account_number: who === 'watched' ? '55667788' : '66778899' }, `the ${who} owner saves a payee`)
        if (payee.status !== 201 || !payee.ok) return fail(`saving the ${who} payee must answer 201; Lens answered ${said(payee)}`)
        return { account: opened.value, payeeID: payee.value.id }
      }
      const pay = async (user: SyntheticUser, who: string, from: { account: Account; payeeID: string }, minor: number, n: number): Promise<Payment | Verdict> => {
        const paid = await call<Payment>(user, 'POST', '/v1/money/payments', { account_id: from.account.id, payee_id: from.payeeID, amount_minor: minor,
          currency: 'GBP', reference: `Nightly monitoring ${n}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `the ${who} owner pays ${gbp(minor)} out (payment ${n})`)
        if (paid.status !== 201 || !paid.ok) return fail(`paying ${gbp(minor)} out of the ${who} account must answer 201; Lens answered ${said(paid)}`)
        if (paid.value.status === 'completed') return paid.value
        const read = await call<Payment>(user, 'GET', `/v1/money/payments/${paid.value.id}`, undefined, `the ${who} owner reads payment ${n}`)
        if (!read.ok || read.value.status !== 'completed') return fail(`the Test partner completes a ${gbp(minor)} payment; payment ${n} reads ${said(read)}`)
        return read.value
      }
      /** The ledger holds exactly the money in and the payments made: the statement and the balance. */
      const ledger = async (user: SyntheticUser, who: string, account: Account, made: number[]): Promise<Verdict | undefined> => {
        const st = await call<{ lines: Line[] | null }>(user, 'GET', `/v1/money/accounts/${account.id}/statement`, undefined, `the ${who} account's statement`)
        if (!st.ok) return fail(`reading the ${who} account's statement was refused: ${said(st)}`)
        const lines = st.value.lines ?? []
        const ins = lines.filter((l) => l.amount_minor > 0).map((l) => l.amount_minor)
        const outs = lines.filter((l) => l.amount_minor < 0).map((l) => -l.amount_minor).sort((a, b) => a - b)
        const want = [...made].sort((a, b) => a - b)
        if (ins.length !== 1 || ins[0] !== FUND_MINOR || outs.join() !== want.join()) {
          return fail(`the ${who} account's statement must hold the ${gbp(FUND_MINOR)} in and one line out for each payment (${want.map(gbp).join(', ')}), ` +
            `and nothing else; it holds in ${ins.map(gbp).join(', ') || 'nothing'} and out ${outs.map(gbp).join(', ') || 'nothing'}`)
        }
        const accounts = await call<{ accounts: Account[] | null }>(user, 'GET', '/v1/money/accounts', undefined, `the ${who} owner lists the accounts`)
        if (!accounts.ok) return fail(`listing the ${who} accounts was refused: ${said(accounts)}`)
        const now = (accounts.value.accounts ?? []).find((a) => a.id === account.id)
        const left = FUND_MINOR - made.reduce((n, m) => n + m, 0)
        if (now === undefined || now.balance_minor !== left || now.test_minor !== left) {
          return fail(`the ${who} account must hold ${gbp(left)} of test money, what came in less what was paid; it reads ${JSON.stringify(now)}`)
        }
        return undefined
      }

      // 1. The watched workspace: two round payments open nothing.
      const w = await open(watched, 'watched')
      if (isVerdict(w)) return w
      for (const n of [1, 2]) {
        const p = await pay(watched, 'watched', w, ROUND_MINOR[n - 1], n)
        if (isVerdict(p)) return p
      }
      const before = await casesOf(watched, 'after two round payments')
      if (isVerdict(before)) return before
      if (before.length !== 0) return fail(`two round payments are not yet a burst: no monitoring case may be open, but ${JSON.stringify(before).slice(0, 300)} is`)

      // 2. The third opens the case, with one round_amounts alert naming it.
      const third = await pay(watched, 'watched', w, ROUND_MINOR[2], 3)
      if (isVerdict(third)) return third
      const opened = await casesOf(watched, 'after the third round payment')
      if (isVerdict(opened)) return opened
      if (opened.length !== 1 || opened[0].status !== 'open') {
        return fail(`the third ${gbp(ROUND_MINOR[2])} within the hour must open one monitoring case on the workspace; the open monitoring cases are ${JSON.stringify(opened).slice(0, 300)}`)
      }
      const caseID = opened[0].id
      const first = await alertsOn(caseID, 'after the third round payment')
      if (isVerdict(first)) return first
      const round = first.filter((a) => a.rule === 'round_amounts')
      const a1 = round[0]
      if (round.length !== 1 || a1.workspace_id !== watched.workspaceID || a1.currency !== 'GBP' || a1.funding !== 'test') {
        return fail(`case ${caseID} must carry one round_amounts alert on the workspace's GBP test money; it carries ${JSON.stringify(first).slice(0, 400)}`)
      }
      const e1 = a1.entries ?? []
      if (e1.length !== 3 || new Set(e1).size !== 3 || a1.entry_id !== e1[2]) {
        return fail(`the round_amounts alert must name the three payments, oldest first, and judge the third (its entry_id the last of them); it reads ${JSON.stringify(a1)}`)
      }

      // 3. The fourth extends the same case.
      const fourth = await pay(watched, 'watched', w, ROUND_MINOR[3], 4)
      if (isVerdict(fourth)) return fourth
      const extended = await casesOf(watched, 'after the fourth round payment')
      if (isVerdict(extended)) return extended
      if (extended.length !== 1 || extended[0].id !== caseID) {
        return fail(`the fourth round payment must extend case ${caseID}, not open another; the open monitoring cases are ${JSON.stringify(extended).slice(0, 300)}`)
      }
      const second = await alertsOn(caseID, 'after the fourth round payment')
      if (isVerdict(second)) return second
      const round2 = second.filter((a) => a.rule === 'round_amounts')
      const a2 = round2.find((a) => a.id !== a1.id)
      const e2 = a2?.entries ?? []
      if (round2.length !== 2 || a2 === undefined || e2.length !== 4 || e2.slice(0, 3).join() !== e1.join() || a2.entry_id !== e2[3] || e1.includes(a2.entry_id)) {
        return fail(`case ${caseID} must carry a second round_amounts alert judging the fourth payment and naming the first three and it; its alerts are ${JSON.stringify(second).slice(0, 500)}`)
      }
      const watchedLedger = await ledger(watched, 'watched', w.account, ROUND_MINOR)
      if (watchedLedger !== undefined) return watchedLedger

      // 4. The ordinary workspace: four ordinary amounts open nothing and raise nothing.
      const o = await open(ordinary, 'ordinary')
      if (isVerdict(o)) return o
      for (const [i, minor] of ORDINARY_MINOR.entries()) {
        const p = await pay(ordinary, 'ordinary', o, minor, i + 1)
        if (isVerdict(p)) return p
      }
      const none = await casesOf(ordinary, 'after the ordinary payments')
      if (isVerdict(none)) return none
      if (none.length !== 0) return fail(`ordinary amounts are no pattern: no monitoring case may be open on the ordinary workspace, but ${JSON.stringify(none).slice(0, 300)} is`)
      const all = await admin<{ alerts: Alert[] | null }>('/v1/admin/compliance/alerts', 'the operator reads every alert')
      if (isVerdict(all)) return all
      const stray = (all.alerts ?? []).filter((a) => a.workspace_id === ordinary.workspaceID)
      if (stray.length !== 0) return fail(`ordinary amounts raise no alert; the ordinary workspace has ${JSON.stringify(stray).slice(0, 300)}`)
      const ordinaryLedger = await ledger(ordinary, 'ordinary', o.account, ORDINARY_MINOR)
      if (ordinaryLedger !== undefined) return ordinaryLedger

      return {
        pass: true,
        detail: `two £100.00 payments out opened no case; the third within the hour opened a monitoring case with one round_amounts alert ` +
          'naming the three payments and judging the third, and the fourth added a second alert naming all four to the same case; £12.34, £23.45, ' +
          '£34.56 and £45.67 opened no case and raised no alert; both statements hold exactly £2,000.00 in and each payment out, and each account ' +
          'what came in less what was paid',
      }
    },
  }
}
