import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { inlineLink } from '@talyvor/ui'
import { Card, Chip, Crumb, Facts, Money, type ChipTone } from '@talyvor/ui/pocket'
import { ACTIVITY_FROM, activityTo, lineState, lineWho, statementKey } from './Activity'
import { BOOK_KEY, readFailure } from './AgentBank'
import { lineWhen } from './AgentStatement'
import { accountOwner, kindWords } from './AccountStatement'
import { DisputePayment } from './CardDisputes'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { agentBankApi } from './agentBankApi'
import { formatWhen } from './format'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

/** B61.2 — /activity/<account>/<entry>: one payment, read from the same statement Activity lists it from. */
export function ActivityPaymentScreen() {
  const { account: accountID = '', entry = '' } = useParams()
  const to = activityTo()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const st = useQuery({ queryKey: statementKey(accountID, to), queryFn: () => agentBankApi.accountStatement(accountID, ACTIVITY_FROM, to) })
  const list = accounts.data?.accounts ?? []
  const agents = book.data?.agents ?? []
  const account = list.find((a) => a.id === accountID)
  const lines = (st.data?.lines ?? []).filter((l) => l.entry_id === entry)
  const l = lines[0]
  const amount = lines.reduce((sum, x) => sum + x.amount_minor, 0)
  const who = l ? lineWho(l, list, agents) : ''
  const [state, tone] = l ? lineState(l) : ['', 'plain' as ChipTone]

  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-2xl gap-4 px-gutter py-4 pb-10 wide:py-6">
      <Crumb trail={[{ label: 'Activity', href: '/activity' }, { label: who || 'Payment' }]} />
      {st.isError || accounts.isError ? (
        <p className="text-body text-ink-2">{readFailure(st.error ?? accounts.error, 'This payment')}</p>
      ) : st.isPending || accounts.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : !l || !account ? (
        <p className="text-body text-ink-2">
          We couldn’t find this payment.{' '}
          <Link className={`text-ink ${inlineLink}`} to="/activity">
            Back to Activity
          </Link>
        </p>
      ) : (
        <Card tone="white" className="grid gap-4" data-testid="activity-payment">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Chip tone={tone}>{state}</Chip>
            <WorkspaceLabel capability={CURRENCY_ACCOUNT} />
          </div>
          <div className="grid gap-1">
            <p className="font-display text-pocket-balance-sm text-ink">
              <Money minor={amount} currency={account.currency} signed />
            </p>
            <p className="text-reading text-ink-2">
              {amount > 0 ? 'from' : 'to'} <span className="font-semibold text-ink">{who}</span>
            </p>
          </div>
          <Facts
            facts={[
              { label: 'What', value: kindWords(l.kind) },
              ...(l.memo ? [{ label: 'Reference', value: l.memo }] : []),
              { label: 'Account', value: `${accountOwner(account, agents)} · ${account.currency}` },
              { label: 'When', value: formatWhen(l.at) },
            ]}
          />
          {l.kind === 'card_charge' && l.partner_ref ? (
            <DisputePayment paymentID={l.partner_ref} payment={{ what: who, when: lineWhen(l.at), minor: amount, currency: account.currency }} />
          ) : null}
        </Card>
      )}
    </div>
  )
}
