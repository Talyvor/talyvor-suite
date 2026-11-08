import { act, fireEvent, render as renderBare, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Bar,
  Button,
  Card,
  Chip,
  CodeBox,
  Crumb,
  Dialog,
  EmptyState,
  Eyebrow,
  Facts,
  Field,
  Input,
  KindTile,
  Layer,
  PageHeading,
  RoomBadge,
  Row,
  Select,
  SheetFrame,
  Snack,
  SnackHost,
  Steps,
  Switch,
  Tabs,
  chipFor,
  showSnack,
  showToast,
} from '../pocket'

// B57.4 — Pocket's components (design/pocket/pocket.css and the reference's #system section), rendered on a page
// held to Pocket's rules, as a redrawn screen marks itself (apps/web/src/pocketPending.ts).
const Pocket = ({ children }: { children: React.ReactNode }) => <div data-design="pocket">{children}</div>
const render = (ui: React.ReactElement) => renderBare(ui, { wrapper: Pocket })
const classes = (el: Element) => el.className.split(/\s+/)
const RING = ['focus-visible:outline', 'focus-visible:outline-3', 'focus-visible:outline-tangerine']

describe('Button', () => {
  it('draws the five Pocket fills from tokens', () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="secondary">S</Button>
        <Button variant="outline">O</Button>
        <Button variant="danger">D</Button>
        <Button variant="white">W</Button>
      </>,
    )
    expect(classes(screen.getByRole('button', { name: 'P' }))).toEqual(expect.arrayContaining(['bg-primary', 'text-on-primary']))
    expect(classes(screen.getByRole('button', { name: 'S' }))).toEqual(expect.arrayContaining(['bg-cloud-2', 'text-ink']))
    expect(classes(screen.getByRole('button', { name: 'O' }))).toEqual(expect.arrayContaining(['text-ink', 'shadow-edge']))
    expect(classes(screen.getByRole('button', { name: 'D' }))).toEqual(expect.arrayContaining(['text-danger', 'shadow-edge-current']))
    // White in both themes: the button keeps the light tokens wherever it sits.
    const white = screen.getByRole('button', { name: 'W' })
    expect(white).toHaveAttribute('data-theme', 'light')
    expect(classes(white)).toEqual(expect.arrayContaining(['bg-page', 'text-ink']))
  })

  it('is 34, 44 or 54 tall, a pill, with the 3px tangerine focus ring', () => {
    render(
      <>
        <Button size="sm">small</Button>
        <Button>default</Button>
        <Button size="lg">large</Button>
      </>,
    )
    expect(classes(screen.getByRole('button', { name: 'small' }))).toContain('h-8.5')
    expect(classes(screen.getByRole('button', { name: 'large' }))).toContain('h-13.5')
    const b = screen.getByRole('button', { name: 'default' })
    expect(classes(b)).toEqual(expect.arrayContaining(['h-11', 'rounded-pill', 'whitespace-nowrap', ...RING]))
    expect(b).toHaveAttribute('type', 'button')
  })

  it('puts its icon before the words, hidden from a screen reader', () => {
    render(<Button icon={<svg data-testid="ico" />}>Pause</Button>)
    const b = screen.getByRole('button', { name: 'Pause' })
    expect(b.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(b.firstElementChild).toContainElement(screen.getByTestId('ico'))
  })

  it('presses from the keyboard, and disabled with its reason it says why and does nothing', () => {
    const go = vi.fn()
    render(
      <>
        <Button onClick={go}>Go</Button>
        <Button onClick={go} disabledReason="Add a payee first">Pay</Button>
      </>,
    )
    const goBtn = screen.getByRole('button', { name: 'Go' })
    goBtn.focus()
    expect(goBtn).toHaveFocus()
    fireEvent.click(goBtn)
    expect(go).toHaveBeenCalledTimes(1)
    const pay = screen.getByRole('button', { name: 'Pay' })
    expect(pay).toBeDisabled()
    expect(pay).toHaveAccessibleDescription('Add a payee first')
    expect(screen.getByText('Add a payee first')).toBeVisible()
    fireEvent.click(pay)
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('Card', () => {
  it('cloud by default, white with its shadow, tight', () => {
    render(
      <>
        <Card data-testid="c">a</Card>
        <Card tone="white" data-testid="w">b</Card>
        <Card tight data-testid="t">c</Card>
      </>,
    )
    expect(classes(screen.getByTestId('c'))).toEqual(expect.arrayContaining(['bg-cloud', 'rounded-card', 'p-5']))
    expect(classes(screen.getByTestId('w'))).toEqual(expect.arrayContaining(['bg-page', 'shadow-pocket']))
    expect(classes(screen.getByTestId('t'))).toEqual(expect.arrayContaining(['rounded-card-tight', 'px-4', 'py-3.5']))
  })
})

describe('Chip', () => {
  it('good, bad, wait, paused and plain, each a fill with its ink; the dot is hidden', () => {
    render(
      <>
        <Chip tone="good" dot>Running</Chip>
        <Chip tone="bad">Declined</Chip>
        <Chip tone="wait">Waiting</Chip>
        <Chip tone="paused">Paused</Chip>
        <Chip>Plain</Chip>
      </>,
    )
    expect(classes(screen.getByText('Running'))).toEqual(expect.arrayContaining(['bg-success-50', 'text-success']))
    expect(screen.getByText('Running').querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(classes(screen.getByText('Declined'))).toEqual(expect.arrayContaining(['bg-danger-50', 'text-danger']))
    expect(classes(screen.getByText('Waiting'))).toEqual(expect.arrayContaining(['bg-tangerine-50', 'text-tangerine-ink']))
    expect(classes(screen.getByText('Paused'))).toEqual(expect.arrayContaining(['bg-cloud-2', 'text-ink-2']))
    expect(classes(screen.getByText('Plain'))).toEqual(expect.arrayContaining(['bg-cloud-2', 'text-ink-2']))
  })

  it('maps a status to words a person reads, never the raw status', () => {
    expect(chipFor('not_paid')).toEqual({ tone: 'wait', words: 'Not paid' })
    expect(chipFor('settled')).toEqual({ tone: 'good', words: 'Settled' })
    expect(chipFor('declined')).toEqual({ tone: 'bad', words: 'Declined' })
    expect(chipFor('paused')).toEqual({ tone: 'paused', words: 'Paused' })
    expect(chipFor('PARTIALLY_REFUNDED')).toEqual({ tone: 'plain', words: 'Partially refunded' })
    render(<Chip status="past_due" />)
    expect(screen.getByText('Past due')).toBeInTheDocument()
  })
})

describe('Row', () => {
  it('a face, the title with its line, the amount right and tabular, and an action', () => {
    render(<Row leading={<span data-testid="face" />} title="Acme Hosting" line="Hosting for October" amount="$340.00" action={<Button size="sm">Review</Button>} />)
    expect(screen.getByTestId('face')).toBeInTheDocument()
    expect(screen.getByText('Hosting for October')).toBeInTheDocument()
    expect(classes(screen.getByText('$340.00'))).toEqual(expect.arrayContaining(['text-right', 'font-figure']))
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('a row that is a link is one link with a chevron', () => {
    render(<Row title="Research" line="Running" href="/agents/research" />)
    const link = screen.getByRole('link', { name: /Research/ })
    expect(link).toHaveAttribute('href', '/agents/research')
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(classes(link)).toEqual(expect.arrayContaining(RING))
  })
})

describe('Switch', () => {
  it('44 by 26, role switch, aria-checked, from click and Space', () => {
    render(<Switch aria-label="Freeze card" />)
    const s = screen.getByRole('switch', { name: 'Freeze card' })
    expect(classes(s)).toEqual(expect.arrayContaining(['w-11', 'h-6.5', ...RING]))
    expect(s).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(s)
    expect(s).toHaveAttribute('aria-checked', 'true')
  })

  it('disabled with its reason says why and does not change', () => {
    render(<Switch aria-label="Freeze card" disabledReason="Only the owner can freeze it" />)
    const s = screen.getByRole('switch', { name: 'Freeze card' })
    expect(s).toBeDisabled()
    expect(s).toHaveAccessibleDescription('Only the owner can freeze it')
    fireEvent.click(s)
    expect(s).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Field', () => {
  it('a label above a 46-tall input on the 1.5px control edge, the unit faint beside the value', () => {
    render(
      <Field label="Amount in USD">
        <Input defaultValue="450.00" unit="USD" />
      </Field>,
    )
    const input = screen.getByLabelText('Amount in USD')
    expect(input).toHaveValue('450.00')
    const box = input.parentElement!
    expect(classes(box)).toEqual(expect.arrayContaining(['h-11.5', 'shadow-edge', 'rounded-control', 'bg-page', 'focus-within:outline-tangerine']))
    expect(classes(screen.getByText('USD'))).toContain('text-ink-3')
  })

  it('a Select in the same box, named by its label', () => {
    render(
      <Field label="How earnings are split">
        <Select defaultValue="owner">
          <option value="owner">The owner decides</option>
          <option value="even">Evenly</option>
        </Select>
      </Field>,
    )
    const select = screen.getByLabelText('How earnings are split')
    expect(select).toHaveValue('owner')
    fireEvent.change(select, { target: { value: 'even' } })
    expect(select).toHaveValue('even')
    expect(classes(select.parentElement!)).toEqual(expect.arrayContaining(['h-11.5', 'shadow-edge', 'focus-within:outline-tangerine']))
  })
})

describe('Tabs', () => {
  it('a row of pill tabs, one on, moved with the arrow keys', () => {
    const pick = vi.fn()
    const { rerender } = render(<Tabs label="Kinds" tabs={['All', 'Agents', 'Compute']} value="All" onChange={pick} />)
    const all = screen.getByRole('tab', { name: 'All' })
    expect(screen.getByRole('tablist', { name: 'Kinds' })).toBeInTheDocument()
    expect(all).toHaveAttribute('aria-selected', 'true')
    expect(classes(all)).toEqual(expect.arrayContaining(['bg-primary', 'text-on-primary']))
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(pick).toHaveBeenLastCalledWith('Agents')
    rerender(<Tabs label="Kinds" tabs={['All', 'Agents', 'Compute']} value="Agents" onChange={pick} />)
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Agents' }), { key: 'ArrowLeft' })
    expect(pick).toHaveBeenLastCalledWith('All')
    fireEvent.click(screen.getByRole('tab', { name: 'Compute' }))
    expect(pick).toHaveBeenLastCalledWith('Compute')
  })
})

describe('Crumb', () => {
  it('Agents › Research: links up the trail, the page you are on last', () => {
    render(<Crumb trail={[{ label: 'Agents', href: '/agents' }, { label: 'Research' }]} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents')
    expect(screen.getByText('Research')).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('the page pieces', () => {
  it('EmptyState: a kind tile, a title, a line and one action', () => {
    render(<EmptyState icon={<svg />} title="Nothing has moved this month." line="Payments show here." action={<Button size="sm">Add money</Button>} />)
    expect(screen.getByText('Nothing has moved this month.')).toBeInTheDocument()
    expect(screen.getByText('Payments show here.')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('KindTile and RoomBadge are icon tiles', () => {
    render(
      <>
        <KindTile data-testid="k" icon={<svg />} />
        <RoomBadge data-testid="r" icon={<svg />} />
      </>,
    )
    expect(classes(screen.getByTestId('k'))).toEqual(expect.arrayContaining(['h-9.5', 'w-9.5', 'rounded-tile', 'bg-page']))
    expect(classes(screen.getByTestId('r'))).toEqual(expect.arrayContaining(['rounded-tile', 'bg-cloud-2', 'text-ink-2']))
  })

  it('Bar: the 10px budget bar says what it shows, and never runs past full', () => {
    render(<Bar value={1.3} label="130% of budget used" />)
    const bar = screen.getByRole('img', { name: '130% of budget used' })
    expect(classes(bar)).toEqual(expect.arrayContaining(['h-2.5', 'rounded-pill']))
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('Eyebrow and PageHeading with its line', () => {
    render(
      <>
        <Eyebrow>Balance</Eyebrow>
        <PageHeading line="Every agent you run.">Agents</PageHeading>
      </>,
    )
    expect(classes(screen.getByText('Balance'))).toEqual(expect.arrayContaining(['text-pocket-eyebrow', 'uppercase', 'text-ink-3']))
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument()
    expect(screen.getByText('Every agent you run.')).toBeInTheDocument()
  })

  it('Facts: label and value rows on cloud', () => {
    const { container } = render(<Facts facts={[{ label: 'Paid from', value: 'Research’s account' }, { label: 'Expires', value: 'Tomorrow' }]} />)
    const dl = container.querySelector('dl')!
    expect(classes(dl)).toContain('bg-cloud')
    expect(Array.from(dl.querySelectorAll('dt')).map((d) => d.textContent)).toEqual(['Paid from', 'Expires'])
    expect(Array.from(dl.querySelectorAll('dd')).map((d) => d.textContent)).toEqual(['Research’s account', 'Tomorrow'])
  })

  it('CodeBox copies its code and says so', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: write } })
    render(<CodeBox code="tlv_ws_example" copied="Copied. Store it now: it will not be shown again" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith('tlv_ws_example')
    expect(await screen.findByRole('status')).toHaveTextContent('Copied. Store it now: it will not be shown again')
  })

  it('Steps are numbered, in order', () => {
    render(<Steps steps={[{ title: 'Make a key' }, { title: 'Add it to Claude', line: 'One command' }]} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['1Make a key', '2Add it to ClaudeOne command'])
  })
})

// B57.5 — Pocket's dialogs, the sheet's frame and the confirmations after an action (pocket.css .dialog, .sheet,
// .snack; the reference's dlg-move-research, dlg-void-inv, dlg-sheet-A and its toast).
describe('Dialog', () => {
  function VoidInvoice({ onVoid = () => {} }: { onVoid?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Void
        </Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Void invoice INV-000002?"
          actions={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button variant="danger" onClick={() => (onVoid(), setOpen(false))}>
                Void it
              </Button>
            </>
          }
        >
          Orbit Studio can no longer pay it, and this cannot be undone.
        </Dialog>
      </>
    )
  }
  const open = () => {
    const opener = screen.getByRole('button', { name: 'Void' })
    opener.focus()
    fireEvent.click(opener)
    return opener
  }

  it('opens over the page, named by its heading, with focus inside it', () => {
    render(<VoidInvoice />)
    open()
    const dialog = screen.getByRole('dialog', { name: 'Void invoice INV-000002?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('heading', { level: 2, name: 'Void invoice INV-000002?' })).toBeInTheDocument()
    expect(screen.getByText('Orbit Studio can no longer pay it, and this cannot be undone.')).toBeInTheDocument()
    // The page it opened over is still there behind the scrim, and cannot be pressed until it closes.
    expect(screen.getByRole('button', { name: 'Void', hidden: true }).closest('[inert]')).not.toBeNull()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Void' }).closest('[inert]')).toBeNull()
  })

  it('holds Tab inside: past the last control it comes back to the first, and Shift+Tab the other way', () => {
    render(<VoidInvoice />)
    open()
    const close = screen.getByRole('button', { name: 'Close' })
    const act = screen.getByRole('button', { name: 'Void it' })
    act.focus()
    fireEvent.keyDown(act, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(act).toHaveFocus()
  })

  it('gives focus back to the control that opened it, by the close x, Esc, the scrim, cancel and act', () => {
    const onVoid = vi.fn()
    render(<VoidInvoice onVoid={onVoid} />)
    const ways: [string, () => void][] = [
      ['the close x', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
      ['Esc', () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' })],
      ['the scrim', () => fireEvent.click(document.querySelector('[data-scrim]')!)],
      ['cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))],
      ['act', () => fireEvent.click(screen.getByRole('button', { name: 'Void it' }))],
    ]
    for (const [how, shut] of ways) {
      const opener = open()
      shut()
      expect(screen.queryByRole('dialog'), how).toBeNull()
      expect(opener, how).toHaveFocus()
    }
    expect(onVoid).toHaveBeenCalledTimes(1)
  })

  it('is 480 wide and centred, and a bottom sheet below 840', () => {
    render(<VoidInvoice />)
    open()
    const card = screen.getByRole('dialog').firstElementChild!
    expect(classes(card)).toEqual(expect.arrayContaining(['wide:w-120', 'w-full', 'rounded-t-sheet', 'wide:rounded-card', 'bg-page', 'shadow-pocket-lg']))
    expect(classes(document.querySelector('[data-layer]')!)).toEqual(expect.arrayContaining(['items-end', 'wide:items-center']))
  })

  it('takes the reference’s other places: top for ⌘K, the corner for Taly', () => {
    const { rerender } = render(
      <Layer label="Search, or type a command" position="top" onClose={() => {}}>
        <p>bar</p>
      </Layer>,
    )
    expect(classes(document.querySelector('[data-layer]')!)).toEqual(expect.arrayContaining(['items-start']))
    rerender(
      <Layer label="Taly" position="corner" onClose={() => {}}>
        <p>panel</p>
      </Layer>,
    )
    expect(classes(document.querySelector('[data-layer]')!)).toEqual(expect.arrayContaining(['items-end', 'justify-end']))
    expect(screen.getByRole('dialog', { name: 'Taly' })).toBeInTheDocument()
  })
})

describe('SheetFrame', () => {
  it('draws the approval sheet’s frame: 28 round, the tangerine top edge, the amount, facts on cloud, the only line, actions', () => {
    const onClose = vi.fn()
    render(
      <SheetFrame
        head={<b>Research wants to pay</b>}
        amount="$340.00"
        to={<>to Acme Hosting</>}
        facts={[{ label: 'Expires', value: 'Tomorrow at 09:17' }]}
        only="This approves this payment only. Approving or declining asks for your passkey."
        actions={<Button>Approve with your passkey</Button>}
        onClose={onClose}
      />,
    )
    const frame = document.querySelector('[data-sheet]')!
    expect(classes(frame)).toEqual(expect.arrayContaining(['rounded-t-sheet', 'wide:rounded-sheet', 'bg-page', 'shadow-pocket-lg']))
    expect(classes(frame.querySelector('[data-edge]')!)).toEqual(expect.arrayContaining(['h-1.75', 'bg-tangerine']))
    expect(classes(screen.getByText('$340.00'))).toEqual(expect.arrayContaining(['font-display', 'text-pocket-amount']))
    expect(screen.getByText('Tomorrow at 09:17').closest('dl')).toHaveClass('bg-cloud')
    expect(screen.getByText('This approves this payment only. Approving or declining asks for your passkey.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Snack and Toast', () => {
  function Act({ view }: { view: string }) {
    return (
      <>
        <Button variant="secondary" onClick={() => showSnack({ title: 'INV-000002 is void', line: 'Its pay link no longer works.' })}>
          Void it
        </Button>
        <SnackHost view={view} />
      </>
    )
  }

  it('shows one snack per action on the next view, and never twice', () => {
    const { rerender } = render(<Act view="/invoices" />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Void it' }))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('INV-000002 is void')
    expect(screen.getByRole('status')).toHaveTextContent('Its pay link no longer works.')
    rerender(<Act view="/invoices" />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    // The next view after the one it was shown on: gone, and it does not come back.
    rerender(<Act view="/agents" />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<Act view="/invoices" />)
    expect(screen.queryByRole('status')).toBeNull()
    // A second action is a second snack, once.
    fireEvent.click(screen.getByRole('button', { name: 'Void it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Void it' }))
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('survives the move an action makes, and shows on the page it lands on', () => {
    function Moves() {
      const [view, setView] = useState('/invoices/2')
      return (
        <>
          <Button variant="secondary" onClick={() => (showSnack({ title: 'INV-000002 is void' }), setView('/invoices'))}>
            Void it
          </Button>
          <Button variant="secondary" onClick={() => setView('/agents')}>
            Agents
          </Button>
          <SnackHost view={view} />
        </>
      )
    }
    render(<Moves />)
    fireEvent.click(screen.getByRole('button', { name: 'Void it' }))
    expect(screen.getByRole('status')).toHaveTextContent('INV-000002 is void')
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a toast says its short message and goes', () => {
    vi.useFakeTimers()
    try {
      render(<SnackHost view="/" />)
      act(() => showToast('You type the amount here, in dollars'))
      expect(screen.getByRole('status')).toHaveTextContent('You type the amount here, in dollars')
      act(() => vi.advanceTimersByTime(3000))
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws the snack ink on page, with its tick, title, line and label', () => {
    render(<Snack title="Approved: Acme Hosting, $340.00" line="It goes through the next time Research sends it." label={<span>Sandbox</span>} />)
    const snack = screen.getByRole('status')
    expect(classes(snack)).toEqual(expect.arrayContaining(['bg-primary', 'text-on-primary', 'rounded-inset', 'shadow-pocket-lg']))
    expect(snack).toHaveTextContent('Sandbox')
  })
})
