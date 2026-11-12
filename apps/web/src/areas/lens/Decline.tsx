import { useState } from 'react'

import { Button, Input } from '@talyvor/ui'

import type { AgentApproval } from './agentBankApi'

// B55.19 — Decline asks why before it sends: optional, kept by Lens (B55.18) and shown to the agent, which is then
// refused the same request without asking the owner for 24 hours. Approvals, Pay's waiting card and Chat use it.

/** What a decline did, said where the person declined it. */
export const declinedText = (who: string, a: AgentApproval) =>
  `Declined. ${who}’s ${a.payee ? 'payment' : 'request'} is refused, and the same request is refused without asking you for 24 hours.`

export function DeclineForm({ disabled, onDecline, onCancel }: { disabled: boolean; onDecline: (reason: string) => void; onCancel: () => void }) {
  const [why, setWhy] = useState('')
  return (
    <form
      className="flex w-full flex-col gap-2 rounded-control border border-rule p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onDecline(why.trim())
      }}
    >
      <label className="flex flex-col gap-1 text-caption text-muted">
        Why (optional, the agent sees it)
        <Input autoFocus maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
        <Button type="submit" className="h-12 w-full wide:h-8 wide:w-auto" disabled={disabled}>
          Decline
        </Button>
        <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
