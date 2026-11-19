import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Card } from '@talyvor/ui/pocket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListFileDownload } from './ListFile'

let asked: { url: string; accept: string }[]

beforeEach(() => {
  asked = []
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    asked.push({ url: String(input), accept: new Headers(init?.headers).get('Accept') ?? '' })
    if (String(input) === '/api/agents/schedules?format=csv') return new Response(JSON.stringify({ error: 'only the owner reads the schedules' }), { status: 403 })
    return new Response('id,status\napr_1,pending\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const show = (list: 'approvals' | 'schedules') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <div data-design="pocket">
        <Card tone="white">
          <ListFileDownload list={list} />
        </Card>
      </div>
    </QueryClientProvider>,
  )

describe('B28.59 — Download CSV on a wallet list', () => {
  it('asks Lens for the list as its CSV and saves it under the list’s name', async () => {
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    show('approvals')
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saved).toEqual(['approvals.csv']))
    expect(asked).toEqual([{ url: '/api/agents/approvals?format=csv', accept: 'text/csv' }])
  })

  it('says Lens’s sentence when the download is refused, and saves nothing', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    show('schedules')
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner reads the schedules.')
    expect(click).not.toHaveBeenCalled()
  })
})
