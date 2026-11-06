import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ChatHelp } from './ChatHelp'
import { PROVIDER_LABEL, STREAMABLE_PROVIDERS } from './chatApi'

describe('How to use Talyvor Chat (B10.3)', () => {
  it('holds the explanations the chat screen no longer carries', () => {
    render(
      <MemoryRouter>
        <ChatHelp />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Asking',
      'Launching an agent',
      'Setting a rule',
      'Handing an agent a task',
      'Scheduling a prompt',
      'Freezing an agent’s card',
      'Downloading a statement',
      'Models',
      'Attaching documents',
      'Searching the web',
      'Running code',
      'Track and Docs in Chat',
      'Connectors',
      'The canvas',
      'What an answer costs',
      'What each question sends',
      'Where conversations are kept',
      'Sharing a chat',
      'Exporting and importing chats',
    ])
    // B16.4 — what goes with a question, and what a new chat starts with.
    expect(screen.getByText(/Nothing from any other conversation goes with it/i)).toBeTruthy()
    expect(screen.getByText(/New chat starts one with nothing before it/i)).toBeTruthy()
    // The price line is the catalog's rate, never this conversation's bill (see Chat.tsx's header).
    expect(screen.getByText(/catalog rate, not this conversation/i)).toBeTruthy()
    // Where history is kept, in full.
    expect(screen.getByText(/In this browser only, for the account you are signed in with/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the chat' }).getAttribute('href')).toBe('/chat')
  })

  // B55.37 — the help names every provider Chat can stream, in the picker's order, from the same lists.
  it('names every provider Chat can use', () => {
    const { container } = render(
      <MemoryRouter>
        <ChatHelp />
      </MemoryRouter>,
    )
    const labels = STREAMABLE_PROVIDERS.map((p) => PROVIDER_LABEL[p])
    expect(labels).toHaveLength(7)
    const named = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    expect(container.textContent).toContain(`Chat can use models from ${named}.`)
    expect(container.textContent).not.toContain('can’t be chosen yet')
  })
})
