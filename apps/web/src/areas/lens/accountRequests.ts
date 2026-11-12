import { useQuery } from '@tanstack/react-query'
import { ApiError, getJSON } from '../../lib/api'

// accountRequests.ts — B59.28: help and complaints, closing the account and the workspace's data. Each is a request a
// person at Talyvor answers (Lens B59.27, through the BFF's workspace_requests.go): it is received, in progress or done,
// and a complaint has its reference from the moment it is sent.

export type RequestKind = 'support' | 'complaint' | 'account_closure' | 'data_export' | 'data_deletion'
export type RequestState = 'received' | 'in_progress' | 'done'

/** One request as the BFF shows it. */
export interface AccountRequest {
  id: number
  kind: RequestKind
  state: RequestState
  /** a complaint's, e.g. C-ABCD-EFGH; "" for every other kind */
  reference: string
  message: string
  /** what Talyvor wrote back; "" until then */
  answer: string
  filed_at: string
  updated_at: string
}

/** Closing the account was refused: what each currency still holds, in minor units. */
export class BalancesHeldError extends ApiError {
  constructor(readonly balances: Record<string, number>) {
    super(409, '/api/workspace/requests')
  }
}

/** A request refused with the sentence Lens gave. */
export class RequestRefusedError extends ApiError {
  constructor(
    status: number,
    readonly sentence: string,
  ) {
    super(status, '/api/workspace/requests')
  }
}

export const REQUESTS_KEY = ['workspace-requests']

/** The workspace's requests, newest first: all of them for the owner, the ones they sent for anyone else. */
export function useAccountRequests() {
  return useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: async () => (await getJSON<{ requests: AccountRequest[] | null }>('/api/workspace/requests', { requests: 'list' })).requests ?? [],
  })
}

/** Sends one request; throws BalancesHeldError when the account still holds money, RequestRefusedError on a refusal. */
export async function sendRequest(kind: RequestKind, message: string): Promise<AccountRequest> {
  const res = await fetch('/api/workspace/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ kind, message }),
  })
  if (res.ok) return (await res.json()) as AccountRequest
  let body: { error?: string; code?: string; balances?: Record<string, number> } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // a body that is not JSON carries no sentence
  }
  if (res.status === 409 && body.code === 'balances_not_empty' && body.balances) throw new BalancesHeldError(body.balances)
  throw new RequestRefusedError(res.status, body.error ?? '')
}

/** Where a finished data export downloads from. */
export const exportHref = (id: number) => `/api/workspace/requests/${id}/export`
