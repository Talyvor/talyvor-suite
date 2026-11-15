import { Face, faceOf } from '@talyvor/ui/pocket'
import { cn } from '@talyvor/ui'

import { cardArt, cardFaces, type AgentCardArt } from './cardArt'
import { CardHolder, TalyvorCard, cardFrame, cardShadow, cardUnit } from './TalyvorCard'

// B57.125 — an agent's own card on the web: the helper drawn for its colour (Remy for cobalt, and so on), with the
// agent's own name and its job line. Lime has no helper yet, so a lime agent keeps today's face on a plain lime card
// (cards handoff, 10 Nov 2026). The colour is the one Lens stores for the agent, or the pick from its id, as its face
// uses. The phone draws the same card (talyvor-mobile B57.126).

type AgentLike = { id: string; name: string; description?: string; colour?: string; face?: string }

/** The alt text names the agent, never the helper: "Atlas, Research's agent card". */
export function agentCardLabel(name: string, sub: string): string {
  const job = sub.split(' · ')[0].trim()
  return job ? `${name}, ${job}'s agent card` : `${name}'s agent card`
}

/** The helper card for a colour; none for lime. */
export function helperFor(colour: string): AgentCardArt | undefined {
  return cardArt.find((c): c is AgentCardArt => c.family === 'agent' && c.colour === colour)
}

/** `sub` is the line under the name in place of its job: the agent's page writes "Agent card · pounds" (B57.20). */
export function AgentCard({ agent, sub: line, className }: { agent: AgentLike; sub?: string; className?: string }) {
  const { colour } = faceOf(agent)
  const sub = line ?? agent.description ?? ''
  const label = agentCardLabel(agent.name, agent.description ?? '')
  const helper = helperFor(colour)
  if (helper) return <TalyvorCard card={helper} holder={agent.name} sub={sub} alt={label} className={className} />

  const face = cardFaces.ink
  return (
    <div
      role="img"
      aria-label={label}
      data-card="agent-plain"
      className={cn('relative w-full overflow-hidden font-sans', className)}
      // Inline, as the art cards' ground is: ink on lime is 11:1 and the sub line's ink-2 5.8:1.
      style={{ ...cardFrame, background: 'var(--agent-lime)', color: face.ink, boxShadow: cardShadow }}
    >
      <img
        data-card-part="logo"
        src={`/brand/logo/talyvor-logo-${face.logo}.svg`}
        alt=""
        className="absolute h-auto"
        style={{ left: cardUnit(22), top: cardUnit(22), width: cardUnit(112) }}
      />
      {/* Today's face, scaled with the card; the card's own label speaks for it. */}
      <div aria-hidden="true" className="absolute" style={{ right: cardUnit(22), top: cardUnit(22), width: cardUnit(72), height: cardUnit(72) }}>
        <Face agent={agent} size={72} className="!h-full !w-full [&>svg]:h-full [&>svg]:w-full" />
      </div>
      <CardHolder holder={agent.name} sub={sub} agent ink2={face.ink2} />
    </div>
  )
}
