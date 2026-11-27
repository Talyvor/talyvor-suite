// B17.552 — Team and roles on the phone (talyvor-mobile B28.463, the phone side of B28.70), once a run, on a Business workspace of
// its own, in the phone app's web export (phoneJourneys.ts openPhone, E2E_MOBILE_SRC). The owner opens Settings on the phone and,
// as a person does, presses Give a role twice in Your team: one email Viewer, another Finance. Your team lists each with its role,
// not yet signed in. From there the run is workspace-roles' own (workspaceRoles.ts): each person signs in with their role, the
// Viewer's fund is refused 403 and writes no posting, Finance's posts exactly one fund line, and once the owner presses Remove and
// Remove it on the phone, Your team no longer lists the Viewer and their session reads nothing more. Accounts shared with you
// cannot be reached here: the BFF sends no code to a test session (409 "a test session holds one account"), so its wrong-code
// sentence is talyvor-mobile's own component test (B28.463's CHECKS). A run without the provisioning secret or the phone is a SKIP.

import { openPhone, type Phone, type Sent, sentWords } from './phoneJourneys.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { type Given, ROLE_NAME, type Team, workspaceRoles } from './workspaceRoles.ts'

const TIMEOUT_MS = 30_000

/** What give answers when the phone's Settings draws no Your team: the feature is not there, so the run FAILs on it. */
export const NO_TEAM = 'the phone’s Settings shows no Your team card (settings-access.tsx YourTeam) to give a role from'

/** The first request after the phone's first `from` that is method to path, once the BFF has answered it. */
async function sentAfter(phone: Phone, from: number, method: string, path: string): Promise<Sent | undefined> {
  const until = Date.now() + TIMEOUT_MS
  while (Date.now() < until) {
    const s = phone.sent.slice(from).find((x) => x.method === method && x.path === path)
    if (s !== undefined) return s
    await phone.page.waitForTimeout(250)
  }
  return undefined
}

/** Your team on the phone's Settings, as the owner presses it. */
export async function onPhone(ctx: ScenarioCtx): Promise<Team> {
  const phone = await openPhone(ctx)
  const { page } = phone
  await phone.open('/settings')
  const card = page.getByTestId('your-team-card')
  const shown = await card.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
  ctx.evidence.push({ note: "the phone's Settings › Team and roles", answer: shown ? 'Your team is shown' : NO_TEAM })
  // A row's email, then what is drawn under it: whether they have signed in, and the role's chip.
  const row = async (email: string) => {
    const under = page.getByTestId(`under:${email}`)
    return (await under.count()) === 0 ? undefined : `${email} ${(await under.first().innerText()).replace(/\s+/g, ' ').trim()}`
  }
  return {
    give: async (email: string, role: Given) => {
      if (!shown) return { status: 0, text: NO_TEAM }
      const from = phone.sent.length
      await card.getByRole('button', { name: 'Give a role', exact: true }).click()
      const sheet = page.getByTestId('give-role-sheet')
      await sheet.getByLabel('Email', { exact: true }).fill(email)
      await sheet.getByRole('radio', { name: ROLE_NAME[role], exact: true }).click()
      await sheet.getByTestId('give-role-send').click()
      const put = await sentAfter(phone, from, 'PUT', '/api/workspace/roles')
      if (put === undefined) return { status: 0, text: `Give role sent no PUT /api/workspace/roles; the phone sent ${sentWords(phone.sent.slice(from))}` }
      if (put.status === 200) await page.getByTestId(`under:${email}`).waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
      return { status: put.status, text: put.answer }
    },
    row,
    remove: async (email: string) => {
      const from = phone.sent.length
      await page.getByRole('button', { name: `Remove ${email}`, exact: true }).click()
      await page.getByTestId('remove-role-sheet').getByRole('button', { name: 'Remove it', exact: true }).click()
      const del = await sentAfter(phone, from, 'DELETE', '/api/workspace/roles')
      if (del === undefined) return 0
      if (del.status < 300) await page.getByTestId(`under:${email}`).waitFor({ state: 'detached', timeout: TIMEOUT_MS }).catch(() => undefined)
      return del.status
    },
    close: () => phone.close(),
  }
}

export function phoneTeamRoles(open: (ctx: ScenarioCtx) => Promise<Team> = onPhone): Scenario {
  return {
    ...workspaceRoles(open),
    id: 'phone-team-roles',
    items: ['B28.463'],
    title: "on the phone's Team and roles the owner gives one email Viewer and another Finance: the Viewer reads the agent but their fund " +
      "is refused and writes no posting, Finance's posts exactly one, and once the owner removes the Viewer on the phone their session reads nothing",
  }
}
