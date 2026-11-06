// B55.44 — what the Pocket problems' scenarios share: a screen opened at 1440x900 and 390x844 with a shot of each, the
// words no person should read, Face ID in the browser, and an agent's approval filed the way an agent files one.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, card } from '../bank.ts'
import type { Answered } from '../lens.ts'
import { RUN_SALT } from '../oracles.ts'
import { said } from '../routes.ts'
import { CannotTest, type ScenarioCtx } from '../scenarios.ts'

/** The web at a desk and on a phone (B55.44). */
export const SIZES = [[1440, 900], [390, 844]] as const

/** What a screen that could not draw says (packages/ui). */
export const BLANK = /This screen couldn.t be read/

/** The phone's own session (B57.86) is not in the harness yet: a problem only the phone can press SKIPs, naming it. */
export const PHONE = "pressed on the phone, through B57.86's phone session, which has not landed in the harness"

/** One step on Lens's API as the workspace's owner, kept as evidence. */
export async function step<T>(ctx: ScenarioCtx, method: string, path: string, body: unknown, note: string): Promise<Answered<T>> {
  const got = await ctx.env.lens.act<T>(ctx.app.user, method, path, body)
  ctx.evidence.push({ note, answer: said(got) })
  return got
}

/** Lets the screen's reads settle: the network quiet, and no "Loading" left. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  await page.getByText(/^Loading/).first().waitFor({ state: 'hidden', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
}

/** `page` at both sizes: a shot of each in the run's shots, and the words on the screen at each. */
export async function bothSizes(ctx: ScenarioCtx, page: Page, name: string): Promise<{ width: number; text: string }[]> {
  const { dir, link } = ctx.env.shots
  await mkdir(dir, { recursive: true })
  const out: { width: number; text: string }[] = []
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height })
    await settled(page)
    const file = `${name}-${width}px-user${ctx.app.user.index}.png`
    await page.screenshot({ path: join(dir, file), fullPage: true })
    ctx.evidence.push({ note: `${name} at ${width}px: ${link}/${file}` })
    // The person's own sign-in address is theirs to read; a synthetic one carries the workspace's id.
    out.push({ width, text: (await page.locator('body').innerText()).replace(/\S+@synthetic\.talyvor\.invalid/g, '') })
  }
  // Back at the desk, where the sidebar and its badge are.
  await page.setViewportSize({ width: SIZES[0][0], height: SIZES[0][1] })
  return out
}

/** Opens `path` in a tab, reads it at both sizes, and closes it. */
export async function screenAt(ctx: ScenarioCtx, path: string, name: string): Promise<{ width: number; text: string }[]> {
  const page = await ctx.app.tab(path)
  try {
    return await bothSizes(ctx, page, name)
  } finally {
    await page.close()
  }
}

/**
 * The machine words on a screen (B55.29 to B55.33, B55.42): any of `ids`, Lens's setting names, µLXC, an `mcp:` client, a
 * "Spending:" prefix, a bracketed rule code, a snake_case status or category, "item(s)" and an RFC 3339 time.
 */
export function machineWords(text: string, ids: readonly string[] = []): string[] {
  const found = ids.filter((id) => id !== '' && text.includes(id)).map((id) => `the raw id ${id}`)
  for (const re of [/\bLENS_[A-Z0-9_]+/, /µLXC/, /\bmcp:\S*/, /\bSpending:/, /\[[a-z][a-z0-9_.-]*\]/, /\b[a-z]+(?:_[a-z]+)+\b/, /\bitem\(s\)/,
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/]) {
    const m = re.exec(text)
    if (m !== null) found.push(`"${m[0]}"`)
  }
  return found
}

/** Money written any way but $450.00, dollars first with LXC beside it (B55.38, B55.30). */
export function moneyWords(text: string): string[] {
  const found: string[] = []
  for (const re of [/US\$\s?\d[\d,.]*/, /\bUSD\s?\d[\d,.]*/, /\d[\d,.]*\s?USD\b/, /\d[\d,.]*\s?LXC\s?\(\$/, /\$\d[\d,]*(?![\d,]*\.\d)/]) {
    const m = re.exec(text)
    if (m !== null) found.push(`"${m[0]}"`)
  }
  return found
}

/** Face ID in this browser: a platform authenticator that verifies the person, for the page's whole life. */
export async function faceID(ctx: ScenarioCtx, page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  ctx.evidence.push({ note: 'this browser has Face ID (a virtual platform authenticator)' })
}

/**
 * Turns on approving with Face ID on Approvals, as the person does, and goes back to where `page` was; the refusal's words
 * when it does not end signed. The authenticator stays with the page.
 */
export async function turnOnPasskey(ctx: ScenarioCtx, page: Page): Promise<string | undefined> {
  const back = page.url()
  await faceID(ctx, page)
  await page.goto(new URL('/approvals', back).toString())
  try {
    return await pressFaceID(page)
  } finally {
    if (new URL(back).pathname !== '/approvals') await page.goto(back)
  }
}

async function pressFaceID(page: Page): Promise<string | undefined> {
  const device = card(page, 'Face ID and notifications')
  const button = device.getByRole('button', { name: /^(Approve with Face ID from now on|Add this device)$/ })
  try {
    await button.waitFor({ timeout: ACTION_TIMEOUT_MS })
  } catch {
    return `Agent Wallets offers no way to approve with Face ID; the card reads "${(await device.innerText().catch(() => '')).slice(0, 200)}"`
  }
  await button.click()
  const done = device.getByRole('status').filter({ hasText: /^This device now signs approvals/ })
  const refused = device.getByRole('alert')
  await done.or(refused).first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  if (await done.first().isVisible()) return undefined
  return `turning on Face ID did not end with "This device now signs approvals": ${(await refused.first().innerText().catch(() => 'nothing was said')).trim()}`
}

export interface Filed {
  payer: { id: string; name: string }
  payee: { id: string; name: string }
  key: string
  approval: string
  amount: number
  /** Pays `amount` again as the agent: Lens's answer. */
  again: (amount?: number) => Promise<Answered<unknown>>
}

const FUND_ULXC = 3_000_000
const ABOVE_ULXC = 1_000_000

/** An agent pays another above its approval amount, as an agent does on its key, and Lens files a pending approval. */
export async function fileApproval(ctx: ScenarioCtx, name: string, amount = 2_000_000, wallet?: { id: string; name: string }): Promise<Filed> {
  const { lens } = ctx.env
  const user = ctx.app.user
  const payer = wallet ?? await lens.createAgent(user, `${name} ${RUN_SALT}`)
  const payee = await lens.createAgent(user, `Payee of ${name} ${RUN_SALT}`)
  const book = await lens.agentBook(user)
  if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
  await lens.fundAgent(user, payer.id, FUND_ULXC)
  const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'pocket-problems' })
  if (!k.ok) throw new Error(`issuing ${payer.name} a key was refused: ${said(k)}`)
  const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: ABOVE_ULXC })
  if (!rules.ok) throw new Error(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)
  const memo = `${name} ${RUN_SALT}`
  const again = async (a = amount) => {
    const r = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, a, memo)
    ctx.evidence.push({ note: `${payer.name} pays ${payee.name} ${a} µLXC, above its ${ABOVE_ULXC} µLXC approval amount`, answer: said(r) })
    return r
  }
  const r = await again()
  const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === amount && a.status === 'pending')?.id
  if (r.ok || id === undefined) throw new Error(`a payment above the approval amount must file a pending approval; Lens answered ${said(r)}`)
  return { payer, payee, key: k.value.key, approval: id, amount, again }
}
