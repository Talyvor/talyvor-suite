import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { Card, Note } from '../marketplace/parts'
import { type RoomAgreement as Agreement, type RoomDetail, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomAgreement.tsx — B41.50: the room's contributor agreement (Lens B41.150). A member's work in the room is assigned to
// the company formed to own it, with a licence back if no company is ever formed, and its points count only once its
// workspace has signed the current version: work accepted before it signs earns nothing. The owner or an admin of the
// workspace signs by typing their full name; Lens keeps the signature with the version and the hash of the text signed.
// Behind the same room_equity gate as the points ledger, so on Lens's 404 nothing is drawn.

export const agreementKey = (id: string) => [...ROOMS_KEY, 'agreement', id]

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

function SignForm({ room, a }: { room: RoomDetail; a: Agreement }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const sign = useMutation({
    mutationFn: () => roomsApi.signAgreement(room.id, a.version, name.trim()),
    onSuccess: (next) => qc.setQueryData(agreementKey(room.id), next),
  })
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      aria-label="Sign the contributor agreement"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && !sign.isPending) sign.mutate()
      }}
    >
      <label className="text-caption text-muted">
        Your full name
        <Input className="mt-1 block w-full" autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="text-caption text-muted">Typing your name and signing is your signature, for your workspace.</p>
      <div>
        <Button type="submit" disabled={!name.trim() || sign.isPending}>
          {sign.isPending ? 'Signing…' : 'Sign the agreement'}
        </Button>
      </div>
      {sign.isError ? <Note ok={false}>{roomRefusal(sign.error)}</Note> : null}
    </form>
  )
}

export function RoomAgreement({ room }: { room: RoomDetail }) {
  // A 404 is Lens's verdict that this room has no agreement for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: agreementKey(room.id), queryFn: () => roomsApi.agreement(room.id), retry: false })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="11" label="Contributor agreement" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The contributor agreement could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const a = q.data
  const s = a.signature
  return (
    <Region index="11" label="Contributor agreement" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        Your work in this room is assigned to the company formed to own it, with a licence back to you. Your points in this
        room count only once your workspace signs.
      </p>
      <Card>
        <div className="flex flex-col gap-3 p-gutter">
          <p className="text-caption text-muted">
            {a.draft ? `Version ${a.version} · Draft${a.marked ? ` · ${a.marked}` : ''}` : `Version ${a.version}`}
          </p>
          <div className="whitespace-pre-line text-body text-ink" data-testid="room-agreement-text">
            {a.text}
          </div>
        </div>
      </Card>
      {s ? (
        <Card>
          <div className="flex flex-col gap-2 p-gutter">
            <p className="text-body text-ink" data-testid="room-agreement-signed">
              {s.signed_name} signed version {s.version} on {day(s.signed_at)}. Your points in this room count.
            </p>
            <p className="text-caption text-muted">
              Text signed, SHA-256
              <span className="block break-all font-figure">{s.text_sha256}</span>
            </p>
          </div>
        </Card>
      ) : (
        <>
          <p className="text-body text-ink" data-testid="room-agreement-unsigned">
            Not signed yet. Work accepted before your workspace signs earns no points.
          </p>
          <Card>
            <SignForm room={room} a={a} />
          </Card>
        </>
      )}
    </Region>
  )
}
