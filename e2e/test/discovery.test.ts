import { describe, expect, it } from 'vitest'
import { type Collection, type Hit, askScreenFaults,
  compareScreenFaults, collectionFaults, collectionPageFaults, featuredFaults, screenFaults, searchFaults, trendingFaults } from '../src/discovery.ts'

const mine = { cheap: 'lst_cheap', dear: 'lst_dear', other: 'lst_other' }
const hit = (id: string, capabilities: string[], price: number | null): Hit => ({ id, title: id, capabilities, price_per_use_usd_micros: price, distinct_buyers_7d: 0, trending_score: 0 })
const cheap = hit('lst_cheap', ['extract'], 40_000)
const col = (id: string, featured: boolean): Collection => ({ id, title: id, public: true, featured, listing_count: 2 })

describe('B32.90 market-discovery', () => {
  it('passes the $0.04 extract listing alone, and fails on the $0.06 one, the summarize one, or a hit outside the filter', () => {
    expect(searchFaults([cheap, hit('lst_free', ['extract', 'summarize'], 0)], mine)).toEqual([])
    expect(searchFaults([cheap, hit('lst_dear', ['extract'], 60_000)], mine)).toEqual(['the $0.06 extract listing lst_dear is found, above max_price_per_use 50000'])
    expect(searchFaults([cheap, hit('lst_other', ['summarize'], 10_000)], mine)).toEqual(['the summarize listing lst_other is found for capability=extract'])
    expect(searchFaults([hit('lst_x', ['summarize'], 70_000)], mine)).toEqual(['the $0.04 extract listing lst_cheap is not found',
      'lst_x "lst_x" is found for capability=extract and declares ["summarize"]', 'lst_x "lst_x" is found under max_price_per_use 50000 and is billed 70000 µUSD a use'])
  })

  it('holds every trending hit to its distinct buyers and score', () => {
    expect(trendingFaults([cheap])).toEqual([])
    expect(trendingFaults([])).toEqual(['sort=trending found no listing'])
    expect(trendingFaults([{ ...cheap, trending_score: undefined }])).toEqual(['lst_cheap carries distinct_buyers_7d 0 and trending_score undefined'])
  })

  it('reads the collection as exactly its listings in its order, and fails when the featured one is not first', () => {
    expect(collectionFaults({ ...col('c', false), listings: [{ id: 'b' }, { id: 'a' }] }, ['b', 'a'])).toEqual([])
    expect(collectionFaults({ ...col('c', false), listings: [{ id: 'a' }, { id: 'b' }] }, ['b', 'a'])).toEqual(['the collection lists ["a","b"], not ["b","a"] in that order'])
    expect(featuredFaults([col('mine', true), col('old', true)], 'mine')).toEqual([])
    expect(featuredFaults([col('old', true), col('mine', true)], 'mine')).toEqual(['the featured collection mine is listed at 2, after old "old"'])
  })

  it('B32.61 market-discover-screen: passes Discover showing the $0.04 listing alone and the collection in order, and fails otherwise', () => {
    expect(screenFaults(['Extract invoice totals', 'Other'], 'Extract invoice totals', 'Extract street addresses')).toEqual([])
    expect(screenFaults(['Extract street addresses'], 'Extract invoice totals', 'Extract street addresses')).toEqual([
      'Discover filtered by capability extract and at most $0.05 a use does not show "Extract invoice totals" (shows ["Extract street addresses"])',
      'Discover filtered by capability extract and at most $0.05 a use shows "Extract street addresses", billed $0.06 a use'])
    expect(collectionPageFaults(['b', 'a'], ['b', 'a'])).toEqual([])
    expect(collectionPageFaults(['a', 'b'], ['b', 'a'])).toEqual(['the collection\'s page shows ["a","b"], not ["b","a"] in that order'])
    expect(collectionPageFaults(['b', 'a', 'c'], ['b', 'a'])).toEqual(['the collection\'s page shows ["b","a","c"], not ["b","a"] in that order'])
  })

  it('B41.71 market-ask-screen: passes up to three listings shown with Lens\'s estimates, and fails otherwise', () => {
    const lens = [
      { id: 'a', estimate: { total_usd_micros: 1_000_000 } },
      { id: 'b', estimate: { total_usd_micros: 9_000_000, display: { currency: 'EUR', amount_minor: 818 } } },
      { id: 'c', estimate: null },
    ]
    expect(askScreenFaults([['a', '$1.00'], ['b', '€8.18'], ['c', 'Enterprise licence only, priced by seat']], lens)).toEqual([])
    expect(askScreenFaults([], lens)).toEqual(['Discover asked "translate 500 product descriptions into German" shows no listing'])
    expect(askScreenFaults([['a', '$0.002'], ['b', '€8.18'], ['c', 'Enterprise licence only, priced by seat']], lens)).toEqual([
      'Discover shows [["a","$0.002"],["b","€8.18"],["c","Enterprise licence only, priced by seat"]], Lens answered [["a","$1.00"],["b","€8.18"],["c","Enterprise licence only, priced by seat"]]'])
  })

  it('B41.72 market-compare-screen: passes a table that shows each listing\'s values from Lens\'s reads, and fails otherwise', () => {
    const lens = [
      { offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: 10_000 }], trust: { reviews: { count: 2, average: 4 }, eval: null, performance: { success_rate: 0.95 } } },
      { offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: 20_000 }], trust: { reviews: { count: 0, average: 0 }, eval: { passed: 9, cases: 10 }, performance: { success_rate: null } } },
    ]
    const rows = {
      'Price for 100 uses': ['$1.00 100 uses at its per-use price', '$2.00 100 uses at its per-use price'],
      Rating: ['4.00 of 5 from 2 reviews', 'No reviews yet'],
      'Success rate': ['95% 5 of 100 uses failed in the last 30 days', 'No uses in the last 30 days'],
      Licence: ['Commercial', 'Commercial'],
      Evaluation: ['Not evaluated', '9 of 10 cases passed'],
    }
    expect(compareScreenFaults(rows, lens, 100)).toEqual([])
    expect(compareScreenFaults({ ...rows, Evaluation: ['Not evaluated', 'Not evaluated'] }, lens, 100)).toEqual([
      'listing 2\'s Evaluation reads "Not evaluated", Lens\'s records say "9 of 10 cases passed"'])
    expect(compareScreenFaults({ ...rows, 'Price for 100 uses': ['$2.00', '$1.00'] }, lens, 100)).toEqual([
      'listing 1\'s Price for 100 uses reads "$2.00", Lens\'s records say "$1.00"',
      'listing 2\'s Price for 100 uses reads "$1.00", Lens\'s records say "$2.00"'])
  })
})
