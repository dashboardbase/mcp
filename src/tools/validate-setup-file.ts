import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolsApiClient } from '../api.js';
import { formatSetupFileResult } from '../format.js';
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
  'Validate a Dashboardbase setup file (the declarative JSON that provisions a dashboard, usually stored at .dashboardbase/<name>.json).',
  'Returns whether the file is valid plus any errors and warnings, with the JSON path, field and line/column of each problem.',
  'Use this after writing or editing a setup file, before telling the user it is ready to import.',
].join(' ');

export function registerValidateSetupFile(server: McpServer, client: ToolsApiClient, mode: Mode): void {
  server.registerTool(
    'validate_setup_file',
    {
      title: 'Validate Dashboardbase setup file',
      description: DESCRIPTION,
      inputSchema: {
        content: z
          .string()
          .describe('The full text of the setup file. Provide this or `path`.')
          .optional(),
        ...(mode === 'stdio' ? { path: pathParameter.optional() } : {}),
      },
      outputSchema: {
        valid: z.boolean().describe('True when the setup file passes validation.'),
        errors: z.array(errorEntrySchema).describe('Problems that make the file invalid.'),
        warnings: z.array(errorEntrySchema).describe('Non-fatal advice about the file.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const { content, path } = args as { content?: string; path?: string };

      let text: string;
      if (typeof path === 'string' && path !== '') {
        if (typeof content === 'string' && content !== '') {
          return toolFailure('Provide either `content` or `path`, not both.');
        }
        try {
          text = await readFileArgument(path);
        } catch (error) {
          return toolFailure(describeFailure(error));
        }
      } else if (typeof content === 'string' && content !== '') {
        text = content;
      } else {
        return toolFailure(
          mode === 'stdio'
            ? 'Provide the setup file as `content`, or give a `path` to read it from.'
            : 'Provide the setup file as `content`.',
        );
      }

      try {
        const result = await client.validateSetupFile(text);
        return toolResult(formatSetupFileResult(result), {
          valid: result.valid === true,
          errors: result.errors ?? [],
          warnings: result.warnings ?? [],
          ...result,
        });
      } catch (error) {
        return toolFailure(describeFailure(error));
      }
    },
  );
}
