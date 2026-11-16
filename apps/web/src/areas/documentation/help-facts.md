# What Help's AI may say beyond /documentation

<!--
B61.38 — the short facts file the Help chat answers from, beside the documentation content it adds to. Each line is
read off the screen its heading names, in that screen's own words. helpPages.test.ts writes this file and
content.ts into apps/bff/help_pages.json, which is all the BFF gives the model: a figure about Talyvor that is not
written here or in content.ts is one the Help chat cannot say. A heading is `## <path> · <name>`, or `## · <name>`
for facts with no page; every path must be a page the app mounts.
-->

## · Talyvor
- Each agent gets a wallet of its own: you fund it, the agent spends only what it holds, and its statement is every payment against it.
- Talyvor checks your rules before an agent's payment moves.
- Talyvor's email address is hello@talyvor.com. We answer by email.

## /approvals · Approvals
- A payment above an agent's approval amount waits in your approvals inbox until you approve or decline it.
- You approve with a passkey once you have one.

## /settings/help · Help and complaints
- Ask us about your account, or tell us what went wrong. A person at Talyvor reads every message and answers on this page.
- A complaint gets a reference as soon as you send it. Quote it whenever you write to us about it.

## /settings/close · Close this account
- Before the account can close, every balance must be empty: the account's own, each agent's, and any money set aside. Move the money out first.
- A person at Talyvor closes the account and answers on this page. Only the account's owner can ask.

## /settings/data · Your data
- Ask for a copy of this account's data, or ask Talyvor to delete it. A person at Talyvor handles each request. Only the account's owner can ask.
- When your copy is ready, Download appears beside your request.
- Billing and ledger records, statements included, are kept as the law requires.
- Help chats are kept for 30 days and are listed on this page, where you can delete yours. Your Help chat is yours alone: no one else in the account sees it.
