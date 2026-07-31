/**
 * Stateless Streamable HTTP handler.
 *
 * Both tools are pure request/response, so there is no session, no SSE stream and no
 * sticky-routing requirement. That keeps this a single `Request -> Response` function,
 * which runs unchanged on Node, in a container, or on any Web-Standards runtime.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createServer, type CreateServerOptions, SERVER_VERSION } from './server.js';

/** Setup files and widget responses are small; anything larger is not a real request. */
export const MAX_BODY_BYTES = 1_000_000;

export interface HttpHandlerOptions extends Omit<CreateServerOptions, 'mode'> {
  /** Exact `Origin` values permitted for browser clients. Omit to allow none. */
  allowedOrigins?: string[];
  endpoint?: string;
}

export function createHttpHandler(options: HttpHandlerOptions = {}) {
  const { allowedOrigins = [], endpoint = '/mcp', ...serverOptions } = options;

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: SERVER_VERSION }, 200, corsHeaders);
    }

    if (url.pathname !== endpoint) {
      return json({ error: 'not_found' }, 404, corsHeaders);
    }

    // An Origin header means a browser sent this; anything not allowlisted is refused
    // so a hostile page cannot drive the server through a victim's browser.
    if (origin !== null && !allowedOrigins.includes(origin)) {
      return json({ error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, corsHeaders);
    }

    let parsedBody: unknown;
    if (request.method === 'POST') {
      const raw = await request.text();
      if (byteLength(raw) > MAX_BODY_BYTES) {
        return json({ error: 'payload_too_large' }, 413, corsHeaders);
      }
      try {
        parsedBody = JSON.parse(raw) as unknown;
      } catch {
        return json({ error: 'invalid_json' }, 400, corsHeaders);
      }
    }

    // A fresh server and transport per request: stateless, and nothing leaks between callers.
    const server = createServer({ ...serverOptions, mode: 'http' });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      return withHeaders(response, corsHeaders);
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };
}

function buildCorsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  if (origin === null || !allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
    'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
