import { describe, expect, it } from 'vitest'
import { SpendCap } from '../src/budget.ts'
import { cutText, type Finding, ledgerSpentUSD, Notebook, parseMove, stepCostUSD, stepWorstUSD } from '../src/explore.ts'

describe("an explorer's reply", () => {
  it('is read as one move, from the JSON object in it', () => {
    expect(parseMove('Sure. {"action":"click","target":3}')).toEqual({ action: 'click', target: 3 })
    expect(parseMove('{"action":"fill","target":0,"text":"What is 2 + 2?"}')).toEqual({ action: 'fill', target: 0, text: 'What is 2 + 2?' })
    expect(parseMove('{"action":"finding","note":"the total is wrong","severity":"high"}'))
      .toEqual({ action: 'finding', note: 'the total is wrong', severity: 'high' })
    expect(parseMove('{"action":"same","lead":4}')).toEqual({ action: 'same', lead: 4 })
    expect(parseMove('{"action":"same","lead":"L4"}')).toEqual({ action: 'same', lead: 4 })
    expect(parseMove('no idea')).toBeUndefined()
  })

  it('never leaves the app or signs out', () => {
    expect(parseMove('{"action":"goto","path":"/features"}')).toEqual({ action: 'goto', path: '/features' })
    expect(parseMove('{"action":"goto","path":"https://example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"//example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"/auth/logout"}')).toBeUndefined()
  })
})

// B26.19 — what the explorers have noted is shared, and one explorer writes at most three notes on a screen.
describe('the explorers\' notebook', () => {
  const book = () => new Notebook([] as Finding[], ['/keys', '/ledger', '/track'], (p) => (p.startsWith('/track/issues/') ? '/track/issues/:id' : p))

  it('keeps one lead for a thing however many explorers see it, and their notes to three a screen each', () => {
    const b = book()
    const keys = b.write(0, 'explorer', 'high', '/keys', 'The key list is stuck on Loading…', [])
    expect(keys).toMatchObject({ id: 1, by: [0] })
    expect(b.write(0, 'explorer', 'high', '/keys?tab=all', 'the key list is stuck on loading', [])).toBe('again')
    expect(b.same(3, 1, '/keys', [])).toMatchObject({ id: 1, by: [0, 3] })
    expect(b.write(5, 'explorer', 'low', '/keys', 'The key list is stuck on loading.', [])).toMatchObject({ id: 1, by: [0, 3, 5] })
    b.write(0, 'explorer', 'low', '/keys', 'a second thing', [])
    b.write(0, 'explorer', 'low', '/keys', 'a third thing', [])
    expect(b.write(0, 'explorer', 'low', '/keys', 'a fourth thing', [])).toBe('full')
    expect(b.notesBy(0, '/keys')).toBe(3)
    expect(b.on('/keys').map((l) => l.id)).toEqual([1, 2, 3])
    expect(b.findings.filter((f) => f.lead === 1).map((f) => f.explorer)).toEqual([0, 3, 5])
    expect(b.write(1, 'explorer', 'low', '/track/issues/42', 'x', [])).toMatchObject({ screen: '/track/issues/:id' })
  })

  it('sends an explorer to the screen seen least, and two sent at once to different ones', () => {
    const b = book()
    b.arrived('/keys')
    expect(b.unseen()).toEqual(['/ledger', '/track'])
    expect(b.leastSeen('/keys')).toBe('/ledger')
    expect(b.leastSeen('/keys')).toBe('/track')
    expect(b.unseen()).toEqual([])
  })
})

// B61.56 — a launch run's explorers: no catalog, the launch version only, held to their ledger.
describe('a launch run\'s explorers', () => {
  it('drop a note about a hidden area, and keep one about a launch screen', () => {
    const b = new Notebook([] as Finding[], ['/keys'], (p) => p, (p) => p === '/chat' || p.startsWith('/chat/'))
    expect(b.write(0, 'browser', 'auto', '/chat/42?x=1', 'page error: boom', [])).toBe('hidden')
    expect(b.same(0, 1, '/chat', [])).toBe('hidden')
    expect(b.write(0, 'explorer', 'low', '/keys', 'a thing', [])).toMatchObject({ id: 1, by: [0] })
    expect(b.findings.map((f) => f.where)).toEqual(['/keys'])
  })

  it('reserve and settle a step at the price per step with no catalog, and at what Lens states it charged', () => {
    const plain = { replayed: false, pooledULXC: undefined, inputTokens: 9_000, outputTokens: 300 }
    expect(stepWorstUSD(undefined, 0.01, 50_000)).toBe(0.01)
    expect(stepCostUSD(undefined, 0.01, plain, 0.1)).toBe(0.01)
    expect(stepCostUSD(undefined, 0.01, { ...plain, pooledULXC: 20_000 }, 0.1)).toBeCloseTo(0.002)
    expect(stepCostUSD(undefined, 0.01, { ...plain, replayed: true }, 0.1)).toBe(0)
  })

  it('are held to what the ledger shows was spent, and stop when that reaches the cap', () => {
    const cap = new SpendCap(0.05)
    const counted = 0.01 * 3
    cap.settle(cap.reserve(counted), counted)
    // The ledger: a grant, and three spends with their platform fees, 0.8 LXC at $0.10.
    const spent = ledgerSpentUSD([{ amount_ulxc: 1_000_000_000 }, { amount_ulxc: -250_000 }, { amount_ulxc: -16_667 },
      { amount_ulxc: -250_000 }, { amount_ulxc: -16_667 }, { amount_ulxc: -250_000 }, { amount_ulxc: -16_666 }], 0.1)
    expect(spent).toBeCloseTo(0.08)
    cap.adjust(spent - counted)
    expect(cap.spentUSD).toBeCloseTo(0.08)
    expect(() => cap.reserve(0.01)).toThrow(/spend cap/)
  })
})

describe('cutText (B28.274)', () => {
  it('ends a long screen at a whole line and says how much is below', () => {
    const page = 'Terms\n\n\nA first paragraph.\nWho decides, on what evidence, whether the user is told, and whether they can contest it.'
    const cut = cutText(page, 40)
    expect(cut).toBe('Terms\nA first paragraph.\n[… the screen goes on below: 90 more characters not shown here]')
    expect(cutText('Short.\n\nScreen.', 60)).toBe('Short.\nScreen.')
  })
})
