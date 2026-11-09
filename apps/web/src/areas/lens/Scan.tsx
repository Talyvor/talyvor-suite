import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { type ScanFinding, type ScanWatch, agentBankApi, parseLXC, refusalText } from './agentBankApi'
import { Lxc } from './money'

// Scan.tsx — B52.28: Scan in the app. The report library lists every published Scan report by family, and each report
// opens on its own page (ScanReport.tsx) with its chart, sources and how it was made (Lens B52.33). Scan agents watch the series their owner picks, with the owner's own idea of
// unusual, and send a short factual alert when one crosses it, paid from the agent's wallet (Lens B52.27). The track
// record shows every published Scan report's range and, once the reading arrives, whether it held (Lens B52.26).
// Facts about the data, never advice: nothing here buys, sells or links to a trade.

export const SCAN_WATCHES_KEY = ['scan-watches']
const TRACK_KEY = ['scan-track-record']
export const REPORTS_KEY = ['scan-reports']

// shortcut: mirrors the series Lens's collectors write that have a model (internal/scan Families); a Lens read of the
// modelled series would replace it once Lens serves one.
export const SCAN_DATASETS: readonly { id: string; name: string; regions: readonly [string, string][] }[] = [
  {
    id: 'gas-storage',
    name: 'EU gas storage (how full)',
    regions: [['eu', 'EU total'], ['de', 'Germany'], ['it', 'Italy'], ['nl', 'Netherlands'], ['fr', 'France'], ['at', 'Austria']].map(
      ([c, n]) => [`gie.agsi.${c}.full`, n] as [string, string],
    ),
  },
  {
    id: 'gas-flows',
    name: 'Gas flows into Europe',
    regions: [
      ['norway-emden', 'Norway to Germany (Emden)'],
      ['norway-dornum', 'Norway to Germany (Dornum)'],
      ['norway-st-fergus', 'Norway to Britain (St Fergus)'],
      ['norway-easington', 'Norway to Britain (Easington)'],
      ['algeria-mazara', 'Algeria to Italy (Transmed)'],
      ['algeria-almeria', 'Algeria to Spain (Medgaz)'],
      ['azerbaijan-tap', 'Azerbaijan to Italy (TAP)'],
      ['turkstream-strandzha', 'TurkStream to Bulgaria'],
      ['baltic-pipe-faxe', 'Norway to Poland (Baltic Pipe)'],
    ].map(([c, n]) => [`entsog.flow.${c}`, n] as [string, string]),
  },
  {
    id: 'oil',
    name: 'US oil stocks (weekly)',
    regions: [
      ['cushing-crude', 'Crude at Cushing, Oklahoma'],
      ['us-crude-ex-spr', 'US crude, outside the reserve'],
      ['us-crude-spr', 'US strategic reserve'],
      ['us-gasoline', 'US gasoline'],
      ['us-distillate', 'US distillate'],
    ].map(([c, n]) => [`eia.stocks.${c}`, n] as [string, string]),
  },
  {
    id: 'crops',
    name: 'US crop condition (share rated good)',
    regions: [
      ['ia.corn', 'Iowa corn'],
      ['ia.soybeans', 'Iowa soybeans'],
      ['il.corn', 'Illinois corn'],
      ['il.soybeans', 'Illinois soybeans'],
      ['ks.winter_wheat', 'Kansas winter wheat'],
    ].map(([c, n]) => [`crop.nass.${c}.condition.good`, n] as [string, string]),
  },
]

/** A series in words: its dataset's region name, or the series id where Scan's list does not name it. */
export function seriesName(series: string): string {
  for (const d of SCAN_DATASETS) {
    const r = d.regions.find(([s]) => s === series)
    if (r) return `${d.name} · ${r[1]}`
  }
  return series
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fig = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1 })
const ruleText = (w: Pick<ScanWatch, 'rule' | 'z'>) =>
  w.rule === 'range' ? 'outside its five-year range' : `more than ${w.z} standard deviations from its normal`

function FindingLine({ f }: { f: ScanFinding }) {
  return (
    <>
      <span className="font-figure">{fig(f.value)}</span> {f.unit} on <span className="font-figure">{day(f.at)}</span> · normal{' '}
      <span className="font-figure">{fig(f.normal_low)}</span>–<span className="font-figure">{fig(f.normal_high)}</span> · likely{' '}
      <span className="font-figure">{fig(f.outlook_low)}</span>–<span className="font-figure">{fig(f.outlook_high)}</span> by{' '}
      <span className="font-figure">{day(f.outlook_at)}</span>
    </>
  )
}

export function ScanAgentsScreen() {
  const qc = useQueryClient()
  const watches = useQuery({ queryKey: SCAN_WATCHES_KEY, queryFn: agentBankApi.scanWatches })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agentName = (id: string) => book.data?.agents.find((a) => a.id === id)?.name ?? 'A Scan agent'

  const [form, setForm] = useState({ name: '', dataset: SCAN_DATASETS[0].id, series: [] as string[], rule: 'range' as ScanWatch['rule'], z: '2', daily: '', monthly: '', fund: '' })
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))
  const dataset = SCAN_DATASETS.find((d) => d.id === form.dataset) ?? SCAN_DATASETS[0]
  const z = Number(form.z)
  const limit = (text: string) => (text.trim() === '' ? 0 : parseLXC(text))
  const daily = limit(form.daily)
  const monthly = limit(form.monthly)
  const fund = limit(form.fund)
  const ready =
    form.name.trim() !== '' && form.series.length > 0 && (form.rule === 'range' || z > 0) && daily !== null && monthly !== null && fund !== null

  const create = useMutation({
    mutationFn: async () => {
      const agent = await agentBankApi.create(form.name.trim())
      if (daily || monthly) {
        const rules = await agentBankApi.rules(agent.id)
        await agentBankApi.setRules(agent.id, { ...rules, daily_limit_ulxc: daily ?? 0, monthly_limit_ulxc: monthly ?? 0 })
      }
      if (fund) await agentBankApi.fund(agent.id, fund, crypto.randomUUID())
      return agentBankApi.scanWatch(agent.id, form.rule === 'range' ? { series: form.series, rule: 'range' } : { series: form.series, rule: 'z', z })
    },
    onSuccess: () => set({ name: '', series: [], daily: '', monthly: '', fund: '' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SCAN_WATCHES_KEY })
      void qc.invalidateQueries({ queryKey: BOOK_KEY })
    },
  })
  const stop = useMutation({ mutationFn: agentBankApi.stopScanWatch, onSuccess: () => void qc.invalidateQueries({ queryKey: SCAN_WATCHES_KEY }) })
  const list = watches.data?.watches ?? []

  return (
    <RegionScreen>
      <Region index="00" label="Scan" heading="Scan agents" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          A Scan agent watches the data you pick — gas storage, gas flows, oil stocks, crop condition — and tells you when a
          reading is unusual by your own measure. Each alert is a brief account of what the data did, with its sources, paid
          from the agent’s wallet within the limits you set. It says what happened, never what to do about it.
        </p>
      </Region>
      <Region index="01" label="Watching" heading="Your Scan agents" className="flex max-w-2xl flex-col gap-3">
        {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
        {watches.isError ? (
          <p className="text-body text-muted">{readFailure(watches.error, 'Your Scan agents')}</p>
        ) : watches.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">No Scan agent yet. Start one under New Scan agent below and it appears here with every alert it sends.</p>
        ) : (
          list.map((w) => (
            <Card key={w.id} data-testid={`scan-watch-${w.id}`}>
              <CardHeader>{agentName(w.agent_id)}</CardHeader>
              <Row
                stack
                label={w.series.map(seriesName).join('; ')}
                hint={
                  <>
                    Alerts when a reading is {ruleText(w)}. {w.active ? (w.last_refusal ? `Last run sent nothing: ${w.last_refusal}.` : 'Watching.') : 'Stopped.'}
                  </>
                }
              >
                {w.active ? (
                  <Button variant="danger" disabled={stop.isPending} onClick={() => stop.mutate(w.id)} aria-label={`Stop ${agentName(w.agent_id)}’s watch`}>
                    Stop
                  </Button>
                ) : null}
              </Row>
              {(w.alerts ?? []).length === 0 ? (
                <p className="px-4 py-3 text-caption text-muted">No alert yet. One appears here when a reading crosses this watch’s measure.</p>
              ) : (
                (w.alerts ?? []).map((a) => (
                  <Row
                    key={a.id}
                    stack
                    data-testid={`scan-alert-${a.id}`}
                    label={seriesName(a.series)}
                    hint={
                      <>
                        <FindingLine f={a.finding} />
                        <br />
                        {a.body}
                        <br />
                        Sources: {(a.attribution ?? []).join('; ') || 'none named'} · paid <Lxc ulxc={a.charged_ulxc} />
                      </>
                    }
                  />
                ))
              )}
            </Card>
          ))
        )}
      </Region>
      <Region index="02" label="New" heading="New Scan agent" className="flex max-w-2xl flex-col gap-3">
        <form
          className="flex flex-col gap-3"
          data-testid="new-scan-agent"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !create.isPending) create.mutate()
          }}
        >
          <Input aria-label="Agent name" placeholder="Name (Gas storage watch)" className="w-72" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          <select aria-label="Dataset" className={`${select} w-72`} value={form.dataset} onChange={(e) => set({ dataset: e.target.value, series: [] })}>
            {SCAN_DATASETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-caption text-muted">Regions</legend>
            {dataset.regions.map(([s, name]) => (
              <label key={s} className="flex items-center gap-2 text-body text-ink">
                <input
                  type="checkbox"
                  className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                  checked={form.series.includes(s)}
                  onChange={(e) => set({ series: e.target.checked ? [...form.series, s] : form.series.filter((x) => x !== s) })}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-caption text-muted">What counts as unusual</legend>
            <label className="flex items-center gap-2 text-body text-ink">
              <input type="radio" name="scan-rule" className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} checked={form.rule === 'range'} onChange={() => set({ rule: 'range' })} />
              Outside its five-year range
            </label>
            <label className="flex items-center gap-2 text-body text-ink">
              <input type="radio" name="scan-rule" className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} checked={form.rule === 'z'} onChange={() => set({ rule: 'z' })} />
              More than
              <Input aria-label="Standard deviations" className="w-16 font-figure" inputMode="decimal" value={form.z} onChange={(e) => set({ z: e.target.value, rule: 'z' })} />
              standard deviations from its normal
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Daily limit (LXC)" placeholder="Daily limit (LXC)" className="w-52 font-figure" inputMode="decimal" value={form.daily} onChange={(e) => set({ daily: e.target.value })} />
            <Input aria-label="Monthly limit (LXC)" placeholder="Monthly limit (LXC)" className="w-52 font-figure" inputMode="decimal" value={form.monthly} onChange={(e) => set({ monthly: e.target.value })} />
            <Input aria-label="Put in its wallet (LXC)" placeholder="Put in its wallet (LXC)" className="w-64 font-figure" inputMode="decimal" value={form.fund} onChange={(e) => set({ fund: e.target.value })} />
          </div>
          <p className="text-caption text-muted">Leave a limit empty for none. An agent with nothing in its wallet sends no alert until you fund it.</p>
          <div>
            <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
              {create.isPending ? 'Setting up…' : 'Start watching'}
            </Button>
          </div>
          {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
          {create.isSuccess ? <Note ok>Watching. Its alerts appear above.</Note> : null}
        </form>
      </Region>
    </RegionScreen>
  )
}

export function ScanTrackRecordScreen() {
  const track = useQuery({ queryKey: TRACK_KEY, queryFn: agentBankApi.scanTrackRecord })
  const records = track.data?.records ?? []
  return (
    <RegionScreen>
      <Region index="00" label="Scan" heading="Track record" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          Every Scan report ever published, with the range it gave and, once the reading for that date arrives, what happened.
          Hits and misses both stay here, and none is edited after it is published.
        </p>
        {track.data ? (
          <p className="text-body text-ink" data-testid="scan-track-summary">
            <span className="font-figure">{track.data.hits}</span> inside the range · <span className="font-figure">{track.data.misses}</span> outside ·{' '}
            <span className="font-figure">{track.data.waiting}</span> waiting for the reading
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Reports" heading="Published reports" className="flex max-w-2xl flex-col gap-3">
        {track.isError ? (
          <p className="text-body text-muted">{readFailure(track.error, 'The track record')}</p>
        ) : track.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : records.length === 0 ? (
          <p className="text-body text-muted">No report has been published yet. Each one appears here when it is published.</p>
        ) : (
          <Card>
            <CardHeader>Reports</CardHeader>
            {records.map((r) => (
              <Row
                key={r.report_id}
                stack
                data-testid={`scan-track-${r.report_id}`}
                label={r.title}
                hint={
                  <>
                    Published <span className="font-figure">{day(r.published_at)}</span> · read{' '}
                    <span className="font-figure">{fig(r.value)}</span> {r.unit} against a normal of{' '}
                    <span className="font-figure">{fig(r.normal_low)}</span>–<span className="font-figure">{fig(r.normal_high)}</span> · range{' '}
                    <span className="font-figure">{fig(r.outlook_low)}</span>–<span className="font-figure">{fig(r.outlook_high)}</span> for{' '}
                    <span className="font-figure">{day(r.outlook_at)}</span>
                    <br />
                    {r.hit === undefined ? (
                      'Waiting for the reading.'
                    ) : (
                      <>
                        Outcome <span className="font-figure">{fig(r.outcome ?? 0)}</span> {r.unit}: {r.hit ? 'inside the range' : 'outside the range'}.
                      </>
                    )}
                    <br />
                    Sources: {(r.sources ?? []).join('; ') || 'none named'}
                  </>
                }
              />
            ))}
          </Card>
        )}
      </Region>
    </RegionScreen>
  )
}

const FAMILIES: readonly [string, string][] = [['', 'All'], ['energy', 'Energy'], ['oil', 'Oil'], ['crops', 'Crops'], ['filings', 'Filings']]
export const familyName = (f: string) => FAMILIES.find(([id]) => id === f)?.[1] ?? f

export function ScanReportsScreen() {
  const [family, setFamily] = useState('')
  const reports = useQuery({ queryKey: [...REPORTS_KEY, family], queryFn: () => agentBankApi.scanReports(family) })
  const list = reports.data?.reports ?? []
  return (
    <RegionScreen>
      <Region index="00" label="Scan" heading="Scan reports" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          Brief reports on what energy, oil, crop and company-filing data did, each read against its normal, with its sources
          and how it was made. A person checks every report before it is published. They describe the data, never what to do
          about it.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Family">
          {FAMILIES.map(([id, name]) => (
            <Button key={id} aria-pressed={family === id} variant={family === id ? 'primary' : 'default'} onClick={() => setFamily(id)}>
              {name}
            </Button>
          ))}
        </div>
      </Region>
      <Region index="01" label="Library" heading="Published reports" className="flex max-w-2xl flex-col gap-3">
        {reports.isError ? (
          <p className="text-body text-muted">{readFailure(reports.error, 'The reports')}</p>
        ) : reports.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">
            No {family ? `${familyName(family).toLowerCase()} ` : ''}report has been published yet. Each one appears here when a person approves it.
          </p>
        ) : (
          <Card>
            <CardHeader>{family ? familyName(family) : 'Every family'}</CardHeader>
            {list.map((r) => (
              <Row
                key={r.id}
                stack
                data-testid={`scan-report-${r.id}`}
                label={
                  <Link to={`/scan/reports/${r.id}`} className={`text-ink ${inlineLink}`}>
                    {r.title}
                  </Link>
                }
                hint={
                  <>
                    {familyName(r.family)} · published <span className="font-figure">{day(r.published_at)}</span> · {(r.sources ?? []).join('; ') || 'no source named'}
                  </>
                }
              />
            ))}
          </Card>
        )}
      </Region>
    </RegionScreen>
  )
}
