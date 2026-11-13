import { pocketFocusRing, type FaceColour } from '@talyvor/ui/pocket'

import { cardArt, type AgentCardArt } from './cardArt'

// B57.124 — where the owner creates or edits an agent, the colour choice shows the six helpers, each its portrait
// and name: picking one sets the colour Lens already stores (Remy cobalt, Sunny orchid, Penny mint, Max lemon, Nova
// sky, Ollie rose). Lime has no helper yet, so it stays a plain lime choice. The agent keeps the name its owner gave
// it; the helper is only its face.
// B57.141 — in Pocket, each choice is a pick (pocket.css .pill.pick): a cloud pill 34 tall with the portrait 22
// across, and the picked one on the page inside a 2px ink ring (.pick.on). Agents is still held to today's design
// (pocketPending.ts), so the choice says it is drawn in Pocket on its own root.

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
    <span className="relative size-5.5 shrink-0 overflow-hidden rounded-pill" aria-hidden="true">
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

const pick = `inline-flex h-8.5 items-center gap-2 whitespace-nowrap rounded-pill bg-cloud pl-1.5 pr-3 text-body font-semibold text-ink transition-colors duration-200 aria-pressed:bg-page aria-pressed:shadow-pick ${pocketFocusRing}`

export function HelperPicker({ label, value, onChange }: { label: string; value: FaceColour | null; onChange: (c: FaceColour) => void }) {
  return (
    <div data-design="pocket" className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {helpers.map((h) => (
        <button key={h.id} type="button" aria-pressed={value === h.colour} className={pick} onClick={() => onChange(h.colour)}>
          <Portrait helper={h} />
          {h.helper}
        </button>
      ))}
      <button type="button" aria-pressed={value === 'lime'} className={pick} onClick={() => onChange('lime')}>
        <span className="size-5.5 shrink-0 rounded-pill bg-agent-lime" aria-hidden="true" />
        Lime
      </button>
    </div>
  )
}
