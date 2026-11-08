import { Icon, type IconName } from '../pocket/Icon'

// B57.6 — the sidebar's names, each mapped onto Pocket's icon set (../pocket/Icon), so every page that draws a
// NavIcon draws Pocket's line: 24px grid, 1.9 stroke, round caps. `turn` rotates the one chevron for fold and unfold.
const MAP = {
  home: { icon: 'home' },
  approvals: { icon: 'approvals' },
  wallet: { icon: 'agents' },
  statement: { icon: 'statements' },
  coins: { icon: 'coin' },
  chat: { icon: 'chat' },
  grid: { icon: 'marketplace' },
  upload: { icon: 'send' },
  tag: { icon: 'coin' },
  receipt: { icon: 'invoices' },
  prove: { icon: 'shield' },
  issues: { icon: 'work' },
  board: { icon: 'work' },
  cycle: { icon: 'clock' },
  folder: { icon: 'work' },
  docs: { icon: 'statements' },
  page: { icon: 'statements' },
  plug: { icon: 'code' },
  key: { icon: 'key' },
  route: { icon: 'arrow' },
  sliders: { icon: 'settings' },
  card: { icon: 'card' },
  layers: { icon: 'billing' },
  chart: { icon: 'spending' },
  ledger: { icon: 'statements' },
  price: { icon: 'coin' },
  settings: { icon: 'settings' },
  members: { icon: 'rooms' },
  fold: { icon: 'chev', turn: -90 },
  unfold: { icon: 'chev', turn: 90 },
  code: { icon: 'code' },
  arrow: { icon: 'arrow' },
  agent: { icon: 'agents' },
  prompt: { icon: 'chat' },
  server: { icon: 'model' },
} satisfies Record<string, { icon: IconName; turn?: number }>

export type NavIconName = keyof typeof MAP
export const navIconNames = Object.keys(MAP) as NavIconName[]

export interface NavIconProps {
  name: NavIconName
  className?: string
}

/** A 20px line icon for a sidebar row. Decorative: the row's label names the destination. */
export function NavIcon({ name, className }: NavIconProps) {
  const { icon, turn } = MAP[name] as { icon: IconName; turn?: number }
  return <Icon name={icon} data-icon={name} className={className} style={turn ? { transform: `rotate(${turn}deg)` } : undefined} />
}
