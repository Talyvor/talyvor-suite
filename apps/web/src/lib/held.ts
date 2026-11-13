// B58.1 — one reading of a payment Lens held for the owner's approval, for every call that can be held: an agent's pay,
// a marketplace use or licence, and a room's run. Lens says it two ways: a 403 whose sentence names the approval
// ("… Approval apr_… must be approved …"), and from B58.2 a 2xx {"status":"pending_approval","approval_id",…}. Either
// way the screen says it waits in Approvals, and never that it was paid.

/** Lens's answer for a payment it held for the owner (B58.2). */
export interface HeldAnswer {
  status: 'pending_approval'
  approval_id: string
  amount_ulxc?: number
  /** Lens's sentence, the same words its 403 gives */
  message?: string
}

/** The approval a refusal's sentence names, whatever its case. */
export function approvalInSentence(sentence: string): string | null {
  return /approval (apr_[\w-]+)/i.exec(sentence)?.[1] ?? null
}

/** The hold a 2xx answer carries, or null when the answer is anything else. */
export function heldIn(body: unknown): HeldAnswer | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  return b.status === 'pending_approval' && typeof b.approval_id === 'string' && b.approval_id !== '' ? (b as unknown as HeldAnswer) : null
}

/** A holdable call's answer: a hold rejects with the error `held` makes, so no caller reads it as paid. */
export async function unlessHeld<T>(answer: Promise<T>, held: (h: HeldAnswer) => Error): Promise<T> {
  const body = await answer
  const h = heldIn(body)
  if (h) throw held(h)
  return body
}
