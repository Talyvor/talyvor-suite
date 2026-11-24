// rolesApi.ts — B28.70: roles in a workspace (apps/bff/workspace_roles.go over talyvor-lens B28.342).
//
//   GET/PUT/DELETE /api/workspace/roles       the owner gives an email a role, changes it or takes it away
//   POST /api/roles/email/code {"email"}      a code is mailed to the address
//   POST /api/roles/email/check {email, code} the address is proved for the signed-in person
//   GET /api/roles                            the proved addresses and the accounts a role was given in
//
// A role opens only by an email the person proved with the code, so an address they typed and could not prove shows
// nothing. Opening a role's account is the accounts switcher's own POST /api/accounts/switch.

import { ApiError, getJSON } from '../../lib/api'

export type Role = 'viewer' | 'finance' | 'approver' | 'admin'

export const ROLES: readonly Role[] = ['viewer', 'finance', 'approver', 'admin']

export const ROLE_NAME: Record<Role, string> = { viewer: 'Viewer', finance: 'Finance', approver: 'Approver', admin: 'Admin' }

/** What each role may do, as Lens enforces it (talyvor-lens internal/auth/roles.go). */
export const ROLE_LINE: Record<Role, string> = {
  viewer: 'Sees everything. Moves, approves and changes nothing.',
  finance: 'Sees everything, and adds, pays, sends and converts money.',
  approver: 'Sees everything, and approves or declines what waits for approval.',
  admin: 'Everything but keys, passkeys and roles, which stay the owner’s.',
}

/** Settings' page for roles: Team and roles on a Business account; a Personal account has no team (launch pack 3.4). */
export const teamTitle = (business: boolean) => (business ? 'Team and roles' : 'Accounts shared with you')

export const roleName = (r: string) => ROLE_NAME[r as Role] ?? r

/** One role the owner gave (talyvor-lens workspace.WorkspaceRole). */
export interface GivenRole {
  email: string
  role: Role
  signed_in: boolean
  granted_at: string
}

/** One account a role was given in, to one of the person's proved addresses. */
export interface RoleAccount {
  id: string
  name: string
  type: string
  kind: string
  role: Role
  email: string
  current: boolean
}

export interface MyRoles {
  emails: string[]
  accounts: RoleAccount[]
}

export const GIVEN_ROLES_KEY = ['workspace-roles'] as const
export const MY_ROLES_KEY = ['my-roles'] as const

/** A request the BFF or Lens refused, with its sentence. */
export class RoleError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function send<T>(path: string, method: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new RoleError(res.status, path, typeof said.error === 'string' ? said.error : '')
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const rolesApi = {
  given: async () => (await getJSON<{ items: GivenRole[] | null }>('/api/workspace/roles', { items: 'list' })).items ?? [],
  give: (email: string, role: Role) => send<GivenRole>('/api/workspace/roles', 'PUT', { email, role }),
  remove: (email: string) => send<void>(`/api/workspace/roles?email=${encodeURIComponent(email)}`, 'DELETE', {}),
  mine: async (): Promise<MyRoles> => {
    const got = await getJSON<{ emails: string[] | null; accounts: RoleAccount[] | null }>('/api/roles', { emails: 'list', accounts: 'list' })
    return { emails: got.emails ?? [], accounts: got.accounts ?? [] }
  },
  sendCode: (email: string) => send<{ sent: boolean; email: string }>('/api/roles/email/code', 'POST', { email }),
  checkCode: (email: string, code: string) => send<{ email: string }>('/api/roles/email/check', 'POST', { email, code }),
}

/** A refusal's sentence, or the fallback. */
export const refusal = (err: unknown, fallback: string) => (err instanceof RoleError && err.sentence ? err.sentence : fallback)
