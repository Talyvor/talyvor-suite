import { pocketFocusRing } from '@talyvor/ui/pocket'

import { AGENT_PICTURES, type AgentPicture } from './agentPictures'

// B57.124 — where the owner creates or edits an agent, the colour choice shows the six helpers, each its portrait
// and name: picking one sets the colour Lens already stores (Remy cobalt, Sunny orchid, Penny mint, Max lemon, Nova
// sky, Ollie rose). Lime has no helper yet, so it stays a plain lime choice. The agent keeps the name its owner gave
// it; the helper is only its face.
// B57.141 — in Pocket, each choice is a pick (pocket.css .pill.pick): a cloud pill 34 tall with the portrait 22
// across, and the picked one on the page inside a 2px ink ring (.pick.on). Agents is still held to today's design
// (pocketPending.ts), so the choice says it is drawn in Pocket on its own root.
// B61.102 — then the twenty pictures B61.36 added, each a round portrait without a name, in the same ring when picked.

/** The art is 1536 × 968; the round portrait shows a square 0.6 of the art's height, centred on the head. */
const zoom = 1 / 0.6
const aspect = 1536 / 968

/** B61.13 — also New agent's pictures, larger and without the helper's name; B61.102 — any picture of the gallery. */
export function Portrait({ picture, className = 'size-5.5' }: { picture: AgentPicture; className?: string }) {
  if (picture.art === null) return <span className={`${className} shrink-0 rounded-pill bg-agent-lime`} aria-hidden="true" />
  const [x, y] = picture.head
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const img = (
    <img
      src={picture.art}
      alt=""
      decoding="async"
      className="absolute max-w-none"
      style={{
        height: pct(zoom),
        width: pct(zoom * aspect),
        left: pct(Math.min(0, Math.max(1 - zoom * aspect, 0.5 - x * zoom * aspect))),
        top: pct(Math.min(0, Math.max(1 - zoom, 0.5 - y * zoom))),
      }}
    />
  )
  return (
    <span className={`relative ${className} shrink-0 overflow-hidden rounded-pill`} aria-hidden="true" data-picture={picture.id}>
      {picture.webp ? (
        <picture>
          <source type="image/webp" srcSet={picture.webp} />
          {img}
        </picture>
      ) : (
        img
      )}
    </span>
  )
}

const pick = `inline-flex h-8.5 items-center gap-2 whitespace-nowrap rounded-pill bg-cloud pl-1.5 pr-3 text-body font-semibold text-ink transition-colors duration-200 aria-pressed:bg-page aria-pressed:shadow-pick ${pocketFocusRing}`
const round = `inline-flex size-8.5 rounded-pill p-0.5 aria-pressed:shadow-pick ${pocketFocusRing}`

/** The gallery: value and onChange are Lens's picture ids. */
export function HelperPicker({ label, value, onChange }: { label: string; value: string | null; onChange: (p: AgentPicture) => void }) {
  return (
    <div data-design="pocket" className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {AGENT_PICTURES.map((p, i) =>
        p.helper ? (
          <button key={p.id} type="button" aria-pressed={value === p.id} className={pick} onClick={() => onChange(p)}>
            <Portrait picture={p} />
            {p.helper}
          </button>
        ) : p.art === null ? (
          <button key={p.id} type="button" aria-pressed={value === p.id} className={pick} onClick={() => onChange(p)}>
            <Portrait picture={p} />
            Lime
          </button>
        ) : (
          <button key={p.id} type="button" aria-label={`Picture ${i + 1}`} aria-pressed={value === p.id} className={round} onClick={() => onChange(p)}>
            <Portrait picture={p} className="size-full" />
          </button>
        ),
      )}
    </div>
  )
}
