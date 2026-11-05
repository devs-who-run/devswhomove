import type { AgentScope } from '../src/app/models';
import { hash, secret } from './crypto';

export const OAUTH_SCOPES: AgentScope[] = ['activities:read', 'activities:write', 'events:read'];
const SCOPE_LABELS: Record<AgentScope, string> = {
  'activities:read': 'Read your activity history',
  'activities:write': 'Log private activities on your account',
  'events:read': 'Discover upcoming public events',
};
const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_TTL_S = 3600;
const GRANT_TTL_MS = 90 * 86400_000;
const MAX_ACTIVE_TOKENS = 10;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const BLOCKED_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'about:',
  'blob:',
  'filesystem:',
  'ws:',
  'wss:',
  'ftp:',
]);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

export interface OAuthEnv {
  DB: D1Database;
  APP_URL: string;
}

export interface OAuthViewer {
  id: string;
  name: string;
  username: string;
  provider: 'github' | 'atproto';
}

export interface OAuthOptions {
  viewer: () => Promise<OAuthViewer | null>;
  signIn: { github: boolean; atproto: boolean };
}

interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  /** Clients identified by an HTTPS metadata document rather than dynamic registration. */
  metadataDocument: boolean;
}

interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: AgentScope[];
}

type ParsedAuthorize =
  | { ok: true; value: AuthorizeRequest }
  | { ok: false; fatal: string }
  | { ok: false; redirect: URL };

interface GrantTable {
  name: 'agent_tokens' | 'atproto_agent_tokens';
  owner: 'user_id' | 'did';
}

const GRANT_TABLES: Record<'github' | 'atproto', GrantTable> = {
  github: { name: 'agent_tokens', owner: 'user_id' },
  atproto: { name: 'atproto_agent_tokens', owner: 'did' },
};

const origin = (appUrl: string) => new URL(appUrl).origin;

/** URL of the protected resource metadata for the MCP endpoint (RFC 9728). */
export function resourceMetadataUrl(appUrl: string): string {
  return `${origin(appUrl)}/.well-known/oauth-protected-resource/mcp`;
}

/** Build the MCP 401 challenge so clients can discover the authorization server. */
export function mcpChallenge(appUrl: string, error?: 'invalid_token'): string {
  return [
    'Bearer realm="devs-who-move MCP"',
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${resourceMetadataUrl(appUrl)}"`,
    `scope="${OAUTH_SCOPES.join(' ')}"`,
  ].join(', ');
}

/** Accept only same-origin authorization requests as post-sign-in destinations. */
export function safeReturnTo(value: string | null | undefined, appUrl: string): string | null {
  if (!value || value.length > 2048 || !value.startsWith('/oauth/authorize?')) return null;
  try {
    const url = new URL(value, origin(appUrl));
    if (url.origin !== origin(appUrl) || url.pathname !== '/oauth/authorize') return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function oauthJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...CORS_HEADERS },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return oauthJson({ error, error_description: description }, status);
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );

function page(title: string, content: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · devswhomove</title>
<style>
:root{color-scheme:light dark;--bg:#0d1117;--card:#161b22;--text:#e6edf3;--muted:#9aa4b2;--line:#30363d;--accent:#d7ff3f;--accent-text:#0d1117;--danger:#ff7b72}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f4;--card:#fff;--text:#14161a;--muted:#555d68;--line:#d6dad0;--accent:#1f2a00;--accent-text:#f6ffd6;--danger:#b42318}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px}
.brand{font-weight:800;letter-spacing:-.02em;margin:0 0 24px}.brand span{color:var(--accent)}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--muted);margin:0 0 8px}
h1{font-size:24px;line-height:1.25;margin:0 0 12px}p{margin:0 0 16px}.muted{color:var(--muted);font-size:14px}
.notice{border:1px solid var(--line);border-radius:10px;padding:12px;font-size:14px}.error{color:var(--danger)}
fieldset{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:0 0 16px}legend{padding:0 6px;font-weight:600}
label{display:flex;gap:10px;align-items:center;padding:6px 0}input[type=checkbox]{width:18px;height:18px}
input[type=text]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
.button{display:inline-flex;justify-content:center;align-items:center;flex:1;min-width:140px;padding:11px 16px;border-radius:999px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.primary{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
.stack{display:grid;gap:12px;margin-bottom:16px}form.inline{margin:0}
</style>
</head>
<body><main><p class="brand">devswhomove<span>.</span></p>${content}</main></body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
      'Cache-Control': 'no-store',
    },
  });
}

function errorPage(message: string, status = 400): Response {
  return page(
    'Cannot connect',
    `<p class="eyebrow">CONNECTION FAILED</p><h1>We couldn’t connect this app.</h1><p class="error">${escapeHtml(message)}</p><p class="muted">Close this window and start the connection again from your MCP client.</p>`,
    status,
  );
}

/** Validate a redirect URI: HTTPS, HTTP loopback, or a private-use native app scheme. */
function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password || value.includes('#')) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return !BLOCKED_REDIRECT_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Compare redirect URIs exactly, allowing any port for loopback redirects (RFC 8252 §7.3). */
function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  if (!validRedirectUri(requested)) return false;
  const expected = new URL(registered);
  const actual = new URL(requested);
  return (
    expected.protocol === 'http:' &&
    actual.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(expected.hostname) &&
    expected.hostname === actual.hostname &&
    expected.pathname === actual.pathname &&
    expected.search === actual.search
  );
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): URL {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params))
    if (value !== null) url.searchParams.set(key, value);
  return url;
}

function clientName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return (name || fallback).slice(0, 60);
}

async function readText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  const reader = body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Resolve a client from dynamic registration or an HTTPS client ID metadata document. */
async function findClient(env: OAuthEnv, clientId: string): Promise<OAuthClient | null> {
  if (clientId.startsWith('https://')) return metadataDocumentClient(clientId);
  const row = await env.DB.prepare(
    'SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?',
  )
    .bind(clientId)
    .first<{ client_id: string; client_name: string; redirect_uris: string }>();
  return row
    ? {
        id: row.client_id,
        name: row.client_name,
        redirectUris: JSON.parse(row.redirect_uris),
        metadataDocument: false,
      }
    : null;
}

async function metadataDocumentClient(clientId: string): Promise<OAuthClient | null> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.href !== clientId ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname === '/'
  )
    return null;
  let document: unknown;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) return null;
    document = JSON.parse(await readText(response.body, 16_384));
  } catch {
    return null;
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const metadata = document as Record<string, unknown>;
  const redirectUris = metadata['redirect_uris'];
  const authMethod = metadata['token_endpoint_auth_method'];
  if (
    metadata['client_id'] !== clientId ||
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every(validRedirectUri) ||
    (authMethod !== undefined && authMethod !== 'none')
  )
    return null;
  return {
    id: clientId,
    name: clientName(metadata['client_name'], url.hostname),
    redirectUris,
    metadataDocument: true,
  };
}

/** Accept resource indicators for this MCP server (RFC 8707). */
function validResource(value: string | null, appUrl: string): boolean {
  if (value === null) return true;
  const base = origin(appUrl);
  return [`${base}/mcp`, `${base}/mcp/`, base, `${base}/`].includes(value);
}

function parseScopes(value: string | null): AgentScope[] | null {
  if (value === null) return [...OAUTH_SCOPES];
  const requested = new Set(value.split(' ').filter(Boolean));
  const scopes = OAUTH_SCOPES.filter((scope) => requested.has(scope));
  return scopes.length ? scopes : null;
}

function scopesFor(provider: OAuthViewer['provider'], scopes: AgentScope[]): AgentScope[] {
  // AT Protocol activities are public records, so agents may only read on those accounts.
  return provider === 'atproto' ? scopes.filter((scope) => scope !== 'activities:write') : scopes;
}

async function parseAuthorize(params: URLSearchParams, env: OAuthEnv): Promise<ParsedAuthorize> {
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge'])
    if (params.getAll(key).length > 1)
      return { ok: false, fatal: `The ${key} parameter was repeated.` };
  const clientId = params.get('client_id');
  if (!clientId) return { ok: false, fatal: 'The request did not identify the app.' };
  const client = await findClient(env, clientId);
  if (!client)
    return { ok: false, fatal: 'This app is not registered or its metadata is invalid.' };
  const requestedRedirect = params.get('redirect_uri');
  const redirectUri =
    requestedRedirect ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !client.redirectUris.some((uri) => redirectMatches(uri, redirectUri)))
    return { ok: false, fatal: 'The redirect address does not match the app’s registration.' };

  const state = params.get('state');
  const fail = (error: string, description: string) => ({
    ok: false as const,
    redirect: redirectWith(redirectUri, {
      error,
      error_description: description,
      state,
      iss: origin(env.APP_URL),
    }),
  });
  if (params.get('response_type') !== 'code')
    return fail('unsupported_response_type', 'Only the authorization code flow is supported.');
  const codeChallenge = params.get('code_challenge');
  if (
    params.get('code_challenge_method') !== 'S256' ||
    !codeChallenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
  )
    return fail('invalid_request', 'PKCE with the S256 method is required.');
  if (params.getAll('resource').length > 1 || !validResource(params.get('resource'), env.APP_URL))
    return fail('invalid_target', 'The requested resource is not served by this server.');
  const scopes = parseScopes(params.get('scope'));
  if (!scopes) return fail('invalid_scope', 'None of the requested scopes are supported.');
  return { ok: true, value: { client, redirectUri, state, codeChallenge, scopes } };
}

async function activeGrantCount(
  env: OAuthEnv,
  viewer: OAuthViewer,
  replaceClientId: string | null,
): Promise<number> {
  const table = GRANT_TABLES[viewer.provider];
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table.name} WHERE ${table.owner} = ?
    AND COALESCE(refresh_expires_at, expires_at) > ? AND (client_id IS NULL OR client_id != ?)`,
  )
    .bind(viewer.id, new Date().toISOString(), replaceClientId ?? '')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function redirectLabel(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : url.protocol;
}

function signInPage(request: AuthorizeRequest, url: URL, options: OAuthOptions): Response {
  const returnTo = encodeURIComponent(`${url.pathname}${url.search}`);
  const providers = [
    options.signIn.github
      ? `<a class="button primary" href="/auth/github?return_to=${returnTo}">Continue with GitHub</a>`
      : '',
    options.signIn.atproto
      ? `<form class="inline" method="get" action="/auth/atproto"><input type="hidden" name="return_to" value="${escapeHtml(`${url.pathname}${url.search}`)}"><label for="handle" class="muted">Or use your AT Protocol handle</label><input id="handle" type="text" name="handle" placeholder="you.bsky.social" autocomplete="username" required maxlength="253"><div class="actions"><button class="button" type="submit">Continue with AT Protocol</button></div></form>`
      : '',
  ].join('');
  return page(
    'Sign in',
    `<p class="eyebrow">CONNECT AN AGENT</p><h1>Sign in to connect ${escapeHtml(request.client.name)}</h1><p class="muted">You’ll choose what it can access next.</p><div class="stack">${providers || '<p class="error">Sign-in is not configured on this server.</p>'}</div>${cancelForm(url)}`,
  );
}

function cancelForm(url: URL): string {
  return `<form class="inline" method="post" action="/oauth/authorize${escapeHtml(url.search)}"><button class="button" type="submit" name="decision" value="deny">Cancel</button></form>`;
}

async function consentPage(
  request: AuthorizeRequest,
  url: URL,
  viewer: OAuthViewer,
  env: OAuthEnv,
  message = '',
  status = 200,
): Promise<Response> {
  const scopes = scopesFor(viewer.provider, request.scopes);
  const replaceClientId = request.client.metadataDocument ? null : request.client.id;
  const atLimit = (await activeGrantCount(env, viewer, replaceClientId)) >= MAX_ACTIVE_TOKENS;
  const name = escapeHtml(request.client.name);
  const intro = `<p class="eyebrow">CONNECT AN AGENT</p><h1><strong>${name}</strong> wants to use your account</h1><p class="muted">Signed in as ${escapeHtml(viewer.name)} (@${escapeHtml(viewer.username)}).</p>`;
  if (atLimit)
    return page(
      'Too many agents',
      `${intro}<p class="notice error">You already have ${MAX_ACTIVE_TOKENS} active agent connections. Revoke one in Your agents, then try again.</p>${cancelForm(url)}`,
      status,
    );
  const options = scopes
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${scope}" checked><span>${escapeHtml(SCOPE_LABELS[scope])}</span></label>`,
    )
    .join('');
  const verification = request.client.metadataDocument
    ? `<p class="muted">App identity is published at ${escapeHtml(new URL(request.client.id).host)}.</p>`
    : '<p class="notice muted">This app registered itself and its name is not verified. Only continue if you just started this connection.</p>';
  return page(
    'Authorize agent',
    `${intro}${message ? `<p class="notice error" role="alert">${escapeHtml(message)}</p>` : ''}<form method="post" action="/oauth/authorize${escapeHtml(url.search)}"><fieldset><legend>Allow it to</legend>${options}</fieldset><p class="muted">Agents can never publish activities publicly. Access lasts up to 90 days and can be revoked anytime in Your agents.</p><p class="muted">After you decide, you’ll return to <strong>${escapeHtml(redirectLabel(request.redirectUri))}</strong>.</p>${verification}<div class="actions"><button class="button primary" type="submit" name="decision" value="approve">Allow access</button><button class="button" type="submit" name="decision" value="deny">Cancel</button></div></form>`,
    status,
  );
}

async function currentViewer(options: OAuthOptions): Promise<OAuthViewer | null | 'error'> {
  try {
    return await options.viewer();
  } catch {
    return 'error';
  }
}

async function authorize(
  request: Request,
  env: OAuthEnv,
  url: URL,
  options: OAuthOptions,
): Promise<Response> {
  const post = request.method === 'POST';
  if (post && request.headers.get('Origin') !== origin(env.APP_URL))
    return errorPage('This request did not come from this site.', 403);
  const parsed = await parseAuthorize(url.searchParams, env);
  if (!parsed.ok) {
    if ('fatal' in parsed) return errorPage(parsed.fatal);
    return Response.redirect(parsed.redirect.toString(), post ? 303 : 302);
  }
  const authorizeRequest = parsed.value;
  const finish = (params: Record<string, string>) =>
    Response.redirect(
      redirectWith(authorizeRequest.redirectUri, {
        ...params,
        state: authorizeRequest.state,
        iss: origin(env.APP_URL),
      }).toString(),
      post ? 303 : 302,
    );

  let form: FormData | null = null;
  if (post) {
    try {
      form = await request.formData();
    } catch {
      return errorPage('The form submission was invalid.');
    }
    if (form.get('decision') === 'deny')
      return finish({ error: 'access_denied', error_description: 'The user denied access.' });
  }

  const viewer = await currentViewer(options);
  if (viewer === 'error')
    return errorPage('We could not verify your sign-in. Please try again shortly.', 503);
  if (!viewer) return signInPage(authorizeRequest, url, options);
  const allowed = scopesFor(viewer.provider, authorizeRequest.scopes);
  if (!allowed.length)
    return finish({
      error: 'invalid_scope',
      error_description: 'AT Protocol accounts cannot let agents write activities.',
    });
  if (!form) return consentPage(authorizeRequest, url, viewer, env);
  if (form.get('decision') !== 'approve') return errorPage('Choose whether to allow access.');

  const chosen = new Set(form.getAll('scope'));
  const scopes = allowed.filter((scope) => chosen.has(scope));
  if (!scopes.length)
    return consentPage(authorizeRequest, url, viewer, env, 'Choose at least one permission.', 400);
  const replaceClientId = authorizeRequest.client.metadataDocument
    ? null
    : authorizeRequest.client.id;
  if ((await activeGrantCount(env, viewer, replaceClientId)) >= MAX_ACTIVE_TOKENS)
    return finish({
      error: 'access_denied',
      error_description: 'The account already has the maximum number of agent connections.',
    });

  const code = secret();
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, client_name, redirect_uri, code_challenge,
        scopes, provider, subject, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await hash(code),
      authorizeRequest.client.id,
      authorizeRequest.client.name,
      authorizeRequest.redirectUri,
      authorizeRequest.codeChallenge,
      JSON.stringify(scopes),
      viewer.provider,
      viewer.id,
      new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    ),
  ]);
  return finish({ code });
}

async function register(request: Request, env: OAuthEnv): Promise<Response> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    return oauthError('invalid_client_metadata', 'Content-Type must be application/json.');
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readText(request.body, 16_384));
  } catch {
    return oauthError('invalid_client_metadata', 'Client metadata must be a JSON object.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return oauthError('invalid_client_metadata', 'Client metadata must be a JSON object.');
  const data = metadata as Record<string, unknown>;
  const redirectUris = data['redirect_uris'];
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every(validRedirectUri)
  )
    return oauthError(
      'invalid_redirect_uri',
      'Use HTTPS, HTTP loopback, or private-use scheme redirect URIs without fragments.',
    );
  const grantTypes = data['grant_types'];
  if (
    grantTypes !== undefined &&
    (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code'))
  )
    return oauthError('invalid_client_metadata', 'The authorization_code grant is required.');
  const responseTypes = data['response_types'];
  if (
    responseTypes !== undefined &&
    (!Array.isArray(responseTypes) || !responseTypes.includes('code'))
  )
    return oauthError('invalid_client_metadata', 'The code response type is required.');

  const clientId = `mcp_${crypto.randomUUID()}`;
  const name = clientName(data['client_name'], 'MCP client');
  const issuedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(clientId, name, JSON.stringify(redirectUris), new Date().toISOString())
    .run();
  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPES.join(' '),
    },
    201,
  );
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Read token-endpoint form parameters and the public client ID from the body or Basic auth. */
async function tokenRequest(
  request: Request,
): Promise<{ params: URLSearchParams; clientId: string | null } | Response> {
  if (
    !request.headers
      .get('Content-Type')
      ?.toLowerCase()
      .startsWith('application/x-www-form-urlencoded')
  )
    return oauthError('invalid_request', 'Use application/x-www-form-urlencoded parameters.');
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(await readText(request.body, 16_384));
  } catch {
    return oauthError('invalid_request', 'The request body is too large.');
  }
  let clientId = params.get('client_id');
  const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(request.headers.get('Authorization') || '');
  if (basic) {
    try {
      const [user] = atob(basic[1]).split(':');
      const decoded = decodeURIComponent(user);
      if (clientId && clientId !== decoded)
        return oauthError('invalid_client', 'Client credentials do not match.', 401);
      clientId = decoded;
    } catch {
      return oauthError('invalid_client', 'Client credentials are malformed.', 401);
    }
  }
  return { params, clientId };
}

async function issueGrant(
  env: OAuthEnv,
  code: {
    client_id: string;
    client_name: string;
    scopes: string;
    provider: 'github' | 'atproto';
    subject: string;
  },
): Promise<Response> {
  const table = GRANT_TABLES[code.provider];
  const accessToken = `dwm_${secret()}`;
  const refreshToken = `dwmr_${secret()}`;
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000).toISOString();
  const grantExpiresAt = new Date(now.getTime() + GRANT_TTL_MS).toISOString();
  const statements = [];
  if (!code.client_id.startsWith('https://'))
    statements.push(
      env.DB.prepare(`DELETE FROM ${table.name} WHERE ${table.owner} = ? AND client_id = ?`).bind(
        code.subject,
        code.client_id,
      ),
    );
  statements.push(
    env.DB.prepare(
      `INSERT INTO ${table.name} (id, ${table.owner}, token_hash, name, scopes, created_at,
        expires_at, client_id, refresh_token_hash, refresh_expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM ${table.name}
        WHERE ${table.owner} = ? AND COALESCE(refresh_expires_at, expires_at) > ?) < ?`,
    ).bind(
      crypto.randomUUID(),
      code.subject,
      await hash(accessToken),
      code.client_name,
      code.scopes,
      now.toISOString(),
      accessExpiresAt,
      code.client_id,
      await hash(refreshToken),
      grantExpiresAt,
      code.subject,
      now.toISOString(),
      MAX_ACTIVE_TOKENS,
    ),
  );
  const results = await env.DB.batch(statements);
  if (!results[results.length - 1].meta.changes)
    return oauthError('invalid_grant', 'The account already has the maximum number of agents.');
  return oauthJson({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: (JSON.parse(code.scopes) as string[]).join(' '),
  });
}

async function token(request: Request, env: OAuthEnv): Promise<Response> {
  const parsed = await tokenRequest(request);
  if (parsed instanceof Response) return parsed;
  const { params, clientId } = parsed;
  if (!validResource(params.get('resource'), env.APP_URL))
    return oauthError('invalid_target', 'The requested resource is not served by this server.');
  const grantType = params.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = params.get('code');
    const verifier = params.get('code_verifier');
    if (!code || !verifier || !clientId)
      return oauthError('invalid_request', 'code, code_verifier and client_id are required.');
    const row = await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *')
      .bind(await hash(code))
      .first<{
        client_id: string;
        client_name: string;
        redirect_uri: string;
        code_challenge: string;
        scopes: string;
        provider: 'github' | 'atproto';
        subject: string;
        expires_at: string;
      }>();
    if (
      !row ||
      row.expires_at <= new Date().toISOString() ||
      row.client_id !== clientId ||
      (params.get('redirect_uri') ?? row.redirect_uri) !== row.redirect_uri ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      (await pkceChallenge(verifier)) !== row.code_challenge
    )
      return oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    return issueGrant(env, row);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = params.get('refresh_token');
    if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required.');
    const refreshHash = await hash(refreshToken);
    const accessToken = `dwm_${secret()}`;
    const nextRefresh = `dwmr_${secret()}`;
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000).toISOString();
    for (const table of Object.values(GRANT_TABLES)) {
      const row = await env.DB.prepare(
        `UPDATE ${table.name} SET token_hash = ?, refresh_token_hash = ?,
          expires_at = MIN(?, refresh_expires_at)
        WHERE refresh_token_hash = ? AND refresh_expires_at > ? AND client_id = COALESCE(?, client_id)
        RETURNING scopes, expires_at`,
      )
        .bind(
          await hash(accessToken),
          await hash(nextRefresh),
          accessExpiresAt,
          refreshHash,
          now.toISOString(),
          clientId,
        )
        .first<{ scopes: string; expires_at: string }>();
      if (row)
        return oauthJson({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: Math.max(0, Math.floor((Date.parse(row.expires_at) - now.getTime()) / 1000)),
          refresh_token: nextRefresh,
          scope: (JSON.parse(row.scopes) as string[]).join(' '),
        });
    }
    return oauthError('invalid_grant', 'The refresh token is invalid, expired, or revoked.');
  }

  return oauthError('unsupported_grant_type', 'Use the authorization_code or refresh_token grant.');
}

/** Revoke an OAuth-issued access or refresh token and its grant (RFC 7009). */
async function revoke(request: Request, env: OAuthEnv): Promise<Response> {
  const parsed = await tokenRequest(request);
  if (parsed instanceof Response) return parsed;
  const value = parsed.params.get('token');
  if (!value) return oauthError('invalid_request', 'token is required.');
  const tokenHash = await hash(value);
  await env.DB.batch(
    Object.values(GRANT_TABLES).map((table) =>
      env.DB.prepare(
        `DELETE FROM ${table.name} WHERE (token_hash = ? OR refresh_token_hash = ?)
        AND client_id IS NOT NULL AND client_id = COALESCE(?, client_id)`,
      ).bind(tokenHash, tokenHash, parsed.clientId),
    ),
  );
  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

function protectedResourceMetadata(appUrl: string) {
  return {
    resource: `${origin(appUrl)}/mcp`,
    authorization_servers: [origin(appUrl)],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'devswhomove MCP',
  };
}

function authorizationServerMetadata(appUrl: string) {
  const base = origin(appUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

/** Serve MCP OAuth discovery, registration, authorization, and token endpoints. */
export async function handleOAuth(
  request: Request,
  env: OAuthEnv,
  url: URL,
  options: OAuthOptions,
): Promise<Response | null> {
  const method = request.method;
  const path = url.pathname;
  const cors = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/oauth/register',
    '/oauth/token',
    '/oauth/revoke',
  ];
  if (method === 'OPTIONS' && cors.includes(path))
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (
    (path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp') &&
    method === 'GET'
  )
    return oauthJson(protectedResourceMetadata(env.APP_URL));
  if (path === '/.well-known/oauth-authorization-server' && method === 'GET')
    return oauthJson(authorizationServerMetadata(env.APP_URL));
  if (path === '/oauth/register' && method === 'POST') return register(request, env);
  if (path === '/oauth/authorize' && (method === 'GET' || method === 'POST'))
    return authorize(request, env, url, options);
  if (path === '/oauth/token' && method === 'POST') return token(request, env);
  if (path === '/oauth/revoke' && method === 'POST') return revoke(request, env);
  return null;
}
