import { useQuery } from '@tanstack/react-query'
import { cn } from '@talyvor/ui'
import { type AgentApproval, type PaymentRequest, agentBankApi } from '../areas/lens/agentBankApi'
import { CAPABILITIES_KEY } from '../areas/lens/WalletMoney'
import { StatusLabel } from './StatusLabel'

// B56.11 — LABELS IN THE APP. A signed-in money screen says Live or Sandbox from what Lens answers for THIS workspace
// (talyvor-lens B56.7: sandbox while its plan has no live money, while it is synthetic, or while a rail is in test),
// read from the same capabilities list Verification and Compliance read, so one answer labels every screen. Until
// Lens answers, or for a capability it gave no label, nothing is drawn.

/** Lens's label for each of the workspace's money capabilities, by key; undefined until it answers. */
export function useWorkspaceLabels(): Record<string, string> | undefined {
  return labelsOf(useCapabilities().data)
}

function useCapabilities() {
  return useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities, staleTime: 60_000 })
}

function labelsOf(data: Awaited<ReturnType<typeof agentBankApi.capabilities>> | undefined): Record<string, string> | undefined {
  if (!data) return undefined
  return Object.fromEntries((data.capabilities ?? []).flatMap((c) => (c.label ? [[c.capability, c.label]] : [])))
}

/** The chip for a money screen or panel: Live only when Lens says live for every capability it moves. */
export function WorkspaceLabel({ capability, className }: { capability: string | readonly string[]; className?: string }) {
  return <StatusLabel capability={capability} labels={useWorkspaceLabels()} className={className} />
}

/** B57.118 — the top bar's label, top right on every signed-in screen (the launch pack's design, W2 to W5): Sandbox
 *  while any money capability Lens labels is sandbox for this workspace, Live once every one is live. Nothing while Lens
 *  is reading or gives no label; a read that failed says Status unknown, so the label never vanishes for a reason the
 *  owner cannot see (S-06). */
export function WorkspaceStatus({ className }: { className?: string }) {
  const caps = useCapabilities()
  const labels = labelsOf(caps.data)
  if (!labels && caps.isError) {
    return (
      <span
        data-testid="workspace-status-unknown"
        title="Talyvor could not read whether this workspace moves real money."
        className={cn(
          'inline-flex h-6 items-center whitespace-nowrap rounded-pill bg-page px-2.5 text-micro font-semibold text-ink-2 shadow-edge',
          className,
        )}
      >
        Status unknown
      </span>
    )
  }
  return <StatusLabel capability={Object.keys(labels ?? {})} labels={labels} className={className} />
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
