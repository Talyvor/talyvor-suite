// B17.537 SELF-TEST — the stand-in Lens's roles (talyvor-lens B28.342) and second approver (B28.315), as much of each as the
// second-approver scenario reads and writes:
//
//   GET/PUT /v1/workspaces/{ws}/roles               the roles the owner gave, by email; a role taken up names its user_id
//   DELETE  /v1/workspaces/{ws}/roles?email=…       B17.540: the role taken away, 204, and every session it gave ended
//   POST    /v1/provision/roles                     the BFF, on the provisioning secret: {"mode": "session"} mints a role session
//   GET/PUT /v1/workspaces/{ws}/second-approver     who, and the amount above which an agent's payment needs them
//   POST    /v1/workspaces/{ws}/second-approver/challenge
//
// Above the line an agent's payment waits for two different people, one of them the second approver: the first approval leaves it
// pending and waiting_for_second_approver, the same person again is 409 same_approver, and a pair without the second approver is
// 403 second_approver_needed. A payment's µLXC is valued in dollars at Lens's $0.10 an LXC, rounded up; in any other currency it
// counts as over. Its defect:
//   second-approver-one-approval — a Lens without B28.40: the first approval above the line approves the payment
//
// B17.540 — what a role session may do (talyvor-lens B28.342, workspace_roles_handler.go): every role reads an agent's summary,
// Finance and Admin fund and withdraw (moneyRoles), Approver and Admin decide approvals (approvalRoles); anything else is 403.
// Its defect:
//   role-viewer-funds — a Lens without B28.70's roles on the money routes: a Viewer's fund moves the money
//   role-finance-approves — B17.545: a Lens whose Finance role also decides approvals (B28.342 keeps them the Approver's)
//
// B17.553 — Lens B28.464: the roles list names the person who took each role up as user_id, "" until someone has. Its defect:
//   roles-no-user-id — a Lens without B28.464: every role lists user_id "", so no second approver can be picked
//
// B17.557 — Lens B61.66: the owner, an admin or Finance moves money between the company's account and an agent's (POST
// /v1/money/accounts/{id}/funding); any other role is 403. Its defect:
//   funding-any-role — a Lens whose funding route lets any role session move the money, a Viewer's included

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
/** The roles that may move an agent's money (cmd/lens moneyRoles). */
const MONEY_ROLES = ['finance', 'admin']

export class SecondApproverDesk {
  private readonly roles = new Map<string, Role[]>()
  private readonly sessions = new Map<string, { ws: string; person: string; role: string; email: string }>()
  /** B17.540 — the sessions a role taken away gave: refused 401 from then on. */
  private readonly ended = new Set<string>()
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

  /** B17.540 — whether bearer is a session whose role was taken away. */
  endedSession(bearer: string): boolean {
    return this.ended.has(bearer)
  }

  /** B17.540 — whether a session of role may send method to rest under its workspace (cmd/lens ownerOrRole). */
  may(role: string, method: string, rest: string): boolean {
    if (/^\/agents\/approvals(?:\/[^/]+\/(?:approve|deny))?$/.test(rest)) return APPROVAL_ROLES.includes(role) || (this.broken('role-finance-approves') && role === 'finance')
    if (/^\/agents\/[^/]+\/summary$/.test(rest) && method === 'GET') return ROLES.includes(role)
    if (/^\/agents\/[^/]+\/(?:fund|withdraw)$/.test(rest) && method === 'POST') return this.broken('role-viewer-funds') || MONEY_ROLES.includes(role)
    return false
  }

  /** B17.557 — whether a session of role may move money between the company's account and an agent's (cmd/lens moneyRoles). */
  mayFund(role: string): boolean {
    return this.broken('funding-any-role') || MONEY_ROLES.includes(role)
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
    this.sessions.set(token, { ws: account_id, person, role: role.role, email: role.email })
    return this.json(res, 200, { workspace_id: account_id, role: role.role, token, expires_at: new Date(Date.now() + 3600e3).toISOString() }), true
  }

  /** The owner's routes: the roles and the second-approver line. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string): Promise<boolean> {
    const method = req.method ?? 'GET'
    if (rest === '/roles' && method === 'GET') {
      // STUB_BREAK=roles-no-user-id: the list as it was before Lens B28.464, naming nobody who took a role up.
      const items = (this.roles.get(ws) ?? []).map((r) => (this.broken('roles-no-user-id') ? { ...r, user_id: '' } : r))
      return this.json(res, 200, { items, roles: ROLES }), true
    }
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
    if (rest === '/roles' && method === 'DELETE') {
      const email = (new URL(req.url ?? '/', 'http://stub').searchParams.get('email') ?? '').toLowerCase()
      const list = this.roles.get(ws) ?? []
      if (!list.some((r) => r.email === email)) return this.json(res, 404, { error: 'that email has no role in this workspace' }), true
      this.roles.set(ws, list.filter((r) => r.email !== email))
      for (const [token, s] of this.sessions) {
        if (s.ws === ws && s.email === email) {
          this.sessions.delete(token)
          this.ended.add(token)
        }
      }
      res.writeHead(204).end()
      return true
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
