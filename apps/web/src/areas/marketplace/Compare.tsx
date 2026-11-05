import { useQueries } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Input, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { usdText } from '../rooms/roomsApi'
import { type Listing, type ListingTrust, type Offer, kindLabel, marketApi } from './marketApi'
import { readFailure } from './parts'

// Compare.tsx — B41.72: two to four listings side by side, each value read from that listing's own records — its
// offers (the price for the buyer's volume, worked out as Lens's Ask prices a pick, B41.171) and its trust panel
// (its rating, its last 30 days of uses from B41.173, its evaluation). The listings ride the address, so a
// comparison is a link that can be shared; Discover's Compare buttons build it.

export const COMPARE_MAX = 4

/** The listing ids a compare address names, in order, without repeats, four at most. */
export function compareIds(param: string | null): string[] {
  return [...new Set((param ?? '').split(',').filter(Boolean))].slice(0, COMPARE_MAX)
}

export const compareHref = (ids: readonly string[]) => `/marketplace/compare?ids=${ids.map(encodeURIComponent).join(',')}`

/** What volume uses cost on a listing's cheapest commercial offer, as Lens's market.estimate works it out. */
export function volumePrice(offers: readonly Offer[], volume: number): { total: number; basis: string } | null {
  if (!offers.length) return { total: 0, basis: 'free to use' }
  let best: { total: number; basis: string } | null = null
  for (const o of offers) {
    // A personal licence never covers an agent; an enterprise one is priced by seat.
    if (o.licence !== 'commercial') continue
    let n = 1
    let basis: string
    if (o.kind === 'per_use') {
      n = volume
      basis = `${volume.toLocaleString('en-US')} ${volume === 1 ? 'use' : 'uses'} at its per-use price`
    } else if (o.kind === 'buy') {
      basis = 'one purchase covers every use'
    } else {
      const what = o.kind === 'rent' ? 'rental' : 'subscription'
      const days = o.period_days ?? 0
      if (!o.included_uses) basis = `one ${days}-day ${what} covers every use`
      else {
        n = Math.ceil(volume / o.included_uses)
        basis = `${n} ${days}-day ${what}${n === 1 ? '' : 's'} of ${o.included_uses} uses each`
      }
    }
    const total = o.price_usd_micros * n
    if (best === null || total < best.total) best = { total, basis }
  }
  return best
}

const LICENCE_ORDER = ['personal', 'commercial', 'enterprise'] as const
const licenceText = (offers: readonly Offer[]) => {
  const have = LICENCE_ORDER.filter((x) => offers.some((o) => o.licence === x))
  return have.length ? have.map((x) => x[0].toUpperCase() + x.slice(1)).join(' · ') : 'Free to use, no licence'
}

const Fig = ({ children }: { children: React.ReactNode }) => <span className="font-figure">{children}</span>

/** One row of the table: what it compares, then each listing's value. */
function Line({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr className="border-t border-rule align-top">
      <th scope="row" className="px-gutter py-3 text-left text-caption font-normal text-muted">
        {label}
      </th>
      {cells.map((c, i) => (
        <td key={i} className="px-gutter py-3 text-body text-ink" data-testid={`compare-${label}`}>
          {c}
        </td>
      ))}
    </tr>
  )
}

export function Compare() {
  const [params, setParams] = useSearchParams()
  const ids = compareIds(params.get('ids'))
  const volume = Math.max(1, Number.parseInt(params.get('volume') ?? '1', 10) || 1)
  const setVolume = (v: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (v && v !== '1') next.set('volume', v)
        else next.delete('volume')
        return next
      },
      { replace: true },
    )
  const listings = useQueries({
    queries: ids.map((id) => ({ queryKey: ['market-listing', id, ''], queryFn: () => marketApi.listing(id) })),
  })
  const trusts = useQueries({
    queries: ids.map((id) => ({ queryKey: ['market-trust', id], queryFn: () => marketApi.trust(id) })),
  })
  const back = (
    <Link className={`text-ink ${inlineLink}`} to="/marketplace">
      Back to the marketplace
    </Link>
  )
  const body = () => {
    if (ids.length < 2)
      return (
        <p className="text-body text-muted" data-testid="compare-few">
          Pick two to four listings with Compare on Discover. {back}
        </p>
      )
    const failed = [...listings, ...trusts].find((q) => q.isError)
    if (failed)
      return (
        <p className="text-body text-muted">
          {readFailure(failed.error, 'A listing in this comparison')} {back}
        </p>
      )
    if (listings.some((q) => !q.data) || trusts.some((q) => !q.data)) return <p className="text-body text-muted">Reading…</p>
    const ls = listings.map((q) => q.data as Listing)
    const ts = trusts.map((q) => q.data as ListingTrust)
    return (
      <div className="overflow-x-auto rounded-card border border-rule bg-raised">
        <table className="w-full text-body" data-testid="compare-table">
          <thead>
            <tr>
              <td />
              {ls.map((l) => (
                <th key={l.id} scope="col" className="px-gutter py-3 text-left align-top font-normal">
                  <span className="block font-figure text-eyebrow uppercase text-label">{kindLabel(l.kind)}</span>
                  <Link className={`text-head text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(l.id)}`}>
                    {l.title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Line
              label={`Price for ${volume.toLocaleString('en-US')} ${volume === 1 ? 'use' : 'uses'}`}
              cells={ls.map((l) => {
                const p = volumePrice(l.offers ?? [], volume)
                if (p === null) return 'Enterprise licence only, priced by seat'
                return (
                  <span className="flex flex-col gap-0.5">
                    <Fig>{usdText(p.total)}</Fig>
                    <span className="text-caption text-muted">{p.basis}</span>
                  </span>
                )
              })}
            />
            <Line
              label="Rating"
              cells={ts.map((t) =>
                t.reviews.count > 0 ? (
                  <>
                    <Fig>{t.reviews.average.toFixed(2)}</Fig> of <Fig>5</Fig> from <Fig>{t.reviews.count}</Fig>{' '}
                    {t.reviews.count === 1 ? 'review' : 'reviews'}
                  </>
                ) : (
                  <span className="text-muted">No reviews yet</span>
                ),
              )}
            />
            <Line
              label="Success rate"
              cells={ts.map((t) => {
                const pf = t.performance
                if (!pf || pf.success_rate === null)
                  return <span className="text-muted">No uses in the last {pf?.days ?? 30} days</span>
                return (
                  <span className="flex flex-col gap-0.5">
                    <Fig>{`${Number((pf.success_rate * 100).toFixed(2))}%`}</Fig>
                    <span className="text-caption text-muted">
                      <Fig>{pf.failed}</Fig> of <Fig>{pf.uses}</Fig> uses failed in the last <Fig>{pf.days}</Fig> days
                    </span>
                  </span>
                )
              })}
            />
            <Line
              label="Latency"
              cells={ts.map((t) =>
                t.performance?.median_latency_ms != null ? (
                  <>
                    <Fig>{t.performance.median_latency_ms.toLocaleString('en-US')} ms</Fig>{' '}
                    <span className="text-caption text-muted">median</span>
                  </>
                ) : (
                  <span className="text-muted">No answered uses yet</span>
                ),
              )}
            />
            <Line label="Licence" cells={ls.map((l) => licenceText(l.offers ?? []))} />
            <Line
              label="Evaluation"
              cells={ts.map((t) =>
                t.eval ? (
                  <>
                    <Fig>{t.eval.passed}</Fig> of <Fig>{t.eval.cases}</Fig> cases passed
                  </>
                ) : (
                  <span className="text-muted">Not evaluated</span>
                ),
              )}
            />
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <Region
      index="00"
      label="Compare"
      heading="Compare listings"
      sectionClassName="pb-10 pt-4 wide:pb-12"
      fullWidth
      className="flex flex-col gap-4"
    >
      <label className="flex flex-wrap items-center gap-2 text-body text-ink">
        Uses you expect
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          className="w-32 font-figure"
          value={String(volume)}
          onChange={(e) => setVolume(e.target.value)}
        />
      </label>
      {body()}
    </Region>
  )
}
