import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Crumb, Facts, Icon, Money, showToast, type ChipTone } from '@talyvor/ui/pocket'
import { ACTIVITY_FROM, activityTo, lineState, lineWho, statementKey } from './Activity'
import { BOOK_KEY, readFailure, saveFile } from './AgentBank'
import { lineWhen } from './AgentStatement'
import { accountOwner, kindWords } from './AccountStatement'
import { DisputePayment } from './CardDisputes'
import { receiptText } from './InstantTransferReceipt'
import { PaymentProofSection, paymentProofQuery } from './PaymentProof'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { agentBankApi } from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { CURRENCY_ACCOUNT } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

/**
 * B61.2 — /activity/<account>/<entry>: one payment, read from the same statement Activity lists it from.
 * B57.170 — drawn as the launch pack's P10 receipt: its state chip with its mark, the amount large, who, its facts, then
 * Done and Download receipt.
 * B62.3 — then the agent's task in its own words and the payment's proof (Lens B62.1), with a button that copies it.
 */
export function ActivityPaymentScreen() {
  const { account: accountID = '', entry = '' } = useParams()
  const to = activityTo()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const st = useQuery({ queryKey: statementKey(accountID, to), queryFn: () => agentBankApi.accountStatement(accountID, ACTIVITY_FROM, to) })
  useQuery(paymentProofQuery(entry)) // B62.3: read beside the statement, drawn below its facts
  const list = accounts.data?.accounts ?? []
  const agents = book.data?.agents ?? []
  const account = list.find((a) => a.id === accountID)
  const lines = (st.data?.lines ?? []).filter((l) => l.entry_id === entry)
  const l = lines[0]
  const amount = lines.reduce((sum, x) => sum + x.amount_minor, 0)
  const who = l ? lineWho(l, list, agents) : ''
  const [state, tone] = l ? lineState(l) : ['', 'plain' as ChipTone]
  const card = useRef<HTMLDivElement>(null)
  const download = () => {
    if (!card.current) return
    saveFile(`payment-${entry}.txt`, new Blob([receiptText(card.current, 'Payment receipt')], { type: 'text/plain' }))
    showToast('Downloading the receipt')
  }

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
          {/* What the receipt's file reads: the headline and the facts. */}
          <div ref={card} className="contents">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Chip tone={tone} data-receipt-line>
                {tone === 'good' ? <Icon name="check" size={14} /> : tone === 'bad' ? <Icon name="x" size={14} /> : null}
                {state}
              </Chip>
              <WorkspaceLabel capability={CURRENCY_ACCOUNT} />
            </div>
            <div className="grid gap-1">
              <p className="font-display text-pocket-balance-sm text-ink" data-receipt-line>
                <Money minor={amount} currency={account.currency} signed />
              </p>
              <p className="text-reading text-ink-2" data-receipt-line>
                {amount > 0 ? 'from' : 'to'} <span className="font-semibold text-ink">{who}</span>
              </p>
            </div>
            <Facts
              facts={[
                { label: 'What', value: kindWords(l.kind) },
                ...(l.memo ? [{ label: 'Reference', value: l.memo }] : []),
                { label: 'Account', value: `${accountOwner(account, agents)} · ${account.currency}` },
                { label: 'When', value: lineWhen(l.at) },
              ]}
            />
          </div>
          <PaymentProofSection entry={entry} task={l.task} />
          {l.kind === 'card_charge' && l.partner_ref ? (
            <DisputePayment paymentID={l.partner_ref} payment={{ what: who, when: lineWhen(l.at), minor: amount, currency: account.currency }} />
          ) : null}
          <div className="grid gap-2 wide:flex wide:flex-wrap">
            <Button asChild size="lg">
              <Link to="/activity">Done</Link>
            </Button>
            <Button type="button" size="lg" variant="secondary" onClick={download}>
              <Icon name="download" size={18} />
              Download receipt
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
