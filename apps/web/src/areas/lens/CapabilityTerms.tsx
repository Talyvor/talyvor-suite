import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Crumb, pocketFocusRing, type ChipTone } from '@talyvor/ui/pocket'
import { Markdown } from '../chat/Markdown'
import { formatWhen } from './format'
import { Note, readFailure } from './WalletMoney'
import { type WorkspaceTerms, agentBankApi, refusalText } from './agentBankApi'

// CapabilityTerms.tsx — B30.103: each money capability's terms (Lens B30.9). Every capability with terms, its latest
// version and whether this workspace has accepted it; its text to read; and the button that accepts the version read.
// Until a capability's latest terms are accepted Lens refuses its money, test or live, so accepting here is what lets
// its first use through. Lens decides who may accept and which version is the latest; a refusal shows its sentence.

export const TERMS_KEY = ['capability-terms']
const termsTextKey = (capability: string) => ['capability-terms', capability]

/** " by <who>" when Lens names the person by an address a reader knows; nothing for an internal id such as jwt:user:…. */
const byWhom = (person: string) => (person.includes('@') && !person.includes(':') ? ` by ${person}` : '')

function state(t: WorkspaceTerms): { text: string; tone: ChipTone } {
  if (t.accepted) return { text: 'Accepted', tone: 'good' }
  if (t.previously_accepted_version)
    return {
      text: `Version ${t.version} is new: accept it again`,
      tone: 'wait',
    }
  return { text: 'Not accepted yet', tone: 'plain' }
}

export function CapabilityTermsScreen() {
  const terms = useQuery({ queryKey: TERMS_KEY, queryFn: agentBankApi.terms })
  const [open, setOpen] = useState<string | null>(null)
  const list = terms.data?.terms ?? []
  const accepted = list.filter((t) => t.accepted).length
  // B57.42 — Pocket's w-capability: the crumb, the line, and one white card listing every capability with terms.
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Capability terms' }]} />
      <div className="grid max-w-3xl gap-1">
        <h2 className="font-display text-bar font-bold text-ink">The terms each money capability asks you to accept</h2>
        <p className="text-reading text-ink-2">
          Each money capability asks you to accept its terms before its first use. When Talyvor publishes a new version, the capability asks
          again before its next use.
        </p>
        <p className="text-body text-ink-2">
          Which of them may use live money depends on your verification level:{' '}
          <Link className={cn(inlineLink, 'font-semibold text-ink')} to="/settings/verification">
            see Verification
          </Link>
          .
        </p>
      </div>
      {terms.isError ? (
        <p className="text-body text-ink-2">{readFailure(terms.error, 'The terms')}</p>
      ) : terms.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : list.length === 0 ? (
        <p className="text-body text-ink-2">No capability asks for terms on this deployment yet.</p>
      ) : (
        <Card tone="white" className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-reading font-bold text-ink">Read each one, then accept it</h3>
            <p className="text-body text-ink-3" data-testid="terms-count">
              <span className="font-figure">{accepted}</span> of <span className="font-figure">{list.length}</span> accepted
            </p>
          </div>
          <ul className="mt-2">
            {list.map((t) => (
              <TermsRow key={t.capability} t={t} open={open === t.capability} onOpen={(o) => setOpen(o ? t.capability : null)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function TermsRow({ t, open, onOpen }: { t: WorkspaceTerms; open: boolean; onOpen: (open: boolean) => void }) {
  const s = state(t)
  return (
    <li className="flex flex-col gap-2 border-t border-line py-2.5 first:border-t-0" data-testid={`terms-${t.capability}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-semibold text-ink">{t.name}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Chip tone={s.tone}>{s.text}</Chip>
          <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => onOpen(!open)}>
            {open ? 'Close' : t.accepted ? 'Read the terms' : 'Read and accept'}
          </Button>
        </span>
      </div>
      <p className="text-body text-ink-3">
        Version <span className="font-figure">{t.version}</span>
        {t.accepted ? (
          <>
            {' '}
            · accepted{byWhom(t.accepted.person)} · <span className="font-figure">{formatWhen(t.accepted.accepted_at)}</span>
          </>
        ) : t.previously_accepted_version ? (
          <>
            {' '}
            · you accepted version <span className="font-figure">{t.previously_accepted_version}</span>
          </>
        ) : null}
      </p>
      {open ? <TermsText t={t} /> : null}
    </li>
  )
}

/** The latest version's text, and the button that accepts it. */
function TermsText({ t }: { t: WorkspaceTerms }) {
  const qc = useQueryClient()
  const text = useQuery({ queryKey: termsTextKey(t.capability), queryFn: () => agentBankApi.termsFor(t.capability) })
  const accept = useMutation({
    mutationFn: (version: number) => agentBankApi.acceptTerms(t.capability, version),
    onSuccess: ({ acceptance }) => {
      qc.setQueryData<{ terms: WorkspaceTerms[] | null }>(TERMS_KEY, (old) =>
        old ? { terms: (old.terms ?? []).map((x) => (x.capability === t.capability ? { ...x, accepted: acceptance } : x)) } : old,
      )
      qc.setQueryData<WorkspaceTerms>(termsTextKey(t.capability), (old) => (old ? { ...old, accepted: acceptance } : old))
    },
    // A newer version was published while this one was being read: read the list and the text again.
    onError: () => void qc.invalidateQueries({ queryKey: TERMS_KEY }),
  })
  if (text.isError) return <p className="text-body text-ink-2">{readFailure(text.error, 'These terms')}</p>
  if (text.isPending) return <p className="text-body text-ink-2">Reading…</p>
  const read = text.data
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn('max-h-96 overflow-y-auto rounded-inset bg-cloud px-4 py-3 text-body text-ink', pocketFocusRing)}
        data-testid="terms-text"
        tabIndex={0}
        aria-label={`${t.name}: terms, version ${read.version}`}
      >
        <Markdown source={read.body ?? ''} />
      </div>
      {read.accepted ? (
        <Note ok>
          Version {read.version} is accepted{byWhom(read.accepted.person)}. {t.name} may be used.
        </Note>
      ) : (
        <div>
          <Button disabled={accept.isPending} onClick={() => accept.mutate(read.version)}>
            {accept.isPending ? 'Accepting…' : `Accept version ${read.version}`}
          </Button>
        </div>
      )}
      {accept.isError ? <Note ok={false}>{refusalText(accept.error)}</Note> : null}
    </div>
  )
}
