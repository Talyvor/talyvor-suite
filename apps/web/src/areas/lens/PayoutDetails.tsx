import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Pill, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Note, readFailure } from './WalletMoney'
import { selectClass } from '../marketplace/parts'
import { type PayoutDetails, type PayoutDetailsRequest, agentBankApi, refusalText } from './agentBankApi'

// PayoutDetails.tsx — B55.28: where a workspace is paid its share of a room, its marketplace sales and its royalties
// (Lens B46.11). An IBAN and BIC for dollars, pounds or euros, or an address on Base for USDC; Lens hands the holder to
// the money layer's partner to verify, and pays what it held for want of verified details once they are.

export const PAYOUT_DETAILS_KEY = ['payout-details']

const ASSETS = ['USD', 'GBP', 'EUR', 'USDC'] as const
type Asset = (typeof ASSETS)[number]

const STATUS: Record<PayoutDetails['status'], { text: string; pill: PillStatus }> = {
  pending: { text: 'Checking', pill: 'held' },
  verified: { text: 'Verified', pill: 'settled' },
  failed: { text: 'Not verified', pill: 'slashed' },
}

const fieldLabel = 'text-caption text-muted'

export function PayoutDetailsScreen() {
  const details = useQuery({ queryKey: PAYOUT_DETAILS_KEY, queryFn: agentBankApi.payoutDetails })
  const saved = details.data?.payout_details ?? []
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Payout details"
        heading="Payout details"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">Where Talyvor pays you: your share of a room, your marketplace sales and royalties.</p>
        {details.isError ? (
          <p className="text-body text-muted">{readFailure(details.error, 'Your payout details')}</p>
        ) : details.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : saved.length > 0 ? (
          <Card>
            <ul>
              {saved.map((d) => (
                <li
                  key={d.asset}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-gutter py-3 last:border-b-0"
                  data-testid="payout-details"
                >
                  <span className="min-w-0 text-body text-ink">
                    <span className="font-figure">{d.asset}</span> · {d.holder} ·{' '}
                    <span className="break-all font-figure">{d.asset === 'USDC' ? d.address : d.iban}</span>
                  </span>
                  <Pill status={STATUS[d.status]?.pill ?? 'idle'}>{STATUS[d.status]?.text ?? d.status}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <DetailsForm />
        <p className="text-body text-muted">Payouts held for you are paid once these are verified.</p>
      </Region>
    </RegionScreen>
  )
}

function DetailsForm() {
  const qc = useQueryClient()
  const [asset, setAsset] = useState<Asset>('USD')
  const [holder, setHolder] = useState('')
  const [iban, setIban] = useState('')
  const [bic, setBic] = useState('')
  const [address, setAddress] = useState('')
  const usdc = asset === 'USDC'
  const body: PayoutDetailsRequest | null =
    holder.trim() === ''
      ? null
      : usdc
        ? address.trim() === ''
          ? null
          : { asset, holder: holder.trim(), network: 'base', address: address.trim() }
        : iban.trim() === '' || bic.trim() === ''
          ? null
          : { asset, holder: holder.trim(), iban: iban.trim(), bic: bic.trim() }
  const save = useMutation({
    mutationFn: (b: PayoutDetailsRequest) => agentBankApi.savePayoutDetails(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYOUT_DETAILS_KEY }),
  })
  const status = save.isSuccess ? STATUS[save.data.status] : undefined
  return (
    <Card>
      <form
        aria-label="Payout details"
        className="flex flex-col gap-3 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (body && !save.isPending) save.mutate(body)
        }}
      >
        <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
          <label className={fieldLabel}>
            Pay me in
            <select className={selectClass} value={asset} onChange={(e) => setAsset(e.target.value as Asset)}>
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Name on the account
            <Input className="mt-1 block w-full" autoComplete="name" value={holder} onChange={(e) => setHolder(e.target.value)} />
          </label>
          {usdc ? (
            <label className={fieldLabel}>
              USDC address on Base
              <Input className="mt-1 block w-full font-figure" placeholder="0x" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
          ) : (
            <>
              <label className={fieldLabel}>
                IBAN
                <Input className="mt-1 block w-full font-figure" value={iban} onChange={(e) => setIban(e.target.value)} />
              </label>
              <label className={fieldLabel}>
                BIC
                <Input className="mt-1 block w-full font-figure" value={bic} onChange={(e) => setBic(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!body || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {status ? <Pill status={status.pill}>{status.text}</Pill> : null}
        </div>
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </form>
    </Card>
  )
}
