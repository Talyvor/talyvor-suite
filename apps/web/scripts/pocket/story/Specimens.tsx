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
  EmptyState,
  Eyebrow,
  Facts,
  Field,
  Input,
  KindTile,
  PageHeading,
  RoomBadge,
  Row,
  Select,
  Steps,
  Switch,
  Tabs,
} from '@talyvor/ui/pocket'

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

export function Story() {
  return (
    <main className="grid wide:grid-cols-2">
      <Specimens theme="light" />
      <Specimens theme="dark" />
    </main>
  )
}
