'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CodingSession, parseDuration, activityUrl, uploadWalk } = require('../nudges.cjs');

test('only sustained editing triggers a reminder; idle and clock changes reset the session', () => {
  const session = new CodingSession();
  assert.equal(session.recordEdit(0, 10_000, 5_000), false);
  assert.equal(session.recordEdit(4_000, 10_000, 5_000), false);
  assert.equal(session.recordEdit(8_000, 10_000, 5_000), false);
  assert.equal(session.recordEdit(10_000, 10_000, 5_000), true);
  assert.equal(session.recordEdit(15_000, 10_000, 5_000), false);
  assert.equal(session.recordEdit(20_000, 10_000, 5_000), false);
  assert.equal(session.recordEdit(19_000, 10_000, 5_000), false);
  assert.equal(session.recordEdit(23_000, 10_000, 5_000), false);
  session.reset();
  assert.equal(session.recordEdit(27_000, 10_000, 5_000), false);
});

test('walk duration and server origin are validated', () => {
  assert.equal(parseDuration('1.5'), 1.5);
  for (const value of ['', '0', '-1', '1441', 'NaN', '1e3']) assert.equal(parseDuration(value), null);
  assert.equal(activityUrl('https://devswhorun.dev').href, 'https://devswhorun.dev/api/activities');
  assert.equal(activityUrl('http://127.0.0.1:8787').href, 'http://127.0.0.1:8787/api/activities');
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x']) {
    assert.throws(() => activityUrl(url));
  }
});

test('upload sends only the completed walking activity via the agent API', async () => {
  let request;
  await uploadWalk(activityUrl('https://example.com'), 'secret', 15, new Date('2026-11-21T12:15:00Z'),
    async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    });
  assert.equal(request.url.href, 'https://example.com/api/activities');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), {
    title: 'Walking break', sport: 'Walking', occurredAt: '2026-11-21T12:00:00.000Z', duration: 15,
  });
  assert.equal('Idempotency-Key' in request.options.headers, false);
});

test('upload reports server and uncertain network failures without exposing the token', async () => {
  await assert.rejects(uploadWalk(activityUrl('https://example.com'), 'secret', 5, new Date(),
    async () => ({ ok: false, status: 401 })), /HTTP 401/);
  await assert.rejects(uploadWalk(activityUrl('https://example.com'), 'secret', 5, new Date(),
    async () => ({ ok: false, status: 500 })), /may have been saved/);
  await assert.rejects(uploadWalk(activityUrl('https://example.com'), 'secret', 5, new Date(),
    async () => { throw new Error('secret'); }), /may have been saved/);
});
