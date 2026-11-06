import { cleanup, render } from '@testing-library/react'
import { focusRing } from '@talyvor/ui'
import { createElement as h, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '../App'
import { pressAll, pressEverything } from './pressEverything'

// B57.1 — pressEverything presses every control on a screen and reports each one that does nothing.

function Planted() {
  const [said, say] = useState('')
  const [on, flip] = useState(false)
  return h(
    'div',
    null,
    h('button', { type: 'button', className: focusRing }, 'Dead'),
    h('button', { type: 'button', className: focusRing, onClick: () => say('Saved.') }, 'Save'),
    h('button', { type: 'button', className: focusRing, role: 'switch', 'aria-checked': on, onClick: () => flip(!on) }, 'Paused'),
    h('p', { role: 'status' }, said),
    h('span', null, h('button', { type: 'button', className: focusRing, disabled: true }, 'Send'), ' Type a message first.'),
    h('button', { type: 'button', className: focusRing, disabled: true }, 'Approve'),
  )
}

const planted = () => pressAll(async () => void render(h(Planted)), () => 0)

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('pressEverything', () => {
  it('fails on a planted dead button, and on a disabled one that does not say why', async () => {
    expect(await planted()).toEqual({
      pressed: 3,
      dead: ['button “Dead”: does nothing', 'button “Approve”: disabled without saying why'],
    })
  })

  it('presses every control on a route of the real app', async () => {
    const report = await pressEverything('/privacy')
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 60_000)
})
