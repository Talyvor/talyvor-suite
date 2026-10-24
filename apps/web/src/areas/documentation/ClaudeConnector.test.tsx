import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { COMPANY_CONTACT } from '../../company'
import { CLAUDE_CONNECTOR_PATH } from './content'
import listing from './claude-connector.json'

// B40.20 — the page Claude's connector directory links to opens signed out and carries what the directory asks for:
// the example prompts, every tool, privacy and a support contact. The privacy section it links to exists.

function openSignedOut(path: string) {
  queryClient.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).startsWith('/auth/me')
      ? new Response(JSON.stringify({ mode: 'oidc', authenticated: false, user: null, signup_open: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response('null', { status: 404 }),
  )
  window.history.pushState({}, '', path)
  return render(<App />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe(CLAUDE_CONNECTOR_PATH, () => {
  it('opens signed out with the prompts, every tool, the privacy section and a support contact', async () => {
    openSignedOut(CLAUDE_CONNECTOR_PATH)
    expect(await screen.findByRole('heading', { level: 1, name: 'Talyvor in Claude.' })).toBeInTheDocument()
    expect(screen.getByText('https://app.talyvor.com/mcp')).toBeInTheDocument()
    for (const p of ["What's due this week?", 'Prepare payment of my bills due Friday', 'Find a translation agent under £20 a month']) {
      expect(screen.getByText(`“${p}”`)).toBeInTheDocument()
    }
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.firstChild?.firstChild?.textContent)).toEqual(listing.tools.map((t) => t.name))
    expect(screen.getByRole('link', { name: 'Privacy › AI assistants you connect' })).toHaveAttribute('href', '/privacy#ai-assistants-you-connect')
    expect(screen.getByRole('link', { name: COMPANY_CONTACT })).toHaveAttribute('href', `mailto:${COMPANY_CONTACT}`)
    expect(screen.getByText('Preview — test money only')).toBeInTheDocument()
  })

  it('links to a privacy section that says what an assistant receives and what it cannot do', async () => {
    const { container } = openSignedOut('/privacy')
    await screen.findByRole('heading', { level: 1, name: /^privacy$/i })
    const section = container.querySelector<HTMLElement>('#ai-assistants-you-connect')
    expect(section).not.toBeNull()
    expect(within(section!).getByText(/No assistant can pay, approve, save a payee or sign a mandate/)).toBeInTheDocument()
  })
})
