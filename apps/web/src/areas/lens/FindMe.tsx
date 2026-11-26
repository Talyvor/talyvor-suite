import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Crumb, Facts, Field, Input, Switch } from '@talyvor/ui/pocket'
import { Choice } from '../auth/Choice'
import { useAuthMeReader } from '../../lib/authMe'
import { AgentBankError, agentBankApi, type PersonFinding, type PersonFindingChange } from './agentBankApi'

// FindMe.tsx — B61.93: how the signed-in person is found on Talyvor, to be paid (BFF B61.93, Lens B61.32). B57.196 —
// Settings, Profile holds their Talyvor name, "Let people find me" (by name or phone number) and being found by email,
// each off until pressed; the end of sign-up asks the one question once. Both draw what Lens RECORDED, from the answer to each write, never
// what was pressed, and a refusal is said in Lens's words.

export const FINDING_KEY = ['people-finding'] as const

/** What a refused write says: Lens's sentence, or that nothing changed. */
function refusalWords(err: unknown): string {
  return err instanceof AgentBankError && err.sentence ? err.sentence : 'That did not save, so nothing changed. You can try again.'
}

function useFinding(enabled = true) {
  return useQuery({ queryKey: FINDING_KEY, queryFn: agentBankApi.personFinding, retry: false, enabled })
}

function useChangeFinding(onDone?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (change: PersonFindingChange) => agentBankApi.changePersonFinding(change),
    onSuccess: (now) => {
      qc.setQueryData<PersonFinding>(FINDING_KEY, now)
      onDone?.()
    },
  })
}

/** One way to be found: its name, what it finds you by, and its switch. */
function FindBy({ id, label, by, checked, reason, busy, onChange }: {
  id: string
  label: string
  by: string
  checked: boolean
  reason?: string
  busy: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <div className="grid min-w-0">
        <span id={id} className="text-body font-semibold text-ink">
          {label}
        </span>
        {by ? <span className="truncate font-figure text-caption text-ink-3">{by}</span> : null}
      </div>
      <Switch aria-labelledby={id} checked={checked} disabled={busy} disabledReason={reason} onCheckedChange={onChange} />
    </div>
  )
}

/** The Talyvor name, from the one Lens kept; Save is there once it is changed. */
function NameForm({ saved, saving, onSave }: { saved: string; saving: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(saved)
  const typed = name.trim()
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed !== saved) onSave(typed)
      }}
    >
      <Field label="Your Talyvor name">
        <Input value={name} autoComplete="off" spellCheck={false} maxLength={21} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="text-caption text-ink-3">3 to 20 letters a to z, digits, dots and underscores.</p>
      {typed !== saved ? (
        <Button type="submit" variant="outline" className="justify-self-start" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      ) : null}
    </form>
  )
}

/** The reference's "Let people find me": one switch, by name and phone number together; on, before a name is chosen, by
 *  phone number only, as the sign-up question turns it on. */
function findMe(on: boolean, name: string): PersonFindingChange {
  if (!on) return { by_name: false, by_phone: false }
  return name ? { by_name: true, by_phone: true } : { by_phone: true }
}

/**
 * /settings/profile — B57.196, Pocket Live's sub:profile: what Talyvor has for you, your Talyvor name, and "Let people
 * find me" (by name or phone number), with being found by email beside it.
 */
export function ProfileScreen() {
  const finding = useFinding()
  const save = useChangeFinding()
  const recorded = finding.data

  let body: React.ReactNode
  if (finding.isLoading) {
    body = null
  } else if (!recorded) {
    const said = finding.error instanceof AgentBankError && finding.error.status === 409 ? finding.error.sentence : ''
    body = (
      <Card>
        <p className="text-body text-ink-2">{said || 'Your settings for being found could not be read.'}</p>
      </Card>
    )
  } else {
    const facts = [
      ...(recorded.name ? [{ label: 'Talyvor name', value: `@${recorded.name}` }] : []),
      ...(recorded.phone ? [{ label: 'Phone number', value: recorded.phone }] : []),
      ...(recorded.email ? [{ label: 'Email', value: recorded.email }] : []),
    ]
    body = (
      <>
        {facts.length ? <Facts facts={facts} /> : null}
        <Card>
          <NameForm key={recorded.name} saved={recorded.name} saving={save.isPending} onSave={(name) => save.mutate({ name })} />
        </Card>
        <Card>
          <FindBy
            id="find-me"
            label="Let people find me"
            by="By my name or phone number, to pay me"
            checked={recorded.by_name || recorded.by_phone}
            reason={recorded.phone || recorded.name ? undefined : 'Talyvor has no phone number for you yet.'}
            busy={save.isPending}
            onChange={(on) => save.mutate(findMe(on, recorded.name))}
          />
          <FindBy
            id="find-by-email"
            label="Email"
            by={recorded.email}
            checked={recorded.by_email}
            reason={recorded.email ? undefined : 'Talyvor has no email for you yet.'}
            busy={save.isPending}
            onChange={(on) => save.mutate({ by_email: on })}
          />
        </Card>
        <p className="text-body text-ink-2">Someone who finds you sees only your first name and the first letter of your last name.</p>
      </>
    )
  }
  return (
    <div data-design="pocket" className="grid min-w-0 max-w-2xl gap-4" data-testid="settings-profile">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Profile' }]} />
      {body}
      {save.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalWords(save.error)}
        </p>
      ) : null}
    </div>
  )
}

const askedKey = (sub: string) => `talyvor.findMeAsked:${sub}`

/**
 * The end of sign-up asks once, as Pocket Live's su7 draws it: "Let people find you?", Yes or No, then Open my account
 * opens Home. Nothing is picked until the person picks, and nothing is switched on without Yes; No leaves every switch
 * off. A session with no person, or one already found, is not asked and is shown `then`.
 */
export function FindMeQuestion({ then }: { then: React.ReactNode }) {
  const me = useAuthMeReader()
  const navigate = useNavigate()
  const sub = me.data?.user?.sub ?? ''
  const person = sub.startsWith('person:')
  const [asked] = useState(() => person && window.localStorage.getItem(askedKey(sub)) === '1')
  const [pick, setPick] = useState<'yes' | 'no' | null>(null)
  const finding = useFinding(person && !asked)
  const done = () => {
    window.localStorage.setItem(askedKey(sub), '1')
    navigate('/', { replace: true })
  }
  const yes = useChangeFinding(done)
  const f = finding.data
  if (!person || asked || finding.isError || (f && (f.by_name || f.by_phone))) return <>{then}</>
  if (!f) return null
  return (
    <section aria-labelledby="find-me-question" className="grid gap-4" data-testid="find-me-question">
      <div className="grid gap-1">
        <h2 id="find-me-question" className="font-display text-pocket-balance-sm font-extrabold text-ink">
          Let people find you?
        </h2>
        <p className="text-reading text-ink-2">So people can pay you by your name or phone number.</p>
      </div>
      <div role="radiogroup" aria-labelledby="find-me-question" className="grid max-w-xl gap-3">
        <Choice name="find_me" value="yes" picked={pick === 'yes'} onPick={() => setPick('yes')} title="Yes, find me" line="By name or phone number, to pay me." />
        <Choice name="find_me" value="no" picked={pick === 'no'} onPick={() => setPick('no')} title="No" line="People need your account details to pay you." />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={yes.isPending}
          disabledReason={pick ? undefined : 'Pick Yes or No.'}
          onClick={() => (pick === 'yes' ? yes.mutate(findMe(true, f.name)) : done())}
        >
          {yes.isPending ? 'Opening…' : 'Open my account'}
        </Button>
      </div>
      {yes.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalWords(yes.error)}
        </p>
      ) : null}
    </section>
  )
}
