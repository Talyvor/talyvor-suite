import { describe, expect, it } from 'vitest'
import type { Entry } from '../src/coverage.ts'
import type { ScenarioCtx } from '../src/scenarios.ts'
import { everyScreen } from '../src/tour.ts'

// B17.491 — /money/card goes to Spending while the physical card is switched off (B60.6), as physical-card checks. A
// console whose screens each land at `lands` (their own address when not named) with the top bar's h1 for that address.
function console(lands: Record<string, string>, titles: Record<string, string>) {
  let path = '/'
  const h1 = () => titles[path] ?? 'Not found'
  const heading = (name?: string): unknown => ({
    or: (other: { name?: string }) => heading(h1() === name || h1() === other.name ? h1() : name),
    first: () => heading(),
    count: async () => (name === undefined || h1() === name ? 1 : 0),
    name,
    waitFor: async () => {
      if (name !== undefined && h1() !== name) throw new Error('timeout')
    },
    innerText: async () => h1(),
  })
  const page = {
    on: () => undefined,
    off: () => undefined,
    goto: async (url: string) => {
      const at = new URL(url).pathname
      path = lands[at] ?? at
    },
    getByRole: (_role: string, o?: { name?: string }) => heading(o?.name),
    waitForLoadState: async () => undefined,
    getByText: () => ({ count: async () => 0 }),
    url: () => `http://app${path}`,
    close: async () => undefined,
  }
  return page
}

const screen = (path: string, feature: string): Entry => ({ kind: 'screen', method: 'GET', path, feature })

async function run(lands: Record<string, string>) {
  const page = console(lands, { '/money/spending': 'Spending', '/money/card': 'Talyvor Card' })
  const ctx = {
    env: { inventory: { screens: [screen('/money/spending', 'Spending'), screen('/money/card', 'Talyvor Card')] } },
    app: { page: { url: () => 'http://app/' }, context: { newPage: async () => page }, screenTimed: () => undefined },
    evidence: [] as { note: string }[],
  }
  const result = await everyScreen().run(ctx as unknown as ScenarioCtx)
  return { result, evidence: ctx.evidence.map((e) => e.note) }
}

describe('every-screen (B17.491)', () => {
  it('counts the card screen right while it is switched off and lands on Spending, saying so', async () => {
    const { result, evidence } = await run({ '/money/card': '/money/spending' })
    expect(result).toMatchObject({ pass: true })
    expect(evidence).toContain('/money/card (Talyvor Card): switched off, so it lands on /money/spending — the physical card is switched off until a live card issuer serves it (B60.6)')
  })

  it('still finds a card screen that lands anywhere else', async () => {
    const { result } = await run({ '/money/card': '/money/wallets' })
    expect(result).toMatchObject({ pass: false, where: ['/money/card'] })
  })
})
