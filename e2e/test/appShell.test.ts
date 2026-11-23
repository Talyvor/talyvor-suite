import { describe, expect, it } from 'vitest'
import type { ScenarioCtx } from '../src/scenarios.ts'
import { appShell } from '../src/tour.ts'

// B17.520 — the shell as the run of 21 Nov 2026 read it: since B61.74 the selected row's cloud is the sidebar's one
// sliding marker under the row, so the row itself is transparent. The page's second read is the shell.
const CLOUD = 'rgb(24, 26, 31)'
const INK = 'rgb(242, 243, 245)'
function shell(marker: { bg: string; opacity: string; under: boolean } | null) {
  const seen = {
    rows: 7,
    bare: [],
    active: 'Home',
    activeBg: 'rgba(0, 0, 0, 0)',
    activeInk: INK,
    marker,
    cloud: CLOUD,
    ink: INK,
    buttons: ['Menu', 'Search agents, payees, bills… or type a command', 'Pause every agent'],
    links: ['Settings and sign out'],
    title: null,
  }
  let reads = 0
  const page = {
    getByRole: () => ({ locator: () => ({ waitFor: async () => undefined }) }),
    evaluate: async () => (reads++ === 0 ? undefined : seen),
    waitForTimeout: async () => undefined,
    close: async () => undefined,
  }
  return { app: { tab: async () => page }, evidence: [] } as unknown as ScenarioCtx
}

describe('app-shell (B17.520)', () => {
  it('passes when the selected row sits on the cloud marker drawn under it', async () => {
    const result = await appShell().run(shell({ bg: CLOUD, opacity: '1', under: true }))
    expect(result).toMatchObject({ pass: true })
  })

  it('fails when nothing paints the cloud under the selected row', async () => {
    const result = await appShell().run(shell(null))
    expect(result).toMatchObject({ pass: false, detail: expect.stringContaining('not the cloud') })
  })
})
