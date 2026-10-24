import { TALY_INTRO } from './lines'

// B45.5 — Taly's first message in a new conversation. The plain ring stands in for Taly's art until Talyvor
// Studio delivers it (SVG and Lottie).
export function TalyIntro() {
  return (
    <p className="flex items-center gap-2 text-body text-muted" data-testid="taly-intro">
      <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-pill border border-accent bg-accent-tint" />
      {TALY_INTRO}
    </p>
  )
}
