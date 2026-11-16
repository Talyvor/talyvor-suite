import type { FaceColour } from '@talyvor/ui/pocket'

import { cardArt, type AgentCardArt } from './cardArt'

// B61.102 — the gallery an agent's picture is chosen from, in Lens's order (economy.AgentPictures): the six helpers
// under the ids of their colours, lime (a plain lime face), then the twenty B61.36 added. Each picture's colour is the
// one Lens gives it, so the agent's colour follows its picture. No picture carries a name: the agent keeps its owner's.
// The twenty are served from /agent-pictures, each a 1536 × 968 WebP (design/agent-pictures, cropped from the bottom
// to the helpers' 1536:968) with a 768-wide PNG for a browser without WebP.

export interface AgentPicture {
  /** Lens's picture id */
  id: string
  colour: FaceColour
  /** the art, or null for lime's plain face */
  art: string | null
  /** a WebP of the same art, when there is one */
  webp: string | null
  /** where the head sits in the art, as a share of its width and height: Portrait centres on it */
  head: [number, number]
  /** one of the six's own name, which only the helper picker shows (B57.124) */
  helper: AgentCardArt['helper'] | null
}

/** Where each helper's head sits in its art. */
const helperHead: Record<AgentCardArt['helper'], [number, number]> = {
  Remy: [0.7, 0.3],
  Sunny: [0.67, 0.35],
  Penny: [0.72, 0.33],
  Max: [0.67, 0.46],
  Nova: [0.68, 0.42],
  Ollie: [0.7, 0.4],
}

const helpers: AgentPicture[] = cardArt
  .filter((c): c is AgentCardArt => c.family === 'agent')
  .map((c) => ({ id: c.colour, colour: c.colour, art: c.art, webp: null, head: helperHead[c.helper], helper: c.helper }))

const lime: AgentPicture = { id: 'lime', colour: 'lime', art: null, webp: null, head: [0.5, 0.5], helper: null }

const drawn = (id: string, colour: FaceColour, head: [number, number]): AgentPicture => ({
  id, colour, art: `/agent-pictures/${id}.png`, webp: `/agent-pictures/${id}.webp`, head, helper: null,
})

/** The twenty of B61.36, each with its colour from pictures.json and its head measured on the cropped art. */
export const NEW_PICTURES: readonly AgentPicture[] = [
  drawn('shopper', 'lime', [0.69, 0.31]),
  drawn('grocer', 'mint', [0.7, 0.31]),
  drawn('bills', 'sky', [0.71, 0.33]),
  drawn('saver', 'rose', [0.66, 0.35]),
  drawn('coder', 'cobalt', [0.71, 0.39]),
  drawn('designer', 'orchid', [0.71, 0.36]),
  drawn('writer', 'lemon', [0.71, 0.32]),
  drawn('social', 'rose', [0.74, 0.36]),
  drawn('recruiter', 'sky', [0.7, 0.38]),
  drawn('legal', 'cobalt', [0.71, 0.38]),
  drawn('analyst', 'mint', [0.71, 0.38]),
  drawn('events', 'orchid', [0.73, 0.42]),
  drawn('chef', 'lemon', [0.71, 0.41]),
  drawn('coach', 'lime', [0.7, 0.38]),
  drawn('home', 'rose', [0.71, 0.38]),
  drawn('driver', 'sky', [0.73, 0.39]),
  drawn('tutor', 'cobalt', [0.7, 0.4]),
  drawn('musician', 'orchid', [0.71, 0.4]),
  drawn('photographer', 'lemon', [0.71, 0.3]),
  drawn('gardener', 'lime', [0.73, 0.37]),
]

export const AGENT_PICTURES: readonly AgentPicture[] = [...helpers, lime, ...NEW_PICTURES]

/** The picture an agent wears: the one Lens names, else its colour's (an agent from before B61.35). */
export function pictureOf(agent: { picture?: string; colour?: string }): AgentPicture | undefined {
  return AGENT_PICTURES.find((p) => p.id === agent.picture) ?? AGENT_PICTURES.find((p) => p.id === agent.colour)
}

/** What to send Lens for a picture: a helper's or lime's colour, as before B61.102, or one of the twenty by its id. */
export function lookFor(p: AgentPicture): { colour: FaceColour } | { picture: string } {
  return NEW_PICTURES.includes(p) ? { picture: p.id } : { colour: p.colour }
}
