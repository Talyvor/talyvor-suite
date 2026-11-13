import { Face } from '@talyvor/ui/pocket'
import type { Agent } from './agentBankApi'

/** B57.6 — an agent's Pocket face: asleep while it is paused, level while it has no owner and so cannot be funded. */
export function AgentFace({ agent, size, waiting }: { agent: Agent; size?: number; waiting?: boolean }) {
  const state = agent.paused_at ? 'asleep' : agent.owner_user_id === '' ? 'level' : 'happy'
  return <Face agent={agent} state={state} size={size} waiting={waiting} />
}
