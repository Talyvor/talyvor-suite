// B53.12 — the physical Talyvor Card (Lens B53.19), once a run, on a workspace of its own. While Lens's switch is off
// (LENS_PHYSICAL_CARDS) GET and POST /v1/money/physical-cards answer 404, and in the app /money/card lands on Spending, which
// shows no link to it: nothing is visible. On, the owner orders a card (a postcode that is not a GB postcode is refused
// 422 first), it cannot be activated before it ships (409), the card partner posts it, the wrong last four digits are refused
// (422) and the right ones activate it; reported lost, the old card is frozen at once and a new one is ordered to the same
// address. Money → Talyvor Card shows both.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { said as saidAnswer } from './routes.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000

interface Address { line1: string; line2: string; city: string; postcode: string; country: string }
interface Card { id: string; last4: string; state: string; address: Address; delivery: { status: string }; replaces: string; replaced_by: string }

const ADDRESS: Address = { line1: '1 Nightly Street', line2: '', city: 'London', postcode: 'N1 9GU', country: 'GB' }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function physicalCard({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'physical-card',
    owner: 'talyvor-suite',
    own: true,
    items: ['B53.12'],
    feature: 'Agent wallets',
    title: 'physical card: nothing shows while the switch is off; on, order (address checked), ship, activate, lose and replace — the old card frozen',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const listed = await step<{ cards: Card[] | null }>('GET', '/v1/money/physical-cards', undefined, 'the owner reads their physical cards')

      // 1. The switch off: Lens serves nothing, writes nothing, and the app shows nothing.
      if (listed.status === 404) {
        const order = await step('POST', '/v1/money/physical-cards', { name_on_card: 'Nightly Owner', address: ADDRESS }, 'the owner tries to order one')
        if (order.status !== 404) return fail(`with the physical card switched off an order must answer 404 and write nothing; Lens answered ${said(order)}`)
        const detail = 'the switch is off: Lens answers 404 to a read and an order'
        if (!screen) return { pass: true, detail }
        const page = await ctx.app.tab('/money/card')
        try {
          await page.waitForURL(/\/money\/spending$/, { timeout: TIMEOUT_MS }).catch(() => undefined)
          const at = new URL(page.url()).pathname
          ctx.evidence.push({ note: 'the app at /money/card', answer: at })
          if (at !== '/money/spending') return fail(`with the switch off /money/card must land on Spending; it stayed on ${at}`)
          if ((await page.getByRole('link', { name: 'Your Talyvor Card' }).count()) > 0) return fail('with the switch off Spending must not link to the Talyvor Card')
          return { pass: true, detail: `${detail}, and the app shows no Talyvor Card` }
        } finally {
          await page.close()
        }
      }
      if (listed.status !== 200) return fail(`reading the physical cards answered ${said(listed)}`)

      // 2. On: the address is checked, then the card is ordered.
      const bad = await step('POST', '/v1/money/physical-cards', { name_on_card: 'Nightly Owner', address: { ...ADDRESS, postcode: 'NOT A CODE' } }, 'an order to a postcode that is not one')
      if (bad.status !== 422) return fail(`an order to the postcode "NOT A CODE" must be refused 422; Lens answered ${said(bad)}`)
      const ordered = await step<Card>('POST', '/v1/money/physical-cards', { name_on_card: 'Nightly Owner', address: ADDRESS }, 'the owner orders a card')
      const card = ordered.value
      if (ordered.status !== 201 || card === undefined) return fail(`ordering a card answered ${said(ordered)}`)
      if (card.state !== 'inactive' || card.delivery.status !== 'ordered') return fail(`a card just ordered must be inactive and ordered; Lens reads ${card.state}, ${card.delivery.status}`)

      // 3. It ships, and only the digits printed on it activate it.
      const early = await step('POST', `/v1/money/physical-cards/${card.id}/activate`, { last4: card.last4 }, 'activating before it ships')
      if (early.status !== 409) return fail(`a card not yet posted must not activate (409); Lens answered ${said(early)}`)
      const shipped = await ctx.env.lens.deliverTestCard(ctx.app.user, card.id, 'shipped')
      ctx.evidence.push({ note: 'the card partner posts the card', answer: saidAnswer(shipped) })
      if (!shipped.ok) return fail(`the card partner's shipped event answered ${saidAnswer(shipped)}`)
      const wrong = await step('POST', `/v1/money/physical-cards/${card.id}/activate`, { last4: card.last4 === '0000' ? '1111' : '0000' }, 'activating with the wrong digits')
      if (wrong.status !== 422) return fail(`the wrong last four digits must be refused 422; Lens answered ${said(wrong)}`)
      const active = await step<Card>('POST', `/v1/money/physical-cards/${card.id}/activate`, { last4: card.last4 }, 'activating with the right digits')
      if (active.status !== 200 || active.value?.state !== 'active') return fail(`the right last four digits must activate the card; Lens answered ${said(active)}`)

      // 4. Lost: the old card frozen at once, a new one on its way to the same address.
      const replaced = await step<{ old: Card; card: Card }>('POST', `/v1/money/physical-cards/${card.id}/replace`, { reason: 'lost' }, 'the owner reports it lost')
      if (replaced.status !== 201 || replaced.value === undefined) return fail(`reporting the card lost answered ${said(replaced)}`)
      const after = await step<{ cards: Card[] | null }>('GET', '/v1/money/physical-cards', undefined, 'the cards after the replacement')
      const old = (after.value?.cards ?? []).find((c) => c.id === card.id)
      const next = (after.value?.cards ?? []).find((c) => c.id === replaced.value?.card.id)
      if (old?.state !== 'frozen') return fail(`a card reported lost must be frozen at once; Lens reads it ${old?.state ?? 'missing'}`)
      if (next === undefined || next.state !== 'inactive' || next.replaces !== card.id || old.replaced_by !== next.id) {
        return fail(`the replacement must be a new inactive card that names the old one, and the old one it; Lens lists ${JSON.stringify(after.value?.cards).slice(0, 400)}`)
      }
      if (JSON.stringify(next.address) !== JSON.stringify(ADDRESS)) return fail(`the replacement must go to the same address; Lens has ${JSON.stringify(next.address)}`)
      const detail = `ordered (a bad postcode refused 422), not activated before it shipped (409) or with the wrong digits (422), activated, ` +
        `and reported lost: card ending ${card.last4} frozen, card ending ${next.last4} on its way to the same address`
      if (!screen) return { pass: true, detail }

      // 5. In the app: Money → Talyvor Card lists both, as Lens has them.
      const page = await ctx.app.tab('/money/card')
      try {
        const shown = async (id: string) => {
          const row = page.locator(`[data-testid="physical-card-${id}"]`).first()
          return row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim(), () => '')
        }
        const oldRow = await shown(card.id)
        const newRow = await shown(next.id)
        ctx.evidence.push({ note: 'Money → Talyvor Card', answer: `old "${oldRow}"; new "${newRow}"` })
        // B57.97 — the Pocket rows: the old card frozen and replaced, the new one on its way to the same address.
        if (!oldRow.startsWith(`Card ending ${card.last4}`) || !oldRow.includes('Frozen and replaced.') || !oldRow.includes('Replaced')) {
          return fail(`Money → Talyvor Card must show card ending ${card.last4} frozen and replaced; it reads "${oldRow}"`)
        }
        if (!newRow.startsWith(`Card ending ${next.last4}`) || !newRow.includes('On its way to the same address.') || !newRow.includes('Not yet active')) {
          return fail(`Money → Talyvor Card must show card ending ${next.last4} on its way; it reads "${newRow}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `physical-card-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path })
          ctx.evidence.push({ note: `Money → Talyvor Card at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
      } finally {
        await page.close()
      }
      return { pass: true, detail: `${detail}; Money → Talyvor Card shows both` }
    },
  }
}
