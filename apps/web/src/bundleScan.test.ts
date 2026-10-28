import { describe, expect, it } from 'vitest'
import { bundleProblems } from './bundleScan'

// B50.6 — the build-time scan finds a planted key and a source map, and passes an ordinary file.
describe('bundleProblems', () => {
  it('finds a key-shaped string in a built file', () => {
    const planted = 'const k="sk_live_' + 'a1B2c3D4e5F6g7H8i9J0"'
    expect(bundleProblems([{ name: 'assets/index.js', text: planted }])).toHaveLength(1)
  })

  it('finds a source map, as a file or as a pointer to one', () => {
    expect(bundleProblems([{ name: 'assets/index.js.map', text: '{}' }])).toHaveLength(1)
    expect(bundleProblems([{ name: 'assets/index.js', text: 'x()\n//# sourceMappingURL=index.js.map' }])).toHaveLength(1)
  })

  it('passes a file that only names a key prefix', () => {
    expect(bundleProblems([{ name: 'assets/index.js', text: 'Your key starts with tlv_ws_ and sk_live_.' }])).toEqual([])
  })
})
