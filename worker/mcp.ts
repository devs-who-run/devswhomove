import type { AgentScope } from '../src/app/models';
import { HttpError } from './validation';

const PROTOCOL_VERSION = '2026-07-28';
const SERVER_INFO = { name: 'devs-who-move', version: '0.0.0' };
const SERVER_META = { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
const ALL_SCOPES: AgentScope[] = ['activities:read', 'activities:write', 'events:read'];
const SPORT_ENUM = ['Running', 'Cycling', 'Tennis', 'Walking', 'Swimming', 'Strength', 'Other'];

interface McpIdentity {
  agent: boolean;
  scopes: AgentScope[];
}

type RequestId = string | number;
type ApiDispatcher = (request: Request) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('Cache-Control', 'no-store');
  return Response.json(body, { status, headers: resultHeaders });
}

function rpcError(
  id: RequestId | undefined,
  code: number,
  message: string,
  status = 400,
  data?: unknown,
): Response {
  return response(
    {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      error: { code, message, ...(data === undefined ? {} : { data }) },
    },
    status,
  );
}

function unauthorized(): Response {
  return response({ error: 'Use a valid scoped agent bearer token.' }, 401, {
    'WWW-Authenticate':
      'Bearer realm="devs-who-move MCP", scope="activities:read activities:write events:read"',
  });
}

function complete(id: RequestId, result: Record<string, unknown>, status = 200): Response {
  return response(
    {
      jsonrpc: '2.0',
      id,
      result: { resultType: 'complete', ...result, _meta: SERVER_META },
    },
    status,
  );
}

function tool(name: string, description: string, requiredScope: AgentScope, inputSchema: object) {
  return { name, description, requiredScope, inputSchema };
}

const TOOLS = [
  tool(
    'list_activities',
    'List your latest activities. Returns only your own activities, including private activities.',
    'activities:read',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
  tool(
    'create_activity',
    'Record a private activity on your account. Agent-created activities are always private.',
    'activities:write',
    {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        sport: { type: 'string', enum: SPORT_ENUM },
        occurredAt: { type: 'string', format: 'date-time' },
        duration: {
          type: 'number',
          minimum: 1,
          maximum: 1440,
          description: 'Duration in minutes.',
        },
        distance: { type: 'number', minimum: 0, maximum: 2000, description: 'Distance in km.' },
        notes: { type: 'string', maxLength: 2000 },
        idempotencyKey: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description: 'Stable key to prevent duplicate activity imports.',
        },
      },
      required: ['title', 'sport', 'occurredAt', 'duration'],
      additionalProperties: false,
    },
  ),
  tool(
    'list_upcoming_events',
    'List upcoming public community events. Attendee identities are not included.',
    'events:read',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
];

function visibleTools(scopes: AgentScope[]) {
  return TOOLS.filter((entry) => scopes.includes(entry.requiredScope)).map(
    ({ requiredScope: _requiredScope, ...definition }) => definition,
  );
}

async function readBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > 16_384) throw new Error('Request body is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body is required.');

  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16_384) {
      await reader.cancel();
      throw new Error('Request body is too large.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function apiRequest(
  original: Request,
  path: string,
  method: 'GET' | 'POST',
  data?: Record<string, unknown>,
  idempotencyKey?: string,
): Request {
  const headers = new Headers({
    Authorization: original.headers.get('Authorization') || '',
  });
  if (data) headers.set('Content-Type', 'application/json');
  if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);
  return new Request(new URL(path, original.url), {
    method,
    headers,
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}

async function callApi(dispatchApi: ApiDispatcher, request: Request) {
  try {
    const result = await dispatchApi(request);
    const payload: unknown = await result.json();
    const data = isRecord(payload) ? payload : {};
    return {
      ok: result.ok,
      data,
      message: typeof data['error'] === 'string' ? data['error'] : 'The API request failed.',
    };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { ok: false, data: { error: error.message }, message: error.message };
  }
}

function toolResult(id: RequestId, data: Record<string, unknown>, isError = false): Response {
  return complete(id, {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError,
  });
}

export async function handleMcp(
  request: Request,
  appUrl: string,
  authenticate: () => Promise<McpIdentity | null>,
  dispatchApi: ApiDispatcher,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(appUrl).origin)
    return rpcError(undefined, -32600, 'Invalid Origin.', 403);

  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    return rpcError(undefined, -32600, 'Content-Type must be application/json.');

  const acceptedTypes = (request.headers.get('Accept') || '')
    .split(',')
    .map((type) => type.trim().split(';', 1)[0].toLowerCase());
  if (!acceptedTypes.includes('application/json') || !acceptedTypes.includes('text/event-stream'))
    return rpcError(
      undefined,
      -32600,
      'Accept must include application/json and text/event-stream.',
      406,
    );

  let message: unknown;
  try {
    message = await readBody(request);
  } catch (error) {
    const isJsonError = error instanceof SyntaxError;
    return rpcError(
      undefined,
      isJsonError ? -32700 : -32600,
      isJsonError ? 'Parse error.' : error instanceof Error ? error.message : 'Invalid request.',
    );
  }

  if (!isRecord(message) || message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string')
    return rpcError(undefined, -32600, 'Invalid JSON-RPC request.');

  const id = message['id'];
  if (
    (typeof id !== 'string' && typeof id !== 'number') ||
    (typeof id === 'number' && (!Number.isSafeInteger(id) || !Number.isFinite(id)))
  )
    return rpcError(undefined, -32600, 'A request ID is required.');

  const requestId = id as RequestId;
  const method = message['method'];
  const params = isRecord(message['params']) ? message['params'] : {};
  const meta = isRecord(params['_meta']) ? params['_meta'] : {};
  const requestedVersion = meta['io.modelcontextprotocol/protocolVersion'];
  const protocolHeader = request.headers.get('MCP-Protocol-Version');

  if (
    typeof protocolHeader !== 'string' ||
    typeof requestedVersion !== 'string' ||
    protocolHeader !== requestedVersion ||
    request.headers.get('Mcp-Method') !== method
  )
    return rpcError(requestId, -32020, 'MCP request headers do not match the request body.');

  if (
    !isRecord(meta['io.modelcontextprotocol/clientCapabilities']) ||
    (meta['io.modelcontextprotocol/clientInfo'] !== undefined &&
      !isRecord(meta['io.modelcontextprotocol/clientInfo']))
  )
    return rpcError(requestId, -32600, 'Request _meta is invalid.');

  if (requestedVersion !== PROTOCOL_VERSION)
    return rpcError(requestId, -32022, 'Unsupported protocol version.', 400, {
      supported: [PROTOCOL_VERSION],
      requested: requestedVersion,
    });

  if (method === 'tools/call') {
    if (typeof params['name'] !== 'string' || request.headers.get('Mcp-Name') !== params['name'])
      return rpcError(requestId, -32020, 'Mcp-Name does not match the request body.');
  }

  const auth = await authenticate();
  if (!auth?.agent) return unauthorized();

  if (method === 'server/discover') {
    return complete(requestId, {
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: { tools: {} },
      instructions:
        'Use scoped agent tokens. Available tools read your own activities, record private activities, and read upcoming public events.',
      ttlMs: 3_600_000,
      cacheScope: 'private',
    });
  }

  if (method === 'tools/list') {
    return complete(requestId, {
      tools: visibleTools(auth.scopes),
      ttlMs: 60_000,
      cacheScope: 'private',
    });
  }

  if (method !== 'tools/call') return rpcError(requestId, -32601, 'Method not found.', 404);

  if (typeof params['name'] !== 'string')
    return rpcError(requestId, -32602, 'Tool name is required.');
  const name = params['name'];
  const definition = TOOLS.find((entry) => entry.name === name);
  if (!definition) return rpcError(requestId, -32602, `Unknown tool: ${name}.`);

  if (!auth.scopes.includes(definition.requiredScope))
    return toolResult(
      requestId,
      { error: `This token needs ${definition.requiredScope} permission.` },
      true,
    );

  const args = params['arguments'] === undefined ? {} : params['arguments'];
  if (!isRecord(args)) return rpcError(requestId, -32602, 'Tool arguments must be an object.');
  const allowedArguments =
    name === 'create_activity'
      ? ['title', 'sport', 'occurredAt', 'duration', 'distance', 'notes', 'idempotencyKey']
      : [];
  const unexpectedArgument = Object.keys(args).find((key) => !allowedArguments.includes(key));
  if (unexpectedArgument)
    return toolResult(
      requestId,
      { error: `Unexpected tool argument: ${unexpectedArgument}.` },
      true,
    );

  if (name === 'list_activities') {
    const result = await callApi(dispatchApi, apiRequest(request, '/api/activities', 'GET'));
    return toolResult(requestId, result.ok ? result.data : { error: result.message }, !result.ok);
  }

  if (name === 'list_upcoming_events') {
    const result = await callApi(dispatchApi, apiRequest(request, '/api/events', 'GET'));
    return toolResult(requestId, result.ok ? result.data : { error: result.message }, !result.ok);
  }

  const { idempotencyKey, ...activity } = args;
  if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string')
    return toolResult(requestId, { error: 'Idempotency key must be a string.' }, true);
  const result = await callApi(
    dispatchApi,
    apiRequest(
      request,
      '/api/activities',
      'POST',
      { ...activity, visibility: 'private' },
      idempotencyKey,
    ),
  );
  return toolResult(
    requestId,
    result.ok
      ? { ...result.data, visibility: 'private', source: 'agent' }
      : { error: result.message },
    !result.ok,
  );
}
