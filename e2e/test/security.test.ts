import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ORIGIN_EXEMPT, writeRoutes } from '../src/security.ts'

// B50.7 — csrf-every-write sends one cross-site write to every write route the BFF registers.
describe('the BFF write routes csrf-every-write attacks (B50.7)', () => {
  it('are every writing registration in apps/bff lens.go, ids filled in, and no read', () => {
    const routes = writeRoutes(readFileSync(new URL('../../apps/bff/lens.go', import.meta.url), 'utf8'))
    const named = routes.map((r) => `${r.method} ${r.path}`)
    expect(routes.length).toBeGreaterThan(20)
    expect(named).toContain('POST /api/keys')
    expect(routes.every((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !r.path.includes('{'))).toBe(true)
    expect(writeRoutes('mux.HandleFunc("GET /api/context", a.handleContext)\nmux.HandleFunc("DELETE /api/keys/{id}", a.del)')).toEqual([{ method: 'DELETE', path: '/api/keys/b507' }])
    expect(ORIGIN_EXEMPT.has('/mcp')).toBe(true)
  })
})
