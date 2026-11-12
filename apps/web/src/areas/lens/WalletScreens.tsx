import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { inlineLink } from '@talyvor/ui'
import { Button as PocketButton, Icon, Select, Tabs } from '@talyvor/ui/pocket'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, Approvals, BOOK_KEY, PREPARED_KEY, Statement } from './AgentBank'
import { AgentStatement, DownloadFailed, JOURNAL_SENTENCE, MONTH_FILE_TYPES, downloadWords, useMonthFile } from './AgentStatement'
import { agentBankApi, type Agent, type CurrencyAccount, type StatementFormat } from './agentBankApi'
import { AccountStatement, MarketplaceBill, accountTitle, useAccountMonthCsv } from './AccountStatement'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { CurrencyPicker } from './money'
import { DESIGN_ATTR } from '../../pocketPending'

// B28.7 — the sidebar is wallet-first: Approvals and Statements are destinations of their own, not
// regions a person scrolls to inside Agent Wallets. Both read the same cache as Agent Wallets and Home,
// so a decision made on any of them is the figure the others show.

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
  // B57.24 — an agent's tab is its statement as a document; B57.25 — so is a currency account's.
  const agentTab = tab?.agent && tab.agent.kind !== 'room' ? tab.agent : null
  const accountTab = tab?.account ?? null
  const everyAgent = useMonthFile(null)
  const thisAgent = useMonthFile(agentTab)
  // B57.112 — the file type both agent downloads save; a currency account's statement is Lens's CSV only.
  const [format, setFormat] = useState<StatementFormat>('csv')
  const thisAccount = useAccountMonthCsv(accountTab, tab?.title ?? '')
  // Pocket's tabs choose by their words, so two wallets of one name take the first's tab.
  const titles = [...new Set(tabs.map((t) => t.title))]
  return (
    <RegionScreen>
      <Region index="00" label="Statements" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-4xl flex-col gap-4">
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
          <div {...{ [DESIGN_ATTR]: 'pocket' }} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select aria-label="File type" className="w-auto" value={format} onChange={(e) => setFormat(e.target.value as StatementFormat)}>
                {MONTH_FILE_TYPES.map((t) => (
                  <option key={t.format} value={t.format}>
                    {t.words}
                  </option>
                ))}
              </Select>
              <PocketButton variant="secondary" disabled={everyAgent.isPending} onClick={() => everyAgent.mutate(format)}>
                Statement for every agent
              </PocketButton>
              {agentTab ? (
                <PocketButton variant="secondary" icon={<Icon name="download" />} disabled={thisAgent.isPending} onClick={() => thisAgent.mutate(format)}>
                  {downloadWords(format)}
                </PocketButton>
              ) : accountTab ? (
                <PocketButton variant="secondary" icon={<Icon name="download" />} disabled={thisAccount.isPending} onClick={() => thisAccount.mutate()}>
                  Download CSV
                </PocketButton>
              ) : null}
            </div>
            {/* B57.113 — B28.56's sentence for the journal, under the downloads it rides with. */}
            <p className="text-right text-micro text-ink-3">{JOURNAL_SENTENCE}</p>
            {everyAgent.isError ? <DownloadFailed error={everyAgent.error} /> : null}
            {thisAgent.isError ? <DownloadFailed error={thisAgent.error} /> : null}
            {thisAccount.isError ? <DownloadFailed error={thisAccount.error} /> : null}
          </div>
        )}
        {accounts.isError ? <p className="text-body text-muted">{readFailure(accounts.error, 'The currency accounts')}</p> : null}
        {tab ? (
          <div {...{ [DESIGN_ATTR]: 'pocket' }}>
            <Tabs
              label="Statements"
              tabs={titles}
              value={tab.title}
              onChange={(title) => setParams({ wallet: tabs.find((t) => t.title === title)?.id ?? '' }, { replace: true })}
            />
          </div>
        ) : null}
        {agentTab ? (
          <>
            <AgentStatement key={agentTab.id} agent={agentTab} nameOf={nameOf} />
            <MarketplaceBill key={`bill-${agentTab.id}`} agent={agentTab} />
          </>
        ) : accountTab ? (
          <AccountStatement
            key={accountTab.id}
            account={accountTab}
            agent={accountTab.purpose === 'agent' ? (agents.find((a) => a.id === accountTab.agent_id) ?? null) : null}
          />
        ) : null}
      </Region>
      {tab?.agent && !agentTab ? (
        <Region index="01" label={tab.title} className="flex max-w-2xl flex-col gap-3">
          <Statement key={tab.id} agent={tab.agent} nameOf={nameOf} />
          <MarketplaceBill key={`bill-${tab.id}`} agent={tab.agent} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}
