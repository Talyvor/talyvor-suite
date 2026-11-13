import { useQueries, useQuery } from '@tanstack/react-query'
import { CardHeader, Pill, Row } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatUSD } from './format'
import { readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { PAYEES_KEY, SCHEDULES_KEY } from './Pay'
import { LICENCES_KEY } from '../marketplace/Licences'
import { type Listing, type MarketLicence, marketApi } from '../marketplace/marketApi'
import { type AgentSchedule, agentBankApi, formatMinor } from './agentBankApi'
import { useLxcText } from './money'

// Subscriptions.tsx — B41.20: everything that charges again, in one list, soonest first — the payments Lens found recurring
// on a card or a payment out (B41.120), the standing orders an agent pays (B30.18) and the marketplace rentals and
// subscriptions that renew (B32.20). Each shows its next charge, what it costs a month, and the day a reminder is due:
// three days before it renews. From that day until it charges, the row says so.

export const SUBSCRIPTIONS_KEY = ['money-subscriptions']
/** Lens economy.RemindDaysBeforeRenewal: Lens's own subscriptions carry remind_on; the others are counted the same way. */
const REMIND_DAYS = 3
const DAY_MS = 86_400_000

interface Renewal {
  id: string
  what: string
  whose: string
  source: string
  every: string
  amount: string
  /** null: not known until the listing's offer is read */
  monthly: string | null
  next: Date
  remind: Date
}

const EVERY: Record<AgentSchedule['every'], string> = { hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly' }

/** A standing order's amount a month: a week is 52/12 of one, as Lens counts a weekly subscription. */
function orderMonthly(minor: number, every: AgentSchedule['every']): number {
  const perMonth = { hour: (24 * 365) / 12, day: 365 / 12, week: 52 / 12, month: 1 }[every]
  return Math.round(minor * perMonth)
}

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * DAY_MS)

export function SubscriptionsScreen() {
  const found = useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: agentBankApi.subscriptions })
  const schedules = useQuery({ queryKey: SCHEDULES_KEY, queryFn: agentBankApi.schedules })
  const licences = useQuery({ queryKey: LICENCES_KEY, queryFn: marketApi.licences })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const lxc = useLxcText()
  const money = (minor: number, currency: string) => (currency === 'LXC' ? lxc(minor) : formatMinor(minor, currency))
  const renewing = (licences.data ?? []).filter((l) => l.status === 'active' && l.auto_renew && l.kind !== 'buy' && l.ends_at !== null)
  // A rental's period and price are its offer's, on its listing.
  const listings = useQueries({
    queries: [...new Set(renewing.map((l) => l.listing_id))].map((id) => ({ queryKey: ['market-listing', id], queryFn: () => marketApi.listing(id) })),
  })
  const agentName = (id: string | undefined) => (!id ? 'Your own wallet' : (book.data?.agents.find((a) => a.id === id)?.name ?? 'An agent'))
  const payeeName = (id: string | undefined) => (payees.data?.payees ?? []).find((p) => p.id === id)?.name ?? 'A saved payee'
  const orders = (schedules.data?.schedules ?? []).filter((s) => s.to_payee_id && s.active && s.amount_minor && s.currency)

  const rows: Renewal[] = [
    ...orders.map((s): Renewal => {
      const next = new Date(s.next_run_at)
      return {
        id: `so-${s.id}`,
        what: payeeName(s.to_payee_id),
        whose: agentName(s.from_agent_id),
        source: 'Standing order',
        every: EVERY[s.every],
        amount: money(s.amount_minor ?? 0, s.currency ?? ''),
        monthly: money(orderMonthly(s.amount_minor ?? 0, s.every), s.currency ?? ''),
        next,
        remind: daysBefore(next, REMIND_DAYS),
      }
    }),
    ...renewing.map((l: MarketLicence): Renewal => {
      const listing = listings.find((q) => (q.data as Listing | undefined)?.id === l.listing_id)?.data as Listing | undefined
      const offer = listing?.offers?.find((o) => o.id === l.offer_id)
      const next = new Date(l.ends_at ?? '')
      const days = offer?.period_days ?? 0
      return {
        id: `lic-${l.id}`,
        what: l.title,
        whose: agentName(l.agent_id),
        source: l.kind === 'rent' ? 'Marketplace rental' : 'Marketplace subscription',
        every: days === 30 ? 'monthly' : days === 7 ? 'weekly' : days > 0 ? `every ${days} days` : '',
        amount: formatUSD(offer?.price_usd_micros ?? l.price_ulxc / 10),
        // shortcut: a month is 30 days for a rental, exact for the usual 30-day period; Lens could serve monthly_minor for rentals too.
        monthly: offer && days > 0 ? formatUSD(Math.round((offer.price_usd_micros * 30) / days)) : null,
        next,
        remind: daysBefore(next, REMIND_DAYS),
      }
    }),
    // Lens finds a standing order's own payments recurring too, once it has paid three: those are already listed above.
    ...(found.data?.subscriptions ?? [])
      .filter((f) => !orders.some((s) => s.from_agent_id === f.agent_id && s.currency === f.currency && s.amount_minor === f.amount_minor &&
        payeeName(s.to_payee_id).toLowerCase() === f.merchant.toLowerCase()))
      .map((f): Renewal => ({
        id: `sub-${f.agent_id ?? 'own'}-${f.merchant}-${f.currency}`,
        what: f.merchant,
        whose: agentName(f.agent_id),
        source: 'Card or payment',
        every: f.interval,
        amount: money(f.amount_minor, f.currency),
        monthly: money(f.monthly_minor, f.currency),
        next: new Date(f.next_at),
        remind: new Date(f.remind_on),
      })),
  ].sort((a, b) => a.next.getTime() - b.next.getTime())

  const now = Date.now()
  const dueSoon = rows.filter((r) => r.remind.getTime() <= now)
  const failed = [found, schedules, licences].find((q) => q.isError)
  // A rental's row waits for its listing: without the offer it would show no period and no monthly cost (B17.348).
  const pending = found.isPending || schedules.isPending || licences.isPending || listings.some((q) => q.isPending)
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Subscriptions"
        heading="Everything that charges again"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          The payments your agents and you make again and again (a card or a payment out that recurs, a standing order, a
          marketplace rental or subscription that renews), each with its next charge, what it costs a month, and a reminder three
          days before it renews.
        </p>
        {!pending ? (
          <p className="text-body text-ink" data-testid="subscriptions-count">
            <span className="font-figure">{rows.length}</span> {rows.length === 1 ? 'renews' : 'renew'}
            {dueSoon.length > 0 ? (
              <>
                , <span className="font-figure">{dueSoon.length}</span> in the next {REMIND_DAYS} days
              </>
            ) : null}
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Renewing" heading="Soonest first" className="flex max-w-2xl flex-col gap-3">
        {failed ? <p className="text-body text-muted">{readFailure(failed.error, 'Some of your subscriptions')}</p> : null}
        {pending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="text-body text-muted">
            Nothing renews yet. One appears here when you set up a standing order on Pay, rent a listing that renews in the
            Marketplace, or pay the same merchant the same amount three times on a schedule.
          </p>
        ) : (
          <Card>
            <CardHeader>Subscriptions</CardHeader>
            {rows.map((r) => {
              const left = Math.ceil((r.next.getTime() - now) / DAY_MS)
              return (
                <Row
                  key={r.id}
                  stack
                  data-testid={`subscription-${r.id}`}
                  label={r.what}
                  hint={
                    <>
                      {r.source} · {r.whose} · {r.amount}
                      {r.every ? ` ${r.every}` : ''}
                      <br />
                      Next charge <span className="font-figure">{day(r.next)}</span> ·{' '}
                      {r.monthly !== null ? (
                        <>
                          <span className="font-figure">{r.monthly}</span> a month ·{' '}
                        </>
                      ) : null}
                      Reminder <span className="font-figure">{day(r.remind)}</span>
                    </>
                  }
                >
                  {r.remind.getTime() <= now ? (
                    <Pill status="held">{left <= 0 ? 'Renews today' : `Renews in ${left} ${left === 1 ? 'day' : 'days'}`}</Pill>
                  ) : null}
                </Row>
              )
            })}
          </Card>
        )}
      </Region>
    </RegionScreen>
  )
}
