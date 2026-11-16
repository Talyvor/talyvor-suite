import { describe, expect, it } from 'vitest'
import type { ScenarioCtx } from '../src/scenarios.ts'
import { HOME_CARDS, homeCards } from '../src/tour.ts'

// B17.476 — Home draws its greeting at once and its total, agents and cards (with every link the scenario clicks) only
// once Lens's reads come back, as the console does. A page whose links arrive a moment after the greeting.
function home(delayMs: number) {
  const opened = Date.now()
  const links = (): { href: string; text: string }[] =>
    Date.now() - opened < delayMs ? [] : HOME_CARDS.map((c) => ({ href: c.href ?? c.path, text: c.title }))
  let path = '/'
  const heading = () => HOME_CARDS.find((c) => c.path === path)?.heading ?? 'Not found'
  const wait = async (ready: () => boolean, timeout: number) => {
    const until = Date.now() + timeout
    while (!ready()) {
      if (Date.now() > until) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  return {
    getByRole: () => ({ waitFor: async () => undefined }),
    locator: (sel: string) => {
      if (sel === 'main h1') return { filter: () => ({ waitFor: async () => undefined }), textContent: async () => heading() }
      const href = /href="([^"]+)"/.exec(sel)?.[1]
      return {
        filter: ({ hasText }: { hasText: string }) => {
          const found = () => links().filter((l) => l.href === href && l.text === hasText)
          return {
            count: async () => found().length,
            first: () => ({
              waitFor: ({ timeout }: { timeout: number }) => wait(() => found().length > 0, timeout),
              click: async () => {
                path = new URL(href ?? '/', 'http://app').pathname
              },
            }),
          }
        },
      }
    },
    waitForURL: async () => undefined,
    url: () => `http://app${path}`,
    close: async () => undefined,
  }
}

describe('home-cards (B17.476)', () => {
  it('waits for the links Home draws once its reads come back, and opens each one', async () => {
    const ctx = { app: { tab: async () => home(50) }, evidence: [] } as unknown as ScenarioCtx
    const result = await homeCards().run(ctx)
    expect(result).toMatchObject({ pass: true })
  })
})
