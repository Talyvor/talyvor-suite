// B57.1 — the components on one page, for pocket-shots. Built by scripts/pocket/shots.mjs outside dist, so the app
// never routes to it (src/FirstRunGaps.test.tsx keeps /specimen gone). B57.4 drew it in Pocket's components (Specimens.tsx).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Cards, Story } from './Specimens'

import '@talyvor/ui/theme.css'
import '../../../src/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Story />
    <Cards />
  </StrictMode>,
)
