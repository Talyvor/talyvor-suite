import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppIcon, LogoSymbol, appIconFile, symbolFile } from '../components/Mark'
import { NavIcon, navIconNames } from '../components/NavIcon'
import { Logo, logoFile } from '../components/Wordmark'
import { contrastRatio } from '../lib/contrast'
import { Face, faceColours, faceOf, faceShapes, type FaceState } from '../pocket/Face'
import { Icon, iconNames } from '../pocket/Icon'

// B57.6 — Pocket's icons, each agent's face and the kit's logo (design/pocket #system; design/logo/talyvor-logo).

describe('an agent’s face', () => {
  // The three vectors B57.10 (Lens's backfill) and B57.64 (the phone) copy: FNV-1a 32-bit of the id,
  // colour = h mod 7, shape = (h div 7) mod 4.
  it.each([
    ['agt_research', 3529705301, 'mint', 'hexagon'],
    ['agt_sales', 2871286680, 'mint', 'flower'],
    ['agt_ops', 3402803948, 'rose', 'squircle'],
  ] as const)('%s picks the same colour and shape as Lens backfills', (id, h, colour, shape) => {
    expect(h % 7).toBe(faceColours.indexOf(colour))
    expect(faceOf({ id })).toEqual({ colour, shape })
  })

  it('takes Lens’s own colour and face fields once they arrive', () => {
    expect(faceOf({ id: 'agt_ops', colour: 'cobalt', face: 'circle' })).toEqual({ colour: 'cobalt', shape: 'circle' })
    expect(faceOf({ id: 'agt_ops', colour: 'teal', face: 'star' }), 'an unknown value falls back to the pick').toEqual({
      colour: 'rose',
      shape: 'squircle',
    })
  })

  it('draws all 84 faces with features at 3:1 or more, white only on cobalt, named "<name> agent"', () => {
    for (const colour of faceColours)
      for (const shape of faceShapes)
        for (const state of ['happy', 'asleep', 'level'] as FaceState[]) {
          const { container, unmount } = render(<Face agent={{ id: 'x', name: 'Research', colour, face: shape }} state={state} />)
          const face = screen.getByRole('img', { name: 'Research agent' })
          expect(face.getAttribute('data-face')).toBe(`${colour} ${shape} ${state}`)
          const svg = container.querySelector('svg')!
          const fill = svg.firstElementChild!.getAttribute('fill')!
          const ink = [...svg.querySelectorAll('circle[cx="37"], path')].map((e) => e.getAttribute('fill') === 'none' ? e.getAttribute('stroke') : e.getAttribute('fill'))
          expect(new Set(ink).size, `${colour} ${shape} ${state}: one feature colour`).toBe(1)
          expect(ink[0]).toBe(colour === 'cobalt' ? '#FFFFFF' : '#111216')
          expect(contrastRatio(ink[0]!, fill), `${colour} ${shape} ${state}`).toBeGreaterThanOrEqual(3)
          unmount()
        }
  })

  it('wears the tangerine badge only while something waits', () => {
    const { container, rerender } = render(<Face agent={{ id: 'agt_ops', name: 'Ops' }} waiting size={44} />)
    expect(container.querySelector('[data-badge="waiting"]')?.className).toContain('bg-tangerine')
    rerender(<Face agent={{ id: 'agt_ops', name: 'Ops' }} size={44} />)
    expect(container.querySelector('[data-badge]')).toBeNull()
  })
})

describe('Pocket’s icons', () => {
  it('has every icon the item names, on the 24px grid at 1.9 stroke with round caps', () => {
    const named = 'home approvals agents payments statements marketplace rooms chat code billing settings pause search bell plus chev faceid lock key check x clock card arrow copy shield phone send download invoices work coin model keyboard'
    for (const name of named.split(' ')) expect(iconNames, name).toContain(name)
    render(<Icon name="home" />)
    const svg = document.querySelector('svg[data-icon="home"]')!
    expect([svg.getAttribute('viewBox'), svg.getAttribute('stroke-width'), svg.getAttribute('stroke-linecap')]).toEqual(['0 0 24 24', '1.9', 'round'])
  })

  it('draws every NavIconName as a Pocket icon', () => {
    for (const name of navIconNames) {
      const { container, unmount } = render(<NavIcon name={name} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('data-icon'), name).toBe(name)
      expect(svg.getAttribute('stroke-width'), name).toBe('1.9')
      expect(svg.children.length, name).toBeGreaterThan(0)
      unmount()
    }
  })
})

describe('the kit’s logo', () => {
  const dir = resolve(import.meta.dirname, '../../../../apps/web/public/brand/logo')
  const srcs = (el: HTMLElement) => [...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))

  it('picks the kit’s drawing by width: full from 240, small from 120, never below 120', () => {
    expect([logoFile(600), logoFile(240), logoFile(239), logoFile(120)]).toEqual(['talyvor-logo', 'talyvor-logo', 'talyvor-logo-small', 'talyvor-logo-small'])
    const { container } = render(<Logo width={80} />)
    expect(container.querySelector('img')!.getAttribute('width'), 'clamped to 120').toBe('120')
  })

  it('puts both versions in the page, each shown by the nearest theme, with half the arrow’s height clear around it', () => {
    const { container } = render(<Logo width={240} />)
    expect(srcs(container)).toEqual(['/brand/logo/talyvor-logo-on-light.svg', '/brand/logo/talyvor-logo-on-dark.svg'])
    const [light, dark] = container.querySelectorAll('img')
    expect([light.style.display, dark.style.display]).toEqual(['var(--logo-on-light)', 'var(--logo-on-dark)'])
    // 168 of the frame's 2963.51 units is half the arrow: 13.6 px at 240 wide.
    expect((container.firstElementChild as HTMLElement).style.padding).toBe('14px')
    const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
    expect(css).toMatch(/\[data-theme='light'\] \{\s*--logo-on-light: block;\s*--logo-on-dark: none;/)
    expect(css).toMatch(/\[data-theme='dark'\] \{\s*--logo-on-light: none;\s*--logo-on-dark: block;/)
  })

  it('the symbol from 48 px and each app-icon drawing for its size', () => {
    expect([symbolFile(120), symbolFile(119), symbolFile(48)]).toEqual(['talyvor-symbol', 'talyvor-symbol-small', 'talyvor-symbol-small'])
    expect([120, 48, 32, 20, 16].map(appIconFile)).toEqual([
      'talyvor-app-icon-rounded.svg',
      'talyvor-favicon-small.svg',
      'talyvor-favicon-tiny.svg',
      'talyvor-favicon-tiny.svg',
      'talyvor-favicon-pico.svg',
    ])
    const { container } = render(
      <>
        <LogoSymbol width={20} />
        <AppIcon size={20} aria-hidden />
      </>,
    )
    expect(srcs(container)).toEqual(['/brand/logo/talyvor-symbol-small-on-light.svg', '/brand/logo/talyvor-symbol-small-on-dark.svg', '/brand/logo/talyvor-favicon-tiny.svg'])
  })

  it('every file it draws is in the web app, and each pair is one drawing in two colourings', () => {
    const files = ['talyvor-logo', 'talyvor-logo-small', 'talyvor-symbol', 'talyvor-symbol-small'].flatMap((f) => [`${f}-on-light.svg`, `${f}-on-dark.svg`])
    for (const f of [...files, ...[120, 48, 20, 16].map(appIconFile)]) expect(existsSync(resolve(dir, f)), f).toBe(true)
    // The kit's README: every path, line width and position is identical in the two versions.
    const geometry = (f: string) => [...readFileSync(resolve(dir, f), 'utf8').matchAll(/ (d|stroke-width|x1|y1|x2|y2)="([^"]+)"/g)].map((m) => m[2])
    for (let i = 0; i < files.length; i += 2) expect(geometry(files[i]), files[i]).toEqual(geometry(files[i + 1]))
  })
})
