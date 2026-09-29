/**
 * Client for the public Dashboardbase Tools API.
 *
 * The API decides what is valid; this client only transports. Response bodies are
 * passed through as-is (unknown fields included) so improvements to the API's
 * messages reach users without a release here.
 */

export const DEFAULT_BASE_URL = 'https://api.dashboardbase.com';
export const DEFAULT_TIMEOUT_MS = 15_000;

/** One entry in a setup-file validation failure. Every field is optional at runtime. */
export interface SetupFileError {
  path?: string;
  field?: string;
  message?: string;
  line?: number | null;
  column?: number | null;
  [key: string]: unknown;
}

export interface SetupFileWarning {
  path?: string;
  message?: string;
  [key: string]: unknown;
}

export interface SetupFileResult {
  valid?: boolean;
  errors?: SetupFileError[];
  warnings?: SetupFileWarning[];
  [key: string]: unknown;
}

export interface WidgetValidationError {
  path?: string;
  message?: string;
  [key: string]: unknown;
}

export interface WidgetResponseResult {
  valid?: boolean;
  widgetType?: string;
  errors?: WidgetValidationError[];
  [key: string]: unknown;
}

/** A link the user can open to preview and import the setup file. */
export interface SetupLinkCreated {
  created: true;
  id?: string;
  url?: string;
  expiresAt?: string | null;
  [key: string]: unknown;
}

/**
 * The API refused to store the file, with a reason the agent can act on —
 * `credentials_detected` above all. A result, not an error, for the same reason a
 * failed validation is one.
 */
export interface SetupLinkRejected {
  created: false;
  reason: string;
  title?: string;
  errors: SetupFileError[];
}

export type SetupLinkResult = SetupLinkCreated | SetupLinkRejected;

/** A transport or non-2xx failure. Validation failures are not errors — they come back as results. */
export class ToolsApiError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options?: { status?: number; retryAfterSeconds?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ToolsApiError';
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export interface ToolsApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ToolsApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ToolsApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Sent as `text/plain` with the raw file text rather than a JSON string literal —
   * that is what lets the API report line and column numbers.
   */
  async validateSetupFile(content: string): Promise<SetupFileResult> {
    return this.post<SetupFileResult>('/tools/v1/validate/setup-file', 'text/plain', content);
  }

  async validateWidgetResponse(response: unknown, widgetType?: string): Promise<WidgetResponseResult> {
    const body = JSON.stringify({ widgetType: widgetType ?? null, response });
    return this.post<WidgetResponseResult>('/tools/v1/validate/widget-response', 'application/json', body);
  }

  /**
   * The raw file is the body, as with validation. The link is readable by anyone who
   * holds it, which is why the tool only calls this when the user asked for one.
   */
  async createSetupLink(content: string): Promise<SetupLinkResult> {
    const response = await this.send('/tools/v1/setup-links', 'text/plain', content);
    const text = await safeText(response);

    if (response.status === 400) {
      const rejection = parseRejection(text);
      if (rejection) return rejection;
    }
    if (!response.ok) throw this.toApiError(response, text);

    return { ...this.parseJson<Record<string, unknown>>(response, text), created: true };
  }

  private async post<T>(path: string, contentType: string, body: string): Promise<T> {
    const response = await this.send(path, contentType, body);
    const text = await safeText(response);
    if (!response.ok) throw this.toApiError(response, text);
    return this.parseJson<T>(response, text);
  }

  private async send(path: string, contentType: string, body: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': contentType, accept: 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new ToolsApiError(describeNetworkFailure(cause, this.baseUrl, this.timeoutMs), { cause });
    }
    return response;
  }

  private parseJson<T>(response: Response, text: string): T {
    if (text.trim() === '') return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ToolsApiError(
        `The validation API returned a ${response.status} response that was not valid JSON.`,
        { status: response.status, cause },
      );
    }
  }

  /**
   * Non-2xx is an edge case: the API answers 200 with `valid: false` for documents that
   * fail validation, including malformed JSON. This path is for genuinely broken
   * requests and for throttling. Neither is described in the OpenAPI spec, so surface
   * whatever the body carries and fall back to the status line.
   */
  private toApiError(response: Response, body: string): ToolsApiError {
    const detail = extractErrorDetail(body);
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));

    if (response.status === 429) {
      const wait = retryAfterSeconds === undefined ? '' : ` Retry in ${retryAfterSeconds}s.`;
      return new ToolsApiError(
        `Rate limited by the Dashboardbase validation API.${wait}${detail ? ` ${detail}` : ''}`,
        { status: response.status, retryAfterSeconds },
      );
    }

    const statusLine = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return new ToolsApiError(
      detail
        ? `The validation API rejected the request (${statusLine}): ${detail}`
        : `The validation API rejected the request (${statusLine}).`,
      { status: response.status, retryAfterSeconds },
    );
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseRejection(body: string): SetupLinkRejected | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed?.['reason'] !== 'string') return undefined;
    return {
      created: false,
      reason: parsed['reason'],
      title: typeof parsed['title'] === 'string' ? parsed['title'] : undefined,
      errors: Array.isArray(parsed['errors']) ? (parsed['errors'] as SetupFileError[]) : [],
    };
  } catch {
    return undefined;
  }
}

/** Pull a human message out of an unknown error body — RFC 7807, common JSON shapes, or raw text. */
function extractErrorDetail(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed === '') return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return truncate(parsed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['detail', 'title', 'message', 'error']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() !== '') return truncate(value);
      }
      // ASP.NET ProblemDetails puts field errors under `errors`.
      const errors = record['errors'];
      if (errors && typeof errors === 'object') {
        const rendered = Object.entries(errors as Record<string, unknown>)
          .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join('; ') : String(messages)}`)
          .join(' | ');
        if (rendered !== '') return truncate(rendered);
      }
    }
    return truncate(trimmed);
  } catch {
    return truncate(trimmed);
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const timestamp = Date.parse(header);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, Math.round((timestamp - Date.now()) / 1000));
}

function describeNetworkFailure(cause: unknown, baseUrl: string, timeoutMs: number): string {
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
    return `The validation API at ${baseUrl} did not respond within ${Math.round(timeoutMs / 1000)}s.`;
  }
  const reason = cause instanceof Error ? cause.message : String(cause);
  return `Could not reach the validation API at ${baseUrl}: ${reason}`;
}

function truncate(value: string, max = 500): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
