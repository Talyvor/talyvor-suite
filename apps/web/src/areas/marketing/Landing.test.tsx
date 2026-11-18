import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_EMAIL, Landing } from './Landing'
import { COMPANY_CONTACT, COMPANY_LINE } from '../../company'

// Area-owned test. Kept from the scaffold contract: the landing renders with NO providers — no auth gate, no query
// client, no router — because it is a public page. B64.1: the page is version 4 (design/website-2026-11-17-v4,
// Nick approved 17 Nov 2026), so what is pinned here is that page's words and the rules FOR-V7.md section 3 keeps on.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** What a visitor reads: the page without its <style>. */
function pageText(container: HTMLElement): string {
  const page = container.cloneNode(true) as HTMLElement
  page.querySelectorAll('style').forEach((s) => s.remove())
  return page.textContent ?? ''
}

describe('Landing', () => {
  it('renders standalone — no router, no providers — under version 4’s one headline', () => {
    render(<Landing />)
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0]).toHaveTextContent('Your AI agent wants your card.Give it its own.')
  })

  it('draws index.html section by section, each under its own heading', () => {
    render(<Landing />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Stop lending your agent your card.',
      'Agent money shouldn’t need a manual.',
      'One minute. The whole app.',
      'Press it. You’ll get it in ten seconds.',
      'Your shopping agent. Your company’s agent army.',
      'Claude does the legwork. You keep the final say.',
      'They built it for engineers. We built it for you.',
      'Start free. Seriously.',
      'Built. Running. Moving fast.',
      'Your move.',
    ])
  })

  it('says no LXC, never that Talyvor is or is not a bank, and none of the words FOR-V7.md keeps off the page', () => {
    const { container } = render(<Landing />)
    const text = pageText(container)
    expect(text).not.toMatch(/LXC/)
    expect(text).not.toMatch(/not a bank/i)
    expect(text).not.toMatch(/\bbank\b|licensed partners|coming soon|ChatGPT/i)
  })

  it('sends every Open your account and Open an account to /signup', () => {
    render(<Landing />)
    const ctas = screen.getAllByRole('link', { name: /open (your|an) account/i })
    expect(ctas).toHaveLength(4)
    for (const a of ctas) expect(a).toHaveAttribute('href', '/signup')
  })

  it('keeps the Sandbox label in the demo and the "Where we are" block, and says real money is next, not live', () => {
    const { container } = render(<Landing />)
    expect(within(container.querySelector<HTMLElement>('#try')!).getByText('Sandbox')).toBeInTheDocument()
    expect(screen.getByText('Sandbox today')).toBeInTheDocument()
    expect(screen.getByText('It switches on with our launch partner, and early users go first.')).toBeInTheDocument()
  })

  it('offers the company address and line, the policies, and the AI Agents Directory badge as they give it', () => {
    render(<Landing />)
    expect(CONTACT_EMAIL).toBe(COMPANY_CONTACT)
    expect(screen.getByText(CONTACT_EMAIL, { selector: 'p' })).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(COMPANY_LINE)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    const badge = within(footer).getByRole('link', { name: 'Talyvor - Featured on AI Agents Directory' })
    expect(badge).toHaveAttribute('href', 'https://aiagentsdirectory.com/agent/talyvor')
    expect(badge).toHaveAttribute('target', '_blank')
    expect(badge).toHaveAttribute('rel', 'noopener')
    expect(badge).toHaveAttribute('title', 'Discover Talyvor on AI Agents Directory')
  })

  it('serves every film, poster and picture it names from the app’s own /site', () => {
    const { container } = render(<Landing />)
    const urls = [...container.querySelectorAll('video, img')].flatMap((el) =>
      ['src', 'poster', 'data-src', 'data-small'].map((a) => el.getAttribute(a)).filter((v): v is string => !!v),
    )
    expect(urls.length).toBeGreaterThanOrEqual(13)
    const missing = urls.filter((u) => !u.startsWith('/site/') || !existsSync(resolve(__dirname, '../../../public', u.slice(1))))
    expect(missing).toEqual([])
  })
})

describe('Try Penny', () => {
  it('pays inside the rules on its own, asks above the line, and lands what you approve on the statement', () => {
    vi.useFakeTimers()
    const { container } = render(<Landing />)
    const tryIt = container.querySelector<HTMLElement>('#try')!
    fireEvent.click(within(tryIt).getByRole('button', { name: /Acme Hosting/ }))
    expect(within(tryIt).getByText('Paid on its own')).toBeInTheDocument()

    fireEvent.click(within(tryIt).getByRole('button', { name: /Northwind Data/ }))
    const sheet = screen.getByRole('dialog', { hidden: true })
    expect(sheet).toHaveClass('on')
    expect(within(sheet).getByText('Above your $50 line')).toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with Face ID' }))
    act(() => void vi.runAllTimers())
    expect(sheet).not.toHaveClass('on')
    expect(document.documentElement.style.overflow).toBe('')
    expect(within(tryIt).getByText('You approved')).toBeInTheDocument()
    expect(within(tryIt).getByText('$186.00')).toBeInTheDocument()

    fireEvent.click(within(tryIt).getByRole('button', { name: /Brightline Leads/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sheet).not.toHaveClass('on')
    expect(within(tryIt).getByText('You declined')).toBeInTheDocument()
  })
})

describe('Pricing on the page', () => {
  it('switches between people and companies, and between dollars, pounds and euros', () => {
    const { container } = render(<Landing />)
    const plans = () => container.querySelector('#plans')!.textContent
    expect(plans()).toContain('Fleet$9.99 a month')
    fireEvent.click(screen.getByRole('button', { name: '£' }))
    expect(plans()).toContain('Fleet£7.99 a month')
    fireEvent.click(screen.getByRole('button', { name: '€' }))
    expect(plans()).toContain('Fleet€8.99 a month')
    fireEvent.click(screen.getByRole('button', { name: 'For companies' }))
    expect(plans()).toContain('Group€125 a month')
    expect(plans()).toContain('CustomLet’s talk')
  })
})
