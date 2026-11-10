import { useQuery } from '@tanstack/react-query'
import { type AgentApproval, type PaymentRequest, agentBankApi } from '../areas/lens/agentBankApi'
import { CAPABILITIES_KEY } from '../areas/lens/WalletMoney'
import { StatusLabel } from './StatusLabel'

// B56.11 — LABELS IN THE APP. A signed-in money screen says Live or Sandbox from what Lens answers for THIS workspace
// (talyvor-lens B56.7: sandbox while its plan has no live money, while it is synthetic, or while a rail is in test),
// read from the same capabilities list Verification and Compliance read, so one answer labels every screen. Until
// Lens answers, or for a capability it gave no label, nothing is drawn.

/** Lens's label for each of the workspace's money capabilities, by key; undefined until it answers. */
export function useWorkspaceLabels(): Record<string, string> | undefined {
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities, staleTime: 60_000 })
  if (!caps.data) return undefined
  return Object.fromEntries((caps.data.capabilities ?? []).flatMap((c) => (c.label ? [[c.capability, c.label]] : [])))
}

/** The chip for a money screen or panel: Live only when Lens says live for every capability it moves. */
export function WorkspaceLabel({ capability, className }: { capability: string | readonly string[]; className?: string }) {
  return <StatusLabel capability={capability} labels={useWorkspaceLabels()} className={className} />
}

/** The sidebar's one chip under the workspace name: Sandbox while every money capability Lens labels is sandbox for
 *  this workspace, and nothing once any is live (each screen then says which). */
export function WorkspaceSandbox({ className }: { className?: string }) {
  const labels = useWorkspaceLabels()
  const keys = Object.keys(labels ?? {})
  if (!keys.length || keys.some((k) => labels?.[k] !== 'sandbox')) return null
  return <StatusLabel capability={keys} labels={labels} className={className} />
}

/** The capability an agent's approval moves money on: a model call is spending on Talyvor; a payment is by its payee. */
export function approvalCapability(a: AgentApproval, ownAgent: (id: string) => boolean): string {
  switch (a.payee?.kind) {
    case undefined:
      return 'spend_on_talyvor'
    case 'listing':
      return 'buy_marketplace_listings'
    case 'outside':
      return 'payments_out'
    case 'agent':
      return ownAgent(a.payee.id) ? 'move_between_own_agents' : 'pay_another_owner'
    default:
      return 'pay_another_owner'
  }
}

/** The capabilities a prepared payment request moves money on: a listing's use is bought on Talyvor; every other line
 *  is paid out to a saved payee outside it. */
export function paymentRequestCapabilities(r: PaymentRequest): string[] {
  return [...new Set((r.items ?? []).map((it) => (it.listing_id ? 'buy_marketplace_listings' : 'payments_out')))]
}
