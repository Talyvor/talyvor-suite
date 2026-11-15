import { Link } from 'react-router-dom'
import { cn, inlineLink } from '@talyvor/ui'
import { Card, Chip, Eyebrow } from '@talyvor/ui/pocket'
import { KIND_NOTE, TYPE_NOTE } from '../auth/signupWords'
import { KIND_LABEL, TYPE_LABEL, useAccount } from './agentBankApi'

// B57.137 — Settings' Account and Team sections in Pocket (launch-pack P11, SPEC 3.5). B61.4 — Nick, 15 Nov: the type
// and the kind of money are fixed once the account is open; another of either is another account, with its own
// sign-up. So both are drawn as facts, each with the sentence sign-up says, and nothing here changes either. Until
// "Open another account" ships (B61.9), the sentences carry no link.

/** One fact of the account: its title, its chip and the sentence that says it stays. */
function Fact({ title, chip, line, testId }: { title: string; chip: string; line: string; testId: string }) {
  return (
    <Card tone="white" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-reading font-bold text-ink">{title}</h2>
        <Chip>{chip}</Chip>
      </div>
      <p className="mt-1 text-body text-ink-2">{line}</p>
    </Card>
  )
}

/** B59.10, drawn in Pocket by B57.137 — the account's kind of money and type (SPEC 3.5's card), and a Business's team. */
export function AccountCards() {
  const { account, shows } = useAccount()
  return (
    <>
      {account ? (
        <>
          <Eyebrow className="mt-1.5">Account</Eyebrow>
          <Fact title="Kind of money" chip={KIND_LABEL[account.money_kind]} line={KIND_NOTE} testId="settings-money-kind" />
          <Fact title="Account type" chip={TYPE_LABEL[account.account_type]} line={TYPE_NOTE} testId="settings-account-type" />
        </>
      ) : null}
      {shows?.team ? (
        <Card tone="white">
          <h2 className="font-display text-reading font-bold text-ink">Your team</h2>
          <p className="mt-1 text-body text-ink-2" data-testid="settings-team">
            Who is in your team and the role each one has are on{' '}
            <Link to="/members" className={cn(inlineLink, 'font-semibold text-ink')}>
              Members
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </>
  )
}
