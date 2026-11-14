import { useParams } from 'react-router-dom'
import { AgentBank } from './AgentBank'
import { AgentSummaryView } from './AgentPage'

// B57.20 — /agents/:id: the agent's page, and under it what today's agent view has that the page does not draw yet, until
// B57.22 redraws it. Its money features are the page's own (B57.21), so the view under it leaves them out. The page's state is AgentPage.tsx's, mounted afresh for each id by its key, so nothing of
// one agent's page survives into the next one's.
export function AgentPage() {
  const { id } = useParams()
  return (
    <>
      {id ? <AgentSummaryView key={id} id={id} /> : null}
      <AgentBank moneyOnPage />
    </>
  )
}
