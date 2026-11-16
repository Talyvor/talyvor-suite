import { useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@talyvor/ui'
import { Button, Chip, CloseX, Icon, Layer, pocketFocusRing } from '@talyvor/ui/pocket'
import { WorkspaceStatus } from '../../labels/workspace'
import { accountChip } from './agentBankApi'
import { ACCOUNTS_KEY, accountOf, readAccounts, switchAccount, type PersonAccount } from './accountsApi'
import { readFailure } from './WalletMoney'

// YourAccounts.tsx — B61.9: the sheet "Your accounts" (Pocket Live's sheet and panel `accounts`, launch-pack DESIGN.md
// P6). Each of the person's accounts with its avatar, name and chip, the current one marked, then "Open another account",
// which opens sign-up's steps on their own page (/accounts/new). Picking another row moves the session (the BFF's
// POST /api/accounts/switch, B61.8) and reloads Home with that account's words: every read is thrown away and asked
// again, so nothing of the account left behind is drawn in the new one.

/** The address that opens the sheet over whichever page it is on, as ?help=open opens Help. */
export const ACCOUNTS_PARAM = 'accounts'

/** sheet → the same page with the sheet open. */
export function withAccountsOpen(pathname: string, search: string): string {
  const q = new URLSearchParams(search)
  q.set(ACCOUNTS_PARAM, 'open')
  return `${pathname}?${q.toString()}`
}

export const OPEN_ANOTHER_PATH = '/accounts/new'
export const NOTE = 'Each account has one kind of money. Another kind is another account.'
const SWITCH_FAILED = 'That account didn’t open. Try again.'

/** Lens names a new workspace by its id (B55.39); a row never shows it. */
export const accountName = (a: { id: string; name: string }) => (!a.name || a.name === a.id ? 'Your workspace' : a.name)

/** The sheet, when the address asks for it. */
export function YourAccountsHost() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  if (new URLSearchParams(search).get(ACCOUNTS_PARAM) !== 'open') return null
  const close = () => {
    const q = new URLSearchParams(search)
    q.delete(ACCOUNTS_PARAM)
    const rest = q.toString()
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true })
  }
  return <YourAccounts onClose={close} />
}

function Row({ a, busy, onPick }: { a: PersonAccount; busy: boolean; onPick: () => void }) {
  const name = accountName(a)
  const kind = accountOf(a)
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        aria-current={a.current ? 'true' : undefined}
        data-testid="account-row"
        className={cn(
          'flex w-full items-center gap-3 rounded-card-tight p-3 text-left',
          a.current ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud',
          pocketFocusRing,
        )}
      >
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-tile bg-primary font-bold text-on-primary">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="grid min-w-0 flex-1 justify-items-start gap-1">
          <span className="max-w-full truncate text-reading font-semibold text-ink">{name}</span>
          {kind ? <Chip>{accountChip(kind)}</Chip> : null}
        </span>
        {a.current ? (
          <span className="flex items-center gap-1 text-body font-semibold text-ink">
            <Icon name="check" size={16} />
            Current
          </span>
        ) : (
          <Icon name="chev" size={16} className="text-ink-3" />
        )}
      </button>
    </li>
  )
}

export function YourAccounts({ onClose }: { onClose: () => void }) {
  const heading = useId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const accounts = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: readAccounts, retry: false })
  const [said, setSaid] = useState<string | null>(null)
  const move = useMutation({
    mutationFn: switchAccount,
    onSuccess: async () => {
      navigate('/', { replace: true })
      // The session is on the other account now: nothing read for the one it left is kept.
      await qc.resetQueries()
    },
    onError: () => setSaid(SWITCH_FAILED),
  })
  const pick = (a: PersonAccount) => {
    if (a.current) {
      onClose()
      return
    }
    setSaid(null)
    move.mutate(a.id)
  }
  return (
    <Layer labelledBy={heading} onClose={onClose}>
      <div className="relative grid w-full gap-4 rounded-t-sheet bg-page p-6 pb-8.5 shadow-pocket-lg wide:w-120 wide:rounded-card wide:pb-6">
        <CloseX onClose={onClose} className="absolute right-4 top-4" />
        <div className="flex items-center justify-between gap-3 pr-10">
          <h2 id={heading} className="font-display text-pocket-dialog text-ink">
            Your accounts
          </h2>
          <WorkspaceStatus />
        </div>
        {accounts.isPending ? (
          <p className="text-body text-ink-2">Reading…</p>
        ) : accounts.isError ? (
          <p className="text-body text-ink-2">{readFailure(accounts.error, 'Your accounts')}</p>
        ) : (
          <ul className="grid gap-2" aria-label="Your accounts">
            {accounts.data.map((a) => (
              <Row key={a.id} a={a} busy={move.isPending} onPick={() => pick(a)} />
            ))}
          </ul>
        )}
        {said ? (
          <p role="alert" className="flex items-center gap-1.5 text-body text-danger">
            <Icon name="x" size={16} />
            {said}
          </p>
        ) : null}
        <Button asChild variant="secondary">
          <Link to={OPEN_ANOTHER_PATH}>Open another account</Link>
        </Button>
        <p className="text-body text-ink-3">{NOTE}</p>
      </div>
    </Layer>
  )
}
