import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ToolsApiClient, type ToolsApiClientOptions } from './api.js';
import { registerValidatePrompt } from './prompts/validate.js';
import type { Mode } from './tools/shared.js';
import { registerValidateSetupFile } from './tools/validate-setup-file.js';
import { registerValidateWidgetResponse } from './tools/validate-widget-response.js';

export const SERVER_NAME = 'dashboardbase';

// Read from package.json rather than duplicating the literal here: this version is
// reported to MCP clients, to `--version` and to /health, and a hardcoded copy would
// silently keep reporting the pre-release value after every bump.
const require = createRequire(import.meta.url);
export const SERVER_VERSION = (require('../package.json') as { version: string }).version;

export interface CreateServerOptions extends ToolsApiClientOptions {
  /** `http` drops the file-reading parameters from the advertised tool schemas. */
  mode?: Mode;
  client?: ToolsApiClient;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const { mode = 'stdio', client, ...clientOptions } = options;
  const apiClient = client ?? new ToolsApiClient(clientOptions);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Validation tools for Dashboardbase. Use validate_setup_file to check a dashboard setup file, ' +
        'and validate_widget_response to check the JSON body a widget endpoint returns. ' +
        'Validate before telling the user their endpoint or setup file is ready.',
    },
  );

  registerValidateSetupFile(server, apiClient, mode);
  registerValidateWidgetResponse(server, apiClient, mode);
  registerValidatePrompt(server, mode);

  return server;
}

export type { Mode };
