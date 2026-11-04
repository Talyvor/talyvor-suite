import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'

import { Button, inlineLink } from '@talyvor/ui'

import { PLAN_KEY, planDay } from '../lens/MonthPlan'
import { agentBankApi, formatMinor } from '../lens/agentBankApi'
import { Card } from '../lens/walletBrand'
import { readFailure } from '../lens/WalletMoney'

// B53.16 — "How much can I spend today?" typed in Chat's composer is not sent to the model: it opens a card in the
// conversation that answers from Lens's month plan (GET /api/money/plan, as the Spending screen reads it): what is safe to
// spend each day until payday, and the first way the month is off plan, in the Coach's own sentence.

const TODAY =
  /^\s*(?:please\s+)?(?:how\s+much\s+(?:can|should)\s+(?:i|we)\s+(?:safely\s+)?spend\s+(?:today|a\s+day|per\s+day|each\s+day|until\s+payday)|what\s+(?:can|should)\s+(?:i|we)\s+spend\s+today|(?:what\s+is|what['’]s)\s+safe\s+to\s+spend\s+today)\s*\??\s*$/i

/** A question the month plan answers rather than the model. */
export const isPlanQuestion = (text: string) => TODAY.test(text)

export function PlanCard({ question, onClose }: { question: string; onClose: () => void }) {
  // Its own read, as of the question: never a plan cached a moment before it was asked.
  const id = useId()
  const plan = useQuery({ queryKey: [...PLAN_KEY, 'asked', id], queryFn: agentBankApi.plan })
  const p = plan.data
  const off = p?.findings.find((f) => f.urgent) ?? p?.findings[0]

  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-plan">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Asked <span className="break-all font-mono">{question}</span>
          </p>
          {plan.isError ? (
            <p role="alert" className="text-body text-ink">
              {readFailure(plan.error, 'Your month plan')}
            </p>
          ) : p === undefined ? (
            <p className="text-body text-muted">Reading your month plan…</p>
          ) : (
            <>
              <p role="status" className="text-body text-ink" data-testid="chat-plan-answer">
                You can spend <span className="font-figure">{formatMinor(p.safe_per_day_minor, p.currency)}</span> today, and each day until{' '}
                {p.next_income ? `payday on ${planDay(p.next_income)}` : `${planDay(p.until)}`}.
              </p>
              {off !== undefined ? (
                <p className="text-body text-ink" data-testid="chat-plan-off">
                  {off.sentence}
                </p>
              ) : null}
              <p className="text-caption text-muted">
                After the payments due and what your budgets still mean to spend.{' '}
                <Link className={inlineLink} to="/money/spending">
                  See your month plan
                </Link>
              </p>
            </>
          )}
          <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
            <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
