import { useQuery } from '@tanstack/react-query'
import { ApiError, getJSON } from '../../lib/api'
import { COMPANY_CONTACT } from '../../company'

// helpChat.ts — B61.38: Help is a chat, answered by AI, with our team one press away (the BFF's help_chat.go). The BFF
// keeps the chat, 30 days, with what the person typed already cut of anything that looks like a code, a card number
// or a key; the browser sends only the question and the page it is on.

/** Who wrote a line: the person, Help's AI, or a person on our team. */
export type HelpBy = 'you' | 'ai' | 'team'

export interface HelpMessage {
  by: HelpBy
  text: string
  /** a page of the app that answers it */
  page?: string
  /** the reply offers "Send to our team" */
  team?: boolean
  /** "complaint": the reply offers the complaints form instead */
  topic?: string
  at: string
}

export const HELP_CHAT_KEY = ['help-chat']

/** The words each author is shown under. */
export const HELP_BY: Record<HelpBy, string> = { you: 'You', ai: 'Talyvor AI', team: 'Talyvor team' }

export function useHelpChat() {
  return useQuery({
    queryKey: HELP_CHAT_KEY,
    queryFn: async () => (await getJSON<{ messages: HelpMessage[] | null }>('/api/help/chat', { messages: 'list' })).messages ?? [],
  })
}

/** The day's questions were all asked: the BFF's sentence, and the chat with the question in it. */
export class HelpLimitError extends ApiError {
  constructor(
    readonly sentence: string,
    readonly messages: HelpMessage[],
  ) {
    super(429, '/api/help/ask')
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

/** Asks one question from `page`; answers the chat with the reply last. */
export async function askHelp(question: string, page: string): Promise<HelpMessage[]> {
  const res = await fetch('/api/help/ask', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ question, page }) })
  const body = (await res.json().catch(() => ({}))) as { messages?: HelpMessage[]; error?: string }
  if (res.status === 429) throw new HelpLimitError(body.error ?? '', body.messages ?? [])
  if (!res.ok) throw new ApiError(res.status, '/api/help/ask')
  return body.messages ?? []
}

/** Files the chat so far in the help inbox. */
export async function sendHelpToTeam(): Promise<void> {
  const res = await fetch('/api/help/team', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({}) })
  if (!res.ok) throw new ApiError(res.status, '/api/help/team')
}

export async function deleteHelpChat(): Promise<void> {
  const res = await fetch('/api/help/chat', { method: 'DELETE', headers: JSON_HEADERS })
  if (!res.ok) throw new ApiError(res.status, '/api/help/chat')
}

/** The person's own email, to Talyvor, with their question filled in. */
export const helpMailto = (question: string) =>
  `mailto:${COMPANY_CONTACT}?subject=${encodeURIComponent('Help with Talyvor')}&body=${encodeURIComponent(question)}`
