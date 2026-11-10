import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusLabel } from './StatusLabel'

afterEach(() => {
  cleanup()
  vi.doUnmock('./building.json')
  vi.resetModules()
})

// StatusLabel read with one registry entry, so Building is drawn the way the real file's entries will be (B56.10
// and B56.11 fill it).
async function withRegistryEntry() {
  vi.resetModules()
  vi.doMock('./building.json', () => ({ default: [{ key: 'sso', feature: 'Single sign-on', item: 'B56.19' }] }))
  return (await import('./StatusLabel')).StatusLabel
}

const LABELS = { spend_on_talyvor: 'live', agent_cards: 'sandbox', odd: 'test' }

describe('StatusLabel (B56.9)', () => {
  it('draws Live from Lens, with its line', () => {
    render(<StatusLabel capability="spend_on_talyvor" labels={LABELS} />)
    const label = screen.getByText('Live')
    expect(label.getAttribute('data-status-label')).toBe('live')
    expect(label.getAttribute('title')).toBe('Live: moves real money.')
  })

  it('draws Sandbox from Lens, with its line', () => {
    render(<StatusLabel capability="agent_cards" labels={LABELS} />)
    const label = screen.getByText('Sandbox')
    expect(label.getAttribute('data-status-label')).toBe('sandbox')
    expect(label.getAttribute('title')).toBe('Sandbox: works. No real money moves.')
  })

  it('draws Building from the registry, with its line', async () => {
    const Registered = await withRegistryEntry()
    render(<Registered building="sso" />)
    const label = screen.getByText('Building')
    expect(label.getAttribute('data-status-label')).toBe('building')
    expect(label.getAttribute('title')).toBe('Building: in our build queue. Not shipped yet.')
  })

  it('draws nothing for a key Lens did not answer, an answer it cannot draw, or no answer at all', () => {
    const { container } = render(
      <>
        <StatusLabel capability="money_payouts" labels={LABELS} />
        <StatusLabel capability="odd" labels={LABELS} />
        <StatusLabel capability="agent_cards" labels={undefined} />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('draws nothing for a Building key not in the registry', async () => {
    const Registered = await withRegistryEntry()
    const { container } = render(<Registered building="edge" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('StatusLabel for a section (B56.10)', () => {
  it('draws Live only when Lens says live for every key, Sandbox for any sandbox, and nothing for one unanswered', () => {
    const labels = { a: 'live', b: 'live', c: 'sandbox' }
    const { container } = render(
      <>
        <StatusLabel capability={['a', 'b']} labels={labels} />
        <StatusLabel capability={['a', 'c']} labels={labels} />
        <StatusLabel capability={['a', 'missing']} labels={labels} />
      </>,
    )
    const drawn = [...container.querySelectorAll('[data-status-label]')].map((el) => [el.getAttribute('data-status-key'), el.textContent])
    expect(drawn).toEqual([
      ['a b', 'Live'],
      ['a c', 'Sandbox'],
    ])
  })
})
