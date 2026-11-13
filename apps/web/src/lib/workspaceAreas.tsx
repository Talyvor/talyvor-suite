import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'

import { getJSON } from './api'

// B59.2 — a hidden area is not there. A workspace has an area only once the operator switches it on
// in Lens (B59.1); until then the console draws no nav row, Home card, palette entry, Settings entry
// or link for it, and its address goes to Home. Not greyed out, and nothing says it is coming.
//
// While the areas are being read, and when they cannot be read, every area is off: the BFF answers
// 404 on an area's routes in both cases too.

export type Area =
  | 'marketplace'
  | 'rooms'
  | 'chat'
  | 'track'
  | 'docs'
  | 'code'
  | 'edge'
  | 'desktop'
  | 'scan'
  | 'counter'
  | 'trading'
  | 'credit'
  | 'interest'
  | 'prediction_markets'
  | 'gateway'

/** Which console addresses belong to which area. A path owns itself and everything below it. */
const AREA_PATHS: readonly { path: string; area: Area }[] = [
  { path: '/chat', area: 'chat' },
  { path: '/rooms', area: 'rooms' },
  { path: '/marketplace', area: 'marketplace' },
  { path: '/track', area: 'track' },
  { path: '/docs', area: 'docs' },
  { path: '/settings/webhooks', area: 'docs' },
  { path: '/settings/email-branding', area: 'docs' },
  { path: '/scan', area: 'scan' },
  { path: '/features', area: 'gateway' },
]

/** The area a console address belongs to, or undefined for a launch screen. */
export function areaOfPath(pathname: string): Area | undefined {
  const path = pathname.replace(/\/\*$/, '')
  return AREA_PATHS.find((e) => path === e.path || path.startsWith(`${e.path}/`))?.area
}

/** GET /api/workspace/areas — the areas this workspace has. */
export async function readWorkspaceAreas(): Promise<string[]> {
  const body = await getJSON<{ areas: string[] }>('/api/workspace/areas', { areas: 'array' })
  return body.areas
}

/**
 * Where the console reads the areas from, and what it holds before the first read answers (nothing, so every area is
 * off). The package's tests open every area here (test-setup.ts).
 */
export const areaSource: { read: () => Promise<string[]>; initial?: string[] } = { read: readWorkspaceAreas }

export interface WorkspaceAreas {
  /** True once the read has answered or failed: until then nothing decides an area is missing. */
  settled: boolean
  /** The areas on, as one string: it changes exactly when `has` and `shows` answer differently. */
  key: string
  has: (area: Area) => boolean
  /** Whether the address belongs to no area, or to one this workspace has. */
  shows: (pathname: string) => boolean
}

export function useWorkspaceAreas(): WorkspaceAreas {
  const q = useQuery({
    queryKey: ['workspace-areas'],
    queryFn: () => areaSource.read(),
    initialData: areaSource.initial,
    staleTime: 60_000,
  })
  const on = new Set(q.data ?? [])
  const has = (area: Area) => on.has(area)
  return {
    settled: !q.isPending,
    key: [...on].sort().join(','),
    has,
    shows: (pathname) => {
      const area = areaOfPath(pathname)
      return area === undefined || has(area)
    },
  }
}

/** Draws its children only when the workspace has the area. */
export function IfArea({ area, children }: { area: Area; children: React.ReactNode }) {
  return useWorkspaceAreas().has(area) ? <>{children}</> : null
}

/** A route's screen, or Home when the address belongs to an area this workspace does not have. */
export function AreaRoute({ path, children }: { path: string; children: React.ReactElement }) {
  const areas = useWorkspaceAreas()
  const area = areaOfPath(path)
  if (area === undefined) return children
  if (!areas.settled) return null
  return areas.has(area) ? children : <Navigate to="/" replace />
}
