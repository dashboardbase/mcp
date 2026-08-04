import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHttpHandler, MAX_BODY_BYTES } from '../dist/http.js';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

test('health reports ok', async () => {
  const handler = createHttpHandler();
  const response = await handler(new Request('http://localhost:3000/health'));

  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { status: string }).status, 'ok');
});

test('unknown paths are 404', async () => {
  const handler = createHttpHandler();
  const response = await handler(new Request('http://localhost:3000/elsewhere'));
  assert.equal(response.status, 404);
});

test('a request with no Origin is served', async () => {
  const handler = createHttpHandler();
  const response = await handler(post(initialize));
  assert.equal(response.status, 200);
});

test('a browser Origin that is not allowlisted is refused', async () => {
  const handler = createHttpHandler();
  const response = await handler(post(initialize, { origin: 'https://evil.example' }));

  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error: string }).error, 'origin_not_allowed');
});

test('an allowlisted Origin is served with CORS headers', async () => {
  const handler = createHttpHandler({ allowedOrigins: ['https://claude.ai'] });
  const response = await handler(post(initialize, { origin: 'https://claude.ai' }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://claude.ai');
});

test('preflight from an allowlisted origin succeeds', async () => {
  const handler = createHttpHandler({ allowedOrigins: ['https://claude.ai'] });
  const response = await handler(
    new Request('http://localhost:3000/mcp', { method: 'OPTIONS', headers: { origin: 'https://claude.ai' } }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://claude.ai');
});

test('an oversized declared body is refused', async () => {
  const handler = createHttpHandler();
  const response = await handler(
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) },
      body: '{}',
    }),
  );

  assert.equal(response.status, 413);
});

test('an oversized actual body is refused', async () => {
  const handler = createHttpHandler();
  const response = await handler(post({ padding: 'x'.repeat(MAX_BODY_BYTES + 1) }));
  assert.equal(response.status, 413);
});

test('a malformed body is refused', async () => {
  const handler = createHttpHandler();
  const response = await handler(
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc": ',
    }),
  );

  assert.equal(response.status, 400);
});

test('tools listed over http omit the path parameter', async () => {
  const handler = createHttpHandler();

  const initialized = await handler(post(initialize));
  assert.equal(initialized.status, 200);

  const response = await handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  const payload = (await response.json()) as {
    result: { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> };
  };

  assert.equal(payload.result.tools.length, 2);
  for (const tool of payload.result.tools) {
    assert.ok(!Object.keys(tool.inputSchema.properties ?? {}).includes('path'), `${tool.name} leaked path`);
  }
});
