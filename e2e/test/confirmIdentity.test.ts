import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { confirmAll, confirmLine } from '../src/confirmIdentity.ts'
import { LensClient } from '../src/lens.ts'

// B61.51 — every synthetic user passes the Sandbox identity check its account needs before any journey, through the calls
// the app makes; a user that cannot is named, never thrown.

let server: Server | undefined
afterEach(() => server?.close())

/** A Lens whose workspaces are `accountType`, each check passing in order unless its kind is in `refuse`; the calls it saw. */
async function lens(accountType: string, refuse: string[] = []): Promise<{ client: LensClient; calls: string[] }> {
  const calls: string[] = []
  const level = new Map<string, number>()
  server = createServer((req, res) => {
    const path = (req.url ?? '').replace(/^\/v1\/workspaces\/[^/]+/, '')
    calls.push(`${req.method} ${path}`)
    const ws = /^\/v1\/workspaces\/([^/]+)/.exec(req.url ?? '')?.[1] ?? ''
    const send = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    req.resume().on('end', () => {
      if (req.url === '/v1/synthetic/workspaces') return send(201, { workspaces: [{ workspace_id: 'ws_1', token: 't1', expires_at: '' }, { workspace_id: 'ws_2', token: 't2', expires_at: '' }] })
      if (path === '/account') return send(200, { account_type: accountType, money_kind: 'hybrid' })
      if (path === '/verification') return send(200, { level: `L${level.get(ws) ?? 0}`, live_level: 'L0', checks: [] })
      if (path === '/business') return send(200, {})
      const kind = /^\/verification\/(contact|identity|company)$/.exec(path)?.[1]
      if (kind === undefined) return send(404, { error: 'no such route' })
      if (refuse.includes(kind)) return send(409, { error: `economy: the ${kind} check was refused` })
      level.set(ws, (level.get(ws) ?? 0) + 1)
      send(201, { check: { status: 'completed' }, verification: { level: `L${level.get(ws)}`, live_level: 'L0' } })
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  return { client: new LensClient(`http://127.0.0.1:${port}`, 'key'), calls }
}

const users = [{ index: 0, workspaceID: 'ws_1', token: 't1', expiresAt: '' }]

describe("the testers' people confirm who they are (B61.51)", () => {
  it('a Business passes the email and phone, identity and, after its company details, company checks to L3', async () => {
    const { client, calls } = await lens('business')
    const got = await confirmAll(client, users)
    expect(got).toMatchObject({ asked: 1, confirmed: 1, failed: [] })
    expect(calls.filter((c) => c.startsWith('POST') || c.startsWith('PUT')))
      .toEqual(['POST /verification/contact', 'POST /verification/identity', 'PUT /business', 'POST /verification/company'])
    expect(confirmLine(got, 1)).toMatch(/^identity: confirmed 1 of 1 synthetic user\(s\) .*; 1 workspace\(s\) of their own start unconfirmed for verification-levels and verification-screen and identity-gate$/)
  })

  it('a Personal stops at L2, with no company details or company check', async () => {
    const { client, calls } = await lens('personal')
    expect(await confirmAll(client, users)).toMatchObject({ confirmed: 1, failed: [] })
    expect(calls).not.toContain('PUT /business')
    expect(calls).not.toContain('POST /verification/company')
  })

  it('a user that cannot pass is named in the incidents and still made; the verification scenarios ask for theirs unconfirmed', async () => {
    const { client, calls } = await lens('business', ['identity'])
    const incidents: string[] = []
    const paced = new LensClient(client.baseURL, 'key', undefined, undefined, undefined, '', '', { sent: [], incidents })
    expect(await paced.createUsers(2)).toHaveLength(2)
    expect(incidents).toHaveLength(2)
    expect(incidents[0]).toMatch(/synthetic user ws_\d could not confirm who it is: the identity check: refused 409: economy: the identity check was refused/)
    calls.length = 0
    await paced.createUsers(2, undefined, { confirm: false })
    expect(calls).toEqual(['POST /v1/synthetic/workspaces'])
  })
})
