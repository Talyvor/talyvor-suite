import { cn } from '../lib/cn'

// B57.6 — Pocket's line icons, path for path from the reference (design/pocket/index.html, its .ico drawings):
// a 24px grid, 1.9 stroke, round caps and joins, in currentColor. `spending` and `scan` are the sidebar's two
// besides the item's list; `work` is the sidebar's Track and Docs checklist.
const ICONS = {
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10v9h11v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  approvals: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="7" width="14" height="11" rx="5" />
      <circle cx="9.7" cy="12" r="1" fill="currentColor" />
      <circle cx="14.3" cy="12" r="1" fill="currentColor" />
      <path d="M12 4v3" />
    </>
  ),
  payments: (
    <>
      <path d="M5 9h12l-3-3" />
      <path d="M19 15H7l3 3" />
    </>
  ),
  statements: (
    <>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M14 3.5V8h4" />
      <path d="M9.5 12h6M9.5 15.5h6" />
    </>
  ),
  spending: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l5.7 5.7" />
      <path d="M12 12h8" />
    </>
  ),
  marketplace: (
    <>
      <path d="M4.5 9.5 6 5h12l1.5 4.5" />
      <path d="M4.5 9.5c0 1.6 1.2 2.6 2.6 2.6S9.8 11 9.8 9.5c0 1.6 1.1 2.6 2.2 2.6s2.2-1 2.2-2.6c0 1.6 1.2 2.6 2.6 2.6s2.6-1 2.6-2.6" />
      <path d="M6 12v7.5h12V12" />
    </>
  ),
  rooms: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.8 19c.5-3 2.6-4.6 5.2-4.6s4.7 1.6 5.2 4.6" />
      <path d="M14.6 15.3c2.6-.4 4.9.9 5.6 3.7" />
    </>
  ),
  chat: <path d="M5 6.5h14v9.5H11l-4 3.5v-3.5H5z" />,
  scan: (
    <>
      <path d="M5 19V5" />
      <path d="M5 19h14" />
      <path d="m8 15 3.5-4 3 2.5L19 8" />
    </>
  ),
  work: (
    <>
      <path d="M10 7h9M10 12h9M10 17h9" />
      <path d="m4.5 7 1 1 2-2M4.5 12l1 1 2-2M4.5 17l1 1 2-2" />
    </>
  ),
  code: <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />,
  billing: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.5 10v4M17.5 10v4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  pause: <path d="M9 6.5v11M15 6.5v11" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
      <path d="M10 20.5h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chev: <path d="M10 7l5 5-5 5" />,
  faceid: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9.5v1.2M15 9.5v1.2M12 9.5v3.5h-1" />
      <path d="M9.3 15.3c1.6 1.3 3.8 1.3 5.4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 7.5-7.5M15.5 7.5l2.5 2.5M13.5 9.5l2 2" />
    </>
  ),
  check: <path d="M6 12.5l4 4 8-9" />,
  x: <path d="m7 7 10 10M17 7 7 17" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  card: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="3" />
      <path d="M3.5 10h17" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2.5" />
      <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6z" />
      <path d="m9 12 2.2 2.2 4-4.4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M11 18h2" />
    </>
  ),
  send: (
    <>
      <path d="M5 12 19 5l-4 14-3.5-5.5z" />
      <path d="m11.5 13.5 3.5-3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  invoices: (
    <>
      <path d="M7 3.5h10v17l-2.5-1.6-2.5 1.6-2.5-1.6L7 20.5z" />
      <path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  model: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M10 3.5v2.5M14 3.5v2.5M10 18v2.5M14 18v2.5M3.5 10h2.5M3.5 14h2.5M18 10h2.5M18 14h2.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
      <path d="M7.5 10h1M11.5 10h1M15.5 10h1M8 14h8" />
    </>
  ),
} as const

export type IconName = keyof typeof ICONS
export const iconNames = Object.keys(ICONS) as IconName[]

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name' | 'ref'> {
  name: IconName
  /** 20 in a row or a button, 16 beside small text. */
  size?: number
  className?: string
}

/** One of Pocket's line icons. Decorative: the label beside it names the thing. */
export function Icon({ name, size = 20, className, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={cn('shrink-0', className)}
      {...props}
    >
      {ICONS[name]}
    </svg>
  )
}
