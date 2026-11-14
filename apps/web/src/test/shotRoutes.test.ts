import { describe, expect, it } from 'vitest'

import { ROUTE_PATHS } from '../App'
import { SHOT_ROUTES } from '../../scripts/pocket/routes'

describe('the routes pocket-shots knows', () => {
  it('are every route App routes, and no other', () => {
    expect(Object.keys(SHOT_ROUTES).sort()).toEqual([...ROUTE_PATHS].sort())
  })
})
