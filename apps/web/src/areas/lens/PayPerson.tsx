import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Dialog, Eyebrow, Facts, Field, Icon, Input, Money, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { useAuthMeReader } from '../../lib/authMe'
import { typedMinor } from './AgentFunding'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { useKeys } from './AgentBank'
import { payPersonSigned } from './passkeys'
import { type CurrencyAccount, AgentBankError, agentBankApi, newMoveKey, refusalText } from './agentBankApi'

// PayPerson.tsx — B61.33: Pay, to a person on Talyvor, as Pocket Live's web `pay` and its panel draw it. One field takes
// their Talyvor name, phone number or email; Lens answers the person's shown name and nothing else (BFF B61.33, Lens
// B61.32), or its one answer for nobody found. Pay opens the panel: the amount, the account it leaves and a note, then
// one review and Send, signed with the account's passkey when Lens asks for it (the first payment to a person always
// is); the payment goes once under one key, renewed only after it is paid or when the payment changes. The people paid
// before are chips: Lens keeps only a hash of what the sender typed, so this browser keeps what was typed, by account.

/** Said when Lens finds nobody; Lens's own words, the same whatever the reason (economy.PersonNotFoundWords). */
export const NOBODY_FOUND = 'Nobody found. Check the name or number, or ask them to turn on being found in Settings.'

/** A person paid before, as this browser remembers them: what was typed, and the shown name Lens answered. */
export interface PaidPerson {
  to: string
  shown_name: string
}

const PAID_PREFIX = 'talyvor.people-paid.'
const PAID_KEPT = 8

/** The people paid before from the account `scope`, newest first; nothing when the browser keeps nothing. */
export function readPaidPeople(scope: string): PaidPerson[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PAID_PREFIX + scope) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PaidPerson[]).filter((p) => typeof p?.to === 'string' && typeof p?.shown_name === 'string') : []
  } catch {
    return []
  }
}

function rememberPaid(scope: string, person: PaidPerson): PaidPerson[] {
  const same = (p: PaidPerson) => p.to.toLowerCase() === person.to.toLowerCase()
  const next = [person, ...readPaidPeople(scope).filter((p) => !same(p))].slice(0, PAID_KEPT)
  try {
    window.localStorage.setItem(PAID_PREFIX + scope, JSON.stringify(next))
  } catch {
    // a browser that keeps nothing shows no chips; the payment is made all the same
  }
  return next
}

/** "Grace H." → "GH". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Initials({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-pill bg-cloud-2 font-bold text-ink', large ? 'h-12 w-12 text-reading' : 'h-9.5 w-9.5 text-body')}
    >
      {initials(name)}
    </span>
  )
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current text-ink-3" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 7l5 5-5 5" />
    </svg>
  )
}

/**
 * The "To a person" card on Pay: the field, what it found, and the chips of people paid before. accounts are the
 * account's own open accounts the payment can leave; owner names them ("Your account" or the company's name).
 */
export function PayToAPerson({ accounts, owner }: { accounts: CurrencyAccount[]; owner: string }) {
  const me = useAuthMeReader()
  const scope = me.data?.workspace_id ?? me.data?.user?.sub ?? (me.data?.mode === 'disabled' ? 'local' : '')
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<PaidPerson | null>(null)
  const [paying, setPaying] = useState<PaidPerson | null>(null)
  const [paid, setPaid] = useState<PaidPerson[]>([])
  useEffect(() => setPaid(scope ? readPaidPeople(scope) : []), [scope])
  const find = useMutation({
    mutationFn: (to: string) => agentBankApi.findPerson(to),
    onSuccess: (f, to) => setFound({ to, shown_name: f.shown_name }),
  })
  const look = (to: string) => {
    setTyped(to)
    setFound(null)
    if (to.trim() !== '') find.mutate(to.trim())
  }
  // Lens's words for nobody found, as it said them; the same words if it said none.
  const nobody = find.error instanceof AgentBankError && find.error.status === 404 ? find.error.sentence || NOBODY_FOUND : null
  return (
    <Card tone="white" data-testid="pay-a-person">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!find.isPending) look(typed)
        }}
      >
        <h2 className="font-display text-head font-bold text-ink">To a person</h2>
        {/* B57.182 — the reference's search pill: the placeholder names it, with the search mark before it. */}
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-ink-3">
            <Icon name="search" size={16} />
          </span>
          <Input
            aria-label="Name, phone number or email"
            placeholder="Name, phone number or email"
            className="rounded-pill pl-10 font-sans font-semibold"
            autoComplete="off"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              setFound(null)
              find.reset()
            }}
          />
        </span>
        {found === null ? (
          <div>
            <Button type="submit" variant="primary" disabled={find.isPending} disabledReason={typed.trim() === '' ? 'Type a name, phone number or email first.' : undefined}>
              {find.isPending ? 'Finding…' : 'Find'}
            </Button>
          </div>
        ) : (
          // The reference's row: the person found is the one control, and pressing it opens the panel.
          <button
            type="button"
            data-testid="pay-a-person-found"
            aria-label={`Pay ${found.shown_name}`}
            className={cn('-mx-2.5 flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-reading transition-colors duration-fast hover:bg-cloud-2', pocketFocusRing)}
            onClick={() => setPaying(found)}
          >
            <Initials name={found.shown_name} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{found.shown_name}</span>
              <span className="block text-body text-ink-3">On Talyvor</span>
            </span>
            <Chevron />
          </button>
        )}
        {find.isError ? (
          <p role="alert" className="flex items-start gap-1.5 text-body text-ink" data-testid="pay-a-person-nobody">
            <Icon name="x" size={16} />
            <span>{nobody ?? refusalText(find.error)}</span>
          </p>
        ) : null}
        {paid.length > 0 ? (
          <div className="grid gap-2 border-t border-line pt-3">
            <Eyebrow>Paid before</Eyebrow>
            <span className="flex flex-wrap gap-2" data-testid="pay-a-person-paid">
              {paid.map((p) => (
                <button
                  key={p.to}
                  type="button"
                  className={cn('inline-flex h-8.5 items-center gap-2 rounded-pill bg-cloud-2 pl-1 pr-3.5 text-body font-semibold text-ink', pocketFocusRing)}
                  aria-label={`Pay ${p.shown_name} again`}
                  onClick={() => look(p.to)}
                >
                  <span aria-hidden="true" className="inline-grid h-6.5 w-6.5 place-items-center rounded-pill bg-page text-label font-bold">
                    {initials(p.shown_name)}
                  </span>
                  {p.shown_name}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </form>
      {paying !== null ? (
        <PayPersonDialog
          person={paying}
          accounts={accounts}
          owner={owner}
          onPaid={(p) => {
            if (scope) setPaid(rememberPaid(scope, p))
          }}
          onClose={() => {
            setPaying(null)
            setFound(null)
            setTyped('')
          }}
        />
      ) : null}
    </Card>
  )
}

/** The panel: the amount, the account it leaves and a note; one review; Send; then Sent. */
export function PayPersonDialog({
  person,
  accounts,
  owner,
  onPaid,
  onClose,
}: {
  person: PaidPerson
  accounts: CurrencyAccount[]
  owner: string
  onPaid: (p: PaidPerson) => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const keys = useKeys()
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [step, setStep] = useState<'amount' | 'review'>('amount')
  const fromID = useId()
  const [key, setKey] = useState(newMoveKey)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const currency = account?.currency ?? ''
  const minor = currency ? typedMinor(amount, currency) : null
  // Another payment is another key: a retry of this one keeps it, so it is paid once.
  useEffect(() => setKey(newMoveKey()), [accountID, minor, note])
  const pay = useMutation({
    mutationFn: () =>
      payPersonSigned({ to: person.to, amount_minor: minor ?? 0, currency, account_id: account?.id ?? '', note: note.trim(), idempotency_key: key }),
    onSuccess: () => {
      onPaid(person)
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const name = person.shown_name
  const sent = pay.isSuccess ? pay.data : null
  const send = keys.thisBrowserSigns ? 'Send with your passkey' : 'Send'
  const firstKey = pay.isError && pay.error instanceof AgentBankError && pay.error.status === 403 && /passkey/.test(pay.error.sentence)
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        sent ? (
          'Sent'
        ) : (
          // The reference's head: their initials, then Pay and their name; the initials are not read, so the panel is
          // named "Pay <name>".
          <span className="flex items-center gap-3">
            <Initials name={name} large />
            {`Pay ${name}`}
          </span>
        )
      }
      actions={
        // One main action a step, full width as the reference stacks them: the main one first.
        sent ? (
          <Button type="button" className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : step === 'review' && minor !== null ? (
          <>
            <Button type="button" className="w-full" disabled={pay.isPending} onClick={() => pay.mutate()}>
              {pay.isPending ? 'Sending…' : send}
            </Button>
            <Button type="button" variant="secondary" className="w-full" disabled={pay.isPending} onClick={() => setStep('amount')}>
              Change something
            </Button>
          </>
        ) : (
          <Button
            type="button"
            className="w-full"
            disabledReason={account === undefined ? 'Open an account first.' : minor === null ? 'Add an amount first.' : undefined}
            onClick={() => setStep('review')}
          >
            Review
          </Button>
        )
      }
    >
      {sent ? (
        <div className="grid justify-items-center gap-3 py-6 text-center">
          <span aria-hidden="true" className="inline-grid h-14 w-14 place-items-center rounded-pill bg-ink text-page">
            <Icon name="check" size={28} />
          </span>
          <p className="text-reading text-ink-2" data-testid="pay-a-person-sent">
            <Money minor={sent.amount_minor} currency={sent.currency} /> to {sent.to_shown_name || name}. It is there now.
          </p>
        </div>
      ) : account === undefined ? (
        <p className="text-body text-ink-2" data-testid="pay-a-person-no-account">
          No currency account yet: open {owner === 'Your account' ? 'your account' : 'the company’s account'} on{' '}
          <Link className={`text-ink ${inlineLink}`} to="/money/invoices">
            Invoices
          </Link>
          , then pay from it here.
        </p>
      ) : step === 'review' && minor !== null ? (
        <div className="grid gap-3" data-testid="pay-a-person-review">
          <p className="text-body text-ink-3">On Talyvor</p>
          <Money size="sheet" minor={minor} currency={currency} />
          <Facts
            facts={[
              { label: 'From', value: `${owner} · ${currency}` },
              { label: 'Arrives', value: 'In seconds' },
              { label: 'Fee', value: <Money minor={0} currency={currency} /> },
              { label: 'They get', value: <Money minor={minor} currency={currency} /> },
              ...(note.trim() ? [{ label: 'Note', value: note.trim() }] : []),
            ]}
          />
          {pay.isError ? (
            <div className="grid gap-2">
              <p role="alert" className="flex items-start gap-1.5 text-body text-danger" data-testid="pay-a-person-refused">
                <Icon name="x" size={16} />
                <span>{refusalText(pay.error)}</span>
              </p>
              {firstKey ? (
                <div>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/approvals">Approvals and devices</Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-body text-ink-3" data-testid="pay-a-person-who">
            On Talyvor
          </p>
          {/* The reference's amount: the figure itself, large, with its currency beside it and the line under it. */}
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <input
                aria-label={`Amount in ${currency}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className={cn('w-0 min-w-0 flex-1 rounded-control bg-page px-3.5 py-1 font-figure text-pocket-amount text-ink shadow-edge transition-colors duration-200 placeholder:text-faint hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50', pocketFocusRing)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="shrink-0 font-figure text-head text-ink-3">{currency}</span>
            </span>
            <span className="text-body text-ink-3">Type the amount</span>
          </span>
          <div className="grid gap-2">
            <Eyebrow id={fromID}>From</Eyebrow>
            <div role="radiogroup" aria-labelledby={fromID} className="grid gap-2" data-testid="pay-a-person-from">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    'relative grid min-w-0 cursor-pointer gap-0.5 rounded-card-tight bg-cloud py-3 pl-11 pr-3.5',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tangerine',
                    a.id === account.id && 'shadow-pick',
                  )}
                >
                  <input type="radio" name={fromID} className={cn('sr-only', pocketFocusRing)} checked={a.id === account.id} onChange={() => setAccountID(a.id)} />
                  <span aria-hidden="true" className={cn('absolute left-3.5 top-1/2 inline-grid h-5 w-5 -translate-y-1/2 place-items-center rounded-pill shadow-edge', a.id === account.id && 'bg-ink')}>
                    {a.id === account.id ? <span className="h-2 w-2 rounded-pill bg-page" /> : null}
                  </span>
                  <span className="font-semibold text-ink">
                    {owner} · {a.currency}
                  </span>
                  <span className="text-body text-ink-2">
                    Holds <Money minor={a.test_minor} currency={a.currency} />
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Field label="Note">
            <Input aria-label="Note" placeholder={`What ${name} sees`} className="font-sans" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
