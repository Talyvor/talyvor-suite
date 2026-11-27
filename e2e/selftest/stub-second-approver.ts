// B17.537 SELF-TEST — the stand-in Lens's roles (talyvor-lens B28.342) and second approver (B28.315), as much of each as the
// second-approver scenario reads and writes:
//
//   GET/PUT /v1/workspaces/{ws}/roles               the roles the owner gave, by email; a role taken up names its user_id
//   POST    /v1/provision/roles                     the BFF, on the provisioning secret: {"mode": "session"} mints a role session
//   GET/PUT /v1/workspaces/{ws}/second-approver     who, and the amount above which an agent's payment needs them
//   POST    /v1/workspaces/{ws}/second-approver/challenge
//
// Above the line an agent's payment waits for two different people, one of them the second approver: the first approval leaves it
// pending and waiting_for_second_approver, the same person again is 409 same_approver, and a pair without the second approver is
// 403 second_approver_needed. A payment's µLXC is valued in dollars at Lens's $0.10 an LXC, rounded up; in any other currency it
// counts as over. Its defect:
//   second-approver-one-approval — a Lens without B28.40: the first approval above the line approves the payment

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

type Json = (res: ServerResponse, status: number, body: unknown) => void
interface Role { email: string; role: string; user_id: string; signed_in: boolean; granted_at: string }
interface Line { user_id: string; above_minor: number; currency: string; set_by?: string; set_at?: string }
/** An approval as the desk decides it over the line; the bank's Approval carries these. */
export interface TwoApprovals { status: string; over_second_approver_line?: boolean; waiting_for_second_approver?: boolean; first_approved_by?: string; second_approved_by?: string }

const ROLES = ['viewer', 'finance', 'approver', 'admin']
/** The roles that may decide an approval (cmd/lens approvalRoles). */
export const APPROVAL_ROLES = ['approver', 'admin']

export class SecondApproverDesk {
  private readonly roles = new Map<string, Role[]>()
  private readonly sessions = new Map<string, { ws: string; person: string; role: string }>()
  private readonly lines = new Map<string, Line>()

  private readonly json: Json
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly passkeys: (ws: string) => string[]

  constructor(json: Json, body: <T>(req: IncomingMessage) => Promise<T>, broken: (name: string) => boolean, passkeys: (ws: string) => string[]) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
  }

  /** The role session a bearer is, if it is one. */
  session(bearer: string): { ws: string; person: string; role: string } | undefined {
    return this.sessions.get(bearer)
  }

  /** POST /v1/provision/roles on the provisioning secret: a person takes up the role their email holds in an account. */
  async provision(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== '/v1/provision/roles' || req.method !== 'POST') return false
    if ((process.env.STUB_PROVISION_SECRET ?? '') === '' || req.headers['x-gateway-auth'] !== process.env.STUB_PROVISION_SECRET) {
      return this.json(res, 401, { error: 'provisioning credentials required' }), true
    }
    const { identity = '', email = '', mode = '', account_id = '' } = await this.body<{ identity?: string; email?: string; mode?: string; account_id?: string }>(req)
    if (identity === '' || email === '') return this.json(res, 400, { error: 'identity and email required' }), true
    if (mode !== 'session') return this.json(res, 400, { error: 'mode must be list or session' }), true
    const role = (this.roles.get(account_id) ?? []).find((r) => r.email === email.toLowerCase())
    if (role === undefined) return this.json(res, 404, { error: 'no such account' }), true
    const person = 'p' + createHash('sha256').update(identity).digest('hex').slice(0, 26)
    if (role.signed_in && role.user_id !== person) return this.json(res, 409, { error: 'workspace: that role was taken up by another person' }), true
    role.signed_in = true
    role.user_id = person
    const token = `role_${randomBytes(16).toString('hex')}`
    this.sessions.set(token, { ws: account_id, person, role: role.role })
    return this.json(res, 200, { workspace_id: account_id, role: role.role, token, expires_at: new Date(Date.now() + 3600e3).toISOString() }), true
  }

  /** The owner's routes: the roles and the second-approver line. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string): Promise<boolean> {
    const method = req.method ?? 'GET'
    if (rest === '/roles' && method === 'GET') return this.json(res, 200, { items: this.roles.get(ws) ?? [], roles: ROLES }), true
    if (rest === '/roles' && method === 'PUT') {
      const { email = '', role = '' } = await this.body<{ email?: string; role?: string }>(req)
      if (!ROLES.includes(role)) return this.json(res, 400, { error: 'workspace: unknown role' }), true
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return this.json(res, 400, { error: 'workspace: a role is given to an email address' }), true
      const list = this.roles.get(ws) ?? []
      const had = list.find((r) => r.email === email.toLowerCase())
      const given: Role = had ?? { email: email.toLowerCase(), role, user_id: '', signed_in: false, granted_at: new Date().toISOString() }
      given.role = role
      if (had === undefined) list.push(given)
      this.roles.set(ws, list)
      return this.json(res, 200, given), true
    }
    if (rest === '/second-approver' && method === 'GET') return this.json(res, 200, this.lines.get(ws) ?? { user_id: '', above_minor: 0, currency: '' }), true
    if ((rest === '/second-approver' && method === 'PUT') || (rest === '/second-approver/challenge' && method === 'POST')) {
      const { user_id = '', above_minor = 0, currency = '', assertion } = await this.body<Line & { assertion?: { credential_id?: string } }>(req)
      const cleared = user_id === '' && above_minor === 0
      if (!cleared && (user_id === '' || !(above_minor > 0) || !['GBP', 'EUR', 'USD', 'USDC'].includes(currency))) {
        return this.json(res, 400, { error: 'economy: invalid second approver: name the person, an amount above 0 and GBP, EUR, USD or USDC' }), true
      }
      const keys = this.passkeys(ws)
      if (rest.endsWith('/challenge')) return this.json(res, 200, { challenge: randomBytes(32).toString('base64url'), allow_credentials: keys, user_verification: 'required' }), true
      if (keys.length > 0 && !keys.includes(assertion?.credential_id ?? '')) return this.json(res, 403, { error: 'economy: a passkey or device key signature is required' }), true
      if (cleared) this.lines.delete(ws)
      else this.lines.set(ws, { user_id, above_minor, currency, set_by: ws, set_at: new Date().toISOString() })
      return this.json(res, 200, this.lines.get(ws) ?? { user_id: '', above_minor: 0, currency: '' }), true
    }
    return false
  }

  /** Whether an agent's payment of amount µLXC in ws is over its second-approver line. */
  over(ws: string, amount: number): boolean {
    const line = this.lines.get(ws)
    if (line === undefined) return false
    return line.currency !== 'USD' || Math.ceil(amount / 100_000) > line.above_minor
  }

  /**
   * An approval of a over its workspace's line, by who ("user:<id>", or "" for a key): the refusal to answer, or undefined when it
   * is approved now. The first person's approval leaves it pending and is answered as it stands.
   */
  approve(ws: string, a: TwoApprovals, who: string): { status: number; body: unknown } | 'waiting' | undefined {
    if (this.broken('second-approver-one-approval')) return undefined
    if (who === '') return { status: 403, body: { error: "economy: this payment is over the second approver line, and only a signed-in person's approval counts towards its two", code: 'approver_unknown' } }
    if (a.first_approved_by === undefined) {
      a.first_approved_by = who
      a.waiting_for_second_approver = true
      return 'waiting'
    }
    if (a.first_approved_by === who) return { status: 409, body: { error: 'economy: approved by you; waiting for a second approver', code: 'same_approver' } }
    const second = `user:${this.lines.get(ws)?.user_id ?? ''}`
    if (a.first_approved_by !== second && who !== second) {
      return { status: 403, body: { error: 'economy: this payment is over the second approver line, so the second approver must be one of its two approvers', code: 'second_approver_needed' } }
    }
    a.second_approved_by = who
    a.waiting_for_second_approver = false
    return undefined
  }
}
