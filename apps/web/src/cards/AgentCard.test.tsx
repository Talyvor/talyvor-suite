// B57.125 — an agent's card shows the helper for its colour, with the agent's own name and job line, and a lime agent
// keeps today's face on a plain lime card. The alt text names the agent, never the helper.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { faceColours } from '@talyvor/ui/pocket'
import { AgentCard, agentCardLabel } from './AgentCard'

const helpers = { cobalt: 'Remy', orchid: 'Sunny', sky: 'Nova', mint: 'Penny', lemon: 'Max', rose: 'Ollie' } as const
const atlas = (colour: string) => ({ id: 'agt_atlas', name: 'Atlas', description: 'Research', colour, face: 'circle' })

describe('AgentCard (B57.125)', () => {
  afterEach(cleanup)

  it.each(faceColours.map((c) => [c] as const))('a %s agent matches its snapshot', (colour) => {
    const { container } = render(<AgentCard agent={atlas(colour)} />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it.each(Object.entries(helpers))('a %s agent shows %s with its own name and job line', (colour, helper) => {
    render(<AgentCard agent={atlas(colour)} />)
    const card = screen.getByRole('img', { name: "Atlas, Research's agent card" })
    expect(card.getAttribute('data-card')).toBe(`agent-${helper.toLowerCase()}`)
    expect(card).toHaveTextContent('AtlasResearch')
    expect(card).not.toHaveTextContent(helper)
  })

  it('keeps a lime agent on a plain lime card with its face', () => {
    const { container } = render(<AgentCard agent={atlas('lime')} />)
    const card = screen.getByRole('img', { name: "Atlas, Research's agent card" })
    expect(card.getAttribute('data-card')).toBe('agent-plain')
    expect(card.style.background).toBe('var(--agent-lime)')
    expect(container.querySelector('[data-face="lime circle happy"]')).not.toBeNull()
    expect(container.querySelector('img[src^="/cards/"]')).toBeNull()
  })

  it('names an agent with no job line on its own', () => {
    expect(agentCardLabel('Atlas', '')).toBe("Atlas's agent card")
    expect(agentCardLabel('Atlas', 'Research · pays in dollars')).toBe("Atlas, Research's agent card")
  })
})
