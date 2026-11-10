import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, CardHeader, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, Approvals, BOOK_KEY, PREPARED_KEY, Statement, StatementDownload } from './AgentBank'
import { agentBankApi, type Agent, type CurrencyAccount } from './agentBankApi'
import { AccountStatement, MarketplaceBill, accountTitle } from './AccountStatement'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { CurrencyPicker } from './money'
import { WorkspaceLabel } from '../../labels/workspace'
import { AGENT_CREDIT } from '../../labels/capabilities'

// B28.7 — the sidebar is wallet-first: Approvals and Statements are destinations of their own, not
// regions a person scrolls to inside Agent Wallets. Both read the same cache as Agent Wallets and Home,
// so a decision made on any of them is the figure the others show.

/** A tab that is on: the tint and a teal edge, as a pressed toggle on the wallet screens. */
const selected = 'aria-selected:border-accent aria-selected:bg-accent-tint'

function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

function useAgentNames() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  return { book, agents, nameOf: (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent' }
}

/** B28.45 — how often the sidebar asks again while the tab is showing. */
export const PENDING_POLL_MS = 10_000

/**
 * How many approvals and prepared payments are waiting for a person — the sidebar's badge. Null until it is known.
 * B28.45: live. An agent files an approval, or a person decides one from a push or another device,
 * with no click on this page — so the count is read again every PENDING_POLL_MS while the tab is
 * showing, and on coming back to it. B17.322: a read that fails keeps the last count and the polling,
 * so a busy minute does not freeze the badge; only a 401 or 403 verdict stops it.
 */
export function usePendingApprovals(): number | null {
  const poll = {
    refetchInterval: (q: { state: { error: unknown } }) => {
      const err = q.state.error
      return err instanceof ApiError && (err.status === 401 || err.status === 403) ? false : PENDING_POLL_MS
    },
    refetchOnWindowFocus: true,
  }
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals, ...poll })
  // B55.10 — a payment Chat or an assistant prepared waits for a person too, so the badge counts it.
  const prepared = useQuery({ queryKey: PREPARED_KEY, queryFn: agentBankApi.pendingPaymentRequests, ...poll })
  return list.data ? (list.data.approvals ?? []).filter((a) => a.status === 'pending').length + (prepared.data?.requests ?? []).length : null
}

export function ApprovalsScreen() {
  const { nameOf } = useAgentNames()
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Approvals"
        heading="What your agents are waiting on"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A request or payment waits here when it is above an agent’s approval amount. Approve it and the agent’s next
          identical request goes through, once; deny it and the request is refused.
        </p>
        <CurrencyPicker />
        <Approvals nameOf={nameOf} held={{}} onSent={() => {}} primary />
      </Region>
    </RegionScreen>
  )
}

/** B56.15 — one tab on Statements: an agent's or the room's wallet in LXC, or a currency account in its own currency. */
type StatementTab = { id: string; title: string; agent: Agent; account?: undefined } | { id: string; title: string; account: CurrencyAccount; agent?: undefined }

export function StatementsScreen() {
  const { book, agents, nameOf } = useAgentNames()
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const [params, setParams] = useSearchParams()
  // B56.15 — each agent's credits, then each room's wallet, then every currency account the company or an agent holds.
  const tabs: StatementTab[] = [
    ...agents.filter((a) => a.kind !== 'room').map((a) => ({ id: a.id, title: a.name, agent: a })),
    ...agents.filter((a) => a.kind === 'room').map((a) => ({ id: a.id, title: a.name, agent: a })),
    ...(accounts.data?.accounts ?? []).map((a) => ({ id: a.id, title: accountTitle(a, agents), account: a })),
  ]
  const tab = tabs.find((t) => t.id === params.get('wallet')) ?? tabs[0] ?? null
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Statements"
        heading="Every movement in every agent’s wallet"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <CurrencyPicker />
        {book.isError ? (
          <p className="text-body text-muted">{readFailure(book.error, 'The agents')}</p>
        ) : book.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : agents.length === 0 ? (
          <p className="text-body text-muted">
            No agents yet.{' '}
            <Link className={`text-ink ${inlineLink}`} to="/agents">
              Create one on Agent Wallets
            </Link>
            ; its statement starts the first time its wallet is funded.
          </p>
        ) : (
          <Card>
            <CardHeader aside={<WorkspaceLabel capability={AGENT_CREDIT} />}>Statement for every agent</CardHeader>
            <StatementDownload agent={null} primary />
          </Card>
        )}
        {accounts.isError ? <p className="text-body text-muted">{readFailure(accounts.error, 'The currency accounts')}</p> : null}
        {tabs.length > 0 ? (
          <div role="tablist" aria-label="Statements" className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <Button
                key={t.id}
                role="tab"
                aria-selected={t.id === tab?.id}
                className={selected}
                onClick={() => setParams({ wallet: t.id }, { replace: true })}
              >
                {t.title}
              </Button>
            ))}
          </div>
        ) : null}
      </Region>
      {tab?.agent ? (
        <Region index="01" label={tab.title} className="flex max-w-2xl flex-col gap-3">
          <Statement key={tab.id} agent={tab.agent} nameOf={nameOf} />
          <MarketplaceBill key={`bill-${tab.id}`} agent={tab.agent} />
        </Region>
      ) : tab?.account ? (
        <Region index="01" label={tab.title} className="flex max-w-2xl flex-col gap-3">
          <AccountStatement key={tab.id} account={tab.account} title={tab.title} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}
