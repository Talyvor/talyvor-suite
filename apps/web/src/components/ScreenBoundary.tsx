import { Component, type ReactNode } from 'react'
import { Button, EmptyState } from '@talyvor/ui/pocket'

// B27.12 — a screen that throws while drawing says so, instead of taking the app with it.
//
// With no boundary anywhere, React unmounts the WHOLE tree on a render error: Lens answering `{}`
// for one route left a blank window — no sidebar, no heading, no way to another screen. The reads
// now check their shape (lib/api.ts#readable) and land in each screen's own failure state; this is
// what still stands if a body gets past them. It sits inside the shell, so the sidebar and the
// heading stay, and it clears when the address changes, so the failure does not follow the person
// to the next screen. Not keyed by address: that would remount every healthy screen on every move.
export class ScreenBoundary extends Component<
  { children: ReactNode; address: string; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { address: string }) {
    if (this.state.failed && prev.address !== this.props.address) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    // B57.5 — drawn in Pocket: its empty state, with the one thing to do about it.
    return (
      <div role="alert" data-design="pocket" className="mx-auto max-w-3xl px-gutter py-4">
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3.5h7l4 4V20.5H7z" />
              <path d="M14 3.5V8h4" />
              <path d="M9.5 12h6M9.5 15.5h6" />
            </svg>
          }
          title="This screen couldn’t be read."
          line="Something it reads came back in a form it can’t show, so nothing is shown rather than something wrong."
          action={
            <Button
              size="sm"
              onClick={() => {
                this.props.onRetry()
                this.setState({ failed: false })
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    )
  }
}
