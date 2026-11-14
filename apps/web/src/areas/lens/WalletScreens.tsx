import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { inlineLink } from '@talyvor/ui'
import { Button as PocketButton, Card, Chip, Face, Facts, Icon, Money, Row, Select, Tabs, pocketFocusRing, showSnack, type ChipTone } from '@talyvor/ui/pocket'
import { Region, RegionScreen } from '../../components/Region'
import { WorkspaceLabel, approvalCapability } from '../../labels/workspace'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, BOOK_KEY, DECIDED, MANDATE_REQUESTS_KEY, MandateRequestRow, PAYEE_KIND, PREPARED_KEY, PreparedRow, Statement, useKeys } from './AgentBank'
import { approvalDeclineTo, approvalSheetTo, expiresText } from './ApprovalSheet'
import { AgentStatement, DownloadFailed, JOURNAL_SENTENCE, MONTH_FILE_TYPES, downloadWords, useMonthFile } from './AgentStatement'
import { agentBankApi, type Agent, type AgentApproval, type CurrencyAccount, type StatementFormat } from './agentBankApi'
import { formatDecided } from './format'
import { signApproval } from './passkeys'
import { AccountStatement, MarketplaceBill, accountTitle, useAccountMonthCsv } from './AccountStatement'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { DESIGN_ATTR } from '../../pocketPending'
import { CardExport } from './CardDisputes'

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
  // B55.40 — and so does an agent's mandate request.
  const mandates = useQuery({ queryKey: MANDATE_REQUESTS_KEY, queryFn: agentBankApi.requestedMandates, ...poll })
  return list.data
    ? (list.data.approvals ?? []).filter((a) => a.status === 'pending').length +
        (prepared.data?.requests ?? []).length +
        (mandates.data?.granted ?? []).filter((m) => m.status === 'requested').length
    : null
}

/** B57.17 — Approvals in Pocket. */
export function ApprovalsScreen() {
  return <ApprovalsPage />
}

// B57.17 — /approvals as Pocket's w-approvals. What waits for the person (each agent's request and each
// payment Chat or an assistant prepared, with Review), the newest five decided with their date, how approving works, and a
// way to each agent's rules. Deciding happens in B57.15's sheet; a and d decide the focused row from the keyboard. The keys
// are on Approvals and devices (B57.43).

/** The newest this many decided approvals are listed. */
export const DECIDED_SHOWN = 5

const DECIDED_TONE: Record<string, ChipTone> = { approved: 'good', used: 'good', denied: 'bad', expired: 'bad' }

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// "Tomorrow at 09:17" inside a line: "expires tomorrow at 09:17", and "16 Nov" keeps its capital.
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** A card's title, as Pocket draws it (pocket.css .h3). */
function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-reading font-bold text-ink">{children}</h2>
}

/** What a request is, in words: its memo, the agent's reason, or the kind of thing it pays (B55.31). */
function whatOf(a: AgentApproval): string {
  if (a.memo) return a.memo
  if (a.reason) return a.reason
  if (a.model) return `A request to ${a.model}`
  return a.payee ? capital(`a payment to ${PAYEE_KIND[a.payee.kind] ?? 'an account'}`) : 'A payment'
}

/** Where it is paid from: "from its US dollar account", "on your monthly marketplace bill"; nothing when `what` says it already. */
function whereOf(a: AgentApproval, agentName: string, what: string): string | null {
  const from = a.paid_from
  if (!from) return null
  const own = `${agentName}’s `
  const where =
    from.kind === 'marketplace_bill' ? 'on your monthly marketplace bill' : `from ${from.name.startsWith(own) ? `its ${from.name.slice(own.length)}` : from.name}`
  return what.includes(where) ? null : where
}

/** The amount as the sheet shows it: an account in another currency pays its own amount; otherwise the LXC, dollars first. */
function amountOf(a: AgentApproval) {
  const from = a.paid_from
  return from?.kind === 'account' && from.currency !== 'USD' ? <Money minor={from.amount_minor} currency={from.currency} /> : <Money ulxc={a.amount_ulxc} />
}

/** "Research wants to pay Acme Hosting", the agent and a listing as links. */
function Asks({ a, agent, name }: { a: AgentApproval; agent: Agent | undefined; name: string }) {
  const uses = a.payee?.kind === 'listing' || (!a.payee && !!a.model)
  const payee = a.payee ? a.payee.name || a.payee.id : a.model
  return (
    <span className="whitespace-normal">
      {agent ? (
        <Link to={`/agents/${encodeURIComponent(a.agent_id)}`} className={inlineLink}>
          {name}
        </Link>
      ) : (
        name
      )}{' '}
      wants to {uses ? 'use' : 'pay'}
      {payee ? ' ' : null}
      {a.payee?.kind === 'listing' ? (
        <Link to={`/marketplace/listings/${encodeURIComponent(a.payee.id)}`} className={inlineLink}>
          {payee}
        </Link>
      ) : a.payee?.kind === 'agent' ? (
        <Link to={`/agents/${encodeURIComponent(a.payee.id)}`} className={inlineLink}>
          {payee}
        </Link>
      ) : (
        payee
      )}
    </span>
  )
}

function AgentFace({ a, agent, name, waiting }: { a: AgentApproval; agent: Agent | undefined; name: string; waiting: boolean }) {
  const face = <Face agent={agent ?? { id: a.agent_id, name }} state={agent?.paused_at ? 'asleep' : 'happy'} waiting={waiting} />
  return agent ? (
    <Link to={`/agents/${encodeURIComponent(a.agent_id)}`} aria-label={`Open ${name}`} tabIndex={-1} className="block leading-none">
      {face}
    </Link>
  ) : (
    face
  )
}

/** When a decided row was decided, or ran out unanswered (B55.41). */
const decidedAt = (a: AgentApproval) => a.decided_at ?? (a.status === 'expired' ? a.expires_at : undefined) ?? a.created_at

function ApprovalsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const prepared = useQuery({ queryKey: PREPARED_KEY, queryFn: agentBankApi.pendingPaymentRequests })
  // B55.40 — an agent's mandate request waits here too.
  const mandateRequests = useQuery({ queryKey: MANDATE_REQUESTS_KEY, queryFn: agentBankApi.requestedMandates })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const keys = useKeys()
  const agents = book.data?.agents ?? []
  const agentOf = (id: string) => agents.find((x) => x.id === id)
  const nameOf = (id: string) => agentOf(id)?.name ?? 'Your agent'

  const all = list.data?.approvals ?? []
  const waiting = all.filter((a) => a.status === 'pending')
  const requests = prepared.data?.requests ?? []
  const asked = (mandateRequests.data?.granted ?? []).filter((m) => m.status === 'requested')
  // The sidebar's badge counts the same three lists (usePendingApprovals).
  const count = waiting.length + requests.length + asked.length
  const decided = all
    .filter((a) => a.status !== 'pending')
    .sort((x, y) => Date.parse(decidedAt(y)) - Date.parse(decidedAt(x)))
    .slice(0, DECIDED_SHOWN)
  const decides = !keys.onlyThePhone && !keys.noLiveKey && !keys.hold

  // a approves the focused request, signed as the sheet signs it; the snack says what happens next, as the sheet's does.
  const approve = useMutation({
    mutationFn: async (a: AgentApproval) => agentBankApi.decide(a.id, 'approve', keys.signed ? await signApproval(a.id) : undefined),
    onSuccess: (_, a) =>
      showSnack({
        title: `Approved: ${a.payee ? a.payee.name || a.payee.id : a.model || 'the request'}`,
        line: `It goes through the next time ${nameOf(a.agent_id)} sends it, once, within 24 hours.`,
      }),
    onError: (err) =>
      showSnack({
        title:
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Cancelled. Nothing changed.'
            : isSessionExpired(err)
              ? 'Nothing was decided. Sign in again, then try once more.'
              : 'Nothing was decided. You can try again.',
      }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ]),
  })

  // j and k (or the arrows) move between the agents' requests; a approves, d opens the sheet on its Decline form.
  const onKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-approval]'))
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-approval]')
    if (!row || e.target !== row) return
    const a = waiting.find((x) => x.id === row.dataset.approval)
    const at = rows.indexOf(row)
    if (e.key === 'j' || e.key === 'ArrowDown') rows[Math.min(at + 1, rows.length - 1)]?.focus()
    else if (e.key === 'k' || e.key === 'ArrowUp') rows[Math.max(at - 1, 0)]?.focus()
    else if (a && decides && !approve.isPending && e.key === 'a') approve.mutate(a)
    else if (a && decides && e.key === 'd') navigate(approvalDeclineTo(location, a.id))
    else return
    e.preventDefault()
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-reading text-ink-2">
          A request or payment waits here when it is above an agent’s approval amount. Approve it and the agent’s next identical request goes through,
          once; decline it and the request is refused, and asking again the same way is refused for 24 hours.
        </p>
        {/* B57.43 — passkeys, the phone's key and notifications have their own page. */}
        <PocketButton asChild variant="secondary">
          <Link to="/settings/devices">Approvals and devices</Link>
        </PocketButton>
      </div>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid min-w-0 gap-4 wide:col-span-7">
          <Card tone="white" aria-label="Waiting for you">
            <div className="flex items-baseline justify-between gap-3">
              <Title>Waiting for you</Title>
              {list.isSuccess && prepared.isSuccess ? (
                <span className="text-body text-ink-3" data-testid="approvals-waiting">
                  {count === 0 ? (
                    'Nothing waiting'
                  ) : (
                    <>
                      <span className="font-figure">{count}</span> waiting
                    </>
                  )}
                </span>
              ) : null}
            </div>
            {list.isError ? (
              <p className="mt-2 text-body text-ink-2">
                {isSessionExpired(list.error) ? 'The approvals can’t be read until you sign in again.' : 'The approvals could not be read just now.'}
              </p>
            ) : list.isPending || prepared.isPending ? (
              <p className="mt-2 text-body text-ink-2">Reading…</p>
            ) : (
              <>
                {count > 0 ? (
                  <div role="group" aria-label="Waiting for you" className="mt-2" onKeyDown={onKeys}>
                    {waiting.map((a) => {
                      const agent = agentOf(a.agent_id)
                      const name = nameOf(a.agent_id)
                      return (
                        <div
                          key={a.id}
                          tabIndex={0}
                          data-approval={a.id}
                          // A request waiting for the person is their move: the face's tangerine dot has its reason.
                          data-tangerine="your-move"
                          id={`approval-${a.id}`}
                          className={`rounded-control border-t border-line first:border-t-0 ${pocketFocusRing}`}
                        >
                          <Row
                            wrap
                            leading={<AgentFace a={a} agent={agent} name={name} waiting />}
                            title={<Asks a={a} agent={agent} name={name} />}
                            line={
                              // Sandbox or live, as the prepared rows and the sheet say it (B56.11).
                              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                                <WorkspaceLabel capability={approvalCapability(a, (id) => !!agentOf(id))} />
                                <span>
                                  {[whatOf(a), whereOf(a, name, whatOf(a)), a.expires_at ? `expires ${lower(expiresText(a.expires_at))}` : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                            }
                            amount={amountOf(a)}
                            action={
                              <PocketButton asChild variant="secondary" size="sm" data-tangerine="your-move">
                                <Link to={approvalSheetTo(location, a.id)}>Review</Link>
                              </PocketButton>
                            }
                          />
                        </div>
                      )
                    })}
                    {requests.map((r) => (
                      <PreparedRow key={r.id} r={r} nameOf={nameOf} labelled />
                    ))}
                    {asked.map((m) => (
                      <MandateRequestRow
                        key={m.id}
                        m={m}
                        nameOf={nameOf}
                        onlyThePhone={keys.onlyThePhone}
                        hold={keys.hold}
                        onOutcome={(o) => showSnack({ title: o.text })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-body text-ink-3">
                    Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount, or when Chat or an assistant
                    prepares a payment.
                  </p>
                )}
                {prepared.isError ? <p className="mt-2 text-body text-ink-2">The prepared payments could not be read just now.</p> : null}
                {mandateRequests.isError ? <p className="mt-2 text-body text-ink-2">The mandate requests could not be read just now.</p> : null}
              </>
            )}
          </Card>
          {list.isSuccess ? (
            <Card aria-label="Decided">
              <Title>Decided</Title>
              {decided.length > 0 ? (
                <div className="mt-2" data-testid="approvals-decided">
                  {decided.map((a) => {
                    const agent = agentOf(a.agent_id)
                    const name = nameOf(a.agent_id)
                    const what =
                      a.status !== 'expired' ? whatOf(a) : a.decided_at ? 'Approved, but not used within 24 hours' : 'Not answered within 24 hours'
                    return (
                      <div key={a.id} data-decided={a.id} className="border-t border-line first:border-t-0">
                        <Row
                          wrap
                          leading={<AgentFace a={a} agent={agent} name={name} waiting={false} />}
                          title={<Asks a={a} agent={agent} name={name} />}
                          line={
                            <>
                              {what} · <span className="font-figure">{formatDecided(decidedAt(a))}</span>
                              {a.approved_by_agent_id ? ` by ${nameOf(a.approved_by_agent_id)}` : null}
                            </>
                          }
                          amount={amountOf(a)}
                          action={<Chip tone={DECIDED_TONE[a.status] ?? 'plain'}>{DECIDED[a.status]?.label ?? 'Closed'}</Chip>}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <p className="mt-2 text-caption text-ink-3">The newest five. A request lasts 24 hours, and so does an approval its agent has not used yet.</p>
            </Card>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-4 wide:col-span-5">
          <Card tone="white" aria-label="How you approve">
            <Title>How you approve</Title>
            <Facts
              className="mt-2"
              facts={[
                { label: 'On the web', value: 'With your passkey' },
                { label: 'On your phone', value: 'With Face ID' },
                { label: 'One approval covers', value: 'That payment only' },
                { label: 'If you decline', value: 'That request is refused, and asking again the same way is refused for 24 hours' },
              ]}
            />
            <p className="mt-3 text-caption text-ink-3">You can say why you declined; the agent sees it. Keys: a approves, d declines.</p>
          </Card>
          <Card aria-label="Ask less often">
            <Title>Ask less often</Title>
            <p className="mt-1 text-body text-ink-2">Raise an agent’s approval amount, or always allow a payee up to a limit, in its rules.</p>
            {agents.some((x) => !x.archived_at) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {agents
                  .filter((x) => !x.archived_at)
                  .map((x) => (
                    <PocketButton key={x.id} asChild variant="secondary" size="sm">
                      <Link to={`/agents/${encodeURIComponent(x.id)}/rules`}>{x.name}’s rules</Link>
                    </PocketButton>
                  ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
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
            {/* B59.25 — every card payment, dispute and refund of a date range, as one file. */}
            <div className="flex justify-end">
              <CardExport />
            </div>
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
