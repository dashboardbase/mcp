import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolsApiClient } from '../api.js';
import { formatSetupLinkResult } from '../format.js';
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
  'Upload a Dashboardbase setup file and get back a link that opens straight into its import preview in Dashboardbase.',
  'Only call this when the user has asked for a link: the file leaves their machine, and anyone holding the link can read it for 48 hours.',
  'Validate the file with validate_setup_file first. A file carrying credential-shaped fields is refused with the offending fields listed — remove them, never work around the check.',
].join(' ');

export function registerCreateSetupLink(server: McpServer, client: ToolsApiClient, mode: Mode): void {
  server.registerTool(
    'create_setup_link',
    {
      title: 'Create Dashboardbase setup link',
      description: DESCRIPTION,
      inputSchema: {
        content: z
          .string()
          .describe('The full text of the setup file. Provide this or `path`.')
          .optional(),
        ...(mode === 'stdio'
          ? { path: pathParameter.describe('Path to the setup file, absolute or relative to the working directory.').optional() }
          : {}),
      },
      outputSchema: {
        created: z.boolean().describe('True when the link was created.'),
        url: z.string().optional().describe('The link to hand to the user.'),
        expiresAt: z.string().nullable().optional().describe('When the link stops working (UTC).'),
        reason: z.string().optional().describe('Why no link was created, e.g. `credentials_detected`.'),
        errors: z.array(errorEntrySchema).optional().describe('The fields that stopped the link being created.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
        const result = await client.createSetupLink(text);
        return toolResult(formatSetupLinkResult(result), { ...result });
      } catch (error) {
        return toolFailure(describeFailure(error));
      }
    },
  );
}
