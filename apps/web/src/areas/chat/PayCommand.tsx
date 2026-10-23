import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, inlineLink } from '@talyvor/ui'

import { ApprovalCard, paymentRequestKey } from '../lens/Approve'
import { type OutsidePayee, agentBankApi, formatMinor, minorOf, newMoveKey, refusalText, type PaymentRequest } from '../lens/agentBankApi'
import { PAYEES_KEY } from '../lens/Pay'
import { Card } from '../lens/walletBrand'

// B40.12 — "pay the ACME invoice", said or typed, is not asked of the model: Chat finds the saved payee, asks how much if
// nobody said, and prepares the payment with Lens (B40.3), which pays nothing. The card reads back the payee and the
// amount — aloud too, when it was said — and the payment goes only once the person approves it with a passkey on the
// approval card (B40.5, B40.9). The payee is named and the amount said; account numbers are never shown or read out.

export interface Amount {
  minor: number
  /** Said with the amount ("£120", "120 euros"); otherwise the payee's account decides. */
  currency?: string
}

export interface PayAsk {
  payee: string
  amount?: Amount
  reference: string
}

const PAY = /^\s*(?:please\s+)?pay\s+(.+?)\s*[.!]?\s*$/i
const AMOUNT = /([£€$])\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(pounds?|quid|euros?|dollars?|gbp|eur|usd)\b/i
const SYMBOLS: Record<string, string> = { '£': 'GBP', '€': 'EUR', $: 'USD' }

function amountIn(text: string): { amount: Amount; rest: string } | null {
  const m = AMOUNT.exec(text)
  if (m === null) return null
  const minor = minorOf((m[2] ?? m[3]).replace(/,/g, ''))
  if (minor === null) return null
  const word = (m[4] ?? '').toLowerCase()
  const currency = m[1] ? SYMBOLS[m[1]] : /^(?:pound|quid|gbp)/.test(word) ? 'GBP' : /^(?:euro|eur)/.test(word) ? 'EUR' : 'USD'
  return { amount: { minor, currency }, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() }
}

/** "£120", "it’s 120 pounds": an answer to "how much?" that is only an amount. */
export function bareAmount(text: string): Amount | null {
  const found = amountIn(text)
  return found !== null && /^(?:it[’']?s|that[’']?s|about)?[\s.!]*$/i.test(found.rest) ? found.amount : null
}

/** What a pay command asks: "pay the ACME invoice", "pay ACME £120", "pay £120 to ACME for the March invoice". A "pay"
 *  that names neither an invoice nor an amount ("pay attention to …") is a question for the model. */
export function parsePay(text: string): PayAsk | null {
  const m = PAY.exec(text)
  if (m === null) return null
  const found = amountIn(m[1])
  const rest = found?.rest ?? m[1]
  const invoice = /\b(invoice|bill)\b/i.exec(rest)
  if (invoice === null && found === null) return null
  const payee = rest
    .split(/\s+for\s+|\s*[—–-]\s+|\s+(?:invoice|bill)s?\b/i)[0]
    .replace(/^(?:to\s+)?(?:the\s+)?/i, '')
    .replace(/[’']s$/i, '')
    .replace(/[\s,.!]+$/, '')
    .trim()
  if (payee === '') return null
  return { payee, amount: found?.amount, reference: invoice !== null ? `${payee} ${invoice[1].toLowerCase()}` : '' }
}

export const isPayCommand = (text: string) => parsePay(text) !== null

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The saved payees a spoken name means: exactly that name, else the names it starts (“ACME” is “ACME Ltd”). */
export function payeesCalled(payees: OutsidePayee[], said: string): OutsidePayee[] {
  const n = norm(said)
  if (n === '') return []
  const exact = payees.filter((p) => norm(p.name) === n)
  return exact.length > 0 ? exact : payees.filter((p) => norm(p.name).startsWith(n))
}

/** A payee's own currency: a US routing number pays dollars, an IBAN outside the UK euros, anything else pounds. */
const currencyOf = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')

/** The read-back: the payee and the amount, and that nothing is paid yet. */
export function readBack(r: PaymentRequest): string {
  const it = r.items[0]
  if (it === undefined) return 'Nothing was prepared.'
  const what = `${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name}`
  return it.decision === 'blocked'
    ? `The payment of ${what} can’t be made: ${it.reason}.`
    : `I’ve prepared a payment of ${what}. Nothing is paid until you approve it with your passkey.`
}

export function PayCard({
  command,
  voice,
  amount,
  onAmount,
  say,
  onClose,
}: {
  command: string
  /** Said rather than typed: Lens always asks for approval, and the card speaks. */
  voice: boolean
  amount: Amount | undefined
  onAmount: (a: Amount) => void
  say: (words: string) => void
  onClose: () => void
}) {
  const [ask] = useState(() => parsePay(command))
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const matches = ask === null ? [] : payeesCalled(payees.data?.payees ?? [], ask.payee)
  const [chosen, setChosen] = useState<string | null>(null)
  const payee = matches.length === 1 ? matches[0] : matches.find((p) => p.id === chosen)
  const [typed, setTyped] = useState('')
  // One key per card: the same payment prepared twice is one request (Lens B40.3).
  const [key] = useState(newMoveKey)
  const prepare = useMutation({
    mutationFn: ({ to, much }: { to: OutsidePayee; much: Amount }) =>
      agentBankApi.prepareRequest(
        { voice, items: [{ payee_id: to.id, currency: much.currency ?? currencyOf(to), amount_minor: much.minor, reference: ask?.reference ?? '' }] },
        key,
      ),
    onSuccess: (r) => (voice ? say(readBack(r)) : undefined),
  })
  const prepared = useQuery({
    queryKey: paymentRequestKey(prepare.data?.id ?? ''),
    queryFn: () => agentBankApi.paymentRequest(prepare.data?.id ?? ''),
    enabled: false,
    initialData: prepare.data,
  })

  const started = useRef(false)
  useEffect(() => {
    if (payee === undefined || amount === undefined || started.current) return
    started.current = true
    prepare.mutate({ to: payee, much: amount })
  }, [amount, payee, prepare])
  const asked = useRef(false)
  useEffect(() => {
    if (!voice || payee === undefined || amount !== undefined || asked.current) return
    asked.current = true
    say(`How much should I pay ${payee.name}?`)
  }, [amount, payee, say, voice])

  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const request = prepared.data ?? prepare.data
  return (
    <div ref={top} className="flex flex-col gap-3">
      <Card data-testid="chat-pay">
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-caption text-muted">
            {voice ? 'You said' : 'You asked'} “{command.trim()}”
          </p>
          {payees.isError ? (
            <p className="text-body text-ink">Your saved payees could not be read just now, so nothing was prepared.</p>
          ) : payees.isPending ? (
            <p className="text-body text-muted">Finding {ask?.payee}…</p>
          ) : matches.length === 0 ? (
            <p className="text-body text-ink">
              No saved payee is called “{ask?.payee}”. Chat pays only payees you saved yourself.{' '}
              <Link className={inlineLink} to="/pay">
                Save one on Pay
              </Link>
            </p>
          ) : payee === undefined ? (
            <div className="flex flex-col gap-2">
              <p className="text-body text-ink">More than one saved payee is called “{ask?.payee}”. Which one?</p>
              <div className="flex flex-wrap gap-2">
                {matches.map((p) => (
                  <Button key={p.id} type="button" onClick={() => setChosen(p.id)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : amount === undefined ? (
            <form
              className="flex flex-col gap-2 wide:flex-row wide:items-center"
              onSubmit={(e) => {
                e.preventDefault()
                const minor = minorOf(typed)
                if (minor !== null) onAmount({ minor })
              }}
            >
              <label htmlFor="chat-pay-amount" className="text-body text-ink">
                How much should I pay {payee.name}?
              </label>
              <Input
                id="chat-pay-amount"
                inputMode="decimal"
                className="font-figure wide:w-32"
                placeholder={formatMinor(0, currencyOf(payee))}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <Button type="submit" disabled={minorOf(typed) === null}>
                Prepare
              </Button>
            </form>
          ) : prepare.isError ? (
            <p className="text-body text-ink" role="alert">
              Nothing was prepared: {refusalText(prepare.error)}
            </p>
          ) : request === undefined ? (
            <p className="text-body text-muted">Preparing the payment…</p>
          ) : (
            <p className="text-body text-ink" role="status" data-testid="chat-pay-readback">
              {readBack(request)}
            </p>
          )}
          <div>
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Card>
      {request !== undefined && request.status !== 'blocked' ? <ApprovalCard id={request.id} request={request} /> : null}
    </div>
  )
}
