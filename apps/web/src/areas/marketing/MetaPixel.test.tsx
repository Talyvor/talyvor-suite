import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { focusRing } from '@talyvor/ui'
import { Waitlist } from '../../components/Waitlist'
import { CONSENT_KEY, FBEVENTS_URL } from './pixel'

// B44.2 — nothing reaches Meta before Accept, after Reject, while the ID is empty, or on a signed-in page; after
// Accept, fbevents.js loads, each public page view is one PageView, and a waitlist sign-up is one bare Lead (B51.1:
// so is a click to /signup while sign-up is open).

// The test setup has already imported the app, so the ID is swapped in on a fresh copy of the banner's modules.
let MetaPixel: typeof import('./MetaPixel').MetaPixel
async function withDatasetId(value: string) {
  vi.resetModules()
  vi.doMock('./pixel', async (original) => ({ ...(await original<typeof import('./pixel')>()), META_DATASET_ID: value }))
  MetaPixel = (await import('./MetaPixel')).MetaPixel
}

const metaScripts = () => [...document.querySelectorAll('script')].filter((s) => /facebook/.test(s.src))
const calls = () => (window.fbq?.queue ?? []).map((args) => [...args])

function GoTo({ path }: { path: string }) {
  const navigate = useNavigate()
  return <button className={focusRing} onClick={() => navigate(path)}>to {path}</button>
}

function mount(path: string) {
  window.history.pushState({}, '', path)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MetaPixel />
      <Routes>
        <Route path="/marketing" element={<><Waitlist /><GoTo path="/pricing" /></>} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await withDatasetId('1234567890')
  localStorage.clear()
  metaScripts().forEach((s) => s.remove())
  delete window.fbq
  delete window._fbq
})
afterEach(() => vi.unstubAllGlobals())

describe('MetaPixel', () => {
  it('asks first and sends nothing before Accept', () => {
    mount('/marketing')
    expect(screen.getByRole('dialog', { name: 'Cookies' }).textContent).toContain(
      'We use one advertising cookie, Meta’s, to measure our ads. Only if you accept.',
    )
    expect(metaScripts()).toHaveLength(0)
    expect(window.fbq).toBeUndefined()
  })

  it('after Accept: loads fbevents.js, a PageView per public page, and one Lead with nothing typed in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
    mount('/marketing')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(metaScripts().map((s) => s.src)).toEqual([FBEVENTS_URL])
    expect(calls()).toEqual([
      ['consent', 'grant'],
      ['set', 'autoConfig', false, '1234567890'],
      ['init', '1234567890'],
      ['track', 'PageView'],
    ])
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}').choice).toBe('accepted')

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ann.lee@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    const leads = calls().filter((c) => c[1] === 'Lead')
    expect(leads).toEqual([['track', 'Lead']])
    expect(JSON.stringify(calls())).not.toMatch(/ann|lee|example/)

    act(() => fireEvent.click(screen.getByRole('button', { name: 'to /pricing' })))
    expect(calls().filter((c) => c[1] === 'PageView')).toHaveLength(2)
    expect(metaScripts()).toHaveLength(1)
  })

  // B51.1: while sign-up is open the way in is Get started (or Create your workspace), so a click on it is the Lead.
  it.each([
    [true, 1],
    [false, 0],
  ])('after Accept, with sign-up open %s, a click to /signup counts %i Lead', async (open, n) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ mode: 'oidc', authenticated: false, signup_open: open }), { status: 200 })),
    )
    window.history.pushState({}, '', '/pricing')
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <MetaPixel />
        <a href="/signup" className={focusRing} onClick={(e) => e.preventDefault()}>
          <span>Create your workspace</span>
        </a>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/auth/me', expect.anything()))
    await act(async () => {})
    fireEvent.click(screen.getByText('Create your workspace'))
    expect(calls().filter((c) => c[1] === 'Lead')).toEqual(Array(n).fill(['track', 'Lead']))
  })

  it('after Reject, or closing the banner, nothing', () => {
    for (const name of ['Reject', 'Close']) {
      localStorage.clear()
      const { unmount } = mount('/marketing')
      fireEvent.click(screen.getByRole('button', { name }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}').choice).toBe('rejected')
      window.dispatchEvent(new Event('talyvor:waitlist-joined'))
      expect(metaScripts()).toHaveLength(0)
      expect(window.fbq).toBeUndefined()
      unmount()
    }
  })

  it('withdrawing after Accept revokes consent and reloads without the pixel', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/marketing', reload })
    mount('/marketing')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    act(() => window.dispatchEvent(new Event('talyvor:cookie-settings')))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(calls().at(-1)).toEqual(['consent', 'revoke'])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}').choice).toBe('rejected')
  })

  it('a client-side move into the app after Accept reloads, so the app never runs with the pixel', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/privacy', reload })
    window.history.pushState({}, '', '/privacy')
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <MetaPixel />
        <Routes>
          <Route path="/privacy" element={<GoTo path="/" />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(reload).not.toHaveBeenCalled()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'to /' })))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('with the ID empty: no banner and no request', async () => {
    await withDatasetId('')
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: 'accepted', date: '2026-10-24' }))
    mount('/marketing')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(metaScripts()).toHaveLength(0)
    expect(window.fbq).toBeUndefined()
  })

  it.each(['/', '/ledger', '/signin', '/auth/login', '/share/abc'])('does not start on %s, even after Accept', (path) => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: 'accepted', date: '2026-10-24' }))
    mount(path)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(metaScripts()).toHaveLength(0)
    expect(window.fbq).toBeUndefined()
  })
})
