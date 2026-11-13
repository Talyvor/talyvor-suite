import { type SpendForecast } from './agentBankApi'

// B28.57 — when an agent's balance runs out at its pace so far this month, as Lens's forecast gives it (B28.330): the
// date in the agent's own time zone, runs_out_on, shown as that calendar date and never moved through this browser's
// zone, with the zone it is in. A forecast from a Lens that does not give the date yet shows nothing.

type AgentForecast = NonNullable<SpendForecast['agents']>[number]

// '2026-04-14' is '14 April 2026': a calendar date, read in UTC so no browser zone can move it a day.
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "runs out on 14 April 2026 (Australia/Sydney)", or "does not run out at this pace"; nothing when Lens has not said. */
export function RunsOut({ forecast }: { forecast: AgentForecast | undefined }) {
  if (forecast === undefined || forecast.runs_out_on === undefined) return null
  if (forecast.runs_out_on === null) return <span data-testid={`runs-out-${forecast.agent_id}`}>does not run out at this pace</span>
  return (
    <span data-testid={`runs-out-${forecast.agent_id}`}>
      runs out on{' '}
      <time dateTime={forecast.runs_out_on} className="font-figure">
        {DAY.format(Date.parse(`${forecast.runs_out_on}T00:00:00Z`))}
      </time>{' '}
      ({forecast.timezone ?? 'UTC'})
    </span>
  )
}
