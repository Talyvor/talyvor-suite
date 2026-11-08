import { render } from '@testing-library/react'
import { createElement } from 'react'
import { expect, it, vi } from 'vitest'

import { Story } from '../../scripts/pocket/story/Specimens'
import { pressAll } from './pressEverything'

// B57.4 — pressEverything on the story page: every control Pocket's components draw does something, in both themes,
// and the disabled ones say why.
it('every control on the story page does something', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  const report = await pressAll(
    async () => {
      window.history.pushState({}, '', '/__pocket-story/')
      render(createElement(Story))
    },
    () => 0,
  )
  expect(report.dead).toEqual([])
  // Two of each per theme at least: the buttons, the tabs, the switch, the links and the copy.
  expect(report.pressed).toBeGreaterThanOrEqual(26)
})
