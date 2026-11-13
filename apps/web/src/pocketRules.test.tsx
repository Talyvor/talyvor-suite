import { describe, expect, it } from 'vitest'

import { isPocketCard, primaryActions, statusWithoutWords, tangerineOffenders } from './pocketRules'

// B57.3 — the view rules the four brand tests (ScreensBrand, ChatBrand, MarketplaceBrand,
// WalletBrand) hold every screen to, proved here on planted violations so each can fail.
// Built detached: the running audits watch `document`.
function dom(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('at most one primary (ink) action per view', () => {
  it('counts the primary fill, as a button or a link, by today’s name and Pocket’s', () => {
    expect(
      primaryActions(dom('<button class="bg-primary">Approve</button><a class="bg-accent">Fund</a><button class="bg-cloud-2">Later</button>')),
    ).toEqual(['Approve', 'Fund'])
  })

  it('a state fill under a variant is not a primary action', () => {
    expect(primaryActions(dom('<button role="switch" class="aria-checked:bg-accent">On</button>'))).toEqual([])
  })
})

describe('tangerine is only the brand and "your move"', () => {
  it('a tangerine fill nobody declared is an offender', () => {
    expect(tangerineOffenders(dom('<span class="h-2 w-2 bg-tangerine"></span>'))).toHaveLength(1)
  })

  it('a tangerine fill declared as the brand or as your move is not', () => {
    expect(
      tangerineOffenders(dom('<span data-tangerine="brand"><i class="bg-tangerine"></i></span><span class="bg-tangerine" data-tangerine="your-move"></span>')),
    ).toEqual([])
  })

  it('a reason other than the two is an offender', () => {
    expect(tangerineOffenders(dom('<span class="bg-tangerine" data-tangerine="decoration"></span>'))).toHaveLength(1)
  })

  it('tangerine text is an offender even when declared: text is never tangerine', () => {
    expect(tangerineOffenders(dom('<p class="text-tangerine" data-tangerine="your-move">Review</p>'))).toHaveLength(1)
  })

  it('tangerine-ink is the orange that carries words, and the tint is not the brand mark', () => {
    expect(tangerineOffenders(dom('<p class="text-tangerine-ink bg-tangerine-50">Waiting for you</p>'))).toEqual([])
  })

  it('a variant prefix does not hide it', () => {
    expect(tangerineOffenders(dom('<button class="hover:bg-tangerine">Pay</button>'))).toHaveLength(1)
    // B57.8 — Pocket's focus ring is tangerine on keyboard focus by design; any other focus paint still counts.
    expect(tangerineOffenders(dom('<a class="focus-visible:outline focus-visible:outline-tangerine">Ledger</a>'))).toEqual([])
    expect(tangerineOffenders(dom('<a class="focus-visible:bg-tangerine">Ledger</a>'))).toHaveLength(1)
  })
})

describe('status colours always come with words', () => {
  it('a green dot with no words beside it is an offender', () => {
    expect(statusWithoutWords(dom('<div><span class="h-2 w-2 rounded-pill bg-success"></span></div>'))).toHaveLength(1)
  })

  it('a red dot beside its word is not', () => {
    expect(statusWithoutWords(dom('<div><span class="bg-danger h-2 w-2"></span>Declined</div>'))).toEqual([])
  })

  it('a chip that carries its word is not', () => {
    expect(statusWithoutWords(dom('<span class="text-success bg-success-50">Running</span>'))).toEqual([])
  })

  it('today’s status names are status colours too', () => {
    expect(statusWithoutWords(dom('<div><span class="bg-settled h-2 w-2"></span></div>'))).toHaveLength(1)
  })

  it('a figure is not a word', () => {
    expect(statusWithoutWords(dom('<div><span class="text-danger">−$12.00</span></div>'))).toHaveLength(1)
  })

  it('an accessible name counts as words', () => {
    expect(statusWithoutWords(dom('<div><span class="bg-success h-2 w-2" aria-label="Running"></span></div>'))).toEqual([])
  })
})

describe('a card is cloud, or white with its shadow', () => {
  it.each([
    ['rounded-card bg-cloud', true],
    ['rounded-card-tight bg-cloud', true],
    ['rounded-card bg-page shadow-pocket', true],
    ['rounded-card bg-page', false],
    ['rounded-card bg-raised', false],
    ['rounded-card bg-cloud-2', false],
  ])('%s → %s', (cls, ok) => {
    expect(isPocketCard(dom(`<section class="${cls}"></section>`).firstElementChild!)).toBe(ok)
  })
})
