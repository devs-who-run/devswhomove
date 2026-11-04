# Devs Who Move

An Angular 22 application served by a Cloudflare Worker, with D1 persistence. Scaffolded with `create-cloudflare`. The repository root contains the application, Worker, database migrations, and npm tooling.

## Run locally

Use Node 22.22.3+ or a current supported Node release.

```sh
npm ci
npm run db:local
npm start
```

Open http://localhost:8787. An empty anonymous community shows **explicitly labelled sample content**, never inserted into the database. After sign-in, the app uses only persisted data. API failures display errors rather than falling back to samples.

For frontend hot reload, run `npm run dev:api` and `npm run dev:ui` in separate terminals. Open http://localhost:4200. OAuth redirects return to `APP_URL` (port 8787 by default); use that origin for testing the full authentication flow. Browser mutations intentionally require the configured `APP_URL` origin, so use port 8787 for mutations, or set `APP_URL` to `http://localhost:4200` locally when using the proxy.

## GitHub sign-in

Create a **GitHub OAuth App** (not a GitHub App) with:

- Homepage URL: `http://localhost:8787`
- Authorization callback URL: `http://localhost:8787/auth/github/callback`

Copy `.dev.vars.example` to `.dev.vars`, and fill in the client ID and secret. Restart Wrangler. Never commit `.dev.vars`.

The Worker requests `read:user`, not repository or email permissions. GitHub access tokens are used only during sign-in and not stored. Browser sessions use hashed opaque tokens and HTTP-only, SameSite cookies (Secure on HTTPS), expire in 30 days, and are invalidated on logout. OAuth state is random, cookie-bound and expires in 10 minutes.

New profiles and activities are **private by default**. Edit your profile to choose sports, bio, approximate location and public/private visibility. Publishing an individual activity does not override a private profile. Hosting an event is explicitly public even with a private profile.

## Included in this slice

- Responsive community feed with sport filters and personal activity view.
- Light, dark, and system themes, with a saved browser preference and live OS-theme updates in system mode.
- Activity logging, distance/time/pace, privacy changes, deletion and agent attribution.
- Profiles with sports, editable bio, visibility controls, summaries and a 13-week activity calendar.
- Clean Angular routes: `/feed`, `/events`, `/profile`, and `/agents`. `/profile` shows your account or a sign-in prompt, never a sample identity.
- Public profile links: `/profile/GITHUB_USERNAME`. Private profiles return 404 to other users. Cloudflare's SPA fallback supports direct links and refreshes.
- Public events with local-time display, capacity, host RSVP, joining/leaving and host cancellation. Capacity is enforced in one database statement.
- GitHub OAuth sign-in, D1-backed sessions and origin checks for cookie-authenticated mutations.
- Scoped, hashed, expiring and revocable agent bearer tokens, with idempotent private uploads.

Activity lists and summaries currently cover the latest 100 visible sessions. Events show the next 100 upcoming sessions. Event details and host names are public; attendee identities are not exposed.

## Agent API

Sign in, open **Your agents**, choose permissions and create a token. Copy it once into the agent's secret manager. Tokens expire in 90 days; at most 10 unexpired tokens per account. Token management, publication, profile privacy and event mutations require a browser session.

Supported scopes: `activities:read`, `activities:write`, `events:read`.

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
    "notes": "Easy effort. Felt good.",
    "visibility": "private"
  }'
```

`duration` is minutes; `distance` is optional and measured in kilometres. Times are ISO 8601, stored in UTC. Sports: `Running`, `Cycling`, `Tennis`, `Walking`, `Swimming`, `Strength`, `Other`. Agent uploads are always private. Reusing an idempotency key with the same validated payload returns the original ID; a different payload returns 409. Agents should supply a stable key per session to avoid duplicate imports.

| Endpoint               | Permission                                   |
| ---------------------- | -------------------------------------------- |
| `GET /api/activities`  | `activities:read` — own recent sessions only |
| `POST /api/activities` | `activities:write` — private sessions only   |
| `GET /api/events`      | `events:read` — upcoming public events       |

This is **bearer-token integration**, not an MCP server. Interactive OAuth authorisation for agents, MCP discovery and tool transport are future work. The GitHub identity/session foundation is implemented, but does not pretend to provide those protocols yet.

## Deploy

```sh
npx wrangler d1 create devs-who-move
```

Set the returned `database_id` in `wrangler.jsonc`. Set `vars.APP_URL` to the final **HTTPS** origin. Create a separate production GitHub OAuth App with that origin and `/auth/github/callback`.

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npm run db:remote
npm run deploy
```

Do not deploy with the placeholder database ID or localhost `APP_URL`. No deployment or remote database changes are performed by local setup.

## Checks

```sh
npm run build
npm run typecheck:worker
npm test
npm run test:worker
```

Worker integration tests run in an isolated Miniflare runtime with real D1 SQL, not mocked database responses. They do not use your local or production database. Live GitHub sign-in requires OAuth credentials and is not exercised against GitHub by the automated suite.

## Deliberately not yet included

Following/follower approvals, reactions, notifications, image uploads, GPS/routes, wearable imports, event waitlists/recurrence, configurable goals, and agent OAuth/MCP. Public/private means **everyone or only you**, not followers-only. Before a public launch, add abuse/rate controls, account deletion/export and operational retention policies.

Cloudflare C3's Angular template currently assumes SSR during its final configuration. This app deliberately uses static Angular assets and a dedicated API Worker; its Wrangler entry point and output directory are configured explicitly.
