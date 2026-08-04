import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolsApiClient } from '../api.js';
import { formatWidgetResponseResult } from '../format.js';
import {
  describeFailure,
  errorEntrySchema,
  type Mode,
  pathParameter,
  readFileArgument,
  toolFailure,
  toolResult,
} from './shared.js';

const DESCRIPTION = [
  'Validate the JSON body a Dashboardbase widget endpoint returns, against the widget contract.',
  'Pass the complete response body — the envelope with title, actions, data and alert — exactly as the endpoint returns it, not just the inner `data` payload.',
  'Returns whether the response is valid, the widget type it was checked against, and the path and message of each problem.',
  'Use this after building or changing an endpoint that Dashboardbase will poll.',
].join(' ');

const RESPONSE_DESCRIPTION = [
  'The full response body from the widget endpoint, including the title/actions/data/alert envelope.',
  'Accepts a JSON object or a JSON string. Provide this or `path`.',
].join(' ');

export function registerValidateWidgetResponse(server: McpServer, client: ToolsApiClient, mode: Mode): void {
  server.registerTool(
    'validate_widget_response',
    {
      title: 'Validate Dashboardbase widget response',
      description: DESCRIPTION,
      inputSchema: {
        response: z.unknown().describe(RESPONSE_DESCRIPTION).optional(),
        widgetType: z
          .string()
          .describe(
            'Optional widget type to check against, for example "kpi", "line" or "table". Inferred from the response when omitted.',
          )
          .optional(),
        ...(mode === 'stdio' ? { path: pathParameter.optional() } : {}),
      },
      outputSchema: {
        valid: z.boolean().describe('True when the response passes validation.'),
        widgetType: z.string().optional().describe('The widget type the response was validated against.'),
        errors: z.array(errorEntrySchema).describe('Problems that make the response invalid.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const { response, widgetType, path } = args as {
        response?: unknown;
        widgetType?: string;
        path?: string;
      };

      let payload: unknown;
      if (typeof path === 'string' && path !== '') {
        if (response !== undefined) {
          return toolFailure('Provide either `response` or `path`, not both.');
        }
        let text: string;
        try {
          text = await readFileArgument(path);
        } catch (error) {
          return toolFailure(describeFailure(error));
        }
        const parsed = parseJson(text);
        if ('error' in parsed) return toolFailure(`${path} is not valid JSON: ${parsed.error}`);
        payload = parsed.value;
      } else if (response === undefined) {
        return toolFailure(
          mode === 'stdio'
            ? 'Provide the endpoint response as `response`, or give a `path` to read it from.'
            : 'Provide the endpoint response as `response`.',
        );
      } else if (typeof response === 'string') {
        // Agents commonly hand over the raw response text rather than a parsed object.
        const parsed = parseJson(response);
        if ('error' in parsed) return toolFailure(`\`response\` is not valid JSON: ${parsed.error}`);
        payload = parsed.value;
      } else {
        payload = response;
      }

      try {
        const result = await client.validateWidgetResponse(payload, widgetType);
        return toolResult(formatWidgetResponseResult(result), {
          valid: result.valid === true,
          errors: result.errors ?? [],
          ...result,
        });
      } catch (error) {
        return toolFailure(describeFailure(error));
      }
    },
  );
}

function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
