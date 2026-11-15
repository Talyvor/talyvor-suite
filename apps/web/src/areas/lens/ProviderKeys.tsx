import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDay } from '@talyvor/ui'
import { Button, Card, Input, Row } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { BYOK_PROVIDERS } from './planApi'
import { PROVIDER_KEYS_KEY, ProviderKeyError, providerKeysApi, type ProviderKey } from './providerKeysApi'

// ProviderKeys.tsx — B27.27, "Your provider keys" on Settings (Lens B27.26).
//
// A key is typed once into a password field, sent to Lens, and gone from the page: the field is cleared on
// save and what is drawn afterwards is Lens's answer — the provider and the last four characters. Adding
// and replacing are the same write (Lens's PUT replaces), so the row offers whichever reads true.

/** Lens's sentence for a refused save or removal, as the screen says it. */
function refusal(err: unknown, nothing: string): string {
  if (isSessionExpired(err)) return `${nothing}. Sign in again.`
  if (err instanceof ProviderKeyError && err.sentence) {
    const s = err.sentence.replace(/^byok: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return `${nothing}. You can try again.`
}

function ProviderKeyRow({ provider, stored, canAdd }: { provider: string; stored?: ProviderKey; canAdd: boolean }) {
  const qc = useQueryClient()
  const name = BYOK_PROVIDERS[provider] ?? provider
  const [mode, setMode] = useState<'idle' | 'editing' | 'removing'>('idle')
  const [typed, setTyped] = useState('')
  const done = () => {
    setTyped('')
    setMode('idle')
    void qc.invalidateQueries({ queryKey: PROVIDER_KEYS_KEY })
  }
  const save = useMutation({
    mutationFn: () => providerKeysApi.save(provider, typed.trim()),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => providerKeysApi.remove(provider),
    onSuccess: done,
  })
  const failed = save.isError
    ? refusal(save.error, 'The key was not saved')
    : remove.isError
      ? refusal(remove.error, 'The key was not removed')
      : null

  return (
    <div className="grid gap-2 border-t border-line py-2.5 first:border-t-0">
      <Row
        title={name}
        line={
          stored ? (
            <span data-testid={`provider-key-${provider}`}>
              <span className="font-figure">•••• {stored.last4}</span>, added {formatDay(stored.updated_at)}
            </span>
          ) : (
            'No key'
          )
        }
        className="py-0"
        action={
          mode === 'idle' ? (
            <>
              {canAdd ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    remove.reset()
                    setMode('editing')
                  }}
                >
                  {stored ? `Replace ${name} key` : `Add ${name} key`}
                </Button>
              ) : null}
              {stored ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    save.reset()
                    setMode('removing')
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      {mode === 'editing' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim()) save.mutate()
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={`${name} API key`}
            placeholder="Paste your key"
            className="w-56 font-mono"
            disabled={save.isPending}
          />
          <Button type="submit" size="sm" disabled={!typed.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save key'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setTyped('')
              save.reset()
              setMode('idle')
            }}
          >
            Cancel
          </Button>
        </form>
      ) : mode === 'removing' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-ink">Requests to {name} then run on prepaid credits.</span>
          <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Removing…' : `Remove ${name} key`}
          </Button>
          <Button variant="secondary" size="sm" disabled={remove.isPending} onClick={() => setMode('idle')}>
            Keep it
          </Button>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-body text-ink">
          {failed}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Settings' card: the workspace's own provider keys. B57.42 — on a plan without them it is one line and the way to
 * Plans; where the plan has them, the keys themselves, added, replaced and removed here.
 */
export function ProviderKeysCard() {
  const q = useQuery({
    queryKey: PROVIDER_KEYS_KEY,
    queryFn: providerKeysApi.list,
    retry: false,
  })
  const data = q.data?.enabled ? q.data.data : null
  const providers = data?.providers.length ? data.providers : Object.keys(BYOK_PROVIDERS)

  return (
    <Card data-testid="provider-keys">
      <h2 className="font-display text-reading font-bold text-ink">Your provider keys</h2>
      {q.isPending ? (
        <p className="mt-1 text-body text-ink-2">Reading your provider keys…</p>
      ) : q.isError ? (
        <p className="mt-1 text-body text-ink-2">
          {isSessionExpired(q.error)
            ? 'Your provider keys can’t be read until you sign in again.'
            : 'Your provider keys couldn’t be read just now.'}
        </p>
      ) : !data ? (
        <p className="mt-1 text-body text-ink-2">This deployment doesn’t hold provider keys, so BYOK isn’t available here.</p>
      ) : !data.byok ? (
        <>
          <p className="mt-1 text-body text-ink-2" data-testid="provider-keys-plan">
            Using your own model providers’ keys is an add-on on Team, and included in Business.
          </p>
          <div className="mt-3">
            <Button asChild variant="secondary" size="sm">
              <Link to="/plans">See plans</Link>
            </Button>
          </div>
          {/* A key kept from a plan that had them can still be removed. */}
          {data.keys.length ? (
            <div className="mt-2 grid">
              {data.keys.map((k) => (
                <ProviderKeyRow key={k.provider} provider={k.provider} stored={k} canAdd={false} />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1 text-body text-ink-2" data-testid="provider-keys-plan">
            You’re on BYOK. A request to a provider you hold a key for goes on your key, and your provider bills you. Only a key’s last four
            characters are ever shown.
          </p>
          <div className="mt-2 grid">
            {providers.map((p) => (
              <ProviderKeyRow key={p} provider={p} stored={data.keys.find((k) => k.provider === p)} canAdd={data.byok} />
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
