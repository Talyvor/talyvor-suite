// B55.2 — the web, when only the phone holds a key. Once a run, on a workspace of its own with no passkey: the owner registers
// a phone key as platform "test" (as device-key-approval does) and an agent files an approval. Approvals in the app must say to
// approve it on the phone, show no Approve or Deny for it, and send nothing when its row is pressed "a"; Lens still holds the
// approval pending. A Lens without LENS_DEVICE_TEST_ATTESTATION=true refuses the "test" platform: a SKIP, never a pass.
// B55.14 — first the agent's Rules card: raising its daily limit must say to add this browser and send nothing, so Lens keeps
// the limit, and lowering it must save at once, so Lens holds the lower one.
// B55.3 — then, on a page with a virtual Face ID, Add this device waits for the phone with the code Lens holds; the phone key
// lets it in over its enrolment challenge and the page says this browser signs. A second phone registered unsigned then waits,
// and the page lets it in with this browser's new passkey: Lens holds that enrolment approved.
// B28.68 — last, the phones are lost. On Approvals and devices the person removes this browser's passkey, then Lost your
// phone? locks both phones out: Lens holds no live key and the lockdown, and the first phone's signature on the waiting
// approval is refused and it stays pending. They pass an identity check again, Lift the lockdown, sign in again and type
// the recovery code Lens answered with the first phone: a new passkey on this browser, a new code shown once, and that
// passkey approves the waiting approval on its sheet. Lens holds it approved.

import type { Page } from 'playwright'
import { card, dollarsTyped, fail } from './bank.ts'
import { softDevice } from './deviceKeyApproval.ts'
import { PERSON } from './confirmIdentity.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000
const DAILY_ULXC = 1_000_000
const RAISED_ULXC = 2_000_000
const LOWERED_ULXC = 500_000
const TIMEOUT_MS = 30_000
export const PHONE_LINE = 'Approve this on your phone: it is waiting in Talyvor there.'
export const loosenLine = (agent: string) => `Loosen ${agent}’s rules with a passkey on this browser: add this browser first.`

/** What Approvals showed for the approval, what the page sent, and what Lens holds after. */
export interface PhoneSeen {
  why?: string
  line: boolean
  /** Approve or Decline buttons on the approval's row */
  buttons: number
  /** decisions or resumes the page posted */
  posts: string[]
  /** the approval's status on Lens afterwards */
  status: string
  /** B55.14 — the Rules card said to add this browser when the daily limit was raised */
  loosenLine: boolean
  /** the daily limits the page sent in a rules save */
  rulesSaved: number[]
  /** the agent's daily limit on Lens afterwards */
  daily: number
}

export function phoneKeyWebVerdict(seen: PhoneSeen): Verdict {
  if (seen.why !== undefined) return fail(`Approvals could not be read: ${seen.why}`)
  const wrong: string[] = []
  if (!seen.line) wrong.push(`the approval's row does not say "${PHONE_LINE}"`)
  if (seen.buttons !== 0) wrong.push(`the approval's row shows ${seen.buttons} Approve or Decline button(s) no key here can sign`)
  if (seen.posts.length > 0) wrong.push(`the page sent ${seen.posts.join(', ')}, which Lens must refuse unsigned`)
  if (seen.status !== 'pending') wrong.push(`the approval is ${seen.status || 'missing'} on Lens, not pending`)
  if (!seen.loosenLine) wrong.push(`raising the daily limit did not say "${loosenLine('…')}"`)
  if (seen.rulesSaved.join() !== String(LOWERED_ULXC)) wrong.push(`the page saved daily limits [${seen.rulesSaved.join(', ')}], not only the lowered ${LOWERED_ULXC} µLXC`)
  if (seen.daily !== LOWERED_ULXC) wrong.push(`the daily limit on Lens is ${seen.daily} µLXC, not the lowered ${LOWERED_ULXC}`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return {
    pass: true,
    detail: 'with only the phone key, Approvals said to approve on the phone, showed no button, sent nothing, and the approval stayed pending; a raised daily limit was not sent and a lowered one saved at once',
  }
}

export const WAITING_LINE = /^Waiting for your phone\. Open Talyvor on your phone and let this browser in\. The code there should be (\d{6})\.$/
export const ADDED_LINE = 'This browser now signs approvals. Face ID, Touch ID or this device’s PIN asks each time you approve or decline.'

/** B55.3 — what Face ID and notifications showed while a key joined from the other device, and what Lens holds after. */
export interface EnrolSeen {
  why?: string
  /** the code this browser showed while it waited, and the code Lens holds for its enrolment */
  shown: string
  held: string
  /** the page said this browser now signs, once the phone let it in */
  added: boolean
  /** passkeys Lens holds afterwards */
  passkeys: number
  /** a second phone's ask, with its code, showed on the page */
  asked: boolean
  /** "{name} can approve now." showed once this browser let it in */
  letIn: boolean
  /** that phone's enrolment status on Lens afterwards */
  phoneStatus: string
}

export function enrolVerdict(seen: EnrolSeen): Verdict {
  if (seen.why !== undefined) return fail(`adding a key from the other device could not be finished: ${seen.why}`)
  const wrong: string[] = []
  if (seen.shown === '' || seen.shown !== seen.held) wrong.push(`the page showed code "${seen.shown}" while Lens holds "${seen.held}" for this browser's enrolment`)
  if (!seen.added) wrong.push(`once the phone let it in the page did not say "${ADDED_LINE}"`)
  if (seen.passkeys !== 1) wrong.push(`Lens holds ${seen.passkeys} passkey(s), not this browser's one`)
  if (!seen.asked) wrong.push("a second phone waiting was not shown with its code")
  if (!seen.letIn) wrong.push('Let it approve did not say the phone can approve now')
  if (seen.phoneStatus !== 'approved') wrong.push(`the second phone's enrolment is ${seen.phoneStatus || 'missing'} on Lens, not approved`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: 'the phone let this browser in with the code both showed, and this browser let a second phone in' }
}

/** B28.68 — what a lost phone's lockout and the recovery code came to, on the page and on Lens. */
export interface LostSeen {
  why?: string
  /** passkeys and phone keys Lens holds live once Lost your phone? locked the phones out */
  liveAfterLockout: number
  /** Lens holds the lockdown, and the Locked down card headed the page */
  lockdown: boolean
  card: boolean
  /** what Lens answered the locked-out phone's signature on the waiting approval, and the approval's status after */
  phoneAnswer: number
  afterPhone: string
  /** Lens holds no lockdown once Lift the lockdown was pressed */
  lifted: boolean
  /** passkeys Lens holds live once the recovery code was used, and the new code was shown once */
  recovered: number
  newCode: boolean
  /** the sheet said it was approved with the recovered passkey, and the approval's status on Lens after */
  approved: boolean
  status: string
}

export function lostPhoneVerdict(seen: LostSeen): Verdict {
  const wrong: string[] = []
  if (seen.liveAfterLockout !== 0) wrong.push(`after Lost your phone? Lens holds ${seen.liveAfterLockout} live key(s), not none`)
  if (!seen.lockdown || !seen.card) wrong.push(`the lockdown ${seen.lockdown ? 'is held' : 'is not held'} on Lens and its card ${seen.card ? 'showed' : 'did not show'}`)
  if (seen.phoneAnswer !== 403) wrong.push(`the locked-out phone's signature on the waiting approval must be refused 403; Lens answered ${seen.phoneAnswer}`)
  if (seen.afterPhone !== 'pending') wrong.push(`after the locked-out phone signed, the approval is ${seen.afterPhone || 'missing'}, not pending`)
  // Stopped part-way: what the lockout came to, as far as it got, then where it stopped.
  if (seen.why !== undefined) return fail(`the lost phone could not be locked out and replaced: ${[...(seen.liveAfterLockout < 0 ? [] : wrong), seen.why].join('; ')}`)
  if (!seen.lifted) wrong.push('Lift the lockdown, after an identity check, left the lockdown standing')
  if (seen.recovered !== 1) wrong.push(`after the recovery code Lens holds ${seen.recovered} live passkey(s), not the new one`)
  if (!seen.newCode) wrong.push('the recovery code was used and no new one was shown to save')
  if (!seen.approved) wrong.push('Approve with your passkey did not say the payment was approved')
  if (seen.status !== 'approved') wrong.push(`the approval is ${seen.status || 'missing'} on Lens, not approved by the recovered passkey`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: 'locked out, the lost phone could no longer approve; after an identity check and the recovery code, a new passkey on this browser approved' }
}

/** B28.68 — the phones are lost: this browser's passkey removed, both phones locked out, then a passkey got back by the recovery code. */
async function lostPhone(ctx: ScenarioCtx, phone: ReturnType<typeof softDevice>, phoneID: string, approvalID: string, code: string): Promise<LostSeen> {
  const { lens } = ctx.env
  const user = ctx.app.user
  const seen: LostSeen = { liveAfterLockout: -1, lockdown: false, card: false, phoneAnswer: 0, afterPhone: '', lifted: false, recovered: -1, newCode: false, approved: false, status: '' }
  type Key = { credential_id?: string; id?: string; name: string; revoked_at?: string }
  const liveKeys = async () => {
    const pk = await lens.act<{ passkeys: Key[] | null }>(user, 'GET', '/v1/workspaces/{ws}/agents/passkeys')
    const dk = await lens.act<{ devices: Key[] | null }>(user, 'GET', '/v1/money/devices')
    if (!pk.ok || !dk.ok) throw new Error(`the keys could not be read: ${said(pk)} ${said(dk)}`)
    return { passkeys: (pk.value.passkeys ?? []).filter((k) => !k.revoked_at), devices: (dk.value.devices ?? []).filter((k) => !k.revoked_at) }
  }
  const lockdown = async () => {
    const l = await lens.act<{ active: boolean }>(user, 'GET', '/v1/money/lockdown')
    if (!l.ok) throw new Error(`the lockdown could not be read: ${said(l)}`)
    return l.value.active
  }
  let page: Page | undefined
  try {
    page = await ctx.app.tab('/settings/devices')
    const cdp = await ctx.app.context.newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    const origin = new URL(page.url()).origin

    // This browser's passkey goes first, as any key but the last is removed; then the phones, lost, are locked out.
    for (const k of (await liveKeys()).passkeys) {
      await page.getByRole('button', { name: `Remove ${k.name || 'Passkey'}`, exact: true }).click({ timeout: TIMEOUT_MS })
      await page.getByRole('dialog').getByRole('button', { name: 'Remove it', exact: true }).click({ timeout: TIMEOUT_MS })
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
    }
    await page.getByRole('region', { name: 'Your phone' }).getByRole('button', { name: 'Lost your phone?' }).click({ timeout: TIMEOUT_MS })
    await page.getByRole('dialog', { name: 'Lost your phone?' }).getByRole('button', { name: 'Lock out my phone', exact: true }).click({ timeout: TIMEOUT_MS })
    seen.card = await page.getByRole('region', { name: 'Locked down' }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    const after = await liveKeys()
    seen.liveAfterLockout = after.passkeys.length + after.devices.length
    seen.lockdown = await lockdown()
    ctx.evidence.push({ note: 'Remove this browser\'s passkey, then Lost your phone? → Lock out my phone', answer: JSON.stringify({ live: after, lockdown: seen.lockdown }) })

    // The lost phone signs the waiting approval: refused.
    const ch = await lens.act<{ challenge: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/approvals/${approvalID}/challenge`, {})
    if (!ch.ok) throw new Error(`the approval's challenge was refused: ${said(ch)}`)
    const signed = await lens.act(user, 'POST', `/v1/workspaces/{ws}/agents/approvals/${approvalID}/approve`, { assertion: phone.assert(phoneID, ch.value.challenge) })
    ctx.evidence.push({ note: 'the locked-out phone signs the waiting approval', answer: said(signed) })
    seen.phoneAnswer = signed.status
    seen.afterPhone = (await lens.agentApprovals(user)).find((a) => a.id === approvalID)?.status ?? ''

    // Who they are, checked again from this sign-in, lifts the lockdown.
    const check = await page.request.post(`${origin}/api/verification/identity`, { headers: { Origin: origin }, data: PERSON })
    ctx.evidence.push({ note: 'an identity check again, from this sign-in', answer: `${check.status()} ${(await check.text()).slice(0, 200)}` })
    await page.getByRole('region', { name: 'Locked down' }).getByRole('button', { name: 'Lift the lockdown' }).click({ timeout: TIMEOUT_MS })
    await page.getByRole('region', { name: 'Locked down' }).waitFor({ state: 'detached', timeout: TIMEOUT_MS }).catch(() => undefined)
    seen.lifted = !(await lockdown())

    // A recovery needs a sign-in in the last 10 minutes: the person signs in again, then types the code they saved.
    const again = await page.evaluate(async ({ u, key }) => (await fetch('/auth/synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Talyvor-Synthetic-Key': key },
      body: JSON.stringify({ workspace_id: u.workspaceID, token: u.token, expires_at: u.expiresAt }),
    })).status, { u: user, key: process.env.LENS_SYNTHETIC_KEY ?? '' })
    if (again !== 200) throw new Error(`signing in again answered ${again}`)
    await page.reload()
    await page.getByLabel('Recovery code').fill(code, { timeout: TIMEOUT_MS })
    await page.getByRole('button', { name: 'Use your recovery code' }).click({ timeout: TIMEOUT_MS })
    const sheet = page.getByRole('dialog', { name: 'Save your recovery code' })
    seen.newCode = await sheet.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    if (seen.newCode) await sheet.getByRole('button', { name: 'I saved it' }).click()
    seen.recovered = (await liveKeys()).passkeys.length

    // The recovered passkey approves the payment that waited.
    await page.goto(`${origin}/?approval=${encodeURIComponent(approvalID)}`)
    await page.getByRole('dialog', { name: /wants to pay/ }).getByRole('button', { name: 'Approve with your passkey' }).click({ timeout: TIMEOUT_MS })
    seen.approved = await page.getByText(/^Approved: /).first().waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
  } catch (e) {
    seen.why = (e as Error).message.split('\n')[0]
  } finally {
    await page?.close()
  }
  seen.status = (await lens.agentApprovals(user)).find((a) => a.id === approvalID)?.status ?? ''
  return seen
}

async function addBrowserThenPhone(ctx: ScenarioCtx, phone: ReturnType<typeof softDevice>, phoneID: string): Promise<EnrolSeen> {
  const { lens } = ctx.env
  const user = ctx.app.user
  const seen: EnrolSeen = { shown: '', held: '', added: false, passkeys: -1, asked: false, letIn: false, phoneStatus: '' }
  let page: Page | undefined
  try {
    page = await ctx.app.tab('/approvals')
    const cdp = await ctx.app.context.newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    const device = card(page, 'Face ID and notifications')
    await device.getByRole('button', { name: 'Add this device' }).click({ timeout: TIMEOUT_MS })
    const waiting = device.getByText(WAITING_LINE)
    await waiting.waitFor({ timeout: TIMEOUT_MS })
    seen.shown = WAITING_LINE.exec((await waiting.innerText()).trim())?.[1] ?? ''

    type Enrolment = { id: string; kind: string; code: string; status: string }
    const list = await lens.act<{ enrolments: Enrolment[] | null }>(user, 'GET', '/v1/workspaces/{ws}/agents/keys/enrolments')
    if (!list.ok) throw new Error(`the waiting keys could not be read: ${said(list)}`)
    const mine = (list.value.enrolments ?? []).find((e) => e.kind === 'passkey' && e.code === seen.shown)
    seen.held = mine?.code ?? ''
    if (mine === undefined) return seen
    const ch = await lens.act<{ challenge: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/keys/enrolments/${mine.id}/challenge`, {})
    if (!ch.ok) throw new Error(`the enrolment challenge was refused: ${said(ch)}`)
    const ok = await lens.act(user, 'POST', `/v1/workspaces/{ws}/agents/keys/enrolments/${mine.id}/approve`, { assertion: phone.assert(phoneID, ch.value.challenge) })
    if (!ok.ok) throw new Error(`the phone key letting this browser in was refused: ${said(ok)}`)
    seen.added = await device.getByText(ADDED_LINE).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    const pk = await lens.act<{ passkeys: unknown[] | null }>(user, 'GET', '/v1/workspaces/{ws}/agents/passkeys')
    seen.passkeys = pk.ok ? (pk.value.passkeys ?? []).length : -1

    const second = softDevice()
    const ch2 = await lens.act<{ challenge: string }>(user, 'POST', '/v1/money/devices/challenge', {})
    if (!ch2.ok) throw new Error(`the second phone's registration challenge was refused: ${said(ch2)}`)
    const reg2 = await lens.act<{ enrolment: { id: string; code: string } }>(user, 'POST', '/v1/money/devices', second.register(ch2.value.challenge, 'Nightly phone two'))
    if (reg2.status !== 202 || !reg2.ok) throw new Error(`a second phone key registered unsigned must wait (202); Lens answered ${said(reg2)}`)
    const { id, code } = reg2.value.enrolment
    const ask = `Your Nightly phone two asks to approve payments too. Let it in only if you are adding it now and its code is ${code}.`
    seen.asked = await device.getByText(ask).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    if (seen.asked) {
      await device.getByRole('button', { name: 'Let it approve' }).click()
      seen.letIn = await device.getByText('Nightly phone two can approve now.').waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    }
    const after = await lens.act<{ status: string }>(user, 'GET', `/v1/workspaces/{ws}/agents/keys/enrolments/${id}`)
    seen.phoneStatus = after.ok ? after.value.status : ''
  } catch (e) {
    seen.why = (e as Error).message.split('\n')[0]
  } finally {
    await page?.close()
  }
  return seen
}

export function phoneKeyWeb(): Scenario {
  return {
    id: 'phone-key-web',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B55.2', 'B55.14', 'B55.3', 'B28.68'],
    title: 'with only a phone key, Approvals says to approve on the phone, shows no Approve or Deny, sends nothing, and the approval stays pending; ' +
      'a raised limit is not sent and a lowered one saves at once; then the phone lets this browser in with the code both show, and this browser lets a second phone in; ' +
      'then the phones are lost and locked out, the lost phone can no longer approve, and a passkey got back by the recovery code approves',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const ch = await lens.act<{ challenge: string }>(user, 'POST', '/v1/money/devices/challenge', {})
      if (!ch.ok) return fail(`the device registration challenge was refused: ${said(ch)}`)
      const phone = softDevice()
      const reg = await lens.act<{ id: string; recovery_code?: string }>(user, 'POST', '/v1/money/devices', phone.register(ch.value.challenge, 'Nightly phone'))
      if (reg.status === 400 && !reg.ok && reg.error.includes('test device keys are not accepted')) {
        throw new CannotTest(`Lens refuses the "test" device platform: ${reg.error} — it needs LENS_DEVICE_TEST_ATTESTATION=true in lens.env`)
      }
      if (reg.status !== 201 || !reg.ok) return fail(`registering a test device key must answer 201; Lens answered ${said(reg)}`)
      ctx.evidence.push({ note: 'the owner registers a phone key and no passkey', answer: said(reg) })

      const payer = await lens.createAgent(user, `Phone payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Phone payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'phone-key-web' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${k.status} ${k.error}`)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC, daily_limit_ulxc: DAILY_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${rules.status} ${rules.error}`)
      const paid = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, 200_000, `phone ${RUN_SALT}`)
      const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.status === 'pending')?.id
      if (paid.ok || id === undefined) return fail(`a payment above the approval amount must be refused and file a pending approval; Lens answered ${paid.ok ? 'paid' : `${paid.status} ${paid.error}`}`)

      const seen: PhoneSeen = { line: false, buttons: -1, posts: [], status: '', loosenLine: false, rulesSaved: [], daily: -1 }
      const page = await ctx.app.tab('/approvals')
      page.on('request', (q) => {
        const path = new URL(q.url()).pathname
        if (q.method() === 'POST' && /^\/api\/agents\/(approvals\/[^/]+\/(approve|deny)|[^/]+\/resume|resume-all)$/.test(path)) seen.posts.push(path)
      })
      try {
        const row = page.locator(`[id="approval-${id}"]`)
        seen.line = await row.getByText(PHONE_LINE).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        seen.buttons = await row.getByRole('button', { name: /^(Approve|Decline)/ }).count()
        await row.focus()
        await page.keyboard.press('a')
        await page.waitForTimeout(1_000)
      } catch (e) {
        seen.why = (e as Error).message.split('\n')[0]
      } finally {
        await page.close()
      }
      seen.status = (await lens.agentApprovals(user)).find((a) => a.id === id)?.status ?? ''

      // B57.23 — the agent's rules page.
      const rulesPage = await ctx.app.tab(`/agents/${encodeURIComponent(payer.id)}/rules`)
      rulesPage.on('request', (q) => {
        if (q.method() !== 'PUT' || new URL(q.url()).pathname !== `/api/agents/${payer.id}/rules`) return
        const body = q.postDataJSON() as { daily_limit_ulxc?: number; rules?: { daily_limit_ulxc?: number } }
        seen.rulesSaved.push(body.rules?.daily_limit_ulxc ?? body.daily_limit_ulxc ?? -1)
      })
      try {
        // B61.86 — since B61.14 the rules page types its limits in dollars, at Lens's peg.
        const daily = rulesPage.getByLabel(`At most a day for ${payer.name}, in dollars`)
        await daily.fill(dollarsTyped(RAISED_ULXC, ctx.env.usdPerLXC), { timeout: TIMEOUT_MS })
        await rulesPage.getByRole('button', { name: 'Save rules' }).click()
        seen.loosenLine = await rulesPage.getByText(loosenLine(payer.name)).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        await daily.fill(dollarsTyped(LOWERED_ULXC, ctx.env.usdPerLXC))
        await rulesPage.getByRole('button', { name: 'Save rules' }).click()
        await rulesPage.getByText(`${payer.name}’s rules are saved`).waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
      } catch (e) {
        seen.why ??= (e as Error).message.split('\n')[0]
      } finally {
        await rulesPage.close()
      }
      seen.daily = (await lens.agentRules(user, payer.id)).daily_limit_ulxc
      ctx.evidence.push({ note: 'Approvals and the Rules card with only the phone key', answer: JSON.stringify(seen) })
      const shown = phoneKeyWebVerdict(seen)
      const enrol = shown.pass ? await addBrowserThenPhone(ctx, phone, reg.value.id) : undefined
      if (enrol) ctx.evidence.push({ note: 'a key let in from the other device, each way', answer: JSON.stringify(enrol) })
      const before = enrol ? enrolVerdict(enrol) : shown
      // B28.68 — whatever the parts before it came to. Lens answers the recovery code once, with the workspace's first key: the phone's.
      const lost: LostSeen = reg.value.recovery_code ? await lostPhone(ctx, phone, reg.value.id, id, reg.value.recovery_code)
        : { why: "Lens answered no recovery code with the workspace's first key", liveAfterLockout: -1, lockdown: false, card: false, phoneAnswer: 0, afterPhone: '', lifted: false, recovered: -1, newCode: false, approved: false, status: '' }
      ctx.evidence.push({ note: 'the phones lost: locked out, then a passkey got back by the recovery code', answer: JSON.stringify(lost) })
      const recovered = lostPhoneVerdict(lost)
      const devices = await lens.act<{ devices: Array<{ id: string; revoked_at?: string }> | null }>(user, 'GET', '/v1/money/devices')
      for (const d of devices.ok ? devices.value.devices ?? [] : [{ id: reg.value.id }]) {
        if (!d.revoked_at) await lens.act(user, 'POST', `/v1/money/devices/${d.id}/revoke`, {})
      }
      const failed = [before, recovered].filter((v) => !v.pass)
      return failed.length > 0 ? fail(failed.map((v) => v.detail).join('; ')) : { pass: true, detail: `${before.detail}; ${recovered.detail}` }
    },
  }
}
