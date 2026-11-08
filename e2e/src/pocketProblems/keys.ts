// B55.44 — the Pocket problems about who holds a key: a second device let in by the first (1), the phone's own presses
// (2, 15, 16), the web when only the phone holds a key (4, 22), and removing keys but never the last (11). Words from
// B55.2, B55.3 and B55.16.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, AgentBankScreen, card, fail } from '../bank.ts'
import { softDevice } from '../deviceKeyApproval.ts'
import { RUN_SALT } from '../oracles.ts'
import { softPasskey } from '../payees.ts'
import { said } from '../routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from '../scenarios.ts'
import { BLANK, PHONE, bothSizes, faceID, fileApproval, machineWords, screenAt, settled, step, turnOnPasskey } from './press.ts'

type Bare = Omit<Scenario, 'id' | 'items'>

/** A phone's key on the workspace, as the phone registers it; Lens without test device keys (production) cannot be pressed. */
async function phoneKey(ctx: ScenarioCtx): Promise<{ id: string; device: ReturnType<typeof softDevice> }> {
  const ch = await step<{ challenge: string }>(ctx, 'POST', '/v1/money/devices/challenge', {}, "the phone asks to register its key")
  if (!ch.ok) throw new Error(`the device registration challenge was refused: ${said(ch)}`)
  const device = softDevice()
  const reg = await step<{ id: string }>(ctx, 'POST', '/v1/money/devices', device.register(ch.value.challenge, `Pocket phone ${RUN_SALT}`), "the phone registers its key")
  if (reg.status === 400 && !reg.ok && reg.error.includes('test device keys are not accepted')) {
    throw new CannotTest(`a phone's key: Lens refuses the "test" device platform (${reg.error}), and the real phone is ${PHONE}`)
  }
  if (!reg.ok) throw new Error(`registering the phone's key was refused: ${said(reg)}`)
  return { id: reg.value.id, device }
}

/** 1 — a second device joins only once a key the workspace already has lets it in (B55.1, B55.3, B55.4). */
export function keysLetIn(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Agent Wallets',
    title: 'a workspace whose first key is a web passkey adds a second device, let in from the first with "Let it approve"',
    run: async (ctx) => {
      const first = await AgentBankScreen.open(ctx.app)
      const browser = ctx.app.context.browser()
      if (browser === null) throw new Error('the run has no browser to open a second device in')
      const second = await browser.newContext()
      try {
        const made = await turnOnPasskey(ctx, first.page)
        if (made !== undefined) return fail(`the first passkey: ${made}`)
        // The second device: the same person, signed in, in a browser of its own with its own Face ID.
        await second.addCookies(await ctx.app.context.cookies())
        const other = await second.newPage()
        await other.goto(new URL('/approvals', first.page.url()).toString())
        await faceID(ctx, other)
        const device = card(other, 'Face ID and notifications')
        const add = device.getByRole('button', { name: /^Add this (device|browser)$/ })
        await add.waitFor({ timeout: ACTION_TIMEOUT_MS })
        await add.click()
        await settled(other)
        const asked = (await device.innerText()).replace(/\s+/g, ' ')
        ctx.evidence.push({ note: 'the second browser presses Add this device', answer: asked })
        if (/This (device|browser) now signs approvals/.test(asked)) return fail('the second browser was let in by Lens at once, with no key the workspace has letting it in')
        // The first device sees it waiting, with its code, and lets it in.
        await first.page.goto(new URL('/approvals', first.page.url()).toString())
        await settled(first.page)
        const ask = first.page.getByText(/asks to approve payments too/).first()
        if (!(await ask.isVisible().catch(() => false))) {
          return fail(`the second browser asked to join ("${asked.slice(0, 200)}"), and the first device shows no "… asks to approve payments too" with "Let it approve"`)
        }
        await first.page.getByRole('button', { name: 'Let it approve' }).first().click()
        await first.page.getByText(/can approve now\.$/).first().waitFor({ timeout: ACTION_TIMEOUT_MS })
        await other.reload()
        await settled(other)
        const keys = await step<{ passkeys: unknown[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/agents/passkeys', undefined, 'the workspace\'s passkeys')
        if (!keys.ok || (keys.value.passkeys ?? []).length !== 2) return fail(`let in from the first device, the workspace lists ${said(keys)}, not two passkeys`)
        await bothSizes(ctx, other, 'pocket-01-second-browser')
      } catch (e) {
        if (e instanceof CannotTest) throw e
        return fail(`pressing it as a person does: ${(e as Error).message.split('\n')[0]}`)
      } finally {
        await second.close().catch(() => undefined)
        await first.close()
      }
      throw new CannotTest(`the web's two legs pass (a second browser let in by the first passkey); the phone's legs are ${PHONE}`)
    },
  }
}

/** 2, 15, 16 — only the phone can press these. */
export function onThePhone(what: string): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Approvals',
    title: what,
    run: async () => {
      throw new CannotTest(`${what}: ${PHONE}`)
    },
  }
}

/** 4 — with only the phone's key, the web offers no button Lens must refuse and says where to approve (B55.2). */
export function phoneOnlyWeb(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Approvals',
    agents: 2,
    title: "with only the phone's key, Approvals shows no Approve that Lens must refuse and says to approve on the phone",
    run: async (ctx) => {
      await phoneKey(ctx)
      const filed = await fileApproval(ctx, 'Phone only')
      const page = await ctx.app.tab('/approvals')
      try {
        const wrong: string[] = []
        for (const { width, text } of await bothSizes(ctx, page, 'pocket-04-approvals')) {
          if (BLANK.test(text)) wrong.push(`at ${width}px Approvals did not draw`)
          if (!text.includes('Approve this on your phone')) wrong.push(`at ${width}px Approvals does not say "Approve this on your phone: it is waiting in Talyvor there."`)
        }
        const buttons = page.getByRole('button', { name: /^(Approve|Deny|Decline)\b/ })
        const live = (await buttons.evaluateAll((bs) => bs.filter((b) => !(b as HTMLButtonElement).disabled).length))
        if (live > 0) wrong.push(`Approvals offers ${live} Approve or Decline button(s) Lens must refuse without the phone's signature`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return { pass: true, detail: `${filed.payer.name}'s approval waits; Approvals offers no button that fails and says to approve on the phone` }
      } finally {
        await page.close()
      }
    },
  }
}

/** The key list on Agent Wallets (B55.16): each key by name; `name`'s row and whether it has Remove. */
async function keyRow(page: Page, name: string): Promise<{ listed: boolean; removable: boolean }> {
  const row = card(page, 'Face ID and notifications').locator('li, [role="listitem"], div').filter({ hasText: name }).last()
  const listed = await row.isVisible().catch(() => false)
  return { listed, removable: listed && (await row.getByRole('button', { name: /^Remove/ }).count()) > 0 }
}

/** 11 — any key but the last is removable from the web, and the last never is (B55.15, B55.16). */
export function keysRemovable(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Agent Wallets',
    title: 'a passkey shows by name on Approvals; a second one can be removed, the last cannot, on the screen or on Lens',
    run: async (ctx) => {
      const reg = await step<{ challenge: string; rp_id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const name = `Pocket key ${RUN_SALT}`
      const key = softPasskey(reg.value.rp_id)
      const made = await step(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, name), 'the owner registers the first passkey')
      if (made.status !== 201) return fail(`registering the first passkey answered ${said(made)}`)
      const list = await step<{ passkeys: { credential_id: string; name: string }[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/agents/passkeys', undefined, 'the passkeys')
      const id = (list.ok ? list.value.passkeys ?? [] : []).find((p) => p.name === name)?.credential_id
      if (id === undefined) return fail(`the registered passkey is not listed: ${said(list)}`)
      const page = await ctx.app.tab('/approvals')
      try {
        await settled(page)
        const wrong: string[] = []
        for (const { width, text } of await bothSizes(ctx, page, 'pocket-11-keys')) {
          if (!text.includes(name)) wrong.push(`at ${width}px Approvals' Face ID card does not list the passkey "${name}" by name`)
        }
        const row = await keyRow(page, name)
        if (row.removable) wrong.push(`the workspace's last key "${name}" has a Remove button`)
        const gone = await step(ctx, 'DELETE', `/v1/workspaces/{ws}/agents/passkeys/${id}`, undefined, 'the owner removes the last key on Lens')
        if (gone.status !== 409) wrong.push(`removing the workspace's last key on Lens must be refused 409; it answered ${said(gone)}`)
        else if (machineWords(said(gone)).length > 0) wrong.push(`the refusal is not in words: ${said(gone)}`)
        if (wrong.length > 0) return fail(wrong.join('; '))
      } finally {
        await page.close()
      }
      throw new CannotTest('the last key is listed by name with no Remove, and Lens refuses removing it in words; a second key to remove waits on a key joining from another device (problem 1)')
    },
  }
}

/** 22 — revoking the workspace's only key, the phone's, is refused in words, and the key still signs (B55.15, B55.16). */
export function lastPhoneKey(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Agent Wallets',
    agents: 2,
    title: "revoking the phone's key when it is the workspace's only key is refused in words, and it still approves",
    run: async (ctx) => {
      const phone = await phoneKey(ctx)
      const wrong: string[] = []
      const rev = await step(ctx, 'POST', `/v1/money/devices/${phone.id}/revoke`, {}, "the owner revokes the phone's key, the only key")
      if (rev.status !== 409) wrong.push(`revoking the only key must be refused 409; Lens answered ${said(rev)}`)
      else if (machineWords(said(rev)).length > 0) wrong.push(`the refusal is not in words: ${said(rev)}`)
      const shown = await screenAt(ctx, '/approvals', 'pocket-22-keys')
      for (const { width, text } of shown) if (BLANK.test(text)) wrong.push(`at ${width}px Approvals did not draw`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      const filed = await fileApproval(ctx, 'Last key')
      const c = await step<{ challenge: string }>(ctx, 'POST', `/v1/workspaces/{ws}/agents/approvals/${filed.approval}/challenge`, {}, 'the approval\'s challenge')
      if (!c.ok) return fail(`the approval's challenge was refused: ${said(c)}`)
      const ok = await step(ctx, 'POST', `/v1/workspaces/{ws}/agents/approvals/${filed.approval}/approve`, { assertion: phone.device.assert(phone.id, c.value.challenge) }, 'the phone approves')
      if (!ok.ok) return fail(`after the refused revoke the phone's key must still approve; Lens answered ${said(ok)}`)
      return { pass: true, detail: "revoking the only key was refused in words; the phone's key still approved" }
    },
  }
}
