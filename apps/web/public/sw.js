// sw.js — B19.10: shows the push Lens sends when an agent's request or payment waits for approval,
// and opens Agent Wallets when it is tapped. The payload is decrypted by the browser (RFC 8291).
//
// B28.38: the push carries Approve and Decline (B55.19; its action is still "deny", the route's name). Either one decides the approval from here, with the
// session cookie, exactly as the Approvals screen does — the app does not open. Once a workspace has a
// passkey, Lens takes a decision only signed with one, which a notification cannot ask for; then, and on
// any other refusal, the app opens on Approvals so the person finishes it there.
//
// B55.2: a workspace with a passkey or a phone key decides only signed, so its push carries no actions
// and the tap opens the approval on Approvals.

const APPROVALS_URL = '/approvals'

// B29.14: every notification carries the Talyvor app icon, as its picture and as its status-bar badge.
const ICON = '/icon-192.png'

/** Whether the workspace signs its decisions: any passkey or phone key, revoked ones too as Lens counts them. A read that fails counts as yes. */
async function workspaceSigns() {
  try {
    const read = (path) => fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    const [p, d] = await Promise.all([read('/api/agents/passkeys'), read('/api/money/devices')])
    if (!p.ok || !d.ok) return true
    const passkeys = (await p.json()).passkeys || []
    const devices = (await d.json()).devices || []
    return passkeys.length > 0 || devices.length > 0
  } catch {
    return true
  }
}

// B55.49: the amount at the end of Lens's sentence, in either order LENS_MONEY_ORDER names: "$340.00 (3,400 LXC)" or "3,400 LXC ($340.00)".
const LENS_AMOUNT = /(-?\$[\d,.]+ \(-?[\d,.]+ LXC\)|-?[\d,.]+ LXC \(-?\$[\d,.]+\))$/

/** Shows the notification for one push from Lens: {approval_id, agent_name, amount_lxc, reason, body}. */
async function showApproval(d) {
  const who = d.agent_name || 'An agent'
  // B55.49: from B55.30 Lens sends body, the sentence the phones show, with dollars beside the LXC; an older Lens does not.
  const said = typeof d.body === 'string' ? d.body.match(LENS_AMOUNT) : null
  const amount = said ? said[1] : d.amount_lxc ? `${d.amount_lxc} LXC` : 'a payment'
  const id = d.approval_id || ''
  const signs = id ? await workspaceSigns() : false
  return self.registration.showNotification(said ? d.body : `${who} asks you to approve ${amount}`, {
    body: signs ? 'Open Talyvor to approve or decline it with your passkey or your phone.' : d.reason || 'Open Agent Wallets to approve or decline it.',
    icon: ICON,
    badge: ICON,
    tag: id || 'agent-approval',
    data: { url: id ? `${APPROVALS_URL}#approval-${id}` : APPROVALS_URL, approval_id: id, who, amount },
    // Only a push naming its approval, in a workspace that signs nothing, can be decided from the notification.
    actions: id && !signs
      ? [
          { action: 'approve', title: 'Approve' },
          { action: 'deny', title: 'Decline' },
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
 * Approve or Decline on the notification: sends the decision to the same route the Approvals screen uses,
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
  return self.registration.showNotification(`${approved ? 'Approved' : 'Declined'}: ${data.who}, ${data.amount}`, {
    body: approved ? 'Its next identical request goes through, once.' : 'Its request is refused, and the same request is refused without asking you for 24 hours.',
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
