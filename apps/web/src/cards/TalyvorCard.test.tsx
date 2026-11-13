// B57.122 — one Card component draws every approved face from the manifest, as layout/Card.dc.html does: the art,
// its scrim, the wordmark, the tier and chip on owner cards, the badge on stablecoin cards, and the holder with one
// sub line. The holder is a prop, never the art's: an agent the owner called "Atlas" shows "Atlas", not "Remy".
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cardArt } from './cardArt'
import { TalyvorCard, cardLayout, holderSize } from './TalyvorCard'

const sample = (c: (typeof cardArt)[number]) =>
  c.family === 'agent'
    ? { holder: 'Atlas', sub: 'Research · pays in dollars' }
    : { holder: 'Nick Gaborac', sub: c.family === 'corporate' ? 'Talyvor Ltd' : 'Your everyday account' }

describe('TalyvorCard (B57.122)', () => {
  it.each(cardArt.flatMap((c) => (['light', 'dark'] as const).map((theme) => [c.id, theme, c] as const)))(
    '%s in %s mode matches its snapshot',
    (_, theme, c) => {
      const { container } = render(
        <div data-theme={theme}>
          <TalyvorCard card={c} {...sample(c)} />
        </div>,
      )
      expect(container.firstChild).toMatchSnapshot()
    },
  )

  it.each(cardArt.map((c) => [c.id, c] as const))('%s draws the holder from its props and carries its alt text', (_, c) => {
    const { holder, sub } = sample(c)
    render(<TalyvorCard card={c} holder={holder} sub={sub} />)
    const card = screen.getByRole('img', { name: c.family === 'agent' ? 'Atlas, agent card' : `Nick Gaborac, ${c.tier} ${c.family} card` })
    expect(card).toHaveTextContent(holder)
    expect(card).toHaveTextContent(sub)
    if (c.family === 'agent') expect(card).not.toHaveTextContent(c.helper)
  })

  it.each(cardArt.map((c) => [c.id, c] as const))('%s shows no number, expiry, CVC or network mark', (_, c) => {
    const { container } = render(<TalyvorCard card={c} {...sample(c)} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(/cvc|cvv|expir|valid thru|network|visa|mastercard/i)
    expect(container.querySelector('[data-card-part="network"]')).toBeNull()
  })

  it('puts the tier, family and chip on owner cards only, and the badge on stablecoin cards only', () => {
    for (const c of cardArt) {
      const { container, unmount } = render(<TalyvorCard card={c} {...sample(c)} />)
      const owner = c.family !== 'agent'
      expect(!!container.querySelector('[data-card-part="tier"]'), c.id).toBe(owner)
      expect(!!container.querySelector('[data-card-part="chip"]'), c.id).toBe(owner)
      expect(container.querySelector('[data-card-part="badge"]')?.textContent ?? null, c.id).toBe(
        c.family === 'stablecoin' ? 'USDC · EURC' : null,
      )
      if (owner) expect(container.querySelector('[data-card-part="tier"]')).toHaveTextContent(new RegExp(`^${c.tier}${c.family}$`, 'i'))
      unmount()
    }
  })

  it('uses the ink wordmark on ink-text cards and the white one on white-text cards', () => {
    for (const c of cardArt) {
      const { container, unmount } = render(<TalyvorCard card={c} {...sample(c)} />)
      const logo = container.querySelector('[data-card-part="logo"]')
      expect(logo?.getAttribute('src'), c.id).toBe(`/brand/logo/talyvor-logo-${c.text === 'ink' ? 'on-light' : 'on-dark'}.svg`)
      unmount()
    }
  })

  it('keeps a 24-character agent name clear of the network corner', () => {
    const name = 'Quartermaster Atlas Bell'
    expect(name).toHaveLength(24)
    // The holder's box ends before the empty network corner, and the name never wraps past it.
    expect(cardLayout.holderLeft + cardLayout.holderMaxWidth).toBeLessThanOrEqual(cardLayout.networkLeft - 8)
    // A bold grotesque runs well under 0.62 em a character, so the shrunk name fits its box with room to spare.
    expect(name.length * 0.62 * holderSize(name, true)).toBeLessThanOrEqual(cardLayout.holderMaxWidth)
    render(<TalyvorCard card={cardArt.find((c) => c.id === 'agent-remy')!} holder={name} sub="Research · pays in dollars" />)
    const holder = screen.getByText(name)
    expect(holder).toHaveStyle({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
  })
})
