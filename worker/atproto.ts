import { Agent } from '@atproto/api';
import { AtprotoDohHandleResolver } from '@atproto-labs/handle-resolver';
import {
  OAuthClient,
  type InternalStateData,
  type Key,
  type OAuthClientMetadataInput,
  type Session,
  type SessionStore,
  type StateStore,
} from '@atproto/oauth-client';
import { JoseKey } from '@atproto/jwk-jose';
import { HttpError } from './validation';

export const PROFILE_COLLECTION = 'dev.devswhorun.profile';
export const ACTIVITY_COLLECTION = 'dev.devswhorun.activity';
export const EVENT_COLLECTION = 'dev.devswhorun.event';
export const ATPROTO_OAUTH_SCOPE = [
  'atproto',
  `repo:${ACTIVITY_COLLECTION}`,
  `repo:${EVENT_COLLECTION}`,
  `repo:${PROFILE_COLLECTION}`,
  'repo:app.bsky.actor.profile',
].join(' ');

/** Return only native profile fields that changed from the user's current projection. */
export function atprotoProfileChanges(
  name: string,
  bio: string,
  currentName: string,
  currentBio: string,
): { displayName?: string; description?: string } | undefined {
  const changes: { displayName?: string; description?: string } = {};
  if (name !== currentName) changes.displayName = name;
  if (bio !== currentBio) changes.description = bio;
  return Object.keys(changes).length ? changes : undefined;
}

export interface AtprotoEnv {
  DB: D1Database;
  APP_URL: string;
  ATPROTO_OAUTH_PRIVATE_KEY?: string;
  ATPROTO_SESSION_KEY?: string;
}

/** Decode a base64-encoded secret into bytes. */
function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Normalize a pasted secret by trimming whitespace, wrapping quotes, and escaped newlines. */
function normalizeSecret(value: string): string {
  return value
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, '$2')
    .replace(/\\n/g, '\n')
    .trim();
}

/** Signal a misconfigured AT Protocol Worker secret without exposing its value. */
function configError(message: string): HttpError {
  return new HttpError(503, `AT Protocol sign-in is misconfigured: ${message} See README.md.`);
}

/** Decode a base64 secret, reporting malformed values as configuration errors. */
function decodeSecret(value: string, name: string): Uint8Array {
  try {
    return decodeBase64(normalizeSecret(value).replace(/\s/g, ''));
  } catch {
    throw configError(`${name} is not valid base64.`);
  }
}

/** Encode bytes as base64 for encrypted values stored in D1. */
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Import the configured AES-GCM key for OAuth state and session storage. */
async function encryptionKey(
  env: AtprotoEnv,
  usage: ('encrypt' | 'decrypt')[],
): Promise<CryptoKey> {
  if (!env.ATPROTO_SESSION_KEY) throw configError('ATPROTO_SESSION_KEY is missing.');
  const raw = decodeSecret(env.ATPROTO_SESSION_KEY, 'ATPROTO_SESSION_KEY');
  if (raw.byteLength !== 32) throw configError('ATPROTO_SESSION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}

/** Encrypt a stored OAuth value and bind it to its state or DID. */
async function encrypt(env: AtprotoEnv, value: unknown, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

/** Decrypt an OAuth value only when its associated state or DID matches. */
async function decrypt<T>(env: AtprotoEnv, value: string, context: string): Promise<T> {
  const [encodedIv, encodedCiphertext] = value.split('.');
  if (!encodedIv || !encodedCiphertext) throw new Error('Invalid encrypted AT Protocol data.');
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64(encodedIv),
      additionalData: new TextEncoder().encode(context),
    },
    await encryptionKey(env, ['decrypt']),
    decodeBase64(encodedCiphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Return the canonical origin used to construct OAuth metadata and callbacks. */
function oauthOrigin(env: AtprotoEnv): string {
  return new URL(env.APP_URL).origin;
}

/** Load the confidential OAuth signing key from a base64-encoded or raw PKCS#8 PEM. */
async function privateKey(env: AtprotoEnv): Promise<JoseKey> {
  if (!env.ATPROTO_OAUTH_PRIVATE_KEY) throw configError('ATPROTO_OAUTH_PRIVATE_KEY is missing.');
  const value = normalizeSecret(env.ATPROTO_OAUTH_PRIVATE_KEY);
  const pem = value.includes('-----BEGIN')
    ? value
    : new TextDecoder().decode(decodeSecret(value, 'ATPROTO_OAUTH_PRIVATE_KEY')).trim();
  if (pem.includes('BEGIN EC PRIVATE KEY'))
    throw configError(
      'ATPROTO_OAUTH_PRIVATE_KEY is a SEC1 EC key; convert it to PKCS#8 with `openssl pkcs8 -topk8 -nocrypt`.',
    );
  try {
    return await JoseKey.fromPKCS8(pem, 'ES256', 'devswhomove-atproto-oauth');
  } catch {
    throw configError('ATPROTO_OAUTH_PRIVATE_KEY must be a P-256 (prime256v1) PKCS#8 private key.');
  }
}

/** Serialize concurrent OAuth refreshes for a named session using a D1 lock. */
async function acquireLock<T>(
  env: AtprotoEnv,
  name: string,
  work: () => T | Promise<T>,
): Promise<T> {
  const owner = crypto.randomUUID();
  for (let attempt = 0; attempt < 150; attempt++) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000).toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO atproto_oauth_locks (name, owner, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE atproto_oauth_locks.expires_at <= ?`,
    )
      .bind(name, owner, expiresAt, now.toISOString())
      .run();
    if (result.meta.changes) {
      try {
        return await work();
      } finally {
        await env.DB.prepare('DELETE FROM atproto_oauth_locks WHERE name = ? AND owner = ?')
          .bind(name, owner)
          .run();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Could not acquire the AT Protocol session lock.');
}

/** Encrypt an OAuth state or session while persisting its private DPoP key. */
async function serializeDpopValue<T extends { dpopKey: Key }>(
  env: AtprotoEnv,
  context: string,
  value: T,
): Promise<string> {
  const { dpopKey, ...rest } = value;
  const dpopJwk = dpopKey.privateJwk;
  if (!dpopJwk) throw new Error('Private DPoP key is missing.');
  return encrypt(env, { ...rest, dpopJwk }, context);
}

/** Restore an OAuth state or session and its private DPoP key from encrypted storage. */
async function deserializeDpopValue<T extends { dpopKey: Key }>(
  env: AtprotoEnv,
  context: string,
  value: string,
): Promise<T> {
  const stored = await decrypt<
    Record<string, unknown> & { dpopJwk: NonNullable<Key['privateJwk']> }
  >(env, value, context);
  const { dpopJwk, ...rest } = stored;
  return { ...rest, dpopKey: await JoseKey.fromJWK(dpopJwk) } as unknown as T;
}

/** Create the AT Protocol OAuth client with encrypted D1 stores and Worker WebCrypto. */
export async function oauthClient(env: AtprotoEnv): Promise<OAuthClient> {
  const origin = oauthOrigin(env);
  const key = await privateKey(env);
  await encryptionKey(env, ['encrypt']);
  const isLoopback = new URL(origin).protocol === 'http:';
  const callback = new URL('/auth/atproto/callback', origin);
  if (isLoopback) callback.hostname = '127.0.0.1';
  const loopbackClientId = new URL('http://localhost');
  loopbackClientId.searchParams.set('redirect_uri', callback.toString());
  loopbackClientId.searchParams.set('scope', ATPROTO_OAUTH_SCOPE);
  const stateStore: StateStore = {
    async set(state: string, value: InternalStateData) {
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM atproto_oauth_states WHERE created_at <= ?').bind(
          new Date(Date.now() - 3600_000).toISOString(),
        ),
        env.DB.prepare(
          `INSERT INTO atproto_oauth_states (state, encrypted_state, created_at) VALUES (?, ?, ?)
          ON CONFLICT(state) DO UPDATE SET encrypted_state = excluded.encrypted_state, created_at = excluded.created_at`,
        ).bind(state, await serializeDpopValue(env, `state:${state}`, value), now),
      ]);
    },
    async get(state: string) {
      const row = await env.DB.prepare(
        'SELECT encrypted_state FROM atproto_oauth_states WHERE state = ? AND created_at > ?',
      )
        .bind(state, new Date(Date.now() - 3600_000).toISOString())
        .first<{ encrypted_state: string }>();
      return row
        ? deserializeDpopValue<InternalStateData>(env, `state:${state}`, row.encrypted_state)
        : undefined;
    },
    async del(state: string) {
      await env.DB.prepare('DELETE FROM atproto_oauth_states WHERE state = ?').bind(state).run();
    },
  };
  const sessionStore: SessionStore = {
    async set(did: string, value: Session) {
      await env.DB.prepare(
        `INSERT INTO atproto_oauth_sessions (did, encrypted_session, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET encrypted_session = excluded.encrypted_session,
          updated_at = excluded.updated_at`,
      )
        .bind(did, await serializeDpopValue(env, `session:${did}`, value), new Date().toISOString())
        .run();
    },
    async get(did: string) {
      const row = await env.DB.prepare(
        'SELECT encrypted_session FROM atproto_oauth_sessions WHERE did = ?',
      )
        .bind(did)
        .first<{ encrypted_session: string }>();
      return row
        ? deserializeDpopValue<Session>(env, `session:${did}`, row.encrypted_session)
        : undefined;
    },
    async del(did: string) {
      await env.DB.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(did).run();
    },
  };

  return new OAuthClient({
    clientMetadata: (isLoopback
      ? {
          client_id: loopbackClientId.toString(),
          client_name: 'Devs Who Move',
          client_uri: 'http://localhost',
          redirect_uris: [callback.toString()],
          grant_types: ['authorization_code', 'refresh_token'],
          scope: ATPROTO_OAUTH_SCOPE,
          response_types: ['code'],
          application_type: 'native',
          token_endpoint_auth_method: 'none',
          dpop_bound_access_tokens: true,
        }
      : {
          client_id: `${origin}/oauth/client-metadata.json`,
          client_name: 'Devs Who Move',
          client_uri: origin,
          redirect_uris: [callback.toString()],
          grant_types: ['authorization_code', 'refresh_token'],
          scope: ATPROTO_OAUTH_SCOPE,
          response_types: ['code'],
          application_type: 'web',
          token_endpoint_auth_method: 'private_key_jwt',
          token_endpoint_auth_signing_alg: 'ES256',
          dpop_bound_access_tokens: true,
          jwks_uri: `${origin}/oauth/jwks.json`,
        }) as OAuthClientMetadataInput,
    keyset: [key],
    handleResolver: new AtprotoDohHandleResolver({
      dohEndpoint: 'https://cloudflare-dns.com/dns-query',
    }),
    responseMode: 'query',
    runtimeImplementation: {
      createKey: (algs) => JoseKey.generate(algs),
      getRandomValues: (length) => crypto.getRandomValues(new Uint8Array(length)),
      digest: async (bytes, algorithm) =>
        new Uint8Array(await crypto.subtle.digest(algorithm.name.toUpperCase(), bytes)),
      requestLock: (name, work) => acquireLock(env, name, async () => await work()),
    },
    stateStore,
    sessionStore,
  });
}

/** Create an AT Protocol API agent backed by the restored OAuth session. */
export function atprotoAgent(session: Awaited<ReturnType<OAuthClient['restore']>>): Agent {
  return new Agent(session);
}
