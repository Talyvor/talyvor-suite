import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Field, Input, Switch } from '@talyvor/ui/pocket'
import { useAuthMeReader } from '../../lib/authMe'
import { AgentBankError, agentBankApi, type PersonFinding, type PersonFindingChange } from './agentBankApi'

// FindMe.tsx — B61.93: how the signed-in person is found on Talyvor, to be paid (BFF B61.93, Lens B61.32). Settings,
// Privacy holds their Talyvor name and the three switches, by name, phone number and email, each off until pressed;
// the end of sign-up asks the one question once. Both draw what Lens RECORDED, from the answer to each write, never
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

/** Settings, Privacy: the Talyvor name and who can find you. */
export function PrivacyCard() {
  const finding = useFinding()
  const save = useChangeFinding()
  const recorded = finding.data

  let body: React.ReactNode
  if (finding.isLoading) {
    body = null
  } else if (!recorded) {
    const said = finding.error instanceof AgentBankError && finding.error.status === 409 ? finding.error.sentence : ''
    body = <p className="mt-2 text-body text-ink-2">{said || 'Your settings for being found could not be read.'}</p>
  } else {
    const switchTo = (change: PersonFindingChange) => save.mutate(change)
    body = (
      <>
        <NameForm key={recorded.name} saved={recorded.name} saving={save.isPending} onSave={(name) => save.mutate({ name })} />
        <h3 className="mt-4 font-display text-body font-bold text-ink">Let people find me by</h3>
        <p className="mt-1 text-body text-ink-2">Someone who finds you sees only your first name and the first letter of your last name.</p>
        <div className="mt-2">
          <FindBy
            id="find-by-name"
            label="Name"
            by={recorded.name ? `@${recorded.name}` : ''}
            checked={recorded.by_name}
            reason={recorded.name ? undefined : 'Choose your Talyvor name first.'}
            busy={save.isPending}
            onChange={(on) => switchTo({ by_name: on })}
          />
          <FindBy
            id="find-by-phone"
            label="Phone number"
            by={recorded.phone}
            checked={recorded.by_phone}
            reason={recorded.phone ? undefined : 'Talyvor has no phone number for you yet.'}
            busy={save.isPending}
            onChange={(on) => switchTo({ by_phone: on })}
          />
          <FindBy
            id="find-by-email"
            label="Email"
            by={recorded.email}
            checked={recorded.by_email}
            reason={recorded.email ? undefined : 'Talyvor has no email for you yet.'}
            busy={save.isPending}
            onChange={(on) => switchTo({ by_email: on })}
          />
        </div>
      </>
    )
  }
  return (
    <Card tone="white" data-testid="settings-privacy">
      <h2 className="font-display text-reading font-bold text-ink">Privacy</h2>
      {body}
      {save.isError ? (
        <p role="alert" className="mt-2 text-body text-ink">
          {refusalWords(save.error)}
        </p>
      ) : null}
    </Card>
  )
}

const askedKey = (sub: string) => `talyvor.findMeAsked:${sub}`

/**
 * The end of sign-up asks once whether people may pay the person by their name or phone number, and then shows `then`.
 * Nothing is switched on without Yes; Not now leaves every switch off. A session with no person, or one already found,
 * is not asked.
 */
export function FindMeQuestion({ then }: { then: React.ReactNode }) {
  const me = useAuthMeReader()
  const sub = me.data?.user?.sub ?? ''
  const person = sub.startsWith('person:')
  const [asked, setAsked] = useState(() => person && window.localStorage.getItem(askedKey(sub)) === '1')
  const finding = useFinding(person && !asked)
  const done = () => {
    window.localStorage.setItem(askedKey(sub), '1')
    setAsked(true)
  }
  const yes = useChangeFinding(done)
  const f = finding.data
  if (!person || asked || finding.isError || (f && (f.by_name || f.by_phone))) return <>{then}</>
  if (!f) return null
  return (
    <section aria-labelledby="find-me-question" className="grid gap-3" data-testid="find-me-question">
      <h2 id="find-me-question" className="font-display text-bar font-bold text-ink">
        Let people on Talyvor pay you by your name or phone number?
      </h2>
      <div className="flex flex-wrap gap-3">
        <Button disabled={yes.isPending} onClick={() => yes.mutate(f.name ? { by_name: true, by_phone: true } : { by_phone: true })}>
          Yes
        </Button>
        <Button variant="outline" disabled={yes.isPending} onClick={done}>
          Not now
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
