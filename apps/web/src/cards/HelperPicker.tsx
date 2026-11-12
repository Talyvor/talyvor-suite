import { Button } from '@talyvor/ui'
import type { FaceColour } from '@talyvor/ui/pocket'

import { pressed } from '../areas/lens/walletBrand'
import { cardArt, type AgentCardArt } from './cardArt'

// B57.124 — where the owner creates or edits an agent, the colour choice shows the six helpers, each its portrait
// and name: picking one sets the colour Lens already stores (Remy cobalt, Sunny orchid, Penny mint, Max lemon, Nova
// sky, Ollie rose). Lime has no helper yet, so it stays a plain lime choice. The agent keeps the name its owner gave
// it; the helper is only its face.

const helpers = cardArt.filter((c): c is AgentCardArt => c.family === 'agent')

/** Where each helper's head sits in its art, as a share of the art's width and height. */
const head: Record<AgentCardArt['helper'], [number, number]> = {
  Remy: [0.7, 0.3],
  Sunny: [0.67, 0.35],
  Penny: [0.72, 0.33],
  Max: [0.67, 0.46],
  Nova: [0.68, 0.42],
  Ollie: [0.7, 0.4],
}

/** The art is 1536 × 968; the round portrait shows a square 0.6 of the art's height, centred on the head. */
const zoom = 1 / 0.6
const aspect = 1536 / 968

function Portrait({ helper }: { helper: AgentCardArt }) {
  const [x, y] = head[helper.helper]
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  return (
    <span className="relative size-8 shrink-0 overflow-hidden rounded-pill" aria-hidden="true">
      <img
        src={helper.art}
        alt=""
        className="absolute max-w-none"
        style={{
          height: pct(zoom),
          width: pct(zoom * aspect),
          left: pct(Math.min(0, Math.max(1 - zoom * aspect, 0.5 - x * zoom * aspect))),
          top: pct(Math.min(0, Math.max(1 - zoom, 0.5 - y * zoom))),
        }}
      />
    </span>
  )
}

export function HelperPicker({ label, value, onChange }: { label: string; value: FaceColour | null; onChange: (c: FaceColour) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {helpers.map((h) => (
        <Button key={h.id} aria-pressed={value === h.colour} className={`h-10 gap-2 pl-1 ${pressed}`} onClick={() => onChange(h.colour)}>
          <Portrait helper={h} />
          {h.helper}
        </Button>
      ))}
      <Button aria-pressed={value === 'lime'} className={`h-10 gap-2 pl-1 ${pressed}`} onClick={() => onChange('lime')}>
        <span className="size-8 shrink-0 rounded-pill bg-agent-lime" aria-hidden="true" />
        Lime
      </Button>
    </div>
  )
}
