#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from './api.js';
import { createHttpHandler, MAX_BODY_BYTES } from './http.js';
import { createServer, SERVER_VERSION } from './server.js';

interface Options {
  http: boolean;
  port: number;
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
  allowedOrigins: string[];
}

const USAGE = `dashboardbase-mcp ${SERVER_VERSION}

Validate Dashboardbase widget endpoint responses and setup files.

Usage:
  dashboardbase-mcp                 Run over stdio (default; for Claude Code, Cursor, etc.)
  dashboardbase-mcp --http          Run as a Streamable HTTP server

Options:
  --http                 Serve Streamable HTTP instead of stdio.
  --port <number>        Port for --http (default 3000, or $PORT).
  --allowed-origin <o>   Permit a browser Origin. Repeatable. None allowed by default.
  -h, --help             Show this message.
  -v, --version          Print the version.

Environment:
  DASHBOARDBASE_API_URL      API base URL (default ${DEFAULT_BASE_URL}).
  DASHBOARDBASE_API_KEY      Optional x-api-key sent upstream.
  DASHBOARDBASE_TIMEOUT_MS   Request timeout (default ${DEFAULT_TIMEOUT_MS}).
`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    http: false,
    port: positiveInt(process.env['PORT']) ?? 3000,
    baseUrl: process.env['DASHBOARDBASE_API_URL']?.trim() || DEFAULT_BASE_URL,
    apiKey: process.env['DASHBOARDBASE_API_KEY']?.trim() || undefined,
    timeoutMs: positiveInt(process.env['DASHBOARDBASE_TIMEOUT_MS']) ?? DEFAULT_TIMEOUT_MS,
    allowedOrigins: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--http':
        options.http = true;
        break;
      case '--port': {
        const port = positiveInt(argv[++index]);
        if (port === undefined) fail('--port requires a positive number.');
        options.port = port;
        break;
      }
      case '--allowed-origin': {
        const origin = argv[++index];
        if (!origin) fail('--allowed-origin requires a value.');
        options.allowedOrigins.push(origin);
        break;
      }
      case '-h':
      case '--help':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case '-v':
      case '--version':
        process.stdout.write(`${SERVER_VERSION}\n`);
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const clientOptions = {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  };

  if (options.http) {
    await startHttp(options, clientOptions);
    return;
  }

  // stdout carries the protocol on stdio, so nothing else may be written to it.
  const server = createServer({ ...clientOptions, mode: 'stdio' });
  await server.connect(new StdioServerTransport());
}

async function startHttp(options: Options, clientOptions: Record<string, unknown>): Promise<void> {
  const handler = createHttpHandler({ ...clientOptions, allowedOrigins: options.allowedOrigins });

  const server = createHttpServer((req, res) => {
    void (async () => {
      try {
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        if (body === TOO_LARGE) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          return;
        }

        const response = await handler(toWebRequest(req, body));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        process.stderr.write(`request failed: ${error instanceof Error ? error.message : String(error)}\n`);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  process.stderr.write(`dashboardbase-mcp listening on http://localhost:${options.port}/mcp\n`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

const TOO_LARGE = Symbol('too-large');

async function readBody(req: IncomingMessage): Promise<string | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return TOO_LARGE;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function toWebRequest(req: IncomingMessage, body: string | undefined): Request {
  const host = req.headers.host ?? 'localhost';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
    body: body === undefined || body === '' ? undefined : body,
  });
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(`dashboardbase-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
