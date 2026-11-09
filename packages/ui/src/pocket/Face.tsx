import { cn } from '../lib/cn'
import { pocket } from '../tokens'

// B57.6 — an agent's face, as the reference's #system "Agent faces" draws it: seven colours by four shapes by
// three states on a 100-unit grid. White features on cobalt only, ink on the rest. Faces are only for agents:
// a room draws RoomBadge, and Chat or an assistant draws the chat tile.
export const faceColours = ['cobalt', 'orchid', 'sky', 'mint', 'lemon', 'rose', 'lime'] as const
export const faceShapes = ['circle', 'squircle', 'hexagon', 'flower'] as const
export type FaceColour = (typeof faceColours)[number]
export type FaceShape = (typeof faceShapes)[number]
/** happy while it runs, asleep while paused, level when blocked or declined. */
export type FaceState = 'happy' | 'asleep' | 'level'

export const faceFill = (colour: FaceColour) => pocket.light[`agent-${colour}`]
export const featureFill = (colour: FaceColour) => (colour === 'cobalt' ? pocket.light['on-primary'] : pocket.light.ink)

/** FNV-1a, 32-bit, over the id's UTF-8 bytes: the same pick Lens backfills its colour and face fields with. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h
}

/** An agent's colour and face: Lens's own fields once it sends them (B57.10), else the pick from its id. */
export function faceOf(agent: { id: string; colour?: string; face?: string }): { colour: FaceColour; shape: FaceShape } {
  const h = fnv1a(agent.id)
  const colour = faceColours.find((c) => c === agent.colour) ?? faceColours[h % 7]
  const shape = faceShapes.find((s) => s === agent.face) ?? faceShapes[Math.floor(h / 7) % 4]
  return { colour, shape }
}

function shapeOf(shape: FaceShape, fill: string) {
  switch (shape) {
    case 'circle':
      return <circle cx="50" cy="50" r="50" fill={fill} />
    case 'squircle':
      return <rect x="0" y="0" width="100" height="100" rx="31" fill={fill} />
    case 'hexagon':
      return <polygon points="50,9 88,30 88,70 50,91 12,70 12,30" fill={fill} stroke={fill} strokeWidth="16" strokeLinejoin="round" />
    case 'flower':
      return (
        <>
          <circle cx="31" cy="31" r="27" fill={fill} />
          <circle cx="69" cy="31" r="27" fill={fill} />
          <circle cx="31" cy="69" r="27" fill={fill} />
          <circle cx="69" cy="69" r="27" fill={fill} />
          <circle cx="50" cy="50" r="34" fill={fill} />
        </>
      )
  }
}

function featuresOf(state: FaceState, ink: string) {
  const line = { stroke: ink, strokeLinecap: 'round', fill: 'none' } as const
  if (state === 'asleep')
    return (
      <>
        <path d="M30 47 Q37 53 44 47" {...line} strokeWidth="5.5" />
        <path d="M56 47 Q63 53 70 47" {...line} strokeWidth="5.5" />
        <path d="M44 65 L56 65" {...line} strokeWidth="5.5" />
      </>
    )
  return (
    <>
      <circle cx="37" cy="45" r="6.6" fill={ink} />
      <circle cx="63" cy="45" r="6.6" fill={ink} />
      <path d={state === 'happy' ? 'M37 60 Q50 72 63 60' : 'M41 64 L59 64'} {...line} strokeWidth="5.8" />
    </>
  )
}

export interface FaceProps {
  agent: { id: string; name: string; colour?: string; face?: string }
  state?: FaceState
  /** The tangerine badge: something of this agent's waits for a person. */
  waiting?: boolean
  /** Edge in px: 34 in a row, 44 on Home, 60 on the agent's own page. */
  size?: number
  className?: string
}

export function Face({ agent, state = 'happy', waiting = false, size = 34, className }: FaceProps) {
  const { colour, shape } = faceOf(agent)
  return (
    <span
      role="img"
      aria-label={`${agent.name} agent`}
      data-face={`${colour} ${shape} ${state}`}
      className={cn('relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="block">
        {shapeOf(shape, faceFill(colour))}
        {featuresOf(state, featureFill(colour))}
      </svg>
      {/* pocket.css .face .badge: 30% of the face, at least 9px, ringed in the page colour. */}
      {waiting ? (
        <i
          data-badge="waiting"
          className="absolute -right-0.5 -top-0.5 rounded-pill bg-tangerine ring-2 ring-page"
          style={{ width: Math.max(9, size * 0.3), height: Math.max(9, size * 0.3) }}
        />
      ) : null}
    </span>
  )
}
