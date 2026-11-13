import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { CATEGORIES, categoryWords } from '../lens/Budgets'
import { SPENDING_KEY, amounts, byCategory, spendPeriod } from '../lens/Spending'
import { agentBankApi } from '../lens/agentBankApi'
import { Card } from '../lens/walletBrand'
import { readFailure } from '../lens/WalletMoney'

// B53.8 — "How much did I spend on eating out this month?" typed in Chat's composer is not sent to the model: it opens a
// card in the conversation that answers from Lens's own totals (GET /api/money/spending, as the Spending screen reads it),
// every wallet together, each currency on its own.

const SPEND =
  /^\s*(?:please\s+)?how\s+much\s+(?:did|have|has)\s+(?:i|we)\s+(?:spent|spend)\s+on\s+(.+?)(?:\s+(this\s+week|this\s+month|so\s+far\s+this\s+(?:week|month)))?\s*\??\s*$/i

/** Words a person uses for a category, beside its own name. */
const SAID: Record<string, string> = {
  restaurants: 'eating_out',
  takeaways: 'eating_out',
  software: 'ai_software',
  ai: 'ai_software',
  transfers: 'transfers',
}

/** The category and period a spend question asks about, or null when it is not one. An unknown category is "". */
export function parseSpend(text: string): { category: string; said: string; period: 'week' | 'month' } | null {
  const m = SPEND.exec(text)
  if (m === null) return null
  const said = m[1].replace(/^[\s"'“‘]+|[\s"'”’]+$/g, '').toLowerCase()
  const category = SAID[said] ?? CATEGORIES.find(([v, name]) => v !== '' && name.toLowerCase() === said)?.[0] ?? ''
  return { category, said, period: /week/i.test(m[2] ?? '') ? 'week' : 'month' }
}

/** A question Lens's spending answers rather than the model. */
export const isSpendQuestion = (text: string) => parseSpend(text) !== null

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function SpendCard({ question, onClose }: { question: string; onClose: () => void }) {
  const [asked] = useState(() => parseSpend(question) ?? { category: '', said: '', period: 'month' as const })
  const [at] = useState(() => spendPeriod(asked.period))
  const [category, setCategory] = useState(asked.category)
  // Its own read, as of the question: never totals cached a moment before it was asked.
  const id = useId()
  const spending = useQuery({ queryKey: [...SPENDING_KEY, 'asked', id], queryFn: () => agentBankApi.spending(at.from, at.to) })
  const spent = byCategory(spending.data).get(category)
  const when = asked.period === 'week' ? 'this week' : 'this month'

  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-spend">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-caption text-muted">
            Asked <span className="break-all font-mono">{question}</span>
          </p>
          {spending.isError ? (
            <p role="alert" className="text-body text-ink">
              {readFailure(spending.error, 'Your spending')}
            </p>
          ) : spending.isPending ? (
            <p className="text-body text-muted">Reading your spending…</p>
          ) : category === '' ? (
            <>
              <select aria-label="Category" className={`${selectClass} wide:max-w-48`} value="" onChange={(e) => setCategory(e.target.value)}>
                <option value="" disabled>
                  Pick a category
                </option>
                {CATEGORIES.filter(([v]) => v !== '').map(([v, name]) => (
                  <option key={v} value={v}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-caption text-muted">There is no category called “{asked.said}”. Pick one.</p>
            </>
          ) : (
            <>
              <p role="status" className="text-body text-ink" data-testid="chat-spend-answer">
                {spent === undefined ? (
                  <>Nothing on {categoryWords(category)} {when}.</>
                ) : (
                  <>
                    You spent <span className="font-figure">{amounts(spent)}</span> on {categoryWords(category)} {when}.
                  </>
                )}
              </p>
              <p className="text-caption text-muted">
                Your own wallet and your agents’ together.{' '}
                <Link className={inlineLink} to="/money/spending">
                  See it on Spending
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
