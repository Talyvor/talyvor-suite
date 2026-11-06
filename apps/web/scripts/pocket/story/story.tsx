// B57.1 — the components on one page, for pocket-shots. Built by scripts/pocket/shots.mjs outside dist, so the app
// never routes to it (src/FirstRunGaps.test.tsx keeps /specimen gone).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Card, CardHeader, Input, Pill, Row, Switch } from '@talyvor/ui'

import '@talyvor/ui/theme.css'
import '../../../src/styles.css'

const STATUSES = ['settled', 'held', 'slashed', 'lens', 'lxc', 'idle', 'parked'] as const

function Story() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 bg-canvas p-6 text-ink">
      <h1 className="text-2xl font-semibold">Components</h1>
      <section aria-label="Buttons" className="flex flex-wrap gap-3">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
      </section>
      <section aria-label="Pills" className="flex flex-wrap gap-3">
        {STATUSES.map((s) => (
          <Pill key={s} status={s}>
            {s}
          </Pill>
        ))}
      </section>
      <Card>
        <CardHeader>
          <h2>Card</h2>
        </CardHeader>
        <Row label="Row" hint="A hint under the label">
          <Switch aria-label="Switch" />
        </Row>
        <Row label="Input" stack>
          <Input aria-label="Input" placeholder="Placeholder" />
        </Row>
      </Card>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Story />
  </StrictMode>,
)
