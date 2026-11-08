// B55.44 — the Pocket problems pass: one user for each of the 25 problems (problems.ts), each pressing its problem in the
// app as a person would. `scripts/e2e-nightly.sh` plays it every night before the nightly run; on demand:
//
//   LENS_SYNTHETIC_KEY=… pnpm --filter @talyvor/e2e pocket --app https://app.talyvor.com --lens https://lens.talyvor.com

import { spendNoticePush } from '../bank.ts'
import type { Scenario } from '../scenarios.ts'
import { coveredPaid, declineHolds, expiredDraws, looseningSigned, pausedPull, preparedListed } from './approvals.ts'
import { keysLetIn, keysRemovable, lastPhoneKey, onThePhone, phoneOnlyWeb } from './keys.ts'
import { POCKET, pocketID } from './problems.ts'
import { roomNames, roomPayout } from './rooms.ts'
import { dollarsFirst, helpProviders, noCardWords, noMachineWords, noRawRefusals, oneMoneyFormat, usdcInvoices, usdcPayment, workspaceNamed } from './screens.ts'

type Bare = Omit<Scenario, 'id' | 'items'>

const PRESS: Record<number, () => Bare> = {
  1: keysLetIn,
  2: () => onThePhone('Resume and Start every agent signed with Face ID on the phone'),
  3: expiredDraws,
  4: phoneOnlyWeb,
  5: preparedListed,
  6: coveredPaid,
  7: workspaceNamed,
  8: noMachineWords,
  9: looseningSigned,
  10: pausedPull,
  11: keysRemovable,
  12: roomPayout,
  13: usdcInvoices,
  14: noCardWords,
  15: () => onThePhone("an agent's approval approved from the lock screen with Face ID"),
  16: () => onThePhone('a payment from the phone confirmed with Face ID every time, the first-payment questions once'),
  17: declineHolds,
  18: roomNames,
  19: helpProviders,
  20: dollarsFirst,
  // B55.43's own scenario presses it: the push Lens sends, shown by the app's service worker.
  21: () => spendNoticePush(21),
  22: lastPhoneKey,
  23: usdcPayment,
  24: noRawRefusals,
  25: oneMoneyFormat,
}

/** Problem `n`'s scenario, under its Pocket id and named by its fix items. */
export function pocketScenario(n: number): Scenario {
  const p = POCKET.find((x) => x.n === n)
  if (p === undefined) throw new Error(`no Pocket problem ${n}`)
  const s = PRESS[n]()
  return { ...s, id: pocketID(n), items: p.items, title: `Pocket problem ${n}, ${p.problem}: ${s.title}` }
}

/** One user for each problem, in order. */
export function pocketJourneys(): Scenario[][] {
  return POCKET.map((p) => [pocketScenario(p.n)])
}
