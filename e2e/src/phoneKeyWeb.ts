// B55.2 — the web, when only the phone holds a key. Once a run, on a workspace of its own with no passkey: the owner registers
// a phone key as platform "test" (as device-key-approval does) and an agent files an approval. Approvals in the app must say to
// approve it on the phone, show no Approve or Deny for it, and send nothing when its row is pressed "a"; Lens still holds the
// approval pending. A Lens without LENS_DEVICE_TEST_ATTESTATION=true refuses the "test" platform: a SKIP, never a pass.

import { fail } from './bank.ts'
import { softDevice } from './deviceKeyApproval.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000
const TIMEOUT_MS = 30_000
export const PHONE_LINE = 'Approve this on your phone: it is waiting in Talyvor there.'

/** What Approvals showed for the approval, what the page sent, and what Lens holds after. */
export interface PhoneSeen {
  why?: string
  line: boolean
  /** Approve or Deny buttons on the approval's row */
  buttons: number
  /** decisions or resumes the page posted */
  posts: string[]
  /** the approval's status on Lens afterwards */
  status: string
}

export function phoneKeyWebVerdict(seen: PhoneSeen): Verdict {
  if (seen.why !== undefined) return fail(`Approvals could not be read: ${seen.why}`)
  const wrong: string[] = []
  if (!seen.line) wrong.push(`the approval's row does not say "${PHONE_LINE}"`)
  if (seen.buttons !== 0) wrong.push(`the approval's row shows ${seen.buttons} Approve or Deny button(s) no key here can sign`)
  if (seen.posts.length > 0) wrong.push(`the page sent ${seen.posts.join(', ')}, which Lens must refuse unsigned`)
  if (seen.status !== 'pending') wrong.push(`the approval is ${seen.status || 'missing'} on Lens, not pending`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: 'with only the phone key, Approvals said to approve on the phone, showed no button, sent nothing, and the approval stayed pending' }
}

export function phoneKeyWeb(): Scenario {
  return {
    id: 'phone-key-web',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B55.2'],
    title: 'with only a phone key, Approvals says to approve on the phone, shows no Approve or Deny, sends nothing, and the approval stays pending',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const ch = await lens.act<{ challenge: string }>(user, 'POST', '/v1/money/devices/challenge', {})
      if (!ch.ok) return fail(`the device registration challenge was refused: ${said(ch)}`)
      const reg = await lens.act<{ id: string }>(user, 'POST', '/v1/money/devices', softDevice().register(ch.value.challenge, 'Nightly phone'))
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
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${rules.status} ${rules.error}`)
      const paid = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, 200_000, `phone ${RUN_SALT}`)
      const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.status === 'pending')?.id
      if (paid.ok || id === undefined) return fail(`a payment above the approval amount must be refused and file a pending approval; Lens answered ${paid.ok ? 'paid' : `${paid.status} ${paid.error}`}`)

      const seen: PhoneSeen = { line: false, buttons: -1, posts: [], status: '' }
      const page = await ctx.app.tab('/approvals')
      page.on('request', (q) => {
        const path = new URL(q.url()).pathname
        if (q.method() === 'POST' && /^\/api\/agents\/(approvals\/[^/]+\/(approve|deny)|[^/]+\/resume|resume-all)$/.test(path)) seen.posts.push(path)
      })
      try {
        const row = page.locator(`[id="approval-${id}"]`)
        seen.line = await row.getByText(PHONE_LINE).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        seen.buttons = await row.getByRole('button', { name: /^(Approve|Deny)/ }).count()
        await row.focus()
        await page.keyboard.press('a')
        await page.waitForTimeout(1_000)
      } catch (e) {
        seen.why = (e as Error).message.split('\n')[0]
      } finally {
        await page.close()
      }
      seen.status = (await lens.agentApprovals(user)).find((a) => a.id === id)?.status ?? ''
      ctx.evidence.push({ note: 'Approvals with only the phone key', answer: JSON.stringify(seen) })
      await lens.act(user, 'POST', `/v1/money/devices/${reg.value.id}/revoke`, {})
      return phoneKeyWebVerdict(seen)
    },
  }
}
