// B17.540 — roles: Viewer, Finance, Approver, Admin (B28.70, Lens B28.342), once a run, on a Business workspace of its own. The
// owner opens Settings → Team and roles and, as a person does, presses Give a role twice: one email Viewer, another Finance. Your
// team lists each with its role, not yet signed in. Each person signs in to the account with their role the way the BFF signs
// them in once they have proved their email with the code (POST /v1/provision/roles on the provisioning secret; the run reads no
// mail, so the code itself is the BFF's own test, TestB2870_ATypedAddressShowsNoRoleAndOpensNoSession). The Viewer reads the
// agent's page, and the Viewer's fund is refused 403 and writes no posting: the agent's statement and the workspace's book are
// as they were. The Finance person's fund of the same amount posts exactly one fund line, so the refusal is the Viewer's role and
// not every role session's. The owner then removes the Viewer on the screen: Your team no longer lists them, and the Viewer's
// session reads nothing more. A run without the provisioning secret is a SKIP, never a pass.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
/** What the owner first moves to the agent, and what the Viewer and then Finance each try to move: 1 LXC. */
const START_ULXC = 1_000_000
const FUND_ULXC = 1_000_000

/** The role names Team and roles shows (apps/web/src/areas/lens/rolesApi.ts ROLE_NAME). */
export const ROLE_NAME = { viewer: 'Viewer', finance: 'Finance' } as const
export type Given = keyof typeof ROLE_NAME

/** Team and roles as the owner uses it: the self-test and the nightly press the screen; the unit test calls the same Lens routes. */
export interface Team {
  /** Give a role: the answer to its PUT /api/workspace/roles. */
  give(email: string, role: Given): Promise<{ status: number; text: string }>
  /** The row Your team shows for email, its words run together, or undefined when it lists no such row. */
  row(email: string): Promise<string | undefined>
  /** Remove, then Remove it: the status its DELETE /api/workspace/roles answered. */
  remove(email: string): Promise<number>
  close(): Promise<void>
}

/** One row of Your team: its email, its role's chip and whether it has signed in, as the screen draws them. */
async function teamRow(page: Page, email: string): Promise<string | undefined> {
  const row = page.getByRole('list', { name: 'Your team' }).getByRole('listitem').filter({ hasText: email })
  return (await row.count()) === 0 ? undefined : (await row.first().innerText()).replace(/\s+/g, ' ').trim()
}

/** Give a role on Team and roles: the BFF's answer to the dialog's PUT /api/workspace/roles. */
export async function giveOnScreen(page: Page, email: string, role: Given | 'approver'): Promise<{ status: number; text: string }> {
  await page.getByRole('button', { name: 'Give a role', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  // Team and roles is itself a panel drawn as a dialog: the one wanted is named.
  const dialog = page.getByRole('dialog', { name: 'Give a role', exact: true })
  await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  await dialog.getByLabel('Email', { exact: true }).fill(email)
  await dialog.getByLabel('Role', { exact: true }).selectOption(role)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/workspace/roles', { timeout: ACTION_TIMEOUT_MS }),
    dialog.getByRole('button', { name: 'Give role', exact: true }).click(),
  ])
  const out = { status: res.status(), text: await res.text().catch(() => '') }
  if (res.ok()) await dialog.waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS })
  await page.getByRole('list', { name: 'Your team' }).getByText(email).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  return out
}

/** Remove on Your team, then Remove it: the BFF's answer to the DELETE /api/workspace/roles the dialog sends. */
async function removeOnScreen(page: Page, email: string): Promise<number> {
  const row = page.getByRole('list', { name: 'Your team' }).getByRole('listitem').filter({ hasText: email })
  await row.getByRole('button', { name: 'Remove', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: `Remove “${email}”?`, exact: true })
  await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/workspace/roles', { timeout: ACTION_TIMEOUT_MS }),
    dialog.getByRole('button', { name: 'Remove it', exact: true }).click(),
  ])
  if (res.ok()) await row.waitFor({ state: 'detached', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  return res.status()
}

/** Team and roles on the screen, in a tab of the owner's own. */
async function onScreen(ctx: ScenarioCtx): Promise<Team> {
  const page = await ctx.app.tab('/settings/team')
  return { give: (e, r) => giveOnScreen(page, e, r), row: (e) => teamRow(page, e), remove: (e) => removeOnScreen(page, e), close: () => page.close() }
}

export function workspaceRoles(open: (ctx: ScenarioCtx) => Promise<Team> = onScreen): Scenario {
  return {
    id: 'workspace-roles',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    feature: 'Team and roles',
    items: ['B28.70'],
    title: "on Team and roles the owner gives one email Viewer and another Finance: the Viewer reads the agent but their fund is refused " +
      "and writes no posting, Finance's posts exactly one, and once the owner removes the Viewer their session reads nothing",
    run: async (ctx) => {
      const { lens, provisionSecret } = ctx.env
      const user = ctx.app.user
      if (provisionSecret === '') throw new CannotTest('a person signs in to the account with their role on LENS_PROVISION_SECRET, which this run was not given')
      const ws = `/v1/workspaces/${user.workspaceID}`

      // 1. One agent, given a first LXC by the owner; the workspace keeps enough free for the two tries.
      const agent = await lens.createAgent(user, `Roles agent ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < START_ULXC + 2 * FUND_ULXC) {
        throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${START_ULXC + 2 * FUND_ULXC} µLXC this scenario moves`)
      }
      await lens.fundAgent(user, agent.id, START_ULXC)
      const funds = async () => (await lens.agentLines(user, agent.id)).filter((l) => l.kind === 'fund')
      const free = async () => (await lens.agentBook(user)).unallocated_ulxc

      // 2. On Team and roles the owner gives one email Viewer and another Finance.
      const emails: Record<Given, string> = {
        viewer: `viewer-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase(),
        finance: `finance-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase(),
      }
      const team = await open(ctx)
      const tokens: Partial<Record<Given, string>> = {}
      try {
        for (const role of ['viewer', 'finance'] as const) {
          const email = emails[role]
          const given = await team.give(email, role)
          ctx.evidence.push({ note: `on Team and roles the owner gives ${email} the ${ROLE_NAME[role]} role`, answer: `${given.status} ${given.text.slice(0, 200)}` })
          if (given.status !== 200) return fail(`Give role for ${email} as ${ROLE_NAME[role]} must answer 200; the BFF answered ${given.status} ${given.text.slice(0, 200)}`)
          const row = await team.row(email)
          ctx.evidence.push({ note: `Your team shows ${email}`, answer: row ?? '(no row)' })
          if (row === undefined || !row.includes(ROLE_NAME[role]) || !row.includes('Hasn’t signed in yet')) {
            return fail(`after Give role, Your team must list ${email} as ${ROLE_NAME[role]}, not yet signed in; it shows ${row === undefined ? 'no row for them' : `"${row}"`}`)
          }

          // 3. They sign in to the account with that role, as the BFF signs in a person who proved this email.
          const session = await lens.as('', 'POST', '/v1/provision/roles',
            { identity: `e2e-roles-${role}-${RUN_SALT}-${user.workspaceID}`, email, mode: 'session', account_id: user.workspaceID, ttl_hours: 1 },
            { [PROVISION_HEADER]: provisionSecret })
          ctx.evidence.push({ note: `${email} signs in to the account as ${ROLE_NAME[role]}`, answer: `${session.status} ${session.status === 200 ? '(token withheld)' : session.text.slice(0, 200)}` })
          if (session.status === 401) throw new CannotTest("Lens refused this run's LENS_PROVISION_SECRET: it is not the value Lens boots with")
          let token = ''
          try {
            token = session.status === 200 ? (JSON.parse(session.text) as { token?: string }).token ?? '' : ''
          } catch {
            token = ''
          }
          if (token === '') return fail(`${email} signing in as ${ROLE_NAME[role]} must answer 200 with a session; Lens answered ${session.status} ${session.text.slice(0, 200)}`)
          tokens[role] = token
        }
        const viewer = tokens.viewer ?? ''
        const finance = tokens.finance ?? ''

        // 4. The Viewer reads the agent's page, and their fund is refused and writes no posting.
        const read = await lens.as(viewer, 'GET', `${ws}/agents/${agent.id}/summary`)
        ctx.evidence.push({ note: "the Viewer reads the agent's page", answer: `${read.status} ${read.text.slice(0, 160)}` })
        if (read.status !== 200) return fail(`a Viewer must read an agent's page; Lens answered ${read.status} ${read.text.slice(0, 200)}`)
        const [linesBefore, freeBefore] = [await funds(), await free()]
        const byViewer = await lens.as(viewer, 'POST', `${ws}/agents/${agent.id}/fund`, { amount_ulxc: FUND_ULXC })
        const [linesAfter, freeAfter] = [await funds(), await free()]
        ctx.evidence.push({ note: `the Viewer funds the agent ${FUND_ULXC} µLXC`, answer: `${byViewer.status} ${byViewer.text.slice(0, 200)}; ` +
          `fund lines ${linesBefore.length} → ${linesAfter.length}, the workspace's free µLXC ${freeBefore} → ${freeAfter}` })
        if (byViewer.status !== 403 || linesAfter.length !== linesBefore.length || freeAfter !== freeBefore) {
          return fail(`a Viewer's fund must be refused 403 and write no posting; Lens answered ${byViewer.status} ${byViewer.text.slice(0, 160)}, ` +
            `and the agent's fund lines went ${linesBefore.length} → ${linesAfter.length}, the workspace's free µLXC ${freeBefore} → ${freeAfter}`)
        }

        // 5. Finance's fund of the same amount posts exactly one fund line: the refusal was the Viewer's role.
        const byFinance = await lens.as(finance, 'POST', `${ws}/agents/${agent.id}/fund`, { amount_ulxc: FUND_ULXC })
        const had = new Set(linesAfter.map((l) => l.entry_id))
        const added = (await funds()).filter((l) => !had.has(l.entry_id))
        ctx.evidence.push({ note: `Finance funds the agent ${FUND_ULXC} µLXC`, answer: `${byFinance.status} ${byFinance.text.slice(0, 200)}; new fund lines ${JSON.stringify(added.map((l) => l.amount_ulxc))}` })
        if (byFinance.status !== 200 || added.length !== 1 || added[0].amount_ulxc !== FUND_ULXC) {
          return fail(`Finance's fund must answer 200 and post exactly one fund line of ${FUND_ULXC} µLXC; Lens answered ${byFinance.status} ` +
            `${byFinance.text.slice(0, 160)}, and the new fund lines are ${JSON.stringify(added.map((l) => l.amount_ulxc))}`)
        }

        // 6. The owner removes the Viewer on Team and roles, and the Viewer's session reads nothing more.
        const removed = await team.remove(emails.viewer)
        const left = await team.row(emails.viewer)
        ctx.evidence.push({ note: `on Team and roles the owner removes ${emails.viewer}`, answer: `${removed}; Your team ${left === undefined ? 'no longer lists them' : `still shows "${left}"`}` })
        if (removed < 200 || removed > 299 || left !== undefined) {
          return fail(`Remove it for ${emails.viewer} must answer 2xx and take them off Your team; the BFF answered ${removed}${left === undefined ? '' : `, and Your team still shows "${left}"`}`)
        }
        const after = await lens.as(viewer, 'GET', `${ws}/agents/${agent.id}/summary`)
        ctx.evidence.push({ note: "the removed Viewer reads the agent's page again", answer: `${after.status} ${after.text.slice(0, 160)}` })
        if (after.status !== 401 && after.status !== 403) {
          return fail(`once the owner removed the Viewer, their session must read nothing (401 or 403); Lens answered ${after.status} ${after.text.slice(0, 160)}`)
        }
      } finally {
        await team.close()
      }

      return {
        pass: true,
        detail: `on Team and roles ${emails.viewer} was given Viewer and ${emails.finance} Finance; the Viewer read ${agent.name} and their fund of ` +
          `${FUND_ULXC} µLXC was refused 403 with no posting, Finance's posted exactly one fund line of ${FUND_ULXC} µLXC, and once removed the Viewer's session was refused`,
      }
    },
  }
}
