import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Row } from '@talyvor/ui'
import { Button, Card, Dialog, EmptyState, Eyebrow, Field, Icon, Input, Row as PocketRow, showSnack } from '@talyvor/ui/pocket'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { formatWhen } from './format'
import { ApiError, getJSON, readable } from '../../lib/api'
import { ConnectedList } from './ConnectAI'
import { isSessionExpired } from '../../lib/productState'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { CodeCopy } from './Setup'
import { DESIGN_ATTR } from '../../pocketPending'
import { DevelopersHead } from './Developers'

// API keys — LIVE. This screen exists because of one real failure: Lens's mint
// response returns `key` and `prefix` ADJACENT in one line of JSON, they look
// nearly identical, and the wrong one got copied — ten minutes of "invalid API
// key". The design makes that mistake structurally impossible:
//
//   · The CREDENTIAL appears exactly once, in the New key dialog, with one Copy
//     that copies the key and nothing else. On Done, or on closing the dialog, it
//     leaves the DOM and the mutation cache; there is no way back.
//   · The PREFIX never sits beside the key at equal weight — a labeled "not a
//     credential" line under it — and in the list rows, where a credential never
//     appears at all.
//
// WIRED to the real BFF routes (apps/bff/keys.go), which hold the workspace key
// server-side:
//   GET  /api/keys → list (WorkspaceAPIKey rows, no credential)
//   POST /api/keys → mint (201 {key, prefix, …}; key shown once). The POST is a
//     write, guarded by the BFF's Origin check — satisfied automatically because
//     keysApi.mint posts to a same-origin relative path (see keysApi.ts).
//
// B57.55 — drawn as Pocket's w-dev-keys: the keys as rows in one card, New key in a dialog
// (w-dev-keys+new-key) and revoking in another that asks first (w-dev-keys+revoke-key).

/**
 * RevokeKey — the dialog that destroys one key.
 *
 * ⚠ WHAT THE CONFIRM IS FOR, ARGUED. The obvious confirm is "Are you sure?", and it guards the
 * wrong thing. Nobody revokes a key by accidentally pressing a button they did not mean to press;
 * they revoke THE WRONG KEY. This list makes that easy — every identifier is tlv_ws_ + eight hex,
 * they are the same length and shape, and names repeat because people call three of them "CI
 * pipeline". A yes/no dialog confirms the ACT, which was never in doubt, and says nothing about the
 * TARGET, which is the only thing that can go wrong.
 *
 * So the confirm is to type the identifier of the key being revoked. It cannot be satisfied without
 * looking at the row, and it fails closed against the specific mistake — reaching for the wrong row
 * — that a yes/no dialog waves straight through. It is the same standard used for deleting a
 * repository or a database, for the same reason: irreversible, and the damage is silent.
 */
function RevokeKey({ k, onClose, onRevoked }: { k: WorkspaceAPIKey; onClose: () => void; onRevoked: () => void }) {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')

  const revoke = useMutation({
    mutationFn: () => keysApi.revoke(k.id),
    onSuccess: async () => {
      showSnack({ title: `${k.key_prefix} is revoked`, line: 'Treat it as gone in 5 minutes.' })
      onRevoked()
      await qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  // Exact match, trimmed only for stray whitespace — a prefix match would defeat the point, since
  // every identifier here shares the tlv_ws_ stem.
  const armed = typed.trim() === k.key_prefix

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Revoke ${k.key_prefix}?`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            disabledReason={armed ? undefined : `Type ${k.key_prefix} above first.`}
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke key'}
          </Button>
        </>
      }
    >
      {/* ⚠ THE 5 MINUTES ARE LOAD-BEARING AND WERE READ FROM SOURCE. Lens caches validated keys
          in-process for 5 minutes (internal/auth/apikeys.go, cacheTTL) and the revoke route deletes
          the row without purging that cache, so a key in active use keeps working for up to the TTL.
          An operator killing a LEAKED key has to know that; "revoked" implying "dead now" would be
          the most dangerous sentence on this screen. */}
      <p>
        It cannot be undone, and anything still using it stops working. Traffic already using it can keep working for up to
        5 minutes.
      </p>
      <Field label={`Type ${k.key_prefix} to confirm`}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={k.key_prefix} className="font-mono" />
      </Field>
      {revoke.isError ? (
        <p role="alert" className="text-body text-ink">
          {revoke.error instanceof ApiError && revoke.error.status === 404
            ? 'That key is already gone, or does not belong to this workspace. Nothing was changed.'
            : 'Couldn’t revoke that key. Nothing was changed. Try again.'}
        </p>
      ) : null}
    </Dialog>
  )
}

// B28.266 — what tells one key from another: three keys made a minute apart read identically as
// "proxy · made Oct 4, 03:29". Lens stamps last_used_at on every key check it passes, so whether a
// key is in use is the fact a reader revoking one most needs; expiry is drawn only when one is set.
function keyFacts(k: WorkspaceAPIKey): string {
  const facts = [k.scopes.join(', '), `made ${formatWhen(k.created_at)}`]
  facts.push(k.last_used_at ? `last used ${formatWhen(k.last_used_at)}` : 'never used')
  if (k.expires_at) facts.push(`expires ${formatWhen(k.expires_at)}`)
  return facts.join(' · ')
}

// B41.15 — everything else allowed to act for the workspace, from Lens's GET /v1/money/access (B41.115): the
// permission mandates its owner signed for assistants and agents, the phones' device keys and the passkeys. Each row
// says what it may do, when it was last used and when it expires, and is revoked in one tap — no typed confirm, since
// a mandate or a device is named in words, not by one of many look-alike identifiers.
interface AccessItem {
  kind: 'mandate' | 'device' | 'passkey'
  id: string
  name: string
  may: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  status: 'active' | 'not_yet_valid' | 'expired' | 'revoked'
  revoke: string // Lens's POST, e.g. /v1/money/devices/{id}/revoke; "" when none is offered yet
}

const ACCESS_KEY = ['money-access']
const KIND_WORD: Record<AccessItem['kind'], string> = { mandate: 'Permission', device: 'Phone', passkey: 'Passkey' }
const STATUS_WORD: Record<AccessItem['status'], string> = {
  active: '',
  not_yet_valid: 'Not yet valid',
  expired: 'Expired',
  revoked: 'Revoked',
}

function accessFacts(it: AccessItem): string {
  const facts = [KIND_WORD[it.kind], `may ${it.may}`, `added ${formatWhen(it.created_at)}`]
  facts.push(it.last_used_at ? `last used ${formatWhen(it.last_used_at)}` : 'never used')
  if (it.expires_at) facts.push(`${it.status === 'expired' ? 'expired' : 'expires'} ${formatWhen(it.expires_at)}`)
  return facts.join(' · ')
}

/** The BFF's forward of each revoke Lens offers (apps/bff/money_access.go, money_devices.go); a passkey has none yet. */
const REVOKE_PATH: Partial<Record<AccessItem['kind'], (id: string) => string>> = {
  mandate: (id) => `/api/money/permission-mandates/${encodeURIComponent(id)}/revoke`,
  device: (id) => `/api/money/devices/${encodeURIComponent(id)}/revoke`,
}

async function revokeAccess(it: AccessItem): Promise<void> {
  const path = REVOKE_PATH[it.kind]!(it.id)
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
}

function AccessList() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ACCESS_KEY,
    queryFn: async () =>
      readable<{ items: AccessItem[] }>('/api/money/access', await getJSON<unknown>('/api/money/access'), { items: 'array' })
        .items,
  })
  const cut = useMutation({ mutationFn: revokeAccess, onSettled: () => qc.invalidateQueries({ queryKey: ACCESS_KEY }) })

  if (list.isPending) return <div className="px-gutter py-3 text-body text-muted">Loading…</div>
  if (list.isError)
    return (
      <div className="px-gutter py-3 text-body text-muted">
        {list.error instanceof ApiError && list.error.status === 403
          ? 'Only the workspace’s owner or an admin sees the permissions, phones and passkeys that act for it.'
          : 'The permissions, phones and passkeys that act for this workspace were not read. This is a fault, not an empty list.'}
      </div>
    )
  if (!list.data.length)
    return <div className="px-gutter py-3 text-body text-muted">No permission, phone or passkey acts for this workspace yet. They appear here when you sign one or add a phone.</div>
  return (
    <>
      {list.data.map((it) => {
        const label = `${KIND_WORD[it.kind]} ${it.name}`
        const pending = cut.isPending && cut.variables?.id === it.id
        return (
          <Row key={`${it.kind}-${it.id}`} stack label={it.name || KIND_WORD[it.kind]} hint={accessFacts(it)}>
            {it.status !== 'active' ? (
              <span className="text-caption text-muted">{STATUS_WORD[it.status]}</span>
            ) : it.revoke && REVOKE_PATH[it.kind] ? (
              <Button variant="outline" size="sm" aria-label={`Revoke ${label}`} disabled={pending} onClick={() => cut.mutate(it)}>
                {pending ? 'Revoking…' : 'Revoke'}
              </Button>
            ) : null}
          </Row>
        )
      })}
      {cut.isError ? (
        <div role="alert" className="px-gutter py-3 text-body text-ink">
          That was not revoked. Nothing was changed. Try again.
        </div>
      ) : null}
    </>
  )
}

/**
 * NewKey — the dialog that makes a key and shows it once.
 *
 * ⚠ CLOSING IT IS ONE-WAY AND TOTAL, HOWEVER IT IS CLOSED: Done, the close x, Esc or the scrim.
 * The credential leaves local state AND the mutation cache (mint.reset), so no copy of it survives
 * anywhere on the page. The list refetches — the new key returns from the server BY PREFIX, never
 * as a value the client kept.
 */
function NewKey({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintResult | null>(null)

  const mint = useMutation({
    mutationFn: () => keysApi.mint(name.trim(), ['proxy']),
    onSuccess: (result) => {
      setMinted(result) // held in local state only; rendered once
      setName('') // B28.266 — the name went with the key; the next one starts empty
      showSnack({ title: 'Here it is, once', line: 'Copy it now: Talyvor keeps a hash, not the key.' })
      // The list refetches NOW, not on close: a reveal left open used to hold "The keys that
      // exist" on Loading… (B26.23). The row comes back BY PREFIX — no credential in it.
      void qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const submit = () => {
    if (minted || mint.isPending || name.trim() === '') return
    mint.mutate()
  }

  const close = (stored: boolean) => {
    if (minted)
      showSnack(
        stored
          ? { title: 'Stored', line: `${minted.prefix} is in the list.` }
          : { title: 'Closed', line: `${minted.prefix} is in the list. Its secret is not shown again.` },
      )
    setMinted(null)
    mint.reset()
    void qc.invalidateQueries({ queryKey: ['keys'] })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={() => close(false)}
      title="New key"
      actions={
        minted ? (
          <Button onClick={() => close(true)}>Done, I stored it</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mint.isPending} disabledReason={name.trim() === '' ? 'Name the key first.' : undefined}>
              {mint.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </>
        )
      }
    >
      {minted ? (
        // ⚠ THE REVEAL IS THE POINT OF THE WHOLE SCREEN. There is exactly one moment when a
        // credential is on this page and exactly one thing the reader must do about it: `key` and
        // `prefix` sit adjacent in Lens's JSON, look alike, and the wrong one gets copied.
        <>
          <p>Copy it now: Talyvor keeps a hash, not the key, so nobody can show it to you again.</p>
          <CodeCopy text={minted.key} label="key" copied="Copied. Store it now: it will not be shown again" />
          <p className="text-caption text-ink-3">
            Identifier, not a credential: <span className="font-mono">{minted.prefix}</span>. Safe to share; this is how the key
            appears in lists.
          </p>
        </>
      ) : (
        <>
          <p>Made with the proxy scope and shown once, here. Afterwards only its identifier remains.</p>
          <Field label="Key name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              disabled={mint.isPending}
            />
          </Field>
          {mint.isError ? (
            <p role="alert" className="text-body text-ink">
              {/* ⚠ THE STATUS, NOT THE MESSAGE: a 403 is the BFF's Origin check, read off ApiError's
                  `.status` rather than a substring of its message. ⚠ AND A 401 GETS NO RETRY ADVICE:
                  the session bar already says signing in again fixes it, so ONLY THE ADVICE MOVES. */}
              {mint.error instanceof ApiError && mint.error.status === 403
                ? 'Couldn’t mint the key. The request origin was rejected. Reach this app at its configured address.'
                : isSessionExpired(mint.error)
                  ? 'Couldn’t mint the key. Nothing was changed.'
                  : 'Couldn’t mint the key. Please try again.'}
            </p>
          ) : null}
        </>
      )}
    </Dialog>
  )
}

const cardHeading = 'font-display text-reading font-bold text-ink'

export function Keys() {
  const [making, setMaking] = useState(false)
  const [revoking, setRevoking] = useState<WorkspaceAPIKey | null>(null)
  const [revoked, setRevoked] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['keys'], queryFn: keysApi.list })
  const keys: WorkspaceAPIKey[] = list.data ?? []
  // Each card is a named region, so a reader moving by landmark gets the keys and what else may act as two stops.
  const keysHeading = useId()
  const actHeading = useId()

  // ⚠ THE EMPTY STATE IS A MEASUREMENT, NOT A DEFAULT, and the direction that matters is the one
  // this is FALSE for: it is claimed only when the list read ANSWERED and the answer was an empty
  // array. A read that FAILED is not a workspace with no keys — told wrongly HERE it tells an
  // operator whose keys are live and serving traffic that they have none, on the screen whose
  // other control is REVOKE. `emptyVsFault.test.ts` holds the failure branch ahead of this one.
  const empty = !list.isError && !list.isLoading && list.data !== undefined && list.data.length === 0

  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-5 px-gutter py-4 wide:py-6">
      <DevelopersHead
        heading="Make and revoke the keys that reach Talyvor."
        line="A workspace key is what a tool presents to Talyvor. It is made here, shown once, and from then on known only by its identifier."
      />

      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid gap-4 wide:col-span-8">
          <Card tone="white" role="region" aria-labelledby={keysHeading} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id={keysHeading} className={cardHeading}>
                The keys that exist
              </h3>
              <Button size="sm" icon={<Icon name="plus" size={16} />} onClick={() => setMaking(true)}>
                New key
              </Button>
            </div>
            {list.isLoading ? (
              <p className="text-body text-ink-2">Loading…</p>
            ) : list.isError ? (
              <PanelFailure error={list.error} what="your keys" />
            ) : empty ? (
              // A key on its own does nothing, so the empty state names the second step too: it is
              // the one this screen never made, and Connect an agent is where the two lines live.
              <EmptyState
                icon={<Icon name="key" />}
                title="This workspace has no keys."
                line={
                  <>
                    Make one with New key, then point a tool at it: Connect an agent has the lines for Claude Code, Cursor and
                    anything on the OpenAI SDK.
                  </>
                }
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link to="/setup">Connect an agent</Link>
                  </Button>
                }
              />
            ) : (
              <div>
                {keys.map((k) => (
                  <PocketRow
                    key={k.id}
                    wrap
                    title={k.name}
                    line={keyFacts(k)}
                    action={
                      <>
                        <span className="font-mono text-body text-ink-2">{k.key_prefix}</span>
                        {/* The accessible name carries the identifier, so the control names WHICH key
                            it destroys rather than being one of several identical "Revoke" buttons. */}
                        <Button variant="outline" size="sm" aria-label={`Revoke ${k.key_prefix}`} onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
            {revoked ? (
              <p className="text-caption text-ink-3">
                {revoked} is revoked. Traffic using it can keep working for up to 5 minutes.
              </p>
            ) : null}
          </Card>

          <Card tone="white" role="region" aria-labelledby={actHeading} className="grid gap-2">
            <h3 id={actHeading} className={cardHeading}>
              What may act for this workspace
            </h3>
            <p className="text-body text-ink-2">
              Assistants you connected, the permissions you signed for them and your agents, and the phones and passkeys that
              approve payments. Revoking one stops it at once.
            </p>
            <Eyebrow className="mt-2">Connected assistants</Eyebrow>
            <ConnectedList />
            <Eyebrow className="mt-2">Permissions, phones and passkeys</Eyebrow>
            <AccessList />
          </Card>
        </div>
      </div>

      {making ? <NewKey onClose={() => setMaking(false)} /> : null}
      {revoking ? (
        <RevokeKey
          k={revoking}
          onClose={() => setRevoking(null)}
          onRevoked={() => {
            setRevoked(revoking.key_prefix)
            setRevoking(null)
          }}
        />
      ) : null}
    </div>
  )
}
