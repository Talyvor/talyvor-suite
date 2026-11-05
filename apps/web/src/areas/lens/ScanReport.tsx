import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CardHeader, Row, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { readFailure } from './WalletMoney'
import { type ScanReport, agentBankApi } from './agentBankApi'
import { REPORTS_KEY, day, familyName } from './Scan'

// ScanReport.tsx — B52.28: one published Scan report (Lens B52.33): the reading against its normal and its likely range,
// the four sections, its sources and the "How this report was made" box. Facts about the data, never advice.

/** The reading against its normal and its likely range on one scale, from the report's own figures; nothing when one lacks its value. */
function RangeChart({ r }: { r: ScanReport }) {
  const figure = (name: string) => (r.figures ?? []).find((f) => f.name === name)
  const [value, normalLow, normalHigh, likelyLow, likelyHigh] = ['value', 'normal_low', 'normal_high', 'outlook_low', 'outlook_high'].map((n) => figure(n)?.value)
  if (value === undefined || normalLow === undefined || normalHigh === undefined || likelyLow === undefined || likelyHigh === undefined) return null
  const lo = Math.min(value, normalLow, likelyLow)
  const hi = Math.max(value, normalHigh, likelyHigh)
  const pad = (hi - lo) * 0.08 || 1
  const at = (x: number) => ((x - lo + pad) / (hi - lo + 2 * pad)) * 100
  const text = (name: string) => figure(name)?.text ?? ''
  const unit = text('unit')
  const said = `Reading ${text('value')} ${unit} on ${text('at')}; normal ${text('normal_low')} to ${text('normal_high')}; likely ${text('outlook_low')} to ${text('outlook_high')} by ${text('outlook_at')}`
  return (
    <figure className="flex flex-col gap-2 px-4 py-3" data-testid="scan-report-chart">
      <div className="relative h-6" role="img" aria-label={said}>
        {/* positions are runtime values → inline style, not Tailwind arbitrary classes. */}
        <div className="absolute inset-x-0 top-3 h-px bg-rule" />
        <div className="absolute top-1 h-4 rounded-pill bg-rule-strong" style={{ left: `${at(normalLow)}%`, width: `${at(normalHigh) - at(normalLow)}%` }} />
        <div className="absolute top-2.5 h-1 rounded-pill bg-accent" style={{ left: `${at(likelyLow)}%`, width: `${at(likelyHigh) - at(likelyLow)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${at(value)}%` }} />
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-ink" aria-hidden />
          Reading <span className="font-figure text-ink">{text('value')}</span> {unit} on <span className="font-figure">{text('at')}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-pill bg-rule-strong" aria-hidden />
          Normal <span className="font-figure text-ink">{text('normal_low')}</span>–<span className="font-figure text-ink">{text('normal_high')}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-3 rounded-pill bg-accent" aria-hidden />
          Likely <span className="font-figure text-ink">{text('outlook_low')}</span>–<span className="font-figure text-ink">{text('outlook_high')}</span> by{' '}
          <span className="font-figure">{text('outlook_at')}</span>
        </span>
      </figcaption>
    </figure>
  )
}

export function ScanReportScreen() {
  const { id = '' } = useParams()
  const report = useQuery({ queryKey: [...REPORTS_KEY, 'one', id], queryFn: () => agentBankApi.scanReport(id) })
  const r = report.data?.report
  return (
    <RegionScreen>
      <Region index="00" label="Scan" heading="Scan report" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <Link to="/scan/reports" className={`text-body text-muted ${inlineLink}`}>
          Every Scan report
        </Link>
        {report.isError ? (
          <p className="text-body text-muted">{readFailure(report.error, 'This report')}</p>
        ) : r === undefined ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <Card data-testid="scan-report">
            <CardHeader>{r.title}</CardHeader>
            <p className="px-4 pt-3 text-caption text-muted">
              {familyName(r.family)} · published <span className="font-figure">{day(r.published_at)}</span>
            </p>
            <RangeChart r={r} />
            <Row stack label="What changed" hint={r.what_changed} />
            <Row stack label="Why it may matter" hint={r.why_it_matters} />
            <Row stack label="How confident" hint={r.confidence} />
            <Row stack label="What would change the view" hint={r.what_would_change} />
          </Card>
        )}
      </Region>
      {r === undefined ? null : (
        <>
          <Region index="01" label="Sources" heading="Sources" className="flex max-w-2xl flex-col gap-3">
            <ul className="flex flex-col gap-1 text-body text-ink" data-testid="scan-report-sources">
              {(r.sources ?? []).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Region>
          <Region index="02" label="Method" heading="How this report was made" className="flex max-w-2xl flex-col gap-3">
            <Card data-testid="scan-report-box">
              <Row stack label="Who made it" hint={r.box.made_by} />
              <Row stack label="The data and its licences" hint={(r.box.data ?? []).join('; ') || 'None named.'} />
              <Row stack label="The method" hint={r.box.method} />
              <Row stack label="The backtest" hint={r.box.backtest} />
              <Row stack label="Conflicts" hint={r.box.conflicts} />
              <Row
                stack
                label="Track record"
                hint={
                  <Link to="/scan/track-record" className={inlineLink}>
                    Every published report, its range and what happened
                  </Link>
                }
              />
            </Card>
          </Region>
        </>
      )}
    </RegionScreen>
  )
}
