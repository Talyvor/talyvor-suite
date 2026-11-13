import { describe, expect, it } from 'vitest'
import { contentFilterFaults } from '../src/contentFilter.ts'

const mine = { adult: 'lst_adult', family: 'lst_family', unrated: 'lst_unrated' }

describe('B41.85 market-content-filter', () => {
  it('passes the family filter showing only the listing rated for everyone, and fails otherwise', () => {
    expect(contentFilterFaults(['lst_family', 'lst_other'], mine, '18+', 'all')).toEqual([])
    expect(contentFilterFaults(['lst_family', 'lst_adult', 'lst_unrated'], mine, '18+', 'all')).toEqual([
      'the listing rated 18+ lst_adult is in the catalog of a workspace with the family filter',
      'the listing published with no rating lst_unrated is in the catalog of a workspace with the family filter',
    ])
    expect(contentFilterFaults([], mine, '', '18+')).toEqual([
      'a listing published with no age rating reads "", not 18+',
      'the family filter saved on Content filter reads max_age_rating "18+" from Lens, not "all"',
      'the control: the listing rated for everyone lst_family is not in the catalog, so the 18+ ones missing proves nothing',
    ])
  })
})
