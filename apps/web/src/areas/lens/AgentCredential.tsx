import { useMutation } from '@tanstack/react-query'
import { Button, Chip, Facts, Money, pocketFocusRing } from '@talyvor/ui/pocket'
import { CopyButton } from '../chat/CopyButton'
import { formatWhen } from './format'
import { Note } from './WalletMoney'
import { type Agent, type KYACredential, agentBankApi, refusalText } from './agentBankApi'
import { DESIGN_ATTR } from '../../pocketPending'

// AgentCredential.tsx — B30.103: an agent's Know Your Agent credential (Lens B30.5, docs/kya.md). What it says — the
// agent, its owner's verified name and level, what it may do with live money, its limits — the credential itself to
// copy and hand to another platform, and Talyvor's own check of it, the same check that platform makes. Lens signs and
// revokes; a frozen or archived agent has none, and Lens's sentence says why. B57.167: drawn in Pocket, in the dialog
// its Settings row opens.

/** The limits a credential may state, in the order a person reads them; an absent one is not set. */
const LIMITS: [string, string][] = [
  ['max_per_request_ulxc', 'Per request'],
  ['hourly_limit_ulxc', 'Each hour'],
  ['daily_limit_ulxc', 'Each day'],
  ['weekly_limit_ulxc', 'Each week'],
  ['monthly_limit_ulxc', 'Each month'],
  ['approval_above_ulxc', 'A person approves above'],
  ['max_commitment_ulxc', 'Most it may commit'],
]

export function AgentCredentialCard({ agent }: { agent: Agent }) {
  const read = useMutation({ mutationFn: () => agentBankApi.credential(agent.id) })
  const check = useMutation({ mutationFn: (token: string) => agentBankApi.verifyCredential(token) })
  const c = read.data
  return (
    <div className="grid gap-3.5" data-testid="agent-credential" {...{ [DESIGN_ATTR]: 'pocket' }}>
      <p>
        Its Know Your Agent credential, signed by Talyvor: who owns {agent.name}, how far they are verified, what it may do with live money and its
        limits. Any platform can check it.
      </p>
      <div className="flex justify-end">
        <Button
          variant={c ? 'secondary' : 'primary'}
          disabled={read.isPending}
          onClick={() => {
            check.reset()
            read.mutate()
          }}
        >
          {read.isPending ? 'Reading…' : c ? 'Read it again' : 'Show its credential'}
        </Button>
      </div>
      {read.isError ? <Note ok={false}>{refusalText(read.error)}</Note> : null}
      {c ? <CredentialBody c={c} /> : null}
      {c ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <CopyButton
              text={c.credential}
              label="Copy credential"
              className="inline-flex h-11 items-center rounded-pill bg-cloud-2 px-5 text-reading font-semibold text-ink"
            />
            <Button disabled={check.isPending} onClick={() => check.mutate(c.credential)}>
              {check.isPending ? 'Checking…' : 'Check it with Talyvor'}
            </Button>
          </div>
          {check.isSuccess ? (
            check.data.valid ? (
              <p className="flex flex-wrap items-center gap-2 text-body text-ink" role="status" data-testid="credential-verdict">
                <Chip tone="good">Valid</Chip>
                <span>Talyvor issued it, has not revoked it, and it says what is true of {agent.name} now.</span>
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-body text-ink" role="alert" data-testid="credential-verdict">
                <Chip tone="bad">Not valid</Chip>
                <span>{check.data.reason}</span>
              </p>
            )
          ) : null}
          {check.isError ? <Note ok={false}>{refusalText(check.error)}</Note> : null}
        </div>
      ) : null}
    </div>
  )
}

function CredentialBody({ c }: { c: KYACredential }) {
  const { owner, capabilities, limits } = c.claims
  const live = (capabilities ?? []).filter((x) => x.money === 'live').length
  const all = (capabilities ?? []).length
  const set = LIMITS.filter(([k]) => typeof limits?.[k] === 'number' && (limits[k] as number) > 0)
  return (
    <div className="grid gap-3.5">
      <Facts
        facts={[
          {
            label: 'Owner',
            value: (
              <span data-testid="credential-owner">
                {owner.name || 'Not verified by name yet'} · level {owner.level}, live level {owner.live_level}
              </span>
            ),
          },
          {
            label: 'Live money',
            value: (
              <span data-testid="credential-capabilities">
                {live} of {all} capabilities
              </span>
            ),
          },
          {
            label: 'Limits',
            value: (
              <span className="grid justify-items-end gap-1" data-testid="credential-limits">
                {set.length > 0
                  ? set.map(([k, label]) => (
                      <span key={k}>
                        {label} <Money ulxc={limits[k] as number} />
                      </span>
                    ))
                  : 'No spending limit is set'}
              </span>
            ),
          },
          {
            label: 'Valid',
            value: (
              <>
                {formatWhen(c.issued_at)} to {formatWhen(c.expires_at)}
              </>
            ),
          },
        ]}
      />
      <pre
        className={`max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-control bg-cloud px-4 py-2.5 font-mono text-body text-ink ${pocketFocusRing}`}
        data-testid="credential-token"
        tabIndex={0}
        aria-label="The credential"
      >
        {c.credential}
      </pre>
      <p className="text-body text-ink-3">
        A platform checks it against Talyvor’s published keys
        {c.jwks_url ? (
          <>
            {' '}
            at <span className="break-all font-mono text-ink">{c.jwks_url}</span>
          </>
        ) : null}
        , or asks Talyvor as the button above does. Freezing the agent, archiving it or changing its rules revokes it.
      </p>
    </div>
  )
}
