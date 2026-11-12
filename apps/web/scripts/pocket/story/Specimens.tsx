// B57.4 — Pocket's components on one page, light beside dark, for pocket-shots and the press check
// (src/test/storyPress.test.tsx). The words are the reference's own (its #system section and the screens B57.4 names).
// Every control does something a person can see: a press says what was pressed, a switch turns, a tab moves.
import { useState } from 'react'
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
  SnackHost,
  Steps,
  Switch,
  Tabs,
  showSnack,
  showToast,
} from '@talyvor/ui/pocket'

import { cardArt } from '../../../src/cards/cardArt'
import { TalyvorCard } from '../../../src/cards/TalyvorCard'

const ico = 'h-5 w-5 fill-none stroke-current'
const stroke = { strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const Pause = () => (
  <svg viewBox="0 0 24 24" className={ico} {...stroke}>
    <path d="M9 6.5v11M15 6.5v11" />
  </svg>
)
const Doc = () => (
  <svg viewBox="0 0 24 24" className={ico} {...stroke}>
    <path d="M7 3.5h7l4 4V20.5H7z" />
    <path d="M14 3.5V8h4" />
    <path d="M9.5 12h6M9.5 15.5h6" />
  </svg>
)
const Chat = () => (
  <svg viewBox="0 0 24 24" className={ico} {...stroke}>
    <path d="M5 6.5h14v9.5H11l-4 3.5v-3.5H5z" />
  </svg>
)

const TABS = ['Research', 'Sales'] as const

function Specimens({ theme }: { theme: 'light' | 'dark' }) {
  const [said, setSaid] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number]>('Research')
  const [frozen, setFrozen] = useState(false)
  const press = (what: string) => () => setSaid(`You pressed ${what}.`)
  const name = theme === 'light' ? 'Light' : 'Dark'
  return (
    <section data-theme={theme} data-design="pocket" aria-label={name} className="grid content-start gap-6 bg-page p-6 text-ink">
      <Crumb trail={[{ label: 'Agents', href: `#agents-${theme}` }, { label: 'Research' }]} />
      <PageHeading line="The pieces every screen is made of.">{name}</PageHeading>
      <p role="status" className="text-body text-ink-2">
        {said}
      </p>

      <div className="flex flex-wrap items-start gap-3">
        <Button onClick={press('Primary')}>Primary</Button>
        <Button variant="secondary" onClick={press('Secondary')}>
          Secondary
        </Button>
        <Button variant="outline" onClick={press('Outline')}>
          Outline
        </Button>
        <Button variant="danger" onClick={press('Danger')}>
          Danger
        </Button>
        <Button size="sm" variant="outline" icon={<Pause />} onClick={press('Pause every agent')}>
          Pause every agent
        </Button>
        <Button size="lg" onClick={press('Approve with your passkey')}>
          Approve with your passkey
        </Button>
        <Button disabledReason="Add a payee first">Pay</Button>
      </div>
      <div data-theme="light" className="flex flex-wrap items-center gap-3 rounded-inset bg-primary p-5">
        <Button variant="white" onClick={press('White')}>
          White
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip tone="good" dot>
          Running
        </Chip>
        <Chip tone="wait">Waiting</Chip>
        <Chip tone="bad">Declined</Chip>
        <Chip tone="paused">Paused</Chip>
        <Chip status="not_paid" />
      </div>

      <Tabs label="Statements" tabs={TABS} value={tab} onChange={setTab} />

      <Card>
        <Eyebrow>Balance</Eyebrow>
        <div className="mt-3 grid gap-1.5">
          <Bar value={0.73} label="73% of budget used" />
          <div className="flex justify-between text-body">
            <span className="text-ink-2">This month</span>
            <span className="font-figure">$1,100.00 of $1,500.00</span>
          </div>
        </div>
      </Card>

      <Card tone="white">
        <Row
          leading={<KindTile on="white" icon={<Doc />} />}
          title="Research wants to pay Acme Hosting"
          line="Hosting for October · today, by you"
          amount="$340.00"
          action={
            <Button size="sm" onClick={press('Review')}>
              Review
            </Button>
          }
        />
        <Row leading={<RoomBadge icon={<Chat />} />} title="Room: Agent pricing research" line="Running" href={`#room-${theme}`} />
      </Card>

      <Card tight className="flex items-center justify-between gap-3">
        <span className="text-body font-semibold">Freeze card</span>
        <Switch aria-label="Freeze Research’s card" checked={frozen} onCheckedChange={setFrozen} />
      </Card>
      <Switch aria-label="Freeze Sales’s card" disabledReason="Only the owner can freeze a card" />

      <div className="grid gap-3.5 wide:grid-cols-2">
        <Field label="Amount in USD">
          <Input inputMode="decimal" defaultValue="450.00" unit="USD" />
        </Field>
        <Field label="Reference">
          <Input placeholder="What the payee sees" />
        </Field>
        <Field label="How earnings are split">
          <Select defaultValue="owner">
            <option value="owner">The owner decides</option>
            <option value="even">Evenly</option>
          </Select>
        </Field>
      </div>

      <Facts
        facts={[
          { label: 'Why it’s asking', value: 'It asks you above $250.00 (2,500 LXC)' },
          { label: 'Paid from', value: 'Research’s US dollar account (holds $400.00)' },
          { label: 'Expires', value: 'Tomorrow at 09:17' },
        ]}
      />

      <CodeBox code="claude mcp add --transport http talyvor https://app.talyvor.com/mcp" copied="Copied the command" />

      <Steps steps={[{ title: 'Your assistant prepares it' }, { title: 'Talyvor writes it out' }, { title: 'You approve it' }]} />

      <EmptyState
        icon={<Doc />}
        title="Nothing has moved this month."
        line="An empty state says what would show here, and how it gets there."
        action={
          <Button size="sm" variant="secondary" onClick={press('Add money')}>
            Add money
          </Button>
        }
      />
    </section>
  )
}

// B57.5 — the reference's dialogs (dlg-move-research, dlg-void-inv), the approval sheet's frame (dlg-sheet-A) and the
// confirmation each action leaves, in its words. They open over this page, once, in the light theme.
function Frames() {
  const [open, setOpen] = useState<'move' | 'void' | 'sheet' | null>(null)
  const close = () => setOpen(null)
  return (
    <section data-theme="light" data-design="pocket" aria-label="Dialogs" className="grid content-start gap-6 bg-page p-6 text-ink wide:col-span-2">
      <PageHeading line="They open over the page you are on, which stays behind the scrim.">Dialogs</PageHeading>
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="secondary" onClick={() => setOpen('move')}>
          Move LXC
        </Button>
        <Button variant="danger" onClick={() => setOpen('void')}>
          Void
        </Button>
        <Button onClick={() => setOpen('sheet')}>Approving Acme Hosting</Button>
      </div>

      <Dialog
        open={open === 'move'}
        onClose={close}
        title="Move LXC: Research"
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                showSnack({ title: 'Research now holds $1,750.00 (17,500 LXC)', line: '$100.00 (1,000 LXC) moved in from the workspace.' })
                close()
              }}
            >
              Fund Research with $100.00
            </Button>
          </>
        }
      >
        <p>
          Research holds <span className="font-figure">$1,650.00 (16,500 LXC)</span>. The workspace has{' '}
          <span className="font-figure">$9,090.00 (90,900 LXC)</span> free to fund it.
        </p>
        <Field label="Amount">
          <Input defaultValue="100.00" unit="USD" inputMode="decimal" onFocus={() => showToast('You type the amount here, in dollars')} />
        </Field>
        <p className="text-body text-ink-3">
          Moving needs no approval: it is not spending. It shows on Research’s statement as “Funded by the workspace” or “Taken back by the
          workspace”.
        </p>
      </Dialog>

      <Dialog
        open={open === 'void'}
        onClose={close}
        title="Void invoice INV-000002?"
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                showSnack({ title: 'INV-000002 is void', line: 'Its pay link no longer works.' })
                close()
              }}
            >
              Void it
            </Button>
          </>
        }
      >
        <p>Orbit Studio can no longer pay it, and this cannot be undone.</p>
      </Dialog>

      {open === 'sheet' ? (
        <Layer label="Approving Acme Hosting" onClose={close}>
          <SheetFrame
            onClose={close}
            head={
              <div>
                <div className="font-bold">Research wants to pay</div>
                <div className="text-body text-ink-3">October hosting invoice</div>
              </div>
            }
            amount="$340.00"
            to={
              <>
                to <b className="text-ink">Acme Hosting</b>
              </>
            }
            facts={[
              { label: 'Why it’s asking', value: 'It asks you above $250.00 (2,500 LXC)' },
              { label: 'Paid from', value: 'Research’s US dollar account (holds $400.00)' },
              { label: 'Budget left after', value: '$420.00 of $2,000.00 (4,200 of 20,000 LXC)' },
              { label: 'Expires', value: 'Tomorrow at 09:17' },
            ]}
            only="This approves this payment only. Approving or declining asks for your passkey."
            actions={
              <>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    showSnack({ title: 'Approved: Acme Hosting, $340.00', line: 'It goes through the next time Research sends it, once, within 24 hours.' })
                    close()
                  }}
                >
                  Approve with your passkey
                </Button>
                <Button size="lg" variant="secondary" className="w-full" onClick={close}>
                  Decline
                </Button>
              </>
            }
          />
        </Layer>
      ) : null}
      <SnackHost view="/__pocket-story/" />
    </section>
  )
}

// B57.122 — the 15 card faces, each drawn by the one Card component with the sample account's names: the owner's
// name or team on owner cards, the agent's own name and job line on agent cards (layout/Card.dc.html's sub lines and
// the handoff's helper jobs). The last card carries a 24-character agent name to show it stays clear of the corner.
const ownerSub = { personal: 'Your everyday account', corporate: 'For your team and its agents', stablecoin: 'Spends from your own wallet' } as const
const agentLine: Record<string, [string, string]> = {
  Remy: ['Research', 'Research · pays in dollars'],
  Sunny: ['Sales', 'Sales · pays in euros'],
  Penny: ['Bookkeeping', 'Bookkeeping · pays in USDC'],
  Max: ['Ads', 'Ads · pays in pounds'],
  Nova: ['Travel', 'Travel · pays in euros'],
  Ollie: ['Quartermaster Atlas Bell', 'Support · pays in dollars'],
}

// The art is the same in either theme, so the faces show once.
function Cards() {
  return (
    <section data-theme="light" data-design="pocket" aria-label="Cards" className="grid content-start gap-6 bg-page p-6 text-ink wide:col-span-2">
      <PageHeading line="Every card face, drawn from its art.">Cards</PageHeading>
      <div className="grid gap-4 wide:grid-cols-3">
        {cardArt.map((c) =>
          c.family === 'agent' ? (
            <TalyvorCard key={c.id} card={c} holder={agentLine[c.helper][0]} sub={agentLine[c.helper][1]} />
          ) : (
            <TalyvorCard key={c.id} card={c} holder={c.family === 'corporate' ? 'Nick’s team' : 'Nick'} sub={ownerSub[c.family]} />
          ),
        )}
      </div>
    </section>
  )
}

export function Story() {
  return (
    <main className="grid wide:grid-cols-2">
      <Specimens theme="light" />
      <Specimens theme="dark" />
      <Frames />
      <Cards />
    </main>
  )
}
