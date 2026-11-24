---
name: garmin-import
description: Import yesterday's Garmin Connect activities into DevsWhoRun safely and idempotently.
---

# Import Garmin activities

Use this skill on demand, or schedule it daily in an agent environment that supports scheduled runs. Each run imports **yesterday's local calendar day**, not the previous 24 hours. It does not backfill missed days. The execution environment's local timezone must be the user's intended timezone, including for scheduled runs.

## Prerequisites and safety

- Configure the DevsWhoRun MCP server as described in the [README](../../../README.md#mcp-server), with an agent token that has `activities:write`. This skill requires a **GitHub account**: AT Protocol activities reject idempotency keys, so do not import them with this skill.
- Supply a Garmin Personal API key to the execution environment as `GARMIN_API_KEY`, or set `GARMIN_OP_REFERENCE` to a user-provided 1Password secret reference (for example, `op://<vault>/<item>/credential`). Set these through the environment's secret manager, not in a command, prompt, or file. The environment variable takes precedence.
- MCP-created activities are **public**. A private GitHub profile still hides its activities from others. Make sure the user understands and has authorized these public uploads before importing; a scheduled run requires prior authorization for unattended uploads.
- Keep keys and tokens in process memory only. Never print them, place them in shell arguments, files, prompts, logs, or tool output, or echo API response bodies or exception details. Disable shell tracing. If 1Password is unavailable, locked, or requires interactive approval, stop and report the blocker; do not bypass approval.
- Only create activities. Never modify or delete existing activities. Do not send notes, routes, or unrelated health data.

## Fetch yesterday's activities

Run the following single Node.js script in an environment with `fetch` (Node 18 or later). It computes yesterday using local calendar arithmetic and requests all pages before emitting only the listed fields. If the script fails, report the sanitized error and stop; do not import a partial fetch.

```sh
node <<'NODE'
const { execFileSync } = require('node:child_process');

async function main() {
  let key = process.env.GARMIN_API_KEY;
  if (!key && process.env.GARMIN_OP_REFERENCE) {
    try {
      key = execFileSync('op', ['read', process.env.GARMIN_OP_REFERENCE], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 60000,
      }).trim();
    } catch {
      throw new Error('1Password is unavailable, locked, or requires approval.');
    }
  }
  if (!key || !key.trim()) throw new Error('Garmin API key is not configured.');

  const tokenResponse = await fetch(
    'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token',
    {
      method: 'POST',
      headers: { Authorization: `ApiKey ${key.trim()}` },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!tokenResponse.ok) throw new Error(`Garmin token request failed (HTTP ${tokenResponse.status}).`);
  const body = (await tokenResponse.text()).trim();
  let token = body;
  try {
    const parsed = JSON.parse(body);
    token = typeof parsed === 'string' ? parsed : parsed?.token ?? parsed?.access_token ?? parsed?.accessToken;
  } catch {
    // Garmin may return the JWT as plain text.
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('Garmin token response was invalid.');

  const yesterday = new Date();
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const activities = [];
  for (let start = 0; ; start += 99) {
    const url = new URL('https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities');
    url.search = new URLSearchParams({ startDate: day, endDate: day, sortOrder: 'asc', start: String(start), limit: '99' });
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Garmin activities request failed (HTTP ${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page) || page.length > 99) throw new Error('Garmin activities response was invalid.');
    for (const activity of page) {
      if (!activity || typeof activity !== 'object' || Array.isArray(activity)) {
        throw new Error('Garmin activities response was invalid.');
      }
      activities.push({
        activityId: typeof activity.activityId === 'string' || Number.isSafeInteger(activity.activityId) ? activity.activityId : null,
        activityName: typeof activity.activityName === 'string' ? activity.activityName : null,
        typeKey: typeof activity.activityType?.typeKey === 'string' ? activity.activityType.typeKey : null,
        startTimeGMT: typeof activity.startTimeGMT === 'string' ? activity.startTimeGMT : null,
        duration: typeof activity.duration === 'number' && Number.isFinite(activity.duration) ? activity.duration : null,
        distance: activity.distance == null ? null : typeof activity.distance === 'number' && Number.isFinite(activity.distance) ? activity.distance : 'invalid',
      });
    }
    if (page.length < 99) break;
  }
  console.log(JSON.stringify({ date: day, activities }));
}

main().catch((error) => {
  const message = error instanceof Error && /^(Garmin (API key is not configured|token request failed \(HTTP \d+\)|token response was invalid|activities request failed \(HTTP \d+\)|activities response was invalid)|1Password is unavailable, locked, or requires approval)\.$/.test(error.message)
    ? error.message
    : 'Garmin request failed; check connectivity and credentials.';
  console.error(message);
  process.exitCode = 1;
});
NODE
```

## Map and import

Map each fetched record independently. Do not invent missing values; count and report unmappable records as failed, without including sensitive details.

- `idempotencyKey`: `garmin-<activityId>`. Require a nonempty, stable ID and a key no longer than 128 characters.
- `title`: trimmed `activityName`, truncated to 100 characters; require a nonempty title.
- `sport`: `running`, `trail_running`, `treadmill_running` → `Running`; cycling variants → `Cycling`; `walking` → `Walking`; lap and open-water swimming → `Swimming`; `tennis` → `Tennis`; `strength_training` → `Strength`; other present type keys → `Other`. A missing type is unmappable.
- `occurredAt`: convert Garmin `startTimeGMT` to ISO UTC (replace the space with `T` and append `Z` when needed). Require a valid timestamp that is not in the future.
- `duration`: seconds divided by 60, rounded to two decimals. Require a finite result from 1 to 1440 minutes; values below 1 are unmappable, not rounded up.
- `distance`: if present, divide meters by 1000 and round to three decimals. Require a finite result from 0 to 2000 km; omit if `null`, but treat `invalid` as unmappable.

Call the DevsWhoRun MCP `create_activities` tool with `{ "activities": [...] }`, in batches of at most 100. Inspect every result and match its zero-based `index` to the input item, requiring exactly one result per item: item `status: 201` means imported, `status: 200` means already present (idempotent replay), and any other status, including `409` for a changed payload, means failed. An MCP error, malformed or missing item result, or uncertain response is not success: report affected items as failed or unknown, and retry only with the same keys and unchanged payload. Do not infer success from the outer response alone. A replay only succeeds when the validated payload is unchanged.

Report the date and counts imported, already present, and failed, including unmappable records; distinguish uncertain outcomes from confirmed failures. Do not include secrets or unrelated health data.
