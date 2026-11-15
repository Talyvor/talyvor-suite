import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Crumb, Eyebrow, Field, Input, pocketFocusRing } from '@talyvor/ui/pocket'
import { useEffect, useState } from 'react'

import { ApiError, getJSON, readable } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'

// B39.34 — Settings → Email branding: a Docs workspace's owner sets the From name, header colour and logo every
// Docs mail carries (B39.20). Docs decides everything: owner only, a #rrggbb colour, an https logo; its 400
// message is shown as it came.

interface Branding {
  from_name: string
  header_color: string
  logo_url: string
}

const KEY = ['docs-email-branding']
const PATH = '/api/docs/email-branding'
/** Docs' header when a workspace sets no colour (internal/email/layout.go DefaultHeaderColor). */
const DEFAULT_COLOR = '#060A12'
const HEX = /^#[0-9A-Fa-f]{6}$/
const OWNER_ONLY = 'Only this workspace’s owner can change how its Docs email looks.'

/** Docs' header text colour: Obsidian on a light header, white on a dark one (internal/email/layout.go ink). */
function ink(bg: string): string {
  const v = parseInt(bg.slice(1), 16)
  return 0.299 * ((v >> 16) & 0xff) + 0.587 * ((v >> 8) & 0xff) + 0.114 * (v & 0xff) > 150 ? '#060A12' : '#FFFFFF'
}

async function save(b: Branding): Promise<Branding> {
  const res = await fetch(PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(b),
  })
  const body = (await res.json().catch(() => null)) as (Branding & { error?: string; code?: string }) | null
  if (!res.ok)
    throw Object.assign(new ApiError(res.status, PATH, body?.code), {
      said: body?.error,
    })
  return body as Branding
}

function refusal(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return OWNER_ONLY
  const said = (err as { said?: string }).said
  if (err instanceof ApiError && err.status === 400 && said) return said
  return 'Docs didn’t save it. Nothing changed. You can try again.'
}

function Preview({ b }: { b: Branding }) {
  const color = HEX.test(b.header_color) ? b.header_color : DEFAULT_COLOR
  const name = b.from_name.trim() || 'Talyvor'
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-body text-ink-3">
        Mail arrives from <span className="text-ink">“{name} via Talyvor”</span>
      </figcaption>
      <div className="overflow-hidden rounded-inset bg-page">
        <div data-testid="branding-preview" className="px-6 py-5" style={{ background: color }}>
          {b.logo_url.startsWith('https://') ? (
            <img src={b.logo_url} alt={name} className="block h-8 max-w-full" />
          ) : (
            <span className="font-display text-head font-bold" style={{ color: ink(color) }}>
              {name}
            </span>
          )}
        </div>
        <div className="px-6 py-5 text-body text-ink-2">Your approval was requested on a page…</div>
      </div>
    </figure>
  )
}

function Form({ saved }: { saved: Branding }) {
  const qc = useQueryClient()
  const [b, setB] = useState(saved)
  useEffect(() => setB(saved), [saved])
  const put = useMutation({
    mutationFn: () =>
      save({
        ...b,
        from_name: b.from_name.trim(),
        header_color: b.header_color.trim(),
        logo_url: b.logo_url.trim(),
      }),
    onSuccess: (next) => qc.setQueryData(KEY, next),
  })
  const field = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement>) => setB({ ...b, [k]: e.target.value })
  return (
    <form
      aria-label="Email branding"
      className="grid items-start gap-4 wide:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!put.isPending) put.mutate()
      }}
    >
      <Card tone="white" className="flex flex-col gap-4">
        <Field label="From name">
          <Input aria-label="From name" maxLength={64} placeholder="Acme" value={b.from_name} onChange={field('from_name')} />
        </Field>
        <div className="flex items-end gap-2">
          <input
            type="color"
            aria-label="Pick header colour"
            className={`h-11 w-12 shrink-0 cursor-pointer rounded-control bg-transparent shadow-edge transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${pocketFocusRing}`}
            value={HEX.test(b.header_color) ? b.header_color : DEFAULT_COLOR}
            onChange={field('header_color')}
          />
          <Field label="Header colour" className="min-w-0 flex-1">
            <Input
              aria-label="Header colour"
              className="font-mono"
              placeholder={DEFAULT_COLOR}
              value={b.header_color}
              onChange={field('header_color')}
            />
          </Field>
        </div>
        <Field label="Logo URL">
          <Input
            aria-label="Logo URL"
            className="font-mono"
            type="url"
            placeholder="https://"
            value={b.logo_url}
            autoComplete="off"
            onChange={field('logo_url')}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={put.isPending}>
            {put.isPending ? 'Saving…' : 'Save branding'}
          </Button>
          {put.isSuccess ? (
            <p className="text-body text-ink-3" role="status">
              Saved. The next Docs email carries it.
            </p>
          ) : null}
        </div>
        {put.isError ? (
          <p className="text-body text-ink" role="alert">
            {refusal(put.error)}
          </p>
        ) : null}
      </Card>
      <Card className="grid gap-2">
        <Eyebrow>Preview</Eyebrow>
        <Preview b={b} />
      </Card>
    </form>
  )
}

export function DocsEmailBranding() {
  const brand = useQuery({
    queryKey: KEY,
    queryFn: async () =>
      readable<Branding>(PATH, await getJSON<unknown>(PATH), {
        from_name: 'string',
        header_color: 'string',
        logo_url: 'string',
      }),
  })
  // B57.42 — Pocket's w-docs-branding: the crumb and the line, the fields in a white card, the preview beside them.
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Email branding' }]} />
      <p className="max-w-3xl text-reading text-ink-2">
        How Docs email looks to your workspace: the name it comes from, the header colour and your logo. Leave a field empty to keep
        Talyvor’s default for it.
      </p>
      {brand.isError ? (
        <p className="max-w-2xl text-body text-ink-2">
          {isUnconfigured(brand.error) || isSessionExpired(brand.error)
            ? 'Docs is not reachable from this session, so there is no branding to show.'
            : 'Couldn’t read your email branding from Docs. This is a fault, not an empty setting.'}
        </p>
      ) : brand.isPending ? (
        <p className="text-body text-ink-2">Reading email branding from Docs…</p>
      ) : (
        <Form saved={brand.data} />
      )}
    </div>
  )
}
