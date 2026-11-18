import { describe, expect, it, vi } from 'vitest';
import { handleMcp } from './mcp';
import type { AgentScope } from '../src/app/models';
import { HttpError } from './validation';

function request(method: string, params: Record<string, unknown> = {}, clientIp?: string) {
  const version = '2026-07-28';
  return new Request('https://app.example/mcp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer scoped-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': version,
      'Mcp-Method': method,
      ...(clientIp === undefined ? {} : { 'CF-Connecting-IP': clientIp }),
      ...(typeof params['name'] === 'string' ? { 'Mcp-Name': params['name'] } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}
const auth = (scopes: AgentScope[]) => async () => ({ agent: true, scopes });

describe('MCP weekly recap', () => {
  it('exposes the tool only with the existing activities:read scope and documents caller-side summaries', async () => {
    const dispatch = vi.fn();
    const response = await handleMcp(
      request('tools/list'),
      'https://app.example',
      auth(['activities:read']),
      dispatch,
    );
    const body = await response.json();
    const recap = body.result.tools.find(
      (tool: { name: string }) => tool.name === 'get_weekly_recap',
    );
    expect(recap.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(recap.description).toMatch(/calling connected agent, not a server-hosted LLM/);
    expect(recap.description).toMatch(/exact dates and coverage limitations/);
    expect(recap.description).toMatch(/do not offer medical advice/);
    const noRead = await handleMcp(
      request('tools/list'),
      'https://app.example',
      auth(['events:read', 'activities:write']),
      dispatch,
    );
    expect(
      (await noRead.json()).result.tools.map((tool: { name: string }) => tool.name),
    ).not.toContain('get_weekly_recap');
  });

  it('dispatches empty arguments to the weekly API with the caller token, not GitHub or an LLM', async () => {
    const payload = {
      period: { start: '2026-11-02', end: '2026-11-08' },
      current: { sessions: 2 },
      summary: '2 sessions',
      coverage: 'Recorded data only',
    };
    const dispatch = vi.fn().mockResolvedValue(Response.json(payload));
    const response = await handleMcp(
      request('tools/call', { name: 'get_weekly_recap', arguments: {} }, '203.0.113.7'),
      'https://app.example',
      auth(['activities:read']),
      dispatch,
    );
    const body = await response.json();
    expect(body.result.structuredContent).toEqual(payload);
    expect(body.result.isError).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const forwarded: Request = dispatch.mock.calls[0][0];
    expect(forwarded.url).toBe('https://app.example/api/insights/weekly');
    expect(forwarded.method).toBe('GET');
    expect(forwarded.headers.get('Authorization')).toBe('Bearer scoped-token');
    expect(forwarded.headers.get('CF-Connecting-IP')).toBe('203.0.113.7');
    expect(forwarded.body).toBeNull();
  });

  it('keeps requests without a client IP header unchanged', async () => {
    const dispatch = vi.fn().mockResolvedValue(Response.json({ activities: [] }));
    await handleMcp(
      request('tools/call', { name: 'list_activities' }),
      'https://app.example',
      auth(['activities:read']),
      dispatch,
    );
    const forwarded: Request = dispatch.mock.calls[0][0];
    expect(forwarded.headers.get('CF-Connecting-IP')).toBeNull();
  });

  it('rejects scope escalation and unexpected arguments before API dispatch', async () => {
    const dispatch = vi.fn();
    for (const [scopes, args] of [
      [['activities:write'], {}],
      [['activities:read'], { username: 'another-user' }],
    ] as [AgentScope[], Record<string, unknown>][]) {
      const response = await handleMcp(
        request('tools/call', { name: 'get_weekly_recap', arguments: args }),
        'https://app.example',
        auth(scopes),
        dispatch,
      );
      expect((await response.json()).result.isError).toBe(true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('surfaces API failures instead of success-shaped recaps', async () => {
    const dispatch = vi.fn().mockRejectedValue(new HttpError(502, 'Unavailable indexed data'));
    const response = await handleMcp(
      request('tools/call', { name: 'get_weekly_recap' }),
      'https://app.example',
      auth(['activities:read']),
      dispatch,
    );
    expect((await response.json()).result).toMatchObject({
      isError: true,
      structuredContent: { error: 'Unavailable indexed data' },
    });
  });

  it('rethrows rate-limit errors so the MCP boundary can preserve Retry-After', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValue(new HttpError(429, 'Too many requests.', { 'Retry-After': '17' }));
    await expect(
      handleMcp(
        request('tools/call', { name: 'get_weekly_recap' }),
        'https://app.example',
        auth(['activities:read']),
        dispatch,
      ),
    ).rejects.toMatchObject({
      status: 429,
      headers: { 'Retry-After': '17' },
    });
  });
});
