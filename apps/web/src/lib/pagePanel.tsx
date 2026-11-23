import { createContext, useContext, useEffect } from 'react'

// B61.121 — a page that opens in the right panel (DESIGN.md section 7, choice 9: on the web, details and decisions open
// in a right panel, never a new page). The shell draws the panel's heading; the page inside can name it for what it
// shows, as a payment is named for who it was to or from.

const PanelName = createContext<((name: string | null) => void) | null>(null)

export const PanelNameProvider = PanelName.Provider

/** Names the panel this page is open in; a page drawn on its own (or a test rendering it alone) names nothing. */
export function usePanelName(name: string | null) {
  const set = useContext(PanelName)
  useEffect(() => {
    if (!set) return
    set(name)
    return () => set(null)
  }, [set, name])
}
