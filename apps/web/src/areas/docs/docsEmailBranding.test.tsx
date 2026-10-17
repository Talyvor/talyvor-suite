import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocsEmailBranding } from './DocsEmailBranding'

// B39.34 — Settings → Email branding, driven at the wire against a BFF that answers as Docs does: the owner's
// save is PUT verbatim and the preview follows the fields; Docs' 400 message is shown as it came; a non-owner is told why.

afterEach(() => vi.restoreAllMocks())

function mockBFF(put: (body: Record<string, string>) => Response) {
  const writes: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ from_name: '', header_color: '', logo_url: '' }), { status: 200 })
    }
    const body = JSON.parse(String(init?.body)) as Record<string, string>
    writes.push(body)
    return put(body)
  })
  return writes
}

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DocsEmailBranding />
    </QueryClientProvider>,
  )
}

describe('Docs email branding settings', () => {
  it('saves the name, colour and logo, and the preview follows them', async () => {
    const writes = mockBFF((b) => new Response(JSON.stringify(b), { status: 200 }))
    renderScreen()
    fireEvent.change(await screen.findByRole('textbox', { name: 'From name' }), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Header colour' }), {
      target: { value: '#1E40AF' },
    })
    expect(screen.getByTestId('branding-preview')).toHaveStyle({
      background: '#1E40AF',
    })
    expect(screen.getByText(/“Acme via Talyvor”/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Logo URL' }), {
      target: { value: 'https://acme.example/l.png' },
    })
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', 'https://acme.example/l.png')
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))
    expect(await screen.findByText(/Saved/)).toBeInTheDocument()
    expect(writes).toEqual([
      {
        from_name: 'Acme',
        header_color: '#1E40AF',
        logo_url: 'https://acme.example/l.png',
      },
    ])
  })

  it('shows Docs’ own 400 message', async () => {
    mockBFF(
      () =>
        new Response(
          JSON.stringify({
            error: 'header_color must be a colour like #1E40AF',
          }),
          { status: 400 },
        ),
    )
    renderScreen()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Header colour' }), { target: { value: 'red' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('header_color must be a colour like #1E40AF')
  })

  it('tells a member who is not the owner why it was refused', async () => {
    mockBFF(
      () =>
        new Response(
          JSON.stringify({
            error: 'only the workspace owner can set email branding',
          }),
          { status: 403 },
        ),
    )
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Save branding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only this workspace’s owner/)
  })
})
