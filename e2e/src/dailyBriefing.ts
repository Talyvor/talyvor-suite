// B41.206 — the daily briefing (Lens B41.106), on Lens's API, once a run, on a workspace of its own.
//
// Before anything happens the new workspace's briefing for tomorrow morning is quiet, in one line. Then an agent pays another
// agent twice, a third payment over its approval amount waits for the owner, and a bill due in two days comes in. Tomorrow
// morning's briefing (?at= a day on) lists the approval first, then the bill, then the two payments, each with its amount, and
// spent_yesterday totals the two. The payments are read as the ledger keeps them too: the agent_postings rows on both agents'
// statements, under the entries the briefing names.

import { fail } from './bank.ts'
import { invoicePDF } from './billsInbox.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

interface Item { kind: string; id?: string; name: string; amount: number; currency?: string; due_date?: string; text: string }
interface Briefing { items: Item[] | null; spent_yesterday: { currency: string; amount: number }[] | null; quiet: boolean; line: string }

const FUND_ULXC = 400_000
const APPROVAL_ABOVE_ULXC = 100_000
const PAID_ULXC = [30_000, 45_000]
const HELD_ULXC = 200_000
const BILL_MINOR = 4_200
const DAY_MS = 86_400_000
const QUIET = 'A quiet day: nothing was spent yesterday, and nothing is waiting for you.'

export function dailyBriefing(): Scenario {
  return {
    id: 'daily-briefing',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B41.206'],
    title: "the daily briefing: a new workspace's is quiet in one line; after two payments, one held for approval and a bill due, the " +
      "next morning's lists the approval, the bill and both payments with their amounts, and spent_yesterday totals the two",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const brief = async (note: string): Promise<Answered<Briefing>> => {
        const at = new Date(Date.now() + DAY_MS).toISOString()
        const got = await lens.act<Briefing>(user, 'GET', `/v1/workspaces/{ws}/agents/briefing?at=${encodeURIComponent(at)}`)
        ctx.evidence.push({ note: `${note} (at ${at})`, answer: said(got) })
        return got
      }

      // 1. A workspace where nothing has happened: quiet, in one line.
      const calm = await brief("the new workspace's briefing for tomorrow morning")
      if (!calm.ok || !calm.value.quiet || (calm.value.items ?? []).length !== 0 || calm.value.line !== QUIET) {
        return fail(`a new workspace's briefing must be quiet with no items and the line "${QUIET}"; Lens answered ${said(calm)}`)
      }

      // 2. Two payments, one over the approval amount, and a bill due in two days.
      const payer = await lens.createAgent(user, `Briefing buyer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Briefing writer ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'daily-briefing' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${said(k)}`)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)
      const entries: string[] = []
      for (const amount of PAID_ULXC) {
        const r = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, amount, `briefing ${amount}`)
        ctx.evidence.push({ note: `${payer.name} pays ${payee.name} ${amount} µLXC`, answer: r.ok ? JSON.stringify(r.value) : `${r.status} ${r.error}` })
        if (!r.ok) return fail(`a ${amount} µLXC payment under the approval amount must be paid; Lens answered ${r.status} ${r.error}`)
        entries.push(r.value.entry_id)
      }
      const held = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, HELD_ULXC, `briefing ${HELD_ULXC}`)
      ctx.evidence.push({ note: `${payer.name} pays ${HELD_ULXC} µLXC, above its approval amount`, answer: held.ok ? 'paid' : `${held.status} ${held.error}` })
      const approval = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === HELD_ULXC && a.status === 'pending')
      if (held.ok || held.status !== 403 || approval === undefined) return fail(`a ${HELD_ULXC} µLXC payment above the approval amount must be refused 403 and wait for approval; Lens answered ${held.ok ? 'paid' : `${held.status} ${held.error}`}`)
      const supplier = `Briefing Supplies ${RUN_SALT}`
      const due = new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10)
      const added = await lens.raw(user.token, 'POST', '/v1/money/bills', invoicePDF([supplier, 'INVOICE', `Invoice number: BRF-${RUN_SALT}`, `Due date: ${due}`,
        `Total due: GBP ${(BILL_MINOR / 100).toFixed(2)}`, 'Sort code: 04-00-04', 'Account number: 12345678']).toString('latin1'), 'application/pdf')
      ctx.evidence.push({ note: `a ${BILL_MINOR} GBP minor bill from ${supplier}, due ${due}`, answer: `${added.status} ${added.text.slice(0, 300)}` })
      if (added.status !== 201) return fail(`adding the bill must answer 201; Lens answered ${added.status} ${added.text.slice(0, 200)}`)
      const bill = JSON.parse(added.text) as { id: string; supplier: string; amount_minor: number; currency: string }

      // 3. Tomorrow morning's briefing: the approval, the bill, the two payments, and what was spent.
      const busy = await brief("tomorrow morning's briefing")
      if (!busy.ok) return fail(`reading the briefing answered ${said(busy)}`)
      const got = (busy.value.items ?? []).map((i) => `${i.kind} ${i.id ?? ''} ${i.amount} ${i.currency ?? ''}`)
      const want = [`approval ${approval.id} ${HELD_ULXC} LXC`, `bill ${bill.id} ${BILL_MINOR} GBP`, ...PAID_ULXC.map((a, n) => `payment ${entries[n]} ${a} LXC`)]
      const wrong: string[] = []
      if (got.join('; ') !== want.join('; ')) wrong.push(`the briefing must list the approval, the bill, then both payments: want ${want.join('; ')}; Lens listed ${got.join('; ') || 'nothing'}`)
      const billItem = (busy.value.items ?? []).find((i) => i.kind === 'bill')
      if (billItem !== undefined && (billItem.name !== bill.supplier || billItem.due_date !== due)) wrong.push(`the bill must be named ${bill.supplier}, due ${due}; Lens said ${JSON.stringify(billItem)}`)
      const total = PAID_ULXC.reduce((s, a) => s + a, 0)
      const spent = JSON.stringify(busy.value.spent_yesterday ?? [])
      if (spent !== JSON.stringify([{ currency: 'LXC', amount: total }])) wrong.push(`spent_yesterday must be ${total} LXC (the two payments); Lens said ${spent}`)
      if (busy.value.quiet) wrong.push('a day with two payments, an approval and a bill is not quiet; Lens said it was')

      // 4. The two payments on the ledger: each entry the briefing names leaves the buyer and reaches the writer.
      const [out, into] = await Promise.all([lens.agentLines(user, payer.id), lens.agentLines(user, payee.id)])
      PAID_ULXC.forEach((amount, n) => {
        const leg = (lines: typeof out, sign: number) => lines.find((l) => l.entry_id === entries[n] && l.kind === 'pay' && l.amount_ulxc === sign * amount)
        if (leg(out, -1) === undefined || leg(into, 1) === undefined) {
          wrong.push(`entry ${entries[n]} must post -${amount} µLXC from ${payer.name} and +${amount} to ${payee.name}; the statements hold ` +
            `${JSON.stringify(out.filter((l) => l.entry_id === entries[n]))} and ${JSON.stringify(into.filter((l) => l.entry_id === entries[n]))}`)
        }
      })
      if (wrong.length > 0) return fail(wrong.join('; '))
      return {
        pass: true,
        detail: `a new workspace's briefing was quiet ("${QUIET}"); after the payments ${entries.join(' and ')}, approval ${approval.id} and bill ${bill.id}, ` +
          `the next morning's listed ${want.join('; ')}, spent yesterday ${total} LXC — "${busy.value.line}"`,
      }
    },
  }
}
