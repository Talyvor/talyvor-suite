import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { pressAll } from '../../test/pressEverything'
import { AgentSettings } from './AgentSettings'
import type { Agent } from './agentBankApi'
import { AppMoney } from './money'

// B57.22 — an agent's Settings, as Pocket's w-agent-research draws it: one row for each thing its owner can set or
// do, in the reference's order, each opening its form; Name and look and Archive open over the page.

const RESEARCH: Agent = { id: 'agt_research', name: 'Research', balance_ulxc: 16_500_000_000, spent_ulxc: 0, keys: ['key_1'], created_at: '2026-09-14T09:00:00Z', owner_user_id: 'usr_nick', verified: false, colour: 'cobalt', face: 'circle' }

const form = (name: string) => <p>{name} form</p>

function mount() {
  render(
    <QueryClientProvider client={queryClient}>
      <AppMoney>
        <BrowserRouter>
          <Routes>
            <Route
              path="/agents/:id"
              element={
                <AgentSettings
                  agent={RESEARCH}
                  onArchived={() => {}}
                  forms={{ keyForm: form('Key'), card: form('Card'), topUp: form('Top-up'), boost: form('Boost'), pay: form('Pay'), schedules: form('Schedules'), credential: form('Credential') }}
                />
              }
            />
            <Route path="*" element={<p>Elsewhere</p>} />
          </Routes>
        </BrowserRouter>
      </AppMoney>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

describe('an agent’s Settings (B57.22)', () => {
  it('draws a row for each thing the agent had, in the reference’s order, with what each says now', async () => {
    populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    window.history.pushState({}, '', '/agents/agt_research')
    mount()
    await settleQueries(queryClient, waitFor)
    const section = screen.getByTestId('agent-settings')
    const titles = Array.from(section.querySelectorAll('[data-testid^="agent-setting-"]')).map((r) => r.getAttribute('data-testid')?.replace('agent-setting-', ''))
    expect(titles).toEqual([
      'Name, description, colour and face',
      'Its key',
      'Its card',
      'Automatic top-up',
      'Limit boost',
      'Pay another agent',
      'Scheduled payments',
      'Prompt schedules',
      'Unusual spend',
      'Its credential',
      'Ownership',
      'Archive',
    ])
    expect(within(section).getByTestId('agent-setting-Name, description, colour and face')).toHaveTextContent('Research: cobalt, a circle face')
    expect(within(section).getByTestId('agent-setting-Ownership')).toHaveTextContent('Its owner is not verified yet')
    expect(within(section).getByTestId('agent-setting-Unusual spend').getAttribute('href')).toBe('/agents/agt_research/rules')
  })

  it('every control in it does something', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const report = await pressAll(
      async () => {
        queryClient.clear()
        window.history.pushState({}, '', '/agents/agt_research')
        mount()
        await settleQueries(queryClient, waitFor)
      },
      () => asked.length,
    )
    expect(report.pressed).toBe(11) // every row but Ownership, which says and does not open
    expect(report.dead).toEqual([])
  }, 300_000)
})
