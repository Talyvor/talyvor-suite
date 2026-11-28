// B17.553 — the second approver picked from Team and roles (Lens B28.464: the roles list names who took each role up), once a run,
// on a Business workspace of its own. On Team and roles the owner gives two emails the Approver role; only the first signs in to
// the account with it, as the BFF signs them in (POST /v1/provision/roles on the provisioning secret). Lens's roles list names the
// person who took the first role up by their user id, and "" for the one nobody has. The owner presses Choose on Second approver:
// Who lists the person who signed in, by that user id, and not the email nobody has taken up. The owner saves them above 1¢. An
// agent pays another agent above that line: after the owner's approval it is still held with no pay line on either statement, and
// after the picked person's approval the retry posts exactly one pay pair. A run without the provisioning secret is a SKIP.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { giveOnScreen } from './workspaceRoles.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
/** 3 LXC into the payer; 2 LXC ($0.20 at Lens's $0.10 an LXC) paid above a second-approver line of 1¢. */
const FUND_ULXC = 3_000_000
const PAY_ULXC = 2_000_000
const LINE = { above: '0.01', above_minor: 1, currency: 'USD' }

/** One person the Second approver dialog's Who offers: the email it shows and the user id it sends. */
export interface Offered { email: string; user_id: string }

/** Team and roles' Second approver as the owner uses it: the nightly presses the screen; the unit test calls the same Lens routes. */
export interface Picker {
  /** Give a role, Approver: the answer to its PUT /api/workspace/roles. */
  give(email: string): Promise<{ status: number; text: string }>
  /** Choose on Second approver: the people Who lists, or why the owner cannot choose anyone. */
  who(): Promise<Offered[] | string>
  /** Save with Who set to userID, above 1¢ in USD: the answer to its PUT /api/workspace/second-approver. */
  save(userID: string): Promise<{ status: number; text: string }>
  close(): Promise<void>
}

/** What who answers when Second approver offers no Choose: nobody who took an approving role up is listed. */
export const NO_CHOOSE = 'Second approver offers no Choose: it lists nobody who has taken up the Approver or Admin role'

/** Team and roles on the screen, in a tab of the owner's own. */
async function onScreen(ctx: ScenarioCtx): Promise<Picker> {
  const page: Page = await ctx.app.tab('/settings/team')
  const dialog = page.getByRole('dialog', { name: 'Second approver', exact: true })
  return {
    give: (email) => giveOnScreen(page, email, 'approver'),
    who: async () => {
      // The team is read once the screen opens; the person signed in after it, so the owner opens Team and roles again.
      await page.reload()
      const choose = page.getByRole('button', { name: 'Choose', exact: true })
      if (!await choose.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)) return NO_CHOOSE
      await choose.click()
      await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
      const options = await dialog.getByLabel('Who', { exact: true }).locator('option').evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent ?? '']))
      // Each option reads "<email> · <role>".
      return options.map(([user_id, text]) => ({ email: text.split(' · ')[0].trim(), user_id }))
    },
    save: async (userID) => {
      await dialog.getByLabel('Who', { exact: true }).selectOption(userID)
      await dialog.getByLabel('Above', { exact: true }).fill(LINE.above)
      await dialog.getByLabel('Currency', { exact: true }).selectOption(LINE.currency)
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/workspace/second-approver', { timeout: ACTION_TIMEOUT_MS }),
        dialog.getByRole('button', { name: 'Save', exact: true }).click(),
      ])
      const out = { status: res.status(), text: await res.text().catch(() => '') }
      if (res.ok()) await dialog.waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
      return out
    },
    close: () => page.close(),
  }
}

interface Approval { id: string; status: string; waiting_for_second_approver?: boolean }

export function secondApproverPicker(open: (ctx: ScenarioCtx) => Promise<Picker> = onScreen): Scenario {
  return {
    id: 'second-approver-picker',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Team and roles',
    items: ['B28.464'],
    title: "on Team and roles the second approver's Who lists the Approver who has signed in, by the user id Lens's roles list names, " +
      "and not the one nobody has taken up; once saved, the agent's payment above the line posts exactly one pay pair only after that person approves",
    run: async (ctx) => {
      const { lens, provisionSecret } = ctx.env
      const user = ctx.app.user
      if (provisionSecret === '') throw new CannotTest('the Approver signs in to the account on LENS_PROVISION_SECRET, which this run was not given')
      const parse = <T>(text: string): T | undefined => {
        try {
          return JSON.parse(text) as T
        } catch {
          return undefined
        }
      }
      const note = (what: string, r: { status: number; text: string }) => ctx.evidence.push({ note: what, answer: `${r.status} ${r.text.slice(0, 300)}` })
      const ws = `/v1/workspaces/${user.workspaceID}`

      // 1. Two agents, the payer funded.
      const payer = await lens.createAgent(user, `Picked approver payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Picked approver payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)

      const tail = `${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase()
      const taken = `picked-${tail}`
      const waiting = `waiting-${tail}`
      let approverToken = ''
      const picker = await open(ctx)
      try {
        // 2. On Team and roles the owner gives both emails the Approver role.
        for (const email of [taken, waiting]) {
          const given = await picker.give(email)
          note(`on Team and roles the owner gives ${email} the Approver role`, given)
          if (given.status !== 200) return fail(`Give role for ${email} as Approver must answer 200; the BFF answered ${given.status} ${given.text.slice(0, 200)}`)
        }

        // 3. Only the first signs in to the account with it.
        const session = await lens.as('', 'POST', '/v1/provision/roles',
          { identity: `e2e-picked-approver-${RUN_SALT}-${user.workspaceID}`, email: taken, mode: 'session', account_id: user.workspaceID, ttl_hours: 1 },
          { [PROVISION_HEADER]: provisionSecret })
        ctx.evidence.push({ note: `${taken} signs in to the account with the Approver role`, answer: `${session.status} ${session.status === 200 ? '(token withheld)' : session.text.slice(0, 200)}` })
        if (session.status === 401) throw new CannotTest("Lens refused this run's LENS_PROVISION_SECRET: it is not the value Lens boots with")
        approverToken = session.status === 200 ? parse<{ token?: string }>(session.text)?.token ?? '' : ''
        if (approverToken === '') return fail(`${taken} signing in with the Approver role must answer 200 with a session; Lens answered ${session.status} ${session.text.slice(0, 200)}`)

        // 4. Lens's roles list names who took each role up: the person's user id, and "" for the role nobody has.
        const roles = await lens.act<{ items: { email: string; role: string; user_id?: string }[] | null }>(user, 'GET', '/v1/workspaces/{ws}/roles')
        ctx.evidence.push({ note: 'the owner reads the roles list', answer: said(roles) })
        const items = roles.ok ? roles.value.items ?? [] : []
        const [byTaken, byWaiting] = [items.find((r) => r.email === taken), items.find((r) => r.email === waiting)]
        if (!byTaken?.user_id || byWaiting === undefined || byWaiting.user_id !== '') {
          return fail(`the roles list must name ${taken}, who signed in, by a user id and ${waiting}, whom nobody has, by ""; Lens answered ${said(roles)}`)
        }
        const userID = byTaken.user_id

        // 5. Choose on Second approver: Who lists the person who signed in, by that user id, and not the one nobody has.
        const offered = await picker.who()
        ctx.evidence.push({ note: "the owner presses Choose on Second approver and reads Who", answer: typeof offered === 'string' ? offered : JSON.stringify(offered) })
        if (typeof offered === 'string') return fail(`after ${taken} signed in as Approver, Second approver must let the owner choose them; ${offered}`)
        if (!offered.some((o) => o.email === taken && o.user_id === userID) || offered.some((o) => o.email === waiting)) {
          return fail(`Who must offer ${taken} as ${userID} and not ${waiting}, who has not signed in; it offers ${JSON.stringify(offered)}`)
        }

        // 6. The owner saves them as the second approver above 1¢.
        const saved = await picker.save(userID)
        note(`the owner saves ${taken} as the second approver above ${LINE.above_minor}¢`, saved)
        if (saved.status !== 200) return fail(`saving ${taken} as the second approver must answer 200; the BFF answered ${saved.status} ${saved.text.slice(0, 200)}`)
        const read = await lens.act<{ user_id: string; above_minor: number; currency: string }>(user, 'GET', '/v1/workspaces/{ws}/second-approver')
        ctx.evidence.push({ note: 'the owner reads the second approver back', answer: said(read) })
        if (!read.ok || read.value.user_id !== userID || read.value.above_minor !== LINE.above_minor || read.value.currency !== LINE.currency) {
          return fail(`the second approver must read back as ${userID} above ${LINE.above_minor} ${LINE.currency}; Lens answered ${said(read)}`)
        }
      } finally {
        await picker.close()
      }

      const pays = async (agentID: string) => (await lens.agentLines(user, agentID)).filter((l) => l.kind === 'pay')
      const posted = async (): Promise<string> => {
        const [from, to] = [await pays(payer.id), await pays(payee.id)]
        return `${payer.name} has ${from.length} pay line(s) ${JSON.stringify(from.map((l) => l.amount_ulxc))}, ${payee.name} ${to.length} ${JSON.stringify(to.map((l) => l.amount_ulxc))}`
      }
      const none = async () => (await pays(payer.id)).length === 0 && (await pays(payee.id)).length === 0
      const pay = async (what: string) => {
        const r = await lens.as(user.token, 'POST', `${ws}/agents/${payer.id}/pay`, { to_agent_id: payee.id, amount_ulxc: PAY_ULXC, memo: `picked approver ${RUN_SALT}` })
        note(what, r)
        return r
      }
      const approve = async (token: string, id: string, what: string) => {
        const r = await lens.as(token, 'POST', `${ws}/agents/approvals/${id}/approve`, {})
        note(what, r)
        return { ...r, value: r.status === 200 ? parse<Approval>(r.text) : undefined }
      }

      // 7. Above the line the payment is held, and the owner's approval alone posts nothing.
      const first = await pay(`the payer pays ${PAY_ULXC} µLXC, above the second-approver line`)
      const held = first.status === 202 ? parse<{ status?: string; approval_id?: string }>(first.text) : undefined
      const approvalID = held?.approval_id ?? ''
      if (held?.status !== 'pending_approval' || approvalID === '') {
        return fail(`${PAY_ULXC} µLXC above the second-approver line must answer 202 naming its pending approval; Lens answered ${first.status} ${first.text.slice(0, 200)}; ${await posted()}`)
      }
      const byOwner = await approve(user.token, approvalID, 'the owner approves the payment, the first of two')
      if (byOwner.status !== 200 || byOwner.value?.status !== 'pending' || byOwner.value.waiting_for_second_approver !== true) {
        return fail(`the owner's approval above the line must leave it pending and waiting for the second approver; Lens answered ${byOwner.status} ${byOwner.text.slice(0, 200)}`)
      }
      const retried = await pay("the payer retries after the owner's approval")
      if (retried.status !== 202 || !await none()) {
        return fail(`after only the owner's approval the retry must still be held (202) with zero postings; Lens answered ${retried.status} ${retried.text.slice(0, 160)}; ${await posted()}`)
      }

      // 8. The picked person's approval approves it, and the retry posts exactly one pay pair.
      const byPicked = await approve(approverToken, approvalID, `${taken}, the second approver picked on Team and roles, approves the payment`)
      if (byPicked.status !== 200 || byPicked.value?.status !== 'approved') {
        return fail(`the picked second approver's approval must answer 200 approved; Lens answered ${byPicked.status} ${byPicked.text.slice(0, 200)}`)
      }
      const paid = await pay('the payer retries after both approvals')
      const [from, to] = [await pays(payer.id), await pays(payee.id)]
      if (paid.status !== 200 || from.length !== 1 || from[0].amount_ulxc !== -PAY_ULXC || to.length !== 1 || to[0].amount_ulxc !== PAY_ULXC) {
        return fail(`after both approvals the retry must answer 200 and post exactly one pay pair of ${PAY_ULXC} µLXC; Lens answered ${paid.status} ` +
          `${paid.text.slice(0, 160)}; ${await posted()}`)
      }

      return {
        pass: true,
        detail: `the roles list named ${taken} by their user id and ${waiting} by ""; Second approver's Who offered ${taken} and not ${waiting}, ` +
          `and the owner saved them above ${LINE.above_minor}¢; ${PAY_ULXC} µLXC above it was held as approval ${approvalID} with zero postings after the ` +
          `owner's approval, and after ${taken}'s the retry posted one pay pair: -${PAY_ULXC} on ${payer.name}, +${PAY_ULXC} on ${payee.name}`,
      }
    },
  }
}
