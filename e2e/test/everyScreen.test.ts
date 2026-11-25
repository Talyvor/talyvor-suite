import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Entry, inventory } from '../src/coverage.ts'
import type { ScenarioCtx } from '../src/scenarios.ts'
import { areaOf, areaPathsFrom, everyScreen } from '../src/tour.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// What a console address shows: the top bar's h1 and, for a page open in the right panel (B61.121), the panel's name.
interface Shown {
  h1: string
  panel?: string
}

// B17.491 — /money/card goes to Spending while the physical card is switched off (B60.6), as physical-card checks. A
// console whose screens each land at `lands` (their own address when not named), showing what `shows` gives that address.
// `areas` is what GET /api/workspace/areas answers.
function console(lands: Record<string, string>, shows: Record<string, Shown>, areas: string[] = []) {
  let path = '/'
  const now = (): Shown => shows[path] ?? { h1: 'Not found' }
  interface Loc {
    match: () => boolean
    or: (other: Loc) => Loc
    first: () => Loc
    count: () => Promise<number>
    waitFor: () => Promise<void>
    innerText: () => Promise<string>
  }
  const loc = (match: () => boolean, text: () => string): Loc => {
    const self: Loc = {
      match,
      or: (other) => loc(() => match() || other.match(), text),
      first: () => self,
      count: async () => (match() ? 1 : 0),
      waitFor: async () => {
        if (!match()) throw new Error('timeout')
      },
      innerText: async () => text(),
    }
    return self
  }
  const panel = () => now().panel
  const page = {
    on: () => undefined,
    off: () => undefined,
    goto: async (url: string) => {
      const at = new URL(url).pathname
      path = lands[at] ?? at
    },
    getByRole: (role: string, o?: { name?: string }) =>
      role === 'dialog'
        ? loc(() => panel() !== undefined && (o?.name === undefined || panel() === o.name), () => panel() ?? '')
        : loc(() => o?.name === undefined || now().h1 === o.name, () => now().h1),
    locator: () => loc(() => panel() !== undefined, () => panel() ?? ''),
    waitForLoadState: async () => undefined,
    getByText: () => ({ count: async () => 0 }),
    url: () => `http://app${path}`,
    close: async () => undefined,
    request: { get: async () => ({ ok: () => true, json: async () => ({ areas }) }) },
  }
  return page
}

const screen = (path: string, feature: string, panel?: string): Entry => ({ kind: 'screen', method: 'GET', path, feature, ...(panel ? { panel } : {}) })

async function run(screens: Entry[], lands: Record<string, string>, shows: Record<string, Shown>, areas?: string[]) {
  const page = console(lands, shows, areas)
  const ctx = {
    env: { inventory: { screens } },
    app: { page: { url: () => 'http://app/' }, context: { newPage: async () => page }, screenTimed: () => undefined },
    evidence: [] as { note: string }[],
  }
  const result = await everyScreen().run(ctx as unknown as ScenarioCtx)
  return { result, evidence: ctx.evidence.map((e) => e.note) }
}

const CARD = [screen('/money/spending', 'Spending'), screen('/money/card', 'Talyvor Card')]
const CARD_SHOWS = { '/money/spending': { h1: 'Spending' }, '/money/card': { h1: 'Talyvor Card' } }

describe('every-screen (B17.491)', () => {
  it('counts the card screen right while it is switched off and lands on Spending, saying so', async () => {
    const { result, evidence } = await run(CARD, { '/money/card': '/money/spending' }, CARD_SHOWS)
    expect(result).toMatchObject({ pass: true })
    expect(evidence).toContain('/money/card (Talyvor Card): switched off, so it lands on /money/spending — the physical card is switched off until a live card issuer serves it (B60.6)')
  })

  it('still finds a card screen that lands anywhere else', async () => {
    const { result } = await run(CARD, { '/money/card': '/money/wallets' }, CARD_SHOWS)
    expect(result).toMatchObject({ pass: false, where: ['/money/card'] })
  })
})

describe('every-screen (B17.529)', () => {
  const DEVICES = screen('/settings/devices', 'Approvals and devices', '/settings')

  it('takes a page in the right panel as named by its panel, with the page behind it keeping its own heading', async () => {
    const { result } = await run([DEVICES], {}, { '/settings/devices': { h1: 'Settings', panel: 'Approvals and devices' } })
    expect(result).toMatchObject({ pass: true })
  })

  it('still finds a panel that names another page, and says what the panel says', async () => {
    const { result } = await run([DEVICES], {}, { '/settings/devices': { h1: 'Settings', panel: 'Security' } })
    expect(result).toMatchObject({ pass: false, where: ['/settings/devices'] })
    expect((result as { detail: string }).detail).toContain('no heading "Approvals and devices" (it says "Settings", its panel "Security")')
  })

  const WEBHOOKS = screen('/settings/webhooks', 'Webhooks', '/settings')
  const HOME = { '/': { h1: 'Home' } }

  it('counts a screen of an area the workspace does not have as landing on Home by design (B59.2), saying so', async () => {
    const { result, evidence } = await run([WEBHOOKS], { '/settings/webhooks': '/' }, HOME, ['marketplace'])
    expect(result).toMatchObject({ pass: true })
    expect(evidence).toContain('/settings/webhooks (Webhooks): its area, docs, is off for this workspace, so it lands on Home (B59.2)')
  })

  it('still finds a screen that lands on Home while the workspace has its area', async () => {
    const { result } = await run([WEBHOOKS], { '/settings/webhooks': '/' }, HOME, ['docs'])
    expect(result).toMatchObject({ pass: false, where: ['/settings/webhooks'] })
  })

  it('reads which pages open in a panel, and each address\'s area, from the web app itself', async () => {
    const inv = await inventory(REPO, 'none')
    expect(inv.screens.find((s) => s.path === '/settings/devices')?.panel).toBe('/settings')
    expect(inv.screens.find((s) => s.path === '/settings')?.panel).toBeUndefined()
    const paths = areaPathsFrom(await readFile(join(REPO, 'apps/web/src/lib/workspaceAreas.tsx'), 'utf8'))
    expect([areaOf('/settings/email-branding', paths), areaOf('/docs/*', paths), areaOf('/settings/devices', paths)]).toEqual(['docs', 'docs', undefined])
  })
})
