import { getJSON } from '../../lib/api'
import type { AccountType, MoneyKind, WorkspaceAccount } from './agentBankApi'
import { AgentBankError } from './agentBankApi'

// accountsApi.ts — B61.9: the signed-in person's accounts (the BFF's accounts.go, B61.8, over Lens's B61.7), switching
// between them, and opening another. Lens says which accounts are the person's; a switch or an open moves the session.

/** One account of the person's, as GET /api/accounts lists it: the first one opened first, the session's marked. */
export interface PersonAccount {
  id: string
  name: string
  type: AccountType | ''
  kind: MoneyKind | ''
  opened_at: string
  current: boolean
}

export const ACCOUNTS_KEY = ['person-accounts'] as const

/** GET /api/accounts. */
export async function readAccounts(): Promise<PersonAccount[]> {
  return (await getJSON<{ accounts: PersonAccount[] | null }>('/api/accounts', { accounts: 'list' })).accounts ?? []
}

/** The row's type and kind, when Lens has said both (a test session's one account says neither). */
export function accountOf(a: PersonAccount): WorkspaceAccount | null {
  return a.type && a.kind ? { account_type: a.type, money_kind: a.kind } : null
}

/** Sign-up's answers for another account (the BFF's parseSignupAccount). */
export interface OpenAccountBody {
  type: AccountType
  kind: MoneyKind
  name: string
  country: string
  registration_number?: string
}

async function post(path: string, body: object): Promise<{ account_id: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return (await res.json()) as { account_id: string }
}

/** POST /api/accounts/switch: the session moves to that account. */
export const switchAccount = (accountID: string) => post('/api/accounts/switch', { account_id: accountID })

/** POST /api/accounts: opens another account with sign-up's answers, and moves the session to it. */
export const openAccount = (body: OpenAccountBody) => post('/api/accounts', body)
