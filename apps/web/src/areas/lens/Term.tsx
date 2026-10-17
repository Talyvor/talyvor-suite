import { useId, useState } from 'react'

import { focusRing } from '@talyvor/ui'

import type { PostingKind } from './agentBankApi'

// B41.40 — plain-language mode: every money word on the statement and the approval card is explained one tap away.
// The ? button opens the explanation in place (no hover, so it works by touch and keyboard) and a screen reader reads
// it when it opens; Escape or a second tap closes it.

export const TERMS = {
  lxc: 'LXC is the credit your agents spend. Where a figure in your own currency is shown in brackets, it is the same amount.',
  balance: 'Balance is what was in the wallet just after this line.',
  approval:
    'Your agent tried to spend more than it may without asking, so it is waiting for you. Nothing moves until you approve. If you deny, it is refused.',
  faceid: 'Approving with Face ID means your own device signs this one decision, so nobody else can approve in your name.',
  held: 'Held means the money is set aside but not spent yet. It is still in the wallet until the line settles or is released.',
  settled: 'Settled means the money has finished moving. The line is final.',
  mandate: 'A mandate lets a payee take money from an agent’s account, only within the limits you set. You can cancel it.',
} as const

/** What each kind of statement line means, in a sentence. */
export const KIND_TERMS: Record<PostingKind, string> = {
  fund: 'Funded: money moved from your workspace into this agent’s wallet.',
  withdraw: 'Taken back: money moved from this agent’s wallet back to your workspace.',
  topup: 'Top-up: your workspace added money by itself because the wallet ran low, by the amount you set.',
  credit_line: 'Credit line: your workspace’s agreed credit paid for this because the wallet was short. It is owed and paid back later.',
  pay: 'A payment between this agent and another one.',
  transfer: 'Transfer: money moved between two wallets in your workspace.',
  reversal: 'Given back: a test-money payment was undone and the money returned.',
  escrow: 'Escrow: money locked until the work it pays for is delivered. Nobody can spend it meanwhile.',
  card: 'Card: a payment made with this agent’s card, or money a seller refunded to it.',
  cash_out: 'Cash-out: money sent from the wallet to an account outside Talyvor.',
  pot_in: 'Pot: money kept apart inside the wallet for one purpose. It is still this agent’s.',
  pot_out: 'Pot: money kept apart inside the wallet for one purpose, moved back to everyday spending.',
  spend: 'Spent: what a request to an AI model cost.',
  hold: 'Hold: money set aside while a request runs. What it did not cost comes back when it finishes.',
  release: 'Released: money that was held came back, because the request cost less or did not go ahead.',
  settle: 'Settle: the final cost of a request, taken from what was held for it.',
  platform_fee: 'Fee: what Talyvor charges for this service. The line names the fee and its rate.',
}

/** A ? button beside a money word; one tap shows what the word means, in place. Its parent is a wrapping flex row, so
 * the explanation takes a line of its own under the word. */
export function Term({ term, children }: { term: string; children: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What does “${term}” mean?`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill border border-rule bg-surface font-figure text-caption text-muted transition-colors duration-200 hover:text-ink ${focusRing}`}
      >
        ?
      </button>
      <span id={id} aria-live="polite" className={open ? 'basis-full whitespace-normal text-caption font-normal normal-case text-ink' : 'sr-only'} data-testid="term-explained">
        {open ? children : ''}
      </span>
    </>
  )
}
