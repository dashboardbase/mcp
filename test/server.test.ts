import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ToolsApiClient } from '../dist/api.js';
import { createServer } from '../dist/server.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch stub that records the request and returns a canned response. */
function stubFetch(response: { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Captured[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const status = response.status ?? 200;
    const payload = typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {});
    return new Response(status === 204 ? null : payload, {
      status,
      headers: { 'content-type': 'application/json', ...response.headers },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function connect(options: Parameters<typeof createServer>[0]) {
  const server = createServer(options);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((part) => part.text ?? '').join('\n');
}

test('both validation tools are advertised', async () => {
  const { client, close } = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['validate_setup_file', 'validate_widget_response'],
  );
  await close();
});

test('stdio mode offers the path parameter', async () => {
  const { client, close } = await connect({ mode: 'stdio' });
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(
      Object.keys(tool.inputSchema.properties ?? {}).includes('path'),
      `${tool.name} should accept path over stdio`,
    );
  }
  await close();
});

test('http mode removes path from the advertised schema', async () => {
  const { client, close } = await connect({ mode: 'http' });
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(
      !Object.keys(tool.inputSchema.properties ?? {}).includes('path'),
      `${tool.name} must not expose path when hosted`,
    );
  }
  await close();
});

test('setup file is sent as raw text/plain so line numbers survive', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, errors: [], warnings: [] } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  await client.callTool({ name: 'validate_setup_file', arguments: { content: '{"version":1}' } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.dashboardbase.com/tools/v1/validate/setup-file');
  assert.equal(calls[0]?.headers['content-type'], 'text/plain');
  assert.equal(calls[0]?.body, '{"version":1}');
  await close();
});

test('an invalid document is a successful call, not a tool error', async () => {
  const { impl } = stubFetch({
    body: {
      valid: false,
      errors: [{ path: 'mappings[0]', field: 'type', message: 'Unknown widget type "guage"', line: 3, column: 5 }],
      warnings: [],
    },
  });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.notEqual(result.isError, true, 'validation failure must not be flagged as a tool error');
  assert.match(textOf(result), /Invalid setup file — 1 error/);
  assert.match(textOf(result), /Unknown widget type "guage"/);
  assert.equal((result.structuredContent as { valid: boolean }).valid, false);
  await close();
});

test('unknown response fields survive into structuredContent', async () => {
  const { impl } = stubFetch({
    body: { valid: false, errors: [{ message: 'Nope', code: 'unknown_widget_type' }], warnings: [], traceId: 'abc123' },
  });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });
  const structured = result.structuredContent as Record<string, unknown>;

  assert.equal(structured['traceId'], 'abc123');
  assert.equal((structured['errors'] as Array<Record<string, unknown>>)[0]?.['code'], 'unknown_widget_type');
  await close();
});

test('widget response is sent as the full envelope', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, widgetType: 'kpi', errors: [] } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const envelope = { title: 'MRR', data: { header: { title: 'MRR' } } };
  await client.callTool({
    name: 'validate_widget_response',
    arguments: { response: envelope, widgetType: 'kpi' },
  });

  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { widgetType: 'kpi', response: envelope });
  await close();
});

test('a JSON string response is parsed before being sent', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, widgetType: 'kpi', errors: [] } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  await client.callTool({
    name: 'validate_widget_response',
    arguments: { response: '{"title":"MRR"}' },
  });

  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}').response, { title: 'MRR' });
  await close();
});

test('malformed JSON is reported without throwing', async () => {
  const { impl } = stubFetch({ body: {} });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({
    name: 'validate_widget_response',
    arguments: { response: '{"title": ' },
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /not valid JSON/);
  await close();
});

test('path reads the file from disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dbmcp-'));
  const file = join(directory, 'setup.json');
  await writeFile(file, '{"version":1,"name":"Ops"}', 'utf8');

  const { impl, calls } = stubFetch({ body: { valid: true, errors: [], warnings: [] } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  await client.callTool({ name: 'validate_setup_file', arguments: { path: file } });

  assert.equal(calls[0]?.body, '{"version":1,"name":"Ops"}');
  await close();
});

test('a missing file is reported clearly', async () => {
  const { impl } = stubFetch({ body: {} });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({
    name: 'validate_setup_file',
    arguments: { path: '/nonexistent/nope.json' },
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /No such file/);
  await close();
});

test('supplying neither content nor path is reported', async () => {
  const { impl } = stubFetch({ body: {} });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: {} });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Provide the setup file/);
  await close();
});

test('rate limiting surfaces Retry-After', async () => {
  const { impl } = stubFetch({ status: 429, body: {}, headers: { 'retry-after': '30' } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Rate limited/);
  assert.match(textOf(result), /Retry in 30s/);
  await close();
});

test('a 400 with a ProblemDetails body surfaces its message', async () => {
  const { impl } = stubFetch({
    status: 400,
    body: { title: 'Bad Request', detail: 'The request body was empty.' },
  });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /The request body was empty\./);
  await close();
});

test('a 400 with no body still reports the status', async () => {
  const { impl } = stubFetch({ status: 400, body: '' });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /400/);
  await close();
});

test('an unreachable API is reported as a tool error', async () => {
  const impl = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  const result = await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Could not reach the validation API/);
  await close();
});

test('an api key is forwarded when configured', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, errors: [], warnings: [] } });
  const { client, close } = await connect({
    client: new ToolsApiClient({ fetchImpl: impl, apiKey: 'secret' }),
  });

  await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(calls[0]?.headers['x-api-key'], 'secret');
  await close();
});

test('no api key header is sent by default', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, errors: [], warnings: [] } });
  const { client, close } = await connect({ client: new ToolsApiClient({ fetchImpl: impl }) });

  await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.ok(!('x-api-key' in (calls[0]?.headers ?? {})));
  await close();
});

test('a custom base url is honoured', async () => {
  const { impl, calls } = stubFetch({ body: { valid: true, errors: [], warnings: [] } });
  const { client, close } = await connect({
    client: new ToolsApiClient({ fetchImpl: impl, baseUrl: 'https://staging.example.com/' }),
  });

  await client.callTool({ name: 'validate_setup_file', arguments: { content: '{}' } });

  assert.equal(calls[0]?.url, 'https://staging.example.com/tools/v1/validate/setup-file');
  await close();
});
