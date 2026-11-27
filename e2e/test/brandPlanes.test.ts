import { describe, expect, it } from 'vitest'
import type { ScenarioCtx } from '../src/scenarios.ts'
import { brandPlanes } from '../src/tour.ts'

// B17.567 — the dark planes as the run of 27 Nov 2026 read them: since B61.125 the sidebar is glass, so the browser
// writes it and its hairline as color(srgb …) at 30% and 9%.
function planes(seen: { canvas: string; sidebar: string; hairline: string; blur: string }) {
  const page = {
    locator: () => ({ waitFor: async () => undefined }),
    evaluate: async () => seen,
    close: async () => undefined,
  }
  return { app: { tab: async () => page }, evidence: [] } as unknown as ScenarioCtx
}

const GLASS = {
  canvas: 'rgb(15, 16, 19)',
  sidebar: 'color(srgb 0.0588235 0.0627451 0.0745098 / 0.3)',
  hairline: 'color(srgb 0.94902 0.952941 0.960784 / 0.09)',
  blur: 'blur(26px) saturate(1.15)',
}

describe('brand-planes (B17.567)', () => {
  it('passes on the sidebar glass Pocket Live draws: the page at 30% over a 26 px blur, ink at 9% for its hairline', async () => {
    expect(await brandPlanes().run(planes(GLASS))).toMatchObject({ pass: true })
  })

  it('fails on the solid panel the glass replaced', async () => {
    const result = await brandPlanes().run(planes({ ...GLASS, sidebar: 'rgb(15, 16, 19)', hairline: 'rgb(42, 46, 54)', blur: 'none' }))
    expect(result).toMatchObject({ pass: false, detail: expect.stringContaining('the sidebar is rgb(15, 16, 19), not the page #0F1013 at 30%') })
  })
})
