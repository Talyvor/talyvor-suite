import { useQuery } from '@tanstack/react-query'
import { ApiError, getJSON } from '../../lib/api'

// companyDetailsApi.ts — B59.31: a Business workspace's company details and the people with control (SPEC 6 (4), Lens
// B59.30 through the BFF's workspace_business.go). They go to the partner's identity check later; no identity
// document is asked for. A Personal workspace has none. The phone (B59.32) shows the same words.

export type ControlRole = 'director' | 'shareholder' | 'other'

/** One person with control; share_bps is their share in hundredths of a percent (2500 is 25%). */
export interface ControlPerson {
  name: string
  role: ControlRole
  share_bps: number
}

/** The company record as the BFF shows it. */
export interface CompanyDetails {
  company_name: string
  registration_number: string
  country: string
  people: ControlPerson[]
}

export const COMPANY_WORDS = {
  title: 'Company details',
  line: 'These go to our partner’s identity check later. No identity documents are asked for.',
  people: 'People with control',
  peopleLine: 'Each director, and anyone who owns or controls part of the company.',
  name: 'Name',
  role: 'Role',
  share: 'Share',
  add: 'Add a person',
  remove: 'Remove',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'We couldn’t save that. Nothing changed.',
  readFailed: 'We couldn’t read the company details.',
  personName: 'Add their name.',
  shareRange: 'A share is from 0 to 100%.',
  sharesTotal: 'The shares come to more than 100%.',
} as const

export const ROLE_LABEL: Record<ControlRole, string> = { director: 'Director', shareholder: 'Shareholder', other: 'Other' }

export const COMPANY_KEY = ['workspace-business'] as const

/** GET /api/workspace/business — null for a Personal workspace, which has no company details. */
export async function readCompanyDetails(): Promise<CompanyDetails | null> {
  try {
    const got = await getJSON<CompanyDetails>('/api/workspace/business', { company_name: 'string', people: 'list' })
    return { ...got, people: got.people ?? [] }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** The company details, read only once the account is known to be a Business. */
export function useCompanyDetails(business: boolean) {
  return useQuery({ queryKey: COMPANY_KEY, queryFn: readCompanyDetails, retry: false, enabled: business })
}

/** Lens refused the details, with its sentence. */
export class CompanyRefusedError extends ApiError {
  constructor(
    status: number,
    readonly sentence: string,
  ) {
    super(status, '/api/workspace/business')
  }
}

/** PUT /api/workspace/business — saves the details, replacing what was saved, and answers what Lens kept. */
export async function saveCompanyDetails(details: CompanyDetails): Promise<CompanyDetails> {
  const res = await fetch('/api/workspace/business', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(details),
  })
  if (res.ok) return (await res.json()) as CompanyDetails
  let body: { error?: string } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // a body that is not JSON carries no sentence
  }
  throw new CompanyRefusedError(res.status, body.error ?? '')
}

/** A share as the screen shows it: 2500 is "25". */
export const shareText = (bps: number) => String(bps / 100)

/** A typed share in percent as hundredths of a percent, or null when it is not a number from 0 to 100. */
export function shareBps(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const bps = Math.round(Number(t) * 100)
  return bps <= 10000 ? bps : null
}
