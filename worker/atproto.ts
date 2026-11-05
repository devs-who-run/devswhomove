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

export const PROFILE_COLLECTION = 'dev.devswhorun.profile';
export const ACTIVITY_COLLECTION = 'dev.devswhorun.activity';
export const EVENT_COLLECTION = 'dev.devswhorun.event';

export interface AtprotoEnv {
  DB: D1Database;
  APP_URL: string;
  ATPROTO_OAUTH_PRIVATE_KEY?: string;
  ATPROTO_SESSION_KEY?: string;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function encryptionKey(
  env: AtprotoEnv,
  usage: ('encrypt' | 'decrypt')[],
): Promise<CryptoKey> {
  if (!env.ATPROTO_SESSION_KEY)
    throw new Error('ATPROTO_SESSION_KEY is required for AT Protocol sessions.');
  const raw = decodeBase64(env.ATPROTO_SESSION_KEY);
  if (raw.byteLength !== 32) throw new Error('ATPROTO_SESSION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}

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

function oauthOrigin(env: AtprotoEnv): string {
  return new URL(env.APP_URL).origin;
}

async function privateKey(env: AtprotoEnv): Promise<JoseKey> {
  if (!env.ATPROTO_OAUTH_PRIVATE_KEY)
    throw new Error('ATPROTO_OAUTH_PRIVATE_KEY is required for AT Protocol sign-in.');
  const pem = new TextDecoder().decode(decodeBase64(env.ATPROTO_OAUTH_PRIVATE_KEY));
  return JoseKey.fromPKCS8(pem, 'ES256', 'devswhomove-atproto-oauth');
}

async function acquireLock<T>(env: AtprotoEnv, name: string, work: () => T | Promise<T>): Promise<T> {
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

async function deserializeDpopValue<T extends { dpopKey: Key }>(
  env: AtprotoEnv,
  context: string,
  value: string,
): Promise<T> {
  const stored = await decrypt<Record<string, unknown> & { dpopJwk: NonNullable<Key['privateJwk']> }>(
    env,
    value,
    context,
  );
  const { dpopJwk, ...rest } = stored;
  return { ...rest, dpopKey: await JoseKey.fromJWK(dpopJwk) } as unknown as T;
}

export async function oauthClient(env: AtprotoEnv): Promise<OAuthClient> {
  const origin = oauthOrigin(env);
  const key = await privateKey(env);
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
    clientMetadata: {
      client_id: `${origin}/oauth/client-metadata.json`,
      client_name: 'Devs Who Move',
      client_uri: origin,
      redirect_uris: [`${origin}/auth/atproto/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      scope: 'atproto',
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      jwks_uri: `${origin}/oauth/jwks.json`,
    } as OAuthClientMetadataInput,
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

export function atprotoAgent(session: Awaited<ReturnType<OAuthClient['restore']>>): Agent {
  return new Agent(session);
}
