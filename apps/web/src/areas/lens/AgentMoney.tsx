import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Dialog, Icon, KindTile, Money, pocketFocusRing, type IconName } from '@talyvor/ui/pocket'
import { IfArea } from '../../lib/workspaceAreas'
import { walletKey, AgentMoneyWalletCard } from './AgentMoneyWallet'
import { type Agent, agentBankApi, useAccount } from './agentBankApi'
import { CASH_OUTS_KEY, CashOutCard, CashOuts, ESCROWS_KEY, Escrows, PayIntoEscrow, Portfolios, Pots, potsKey } from './WalletHoldings'
import {
  AgentAddress,
  AgentTransfers,
  CREDIT_KEY,
  CreditLinePanel,
  Loans,
  MoneyRequests,
  OfferLoan,
  REQUESTS_KEY,
  RecurringTransfer,
  SendAndRequest,
  transfersKey,
} from './WalletMoney'

// AgentMoney.tsx — B57.21: an agent's money features, on its page, as Pocket's w-agent-research draws its Money card.
// One row per feature, its state in the line under it, each opening its own panel: the same forms, lists and rules the
// agent view had (WalletMoney.tsx, WalletHoldings.tsx, AgentMoneyWallet.tsx), each posting what it posted before.
// Lending is credit's and the simulated portfolios are trading's (B59.2): a workspace without the area has no row.

const BOOK_KEY = ['agent-book']

type Panel = 'address' | 'send' | 'requests' | 'transfers' | 'recurring' | 'pots' | 'escrow' | 'cash-out' | 'loans' | 'credit' | 'wallet' | 'investing'

/**
 * A row of the Money card: the whole row opens its panel. The button's name is the title alone; the line under it
 * describes it, and an empty layer inside the button covers the row, so a press anywhere on it opens the panel.
 */
function MoneyRow({ icon, title, line, onOpen, testId }: { icon: IconName; title: string; line: React.ReactNode; onOpen: () => void; testId: string }) {
  const id = useId()
  return (
    <div className="relative flex items-center gap-3 border-t border-line py-2.5 text-reading first:border-t-0">
      <KindTile on="white" icon={<Icon name={icon} size={18} />} />
      <span className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} data-testid={testId} aria-describedby={id} className={`block rounded-control text-left font-semibold text-ink ${pocketFocusRing}`}>
          <span aria-hidden="true" className="absolute inset-0" />
          {title}
        </button>
        <span id={id} className="block text-body text-ink-3">
          {line}
        </span>
      </span>
      <Icon name="chev" size={16} className="shrink-0 text-ink-3" />
    </div>
  )
}

/** ". None yet" once a list is read empty, nothing while it is read or could not be. */
const emptied = (read: { isSuccess: boolean }, n: number, words: string) => (read.isSuccess && n === 0 ? `. ${words}` : '')

/** The agent's Money card and the panel open from it. */
export function AgentMoneySection({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState<Panel | null>(null)
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? [agent]
  const { shows } = useAccount()
  const id = agent.id
  const name = agent.name
  // Each row's line says where the feature stands; the panel reads the same keys, so opening it reads nothing again.
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: agentBankApi.moneyRequests })
  const transfers = useQuery({ queryKey: transfersKey(id), queryFn: () => agentBankApi.transfers(id) })
  const pots = useQuery({ queryKey: potsKey(id), queryFn: () => agentBankApi.pots(id) })
  const escrows = useQuery({ queryKey: ESCROWS_KEY, queryFn: agentBankApi.escrows })
  const cashOuts = useQuery({ queryKey: CASH_OUTS_KEY, queryFn: agentBankApi.cashOuts })
  const credit = useQuery({ queryKey: CREDIT_KEY, queryFn: agentBankApi.creditLine })
  const wallet = useQuery({ queryKey: walletKey(id), queryFn: () => agentBankApi.wallet(id) })
  const nRequests = (requests.data?.requests ?? []).filter((r) => r.from_agent_id === id || r.to_agent_id === id).length
  const nTransfers = (transfers.data?.transfers ?? []).length
  const nPots = (pots.data?.pots ?? []).length
  const nEscrows = (escrows.data?.escrows ?? []).filter((e) => e.payer_agent_id === id || e.payee_agent_id === id).length
  const nCashOuts = (cashOuts.data?.cash_outs ?? []).filter((c) => c.agent_id === id).length
  const close = () => setOpen(null)
  const panel = (key: Panel, title: string, body: React.ReactNode) => (
    <Dialog open={open === key} onClose={close} title={title} className="max-h-screen overflow-y-auto">
      {body}
    </Dialog>
  )
  return (
    <Card tone="white" data-design="pocket" className="grid content-start gap-2" data-testid="agent-page-money">
      <h2 className="font-display text-reading font-bold text-ink">Money</h2>
      <div>
        <MoneyRow testId="money-row-address" icon="key" title="Its address" line={`Anyone on Talyvor can send ${name} credits at its wallet ID or @handle`} onOpen={() => setOpen('address')} />
        <MoneyRow
          testId="money-row-send"
          icon="send"
          title="Send or request"
          line={`To or from any agent on Talyvor. Credits stay credits; sending is judged by ${name}’s rules`}
          onOpen={() => setOpen('send')}
        />
        <MoneyRow
          testId="money-row-requests"
          icon="bell"
          title="Requests"
          line={`What other agents ask of ${name}, to accept or decline${emptied(requests, nRequests, 'None yet')}`}
          onOpen={() => setOpen('requests')}
        />
        <MoneyRow
          testId="money-row-transfers"
          icon="arrow"
          title="Transfers"
          line={transfers.isSuccess && nTransfers === 0 ? `${name} has not sent or received a transfer yet` : `What ${name} sent to and received from other agents`}
          onOpen={() => setOpen('transfers')}
        />
        <MoneyRow
          testId="money-row-recurring"
          icon="clock"
          title="Recurring transfer"
          line="Pay any agent on Talyvor the same amount every day, week or month"
          onOpen={() => setOpen('recurring')}
        />
        <MoneyRow
          testId="money-row-pots"
          icon="coin"
          title="Pots"
          line={`Credits ${name} sets aside for a goal, a budget or a reserve${emptied(pots, nPots, 'No pots yet')}`}
          onOpen={() => setOpen('pots')}
        />
        <MoneyRow
          testId="money-row-escrow"
          icon="shield"
          title="Escrow"
          line={`Credits held until you confirm the work was delivered${emptied(escrows, nEscrows, 'Nothing in escrow')}`}
          onOpen={() => setOpen('escrow')}
        />
        <MoneyRow
          testId="money-row-cash-out"
          icon="download"
          title="Cash out"
          line={`Turn ${name}’s credits back into money. Only the workspace’s owner can ask${emptied(cashOuts, nCashOuts, 'No cash-outs yet')}`}
          onOpen={() => setOpen('cash-out')}
        />
        <IfArea area="credit">
          <MoneyRow
            testId="money-row-loans"
            icon="billing"
            title="Loans"
            line="Offer a loan to another company’s agent, repaid in instalments"
            onOpen={() => setOpen('loans')}
          />
        </IfArea>
        <MoneyRow
          testId="money-row-credit"
          icon="card"
          title="Credit line"
          line={
            credit.isSuccess && credit.data === null ? (
              'This workspace has no credit line'
            ) : credit.data ? (
              <>
                Your agents may spend up to <Money ulxc={credit.data.limit_ulxc} /> past zero
              </>
            ) : (
              'What your agents may spend past zero, and its monthly invoices'
            )
          }
          onOpen={() => setOpen('credit')}
        />
        <MoneyRow
          testId="money-row-wallet"
          icon="payments"
          title="Its wallet"
          line={
            wallet.data ? (
              <>
                {name} holds <Money minor={wallet.data.balance_minor} currency="USDC" />: add money to it{shows?.bankTransfers ? ', or send to a saved payee' : ''}
              </>
            ) : (
              `What ${name} holds, and how to add money to it`
            )
          }
          onOpen={() => setOpen('wallet')}
        />
        <IfArea area="trading">
          <MoneyRow
            testId="money-row-investing"
            icon="spending"
            title="Investing, simulated"
            line="Portfolios of simulated US dollars at real prices. No credits move"
            onOpen={() => setOpen('investing')}
          />
        </IfArea>
      </div>
      {panel('address', `${name}’s address`, <AgentAddress agent={agent} />)}
      {panel('send', 'Send or request', <SendAndRequest agent={agent} />)}
      {panel('requests', 'Requests', <MoneyRequests agents={agents} agentId={id} />)}
      {panel('transfers', 'Transfers', <AgentTransfers agent={agent} />)}
      {panel('recurring', 'Recurring transfer', <RecurringTransfer agent={agent} />)}
      {panel('pots', 'Pots', <Pots agent={agent} />)}
      {panel(
        'escrow',
        'Escrow',
        <>
          <PayIntoEscrow agent={agent} />
          <div className="border-t border-line pt-3">
            <Escrows agents={agents} agentId={id} />
          </div>
        </>,
      )}
      {panel(
        'cash-out',
        'Cash out',
        <>
          <CashOutCard agent={agent} />
          <div className="grid gap-3 border-t border-line pt-3">
            <h3 className="font-semibold text-ink">Cash-outs</h3>
            <CashOuts agents={agents} agentId={id} />
          </div>
        </>,
      )}
      {panel(
        'loans',
        'Loans',
        <>
          <OfferLoan agent={agent} />
          <div className="border-t border-line pt-3">
            <Loans agents={agents} agentId={id} />
          </div>
        </>,
      )}
      {panel('credit', 'Credit line', <CreditLinePanel />)}
      {panel('wallet', `${name}’s wallet`, <AgentMoneyWalletCard agent={agent} />)}
      {panel('investing', 'Investing, simulated', <Portfolios agent={agent} />)}
    </Card>
  )
}
