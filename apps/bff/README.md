# apps/bff — the Talyvor suite backend-for-frontend

A small Go service. Three jobs:

1. **Sign people in.** `BFF_AUTH_MODE=oidc` (the name is historical) turns sign-in on: a phone
   number, a texted code, a passcode and a passkey (`phone_signin.go`), and hands back an opaque
   `__Host-talyvor_session` cookie (a Bearer token to the phone app). Google sign-in is gone
   (B61.29). Tokens and upstream credentials stay server-side. `BFF_AUTH_MODE=disabled` is the
   no-auth dev posture — loopback bind only. **There is no default mode**: silence refuses to
   start, because a default would decide an authentication question by omission.
2. **Hold the upstream credentials server-side. They never reach the browser.** They are attached
   only to outbound upstream requests. `TestKeyNeverReachesResponse` fails if any secret **this
   app's own config is holding** — read off `config` by `installedSecrets`, not from a constant —
   appears in a response body or header, or if a `tlv_ws_`/`gwsecret_` credential does.

   ⚠ It used to search only for the constant `testKey` (`tlv_ws_…`), which **no fixture in the
   package installs**, so it could not fail. See `secretleak_test.go` for the measurement and
   `~/talyvor-queue/w11-secretleak-controls.py` for the controls.
3. **Serve the built web app and its API from one origin** — so CORS never enters the picture.

Each signed-in person is provisioned their **own** Lens workspace (and their own Track workspace,
and Docs follows Track). There is no pinned workspace and no stored workspace key: the BFF holds
`LENS_PROVISION_SECRET`, which can create a workspace and mint that workspace's session token and
nothing else. Deliberately **not** `LENS_API_KEY` — the admin key authorises every workspace and
~30 admin routes, so a BFF compromise would escalate from one tenant to all of them.

## What refuses to start

All of it is in `loadConfig` (`main.go`), so a refusal happens before anything binds:

- `LENS_PROVISION_SECRET` missing.
- `BFF_AUTH_MODE` unset or not `oidc`/`disabled`.
- `LENS_API_KEY` **set** — the wrong credential for this process, so it is rejected rather than
  ignored.
- `TRACK_WORKSPACE_ID` **set** — Track is per-session; a pinned id would state a pinning that does
  not happen. Ignoring it would be worse than refusing.
- `LENS_BASE_URL` neither https nor loopback — credentials ride every request to it.
- `disabled` mode on a non-loopback bind. In `oidc` mode a non-loopback bind is permitted **only**
  with an https `BFF_PUBLIC_BASE_URL`, the origin the Secure `__Host-` cookie needs.
- `oidc` mode missing any of `OIDC_ISSUER`, `BFF_PUBLIC_BASE_URL`, or `OIDC_ALLOWED_EMAILS`
  (whether sign-up is open must be stated; `*` states it).
- Track or Docs configured with only half its pair, or in `disabled` mode — the BFF forwards an
  identity it authenticated, and there is none to forward without auth.

A missing `WEB_DIST` bundle is **not** a refusal: it logs `WARNING web bundle not found` and serves
the API anyway.

## Run

```bash
BFF_ADDR=127.0.0.1:8787 \
BFF_AUTH_MODE=disabled \
LENS_BASE_URL=http://127.0.0.1:8080 \
LENS_PROVISION_SECRET=dev-provision-secret \
WEB_DIST=../web/dist \
go run .
```

`readme_boot_test.go` pastes that block into `loadConfig` and fails if it does not start — the
previous one named two variables this binary never reads and omitted two it refuses to start
without.

| Env | Default | |
|---|---|---|
| `BFF_ADDR` | `127.0.0.1:8787` | loopback, unless `oidc` + https public origin |
| `BFF_AUTH_MODE` | — | **required**: `oidc` or `disabled` |
| `LENS_BASE_URL` | `http://127.0.0.1:8080` | how the BFF reaches Lens; https or loopback |
| `LENS_PROVISION_SECRET` | — | **required**; same value Lens boots with |
| `LENS_PUBLIC_BASE_URL` | — | how a *customer* reaches Lens; unset ⇒ the Setup page has no snippets |
| `LENS_API_KEY` | — | must **not** be set (boot refusal) |
| `TRACK_WORKSPACE_ID` | — | must **not** be set (boot refusal) |
| `WEB_DIST` | `../web/dist` | built app to serve; missing ⇒ warning, not refusal |
| `BFF_PUBLIC_BASE_URL` | — | `oidc`: browser-facing origin, bare, no path |
| `OIDC_ISSUER` | — | `oidc`: the namespace the identities of people who first signed in with Google were made under; Lens keys their accounts by it, so it keeps its value. Nothing is fetched from it (B61.29) |
| `OIDC_ALLOWED_EMAILS` | — | `oidc`: `*` reports sign-up as open (`/auth/me`'s `signup_open`); a comma-separated list reports it closed |
| `BFF_SESSION_TTL` | `12h` | absolute session lifetime; sessions are in-memory |
| `BFF_DATABASE_URL` | (unset) | Postgres for assistant sign-ins (Talyvor Connect): clients, codes, grants and hashed tokens survive a restart; unset keeps them in memory |
| `BFF_CONNECT_REGISTER_PER_IP_HOUR` | `10` | Talyvor Connect (B52.3): client registrations per IP per hour, which also caps the unused clients one address holds; over it is 429 with Retry-After |
| `BFF_CONNECT_AUTHORIZE_PER_IP_MINUTE` | `60` | Connect: `/oauth/authorize` requests per IP per minute |
| `BFF_PHONE_DOOR_PER_IP_MINUTE` | `60` | B61.25: requests per IP per minute to each sign-in route of the phone door (`/auth/phone/*`, `/auth/passkey/challenge`, `/auth/passkey/finish`, `/auth/unlock*`), beside Lens's own limits on texts and passcode tries |
| `BFF_CONNECT_TOKEN_PER_IP_MINUTE` | `60` | Connect: `/oauth/token` requests per IP per minute |
| `BFF_CONNECT_TOKEN_PER_CONNECTION_MINUTE` | `10` | Connect: refreshes per connection per minute |
| `BFF_CONNECT_MCP_PER_IP_MINUTE` | `600` | Connect: `/mcp` requests per IP per minute |
| `BFF_CONNECT_MCP_PER_CONNECTION_MINUTE` | `120` | Connect: `/mcp` requests per connection per minute |
| `BFF_CONNECT_REDIRECT_ORIGINS` | `https://claude.ai,https://chatgpt.com` | Connect (B54.11): the `scheme://host` origins open registration accepts as a `redirect_uri`, comma-separated, besides loopback http; set, it replaces the list; any other redirect is refused at `/oauth/register` |
| `BFF_CONNECT_PREPARE_ONLY` | unset | `true` ⇒ Connect's `send_payment` pays nothing and points to Talyvor: the connector a public plugin directory lists (B52.6) |
| `BFF_OPENAI_APPS_CHALLENGE` | unset | the token ChatGPT's plugin directory gives Talyvor's OpenAI publisher account; `/.well-known/openai-apps-challenge` answers it as plain text; unset ⇒ that path is a 404 (B52.8) |
| `LENS_CONNECT_MINT_KEY` | — | the same value as Lens's `LENS_CONNECT_MINT_KEY`; set ⇒ Connect's `send_payment` pays from an agent inside its limits on a token Lens binds to that agent; unset ⇒ it pays nothing (B52.6). With it the BFF also tells Lens when a person disconnects an assistant or signs out everywhere, retried every 30 s until Lens records it, so those Connect tokens stop paying at once (B54.21). Never a Lens admin key |
| `HELP_LENS_KEY` | unset | a Lens key on Talyvor's own account; the Help chat's model calls go on it, never on the customer's (B61.38). Unset ⇒ Help asks no model and offers "Send to our team" for every question |
| `HELP_QUESTIONS_PER_DAY` | `20` | how many questions one account may ask the Help chat in a UTC day (B61.38); a whole number above 0 |
| `HELP_MODEL` | unset | the model the Help chat asks on `HELP_LENS_KEY` (B61.69). Unset ⇒ Lens's catalog's newest Anthropic model, which Lens answers only where the old gateway's area is on; a 404 there is logged once, naming `HELP_MODEL` |
| `BFF_SMTP_HOST` | unset | the SMTP server for the mail a moved phone number owes each address the person gave for their contact check (B61.91, number_moves.go). Unset (or `BFF_EMAIL_FROM` unset) ⇒ the mails are kept unsent in `number_move_mails` and go once it is set; the moved person is signed out everywhere either way |
| `BFF_SMTP_PORT` | `465` | 465 speaks TLS from the first byte; any other port must offer STARTTLS (loopback excepted) |
| `BFF_SMTP_USER` | unset | the SMTP sign-in name |
| `BFF_SMTP_PASSWORD` | unset | the SMTP password (server-side only, never logged) |
| `BFF_EMAIL_FROM` | unset | the From address of the BFF's mail; must be an email address |
| `OPERATOR_SUBS` | — | OIDC `sub`s that may read every tenant. Unset means **nobody** |
| `TRACK_BASE_URL` | — | optional pair with the secret below; `oidc` only |
| `TRACK_GATEWAY_SECRET` | — | must equal Track's `GATEWAY_AUTH_SECRET` |
| `DOCS_BASE_URL` | — | optional pair; unset ⇒ `/api/docs/*` answers 503 |
| `DOCS_GATEWAY_SECRET` | — | must equal Docs' `GATEWAY_AUTH_SECRET` |
| `LENS_SYNTHETIC_KEY` | — | same value as Lens's; set ⇒ `POST /auth/synthetic` signs in Lens's synthetic test workspaces (B17.2), unset ⇒ 404 |
| `LENS_MODERATOR_KEY` | — | a `tlv_mod_` key from Lens (`/lens moderator-keys create web app`, talyvor-lens `docs/moderator-keys.md`); set ⇒ the marketplace review queue under `/api/admin/marketplace/*` works for anyone on `OPERATOR_SUBS`, each call naming the signed-in operator in `X-Talyvor-Operator`; unset ⇒ 501. Never a Lens admin key (B20.12) |
| `LENS_OPERATOR_READ_KEY` | — | the same value as Lens's `LENS_OPERATOR_READ_KEY`; set ⇒ `GET /api/admin/workspaces` (the operator screen) reads every workspace's spend, held LENS and last activity from Lens for anyone on `OPERATOR_SUBS`; unset ⇒ 501. Never a Lens admin key (B18.25) |
| `PICOVOICE_ACCESS_KEY` | — | "Hey Taly"'s Picovoice access key; set ⇒ `GET /api/voice/key` answers it to a signed-in phone (never logged); unset ⇒ 503 "Hey Taly is off." (B58.10) |
| `BFF_VOICE_KEY_PER_SESSION_HOUR` | `20` | `GET /api/voice/key` requests per signed-in person per hour (B58.10) |

That is the whole surface, and it is held to the binary from both sides:
`TestEveryEnvVarTheBinaryReadsIsDocumented` fails if a variable is read and missing here,
`TestReadmeNamesNoVariableTheBinaryIgnores` fails if one is listed here and read by nobody. For an
operator, `deploy/README.md` §4 and `deploy/bff.env.example` say what each value does to a
deployment and how it fails.

## Endpoints

Reads are `GET`. Writes — `POST`/`PATCH`/`DELETE` — are **both session-gated and
same-Origin-checked**; `keys.go` carries the CSRF argument they share. The registered set is in
`newApp` (`lens.go`) and covers `/api/context`, the LXC and token ledgers, keys, spend, pooling,
distill, convert, the Track and Docs proxies, the operator-only `/api/admin/*`, and `/auth/*`.
Not enumerated here on purpose: a list in this file is a second source of truth that nothing
compares to the router.

`/api/lxc/checkout` starts a Stripe Checkout Session to buy LXC and charges nothing itself — the
credit lands later, when Stripe's webhook reaches Lens. It answers `503 {billing_enabled:false}`
when Lens runs without `LENS_BILLING_ENABLED` (a **Lens** variable, not one of the BFF's);
`billing.go` argues why a 404 from Lens is unambiguous on that route.

Everything else is the SPA (client routes fall back to `index.html`).

`go vet ./... && go test -race ./...`
