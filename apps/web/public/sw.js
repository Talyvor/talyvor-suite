// sw.js — B19.10: shows the push Lens sends when an agent's request or payment waits for approval,
// and opens Agent Wallets when it is tapped. The payload is decrypted by the browser (RFC 8291).
//
// B28.38: the push carries Approve and Deny. Either one decides the approval from here, with the
// session cookie, exactly as the Approvals screen does — the app does not open. Once a workspace has a
// passkey, Lens takes a decision only signed with one, which a notification cannot ask for; then, and on
// any other refusal, the app opens on Approvals so the person finishes it there.

const APPROVALS_URL = '/approvals'

// B29.14: every notification carries the Talyvor app icon, as its picture and as its status-bar badge.
const ICON = '/icon-192.png'

/** Shows the notification for one push from Lens: {approval_id, agent_name, amount_lxc, reason}. */
function showApproval(d) {
  const who = d.agent_name || 'An agent'
  const amount = d.amount_lxc ? `${d.amount_lxc} LXC` : 'a payment'
  const id = d.approval_id || ''
  return self.registration.showNotification(`${who} asks you to approve ${amount}`, {
    body: d.reason || 'Open Agent Wallets to approve or deny it.',
    icon: ICON,
    badge: ICON,
    tag: id || 'agent-approval',
    data: { url: APPROVALS_URL, approval_id: id, who, amount },
    // Only a push naming its approval can be decided from the notification.
    actions: id
      ? [
          { action: 'approve', title: 'Approve' },
          { action: 'deny', title: 'Deny' },
        ]
      : [],
  })
}

// B41.207: Lens's morning push ({type: "daily_briefing", workspace_id, line, quiet}) is a briefing, not a
// decision, so it carries no actions and a tap opens Home.
function showBriefing(d) {
  return self.registration.showNotification('This morning', {
    body: d.line || '',
    icon: ICON,
    badge: ICON,
    tag: 'daily-briefing',
    data: { url: '/' },
    actions: [],
  })
}

// B55.43: a spending notice ({type: "spend_notice", kind, notice_id, workspace_id, title, body}) shows Lens's own words
// and opens Spending; a payment or unusual notice opens that notice there, as the phone opens /notices/{id}.
function showSpendNotice(d) {
  const id = d.notice_id || ''
  const url = id && (d.kind === 'payment' || d.kind === 'unusual') ? `/money/spending#notice-${id}` : '/money/spending'
  return self.registration.showNotification(d.title || 'Talyvor', {
    body: d.body || '',
    icon: ICON,
    badge: ICON,
    tag: `spend-notice-${id}`,
    data: { url },
    actions: [],
  })
}

// A push of a type this browser does not know is never read as an approval: it says Talyvor and opens Home.
function showOther() {
  return self.registration.showNotification('Talyvor', {
    body: 'Open Talyvor to see it.',
    icon: ICON,
    badge: ICON,
    tag: 'talyvor',
    data: { url: '/' },
    actions: [],
  })
}

const SHOW = { agent_approval: showApproval, daily_briefing: showBriefing, spend_notice: showSpendNotice }

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = {}
  }
  event.waitUntil((Object.hasOwn(SHOW, d.type) ? SHOW[d.type] : showOther)(d))
})

/** Opens the app at `url`, in a window already open if there is one. */
function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ('focus' in w) {
        w.navigate(url)
        return w.focus()
      }
    }
    return self.clients.openWindow(url)
  })
}

/**
 * Approve or Deny on the notification: sends the decision to the same route the Approvals screen uses,
 * then replaces the notification with what happened. A decision Lens refuses opens the app instead.
 */
async function decideFromNotification(notification, action) {
  const data = notification.data || {}
  const url = data.url || APPROVALS_URL
  let res
  try {
    res = await fetch(`/api/agents/approvals/${encodeURIComponent(data.approval_id)}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    })
  } catch {
    res = undefined
  }
  if (!res || !res.ok) return openApp(url)
  const approved = action === 'approve'
  return self.registration.showNotification(`${approved ? 'Approved' : 'Denied'}: ${data.who}, ${data.amount}`, {
    body: approved ? 'Its next identical request goes through, once.' : 'Its request will be refused.',
    icon: ICON,
    badge: ICON,
    tag: data.approval_id,
    data: { url },
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  if ((event.action === 'approve' || event.action === 'deny') && data.approval_id) {
    event.waitUntil(decideFromNotification(event.notification, event.action))
    return
  }
  event.waitUntil(openApp(data.url || APPROVALS_URL))
})
