import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOME_RUNS_OUT } from '../src/bank.ts'

// B17.485 — agent-runs-out-date reads the run-out day from Home's agent row. Since B57.114 Home draws each row's line as
// <RunsOut testid="home-runs-out" />, so the row is `home-runs-out-<agent id>`; the scenario looked for the bare
// `runs-out-<agent id>` (Agent Wallets' line) and found no run-out day on Home for every user.
const web = (path: string) => readFileSync(new URL(`../../apps/web/src/areas/lens/${path}`, import.meta.url), 'utf8')

describe('agent-runs-out-date (B17.485)', () => {
  it('looks for the run-out line by the id Home gives it', () => {
    expect(web('Home.tsx')).toContain(`<RunsOut forecast={month} testid="${HOME_RUNS_OUT}" />`)
    expect(web('RunsOut.tsx')).toContain('data-testid={`${testid}-${forecast.agent_id}`}')
  })
})
