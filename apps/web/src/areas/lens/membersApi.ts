// B32.72 — adding a member from the Members screen.
//
//   POST /api/members  {"email": "…", "role": "member" | "owner"}  (apps/bff/track_members.go)
//
// The BFF adds the person to the session's Track workspace and relays Track's answer unchanged:
// 201 the new member; 402 Lens's refusal when the plan has no seat left ({error, code, plan, limit,
// allows} — `error` is Lens's own sentence); 409 MEMBER_EXISTS; 403 OWNER_REQUIRED; 503 SEATS_UNCHECKED.

import { ApiError } from '../../lib/api'

/** Track internal/model.Member, as POST answers it (its name is the email until the person signs in). */
export interface AddedMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/** An add Track refused, with the sentence it (or, on 402, Lens) gave. */
export class MemberAddError extends ApiError {
  constructor(
    status: number,
    code: string | undefined,
    readonly sentence: string,
  ) {
    super(status, '/api/members', code)
  }
}

export async function addMember(email: string, role: 'owner' | 'member'): Promise<AddedMember> {
  const res = await fetch('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<AddedMember> & { error?: string; code?: string }
  if (!res.ok) throw new MemberAddError(res.status, body.code, typeof body.error === 'string' ? body.error : '')
  return body as AddedMember
}

// B52.36 — invite links into the workspace, who joined by one, and accepting one (apps/bff/workspace_members.go).
//
//   GET/POST /api/workspace/member-invites, DELETE /api/workspace/member-invites/{id}
//   GET /api/workspace/members, DELETE /api/workspace/members/{id}
//   POST /api/invites/accept {"token"}  — the BFF adds the SESSION's person; the browser sends only the token

/** Lens members.Invite. token is there only in the answer that made the link. */
export interface WorkspaceInvite {
  id: string
  token?: string
  max_uses: number
  uses: number
  expires_at: string
  revoked_at?: string
  live: boolean
  created_at: string
}

/** One person who joined by invite, as the BFF answers them: never their identity. */
export interface JoinedMember {
  id: string
  role: string
  added_at: string
}

export interface Joined {
  workspace_id: string
  name: string
  created: boolean
}

/** A request the BFF refused, with its sentence. */
export class InviteError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function answer<T>(path: string, res: Response): Promise<T> {
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new InviteError(res.status, path, typeof said.error === 'string' ? said.error : '')
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const read = async <T,>(path: string): Promise<T> => answer<T>(path, await fetch(path, { headers: { Accept: 'application/json' } }))

async function send<T>(path: string, method: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return answer<T>(path, res)
}

const e = encodeURIComponent

export const invitesApi = {
  invites: async () => (await read<{ invites: WorkspaceInvite[] | null }>('/api/workspace/member-invites')).invites ?? [],
  create: (maxUses: number, expiresAt: string) =>
    send<WorkspaceInvite>('/api/workspace/member-invites', 'POST', { max_uses: maxUses, expires_at: expiresAt }),
  revoke: (id: string) => send<WorkspaceInvite>(`/api/workspace/member-invites/${e(id)}`, 'DELETE', {}),
  members: async () => (await read<{ members: JoinedMember[] | null }>('/api/workspace/members')).members ?? [],
  remove: (id: string) => send<void>(`/api/workspace/members/${e(id)}`, 'DELETE', {}),
  accept: (token: string) => send<Joined>('/api/invites/accept', 'POST', { token }),
}

/** Where an invite link opens. The token rides after the #, so it never reaches a server's access log. */
export const joinHref = (token: string) => `/join#${encodeURIComponent(token)}`
