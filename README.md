# Devs Who Move

An Angular 22 application served by a Cloudflare Worker, with D1 persistence. Scaffolded with `create-cloudflare`. The repository root contains the application, Worker, database migrations, and pnpm tooling.

## Run locally

Use Node 24+ (see `.nvmrc`) and pnpm 12.16.1, pinned in `package.json`.

```sh
npm install --global pnpm@12.16.1
pnpm install --frozen-lockfile
pnpm run db:local
pnpm start
```

Commit dependency changes with `pnpm-lock.yaml`. Native dependency build scripts are explicitly allowed in `pnpm-workspace.yaml`; review new build-script requests before approving them with `pnpm approve-builds`.

Open http://127.0.0.1:8787. `pnpm start` configures `APP_URL` for this loopback origin. An empty anonymous community shows **explicitly labelled sample content**, never inserted into the database. After sign-in, the app uses only persisted data. API failures display errors rather than falling back to samples.

For frontend hot reload, run `pnpm run dev:api` and `pnpm run dev:ui` in separate terminals. `dev:api` configures `APP_URL` as `http://127.0.0.1:4200` for the proxy; open http://127.0.0.1:4200. Use the same `127.0.0.1` host for the app and OAuth callback so the state cookie is sent on the loopback redirect.

## GitHub sign-in

Create a **GitHub OAuth App** (not a GitHub App) with:

- Homepage URL: `http://127.0.0.1:8787`
- Authorization callback URL: `http://127.0.0.1:8787/auth/github/callback`

Copy `.dev.vars.example` to `.dev.vars`, and fill in the client ID and secret. Restart Wrangler. Never commit `.dev.vars`.

The Worker requests `read:user`, not repository or email permissions. GitHub access tokens are used only during sign-in and not stored. Browser sessions use hashed opaque tokens and HTTP-only, SameSite cookies (Secure on HTTPS), expire in 30 days, and are invalidated on logout. OAuth state is random, cookie-bound and expires in 10 minutes.

For GitHub accounts, new profiles and website-created activities are **private by default**. Activities created using agent API tokens or MCP are **public**. Edit your profile to choose sports, bio, approximate location and public/private visibility. Publishing an individual activity does not override a private profile. Hosting an event is explicitly public even with a private profile. AT Protocol accounts are public-only; see the privacy notes below.

## AT Protocol sign-in and public data

AT Protocol sign-in uses OAuth with PKCE and DPoP. Set `ATPROTO_OAUTH_PRIVATE_KEY` to a base64-encoded PKCS#8 P-256 private key PEM, and `ATPROTO_SESSION_KEY` to a base64-encoded, random 32-byte AES key. Generate local development values with:

```sh
openssl ecparam -name prime256v1 -genkey -noout \
  | openssl pkcs8 -topk8 -nocrypt -outform PEM \
  | base64 | tr -d '\n'
openssl rand -base64 32 | tr -d '\n'
```

Put each result in `.dev.vars` beside `wrangler.jsonc`; never commit either key. A raw PKCS#8 PEM (`BEGIN PRIVATE KEY`) is also accepted for the signing key, but SEC1 keys (`BEGIN EC PRIVATE KEY`) must be converted with `openssl pkcs8 -topk8 -nocrypt`. If a key is malformed, sign-in returns a 503 naming the misconfigured secret. Use separate keys in production and configure them as Worker secrets. The signing key is published only through the OAuth JWKS endpoint; the private key and encrypted OAuth sessions are never published.

An AT Protocol personal data server (PDS) is public storage. Profiles, activities, and hosted events for AT Protocol accounts are public records; a public record can be copied, indexed, or cached by others and deleting it cannot guarantee those copies disappear. Do not publish precise home/work locations, live location or routes, private contact details, health or other sensitive notes, attendance identities, or information you would not want permanently public. The app warns users and requires confirmation before public writes. Photos are not supported for these accounts. RSVP identities and agent tokens remain in Cloudflare and are not written to the PDS.

The PDS is canonical for AT Protocol profiles, activities, and hosted events. Cloudflare D1 holds a validated, bounded read projection for the community feed; synchronization is throttled to once every five minutes and capped at 1,000 records per collection per sync. OAuth state and refresh sessions are encrypted in D1. Never put OAuth signing keys, session-encryption keys, agent tokens, or credentials in PDS records.

## Included in this slice

- Responsive community feed with sport filters and personal activity view.
- Light, dark, and system themes, with a saved browser preference and live OS-theme updates in system mode.
- Activity logging, distance/time/pace, privacy changes, deletion and agent attribution.
- One optional photo per activity, stored in Cloudflare R2. The browser resizes photos to at most 2048px and re-encodes them as JPEG. The Worker also strips EXIF/GPS, XMP and text metadata from JPEG, PNG and WebP uploads. Photos are only served to people who can see the activity.
- Profiles with sports, editable bio, visibility controls, summaries and a 13-week activity calendar.
- Clean Angular routes: `/feed`, `/events`, `/profile`, and `/agents`. `/profile` shows your account or a sign-in prompt, never a sample identity.
- Public profiles have a **Copy profile link** button. GitHub links use `/profile/GITHUB_USERNAME` and AT Protocol links use the account DID. Private profiles return 404 to other users. Cloudflare's SPA fallback supports direct links and refreshes.
- Profile statistics include all visible indexed activities. Month and activity filters apply to the activity list and calendar; the community feed remains limited to recent activities.
- Public events with local-time display, capacity, host RSVP, joining/leaving, host editing and host cancellation. Hosts cannot lower capacity below the number of people already going. Capacity is enforced in one database statement.
- GitHub OAuth sign-in, D1-backed sessions and origin checks for cookie-authenticated mutations.
- AT Protocol OAuth sign-in with PDS-backed public profiles, activities and hosted events; private RSVP identities and agent tokens remain in Cloudflare.
- Scoped, hashed, expiring and revocable agent bearer tokens, with idempotent private uploads.

Activity lists and summaries currently cover the latest 100 visible sessions. Events show the next 100 upcoming sessions. Event details and host names are public; attendee identities are not exposed.

## Agent API

Sign in, open **Your agents**, choose permissions and create a token. Copy it once into the agent's secret manager. Tokens expire in 90 days; at most 10 unexpired tokens per account. Token management, changing existing activity visibility, profile privacy and event mutations require a browser session.

Supported scopes: `activities:read`, `activities:write`, `events:read`.
AT Protocol agent tokens can publish public activity records to the account's PDS while its authorization remains valid.

An HTTP-capable agent can upload a session:

```sh
curl "$DWM_URL/api/activities" \
  -H "Authorization: Bearer $DWM_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: training-session-2026-11-04' \
  --data '{
    "title": "Before standup",
    "sport": "Running",
    "occurredAt": "2026-11-04T07:30:00Z",
    "duration": 31,
    "distance": 5,
    "notes": "Easy effort. Felt good."
  }'
```

To attach a photo, send the raw image bytes (JPEG, PNG or WebP, at most 5 MB). Location and other embedded metadata are removed before storage:

```sh
curl -X PUT "$DWM_URL/api/activities/$ACTIVITY_ID/photo" \
  -H "Authorization: Bearer $DWM_TOKEN" \
  -H 'Content-Type: image/jpeg' \
  --data-binary @session.jpg
```

`duration` is minutes; `distance` is optional and measured in kilometres. Times are ISO 8601, stored in UTC. Sports: `Running`, `Cycling`, `Tennis`, `Walking`, `Swimming`, `Strength`, `Other`. Agent uploads are always public, even if an older client sends `"visibility": "private"`. A private GitHub profile still hides its activities from other people. Existing activities are not changed.

For GitHub accounts, reusing an idempotency key with the same validated payload returns the original ID; a different payload returns 409. Agents should supply a stable key per session to avoid duplicate imports. Idempotency keys are not supported for AT Protocol activities and are rejected rather than silently ignored.

To import up to 100 activities in one request (maximum JSON body: 1 MiB), use `POST /api/activities/bulk`:

```sh
curl "$DWM_URL/api/activities/bulk" \
  -H "Authorization: Bearer $DWM_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "activities": [
      {
        "title": "Morning run",
        "sport": "Running",
        "occurredAt": "2026-11-04T07:30:00Z",
        "duration": 31,
        "distance": 5,
        "idempotencyKey": "training-session-2026-11-04"
      }
    ]
  }'
```

Bulk requests return HTTP 200 with ordered, zero-based per-item results, for example
`{"results":[{"index":0,"status":201,"id":"..."},{"index":1,"status":400,"error":"..."}]}`.
Valid activities are saved even when other items fail validation or conflict with an
idempotency key. A replay has item status 200; an idempotency conflict has item
status 409. Use each item's `idempotencyKey`, not an `Idempotency-Key` header for
the whole batch. Authentication, scope, malformed body and batch-size failures
reject the request before any activities are saved.

| Endpoint                           | Permission                                      |
| ---------------------------------- | ----------------------------------------------- |
| `GET /api/activities`              | `activities:read` — own recent sessions only    |
| `POST /api/activities`             | `activities:write` — public sessions            |
| `POST /api/activities/bulk`        | `activities:write` — 1–100 public sessions      |
| `PUT /api/activities/:id/photo`    | `activities:write` — own sessions (GitHub only) |
| `DELETE /api/activities/:id/photo` | `activities:write` — own sessions (GitHub only) |
| `GET /api/events`                  | `events:read` — upcoming public events          |

## MCP server

The app also exposes a stateless MCP server at `POST /mcp`, using the
2026-07-28 Streamable HTTP protocol. Configure an MCP client with the app URL
and an existing scoped agent token:

```json
{
  "mcpServers": {
    "devs-who-move": {
      "url": "https://devswhorun.dev/mcp",
      "headers": {
        "Authorization": "Bearer dwm_YOUR_TOKEN"
      }
    }
  }
}
```

The server implements `server/discover`, `tools/list` and `tools/call`. It
exposes `list_activities` (`activities:read`), `create_activity` / `create_activities`
(`activities:write`) and `list_upcoming_events` (`events:read`) according to
the token's scopes. `create_activities` accepts the same `activities` array as
the bulk API and returns the same per-item results. Agent-created activities are public; activity
validation, idempotency and token revocation use the same API and storage as
other agents. MCP connections use the existing bearer tokens; MCP OAuth
authorization is not implemented.

## Deploy

```sh
pnpm exec wrangler d1 create devs-who-move
pnpm exec wrangler r2 bucket create devs-who-move-photos
```

Set the returned `database_id` in `wrangler.jsonc`. Set `vars.APP_URL` to the final **HTTPS** origin. Create a separate production GitHub OAuth App with that origin and `/auth/github/callback`.

```sh
pnpm exec wrangler secret put GITHUB_CLIENT_ID
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put ATPROTO_OAUTH_PRIVATE_KEY
pnpm exec wrangler secret put ATPROTO_SESSION_KEY
pnpm run db:remote   # also run after pulling new migrations
pnpm run deploy
```

Do not deploy with the placeholder database ID or localhost `APP_URL`. No deployment or remote database changes are performed by local setup.

## Checks

```sh
pnpm run build
pnpm run typecheck:worker
pnpm test
pnpm run test:worker
```

Worker integration tests run in an isolated Miniflare runtime with real D1 SQL, not mocked database responses. They do not use your local or production database. Live GitHub sign-in requires OAuth credentials and is not exercised against GitHub by the automated suite.

## Deliberately not yet included

Following/follower approvals, reactions, notifications, multiple photos or video, GPS/routes, wearable imports, event waitlists/recurrence, configurable goals, and agent OAuth. Public/private means **everyone or only you**, not followers-only. Before a public launch, add abuse/rate controls, account deletion/export and operational retention policies.

Cloudflare C3's Angular template currently assumes SSR during its final configuration. This app deliberately uses static Angular assets and a dedicated API Worker; its Wrangler entry point and output directory are configured explicitly.
