import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Mode } from '../tools/shared.js';

/**
 * A single `validate` prompt, which Claude Code surfaces as the slash command
 * `/mcp__<server>__validate` — `/mcp__dashboardbase__validate` when installed under the
 * name the README recommends.
 *
 * One prompt rather than one per tool: people validating something often do not know
 * which of the two they have, and one entry in the slash menu beats two. The agent
 * routes to the right tool from what it is pointed at.
 *
 * This adds no capability — it is a deterministic way to reach the two existing tools
 * without relying on the model noticing it should.
 */
export function registerValidatePrompt(server: McpServer, mode: Mode): void {
  server.registerPrompt(
    'validate',
    {
      title: 'Validate a Dashboardbase file',
      description:
        'Validate a Dashboardbase setup file or widget endpoint response, then fix whatever is wrong.',
      argsSchema: {
        target: z
          .string()
          .optional()
          .describe(
            mode === 'stdio'
              ? 'What to validate — a file path such as .dashboardbase/revenue.json. Leave empty to validate what you paste or what you are working on.'
              : 'What to validate. Leave empty to validate what you paste or what you are working on.',
          ),
      },
    },
    (args) => {
      const target = typeof args?.target === 'string' ? args.target.trim() : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: buildInstruction(target, mode) },
          },
        ],
      };
    },
  );
}

function buildInstruction(target: string, mode: Mode): string {
  const subject =
    target !== ''
      ? `Validate ${target} against the Dashboardbase contract.`
      : mode === 'stdio'
        ? 'Validate my Dashboardbase file against the contract. If I have not said which one, look for a setup file at .dashboardbase/*.json in this project, or for the widget endpoint we have been working on. Ask me only if neither is obvious.'
        : 'Validate the Dashboardbase content I have provided against the contract. Ask me for it if I have not pasted anything yet.';

  const lines = [
    subject,
    '',
    'Pick the right tool:',
    '- `validate_setup_file` for a Dashboardbase setup file — the JSON that provisions a dashboard, usually at `.dashboardbase/*.json`.',
    '- `validate_widget_response` for the JSON body a widget endpoint returns. Pass the **full response envelope** (`title`, `actions`, `data`, `alert`) exactly as the endpoint returns it, not just the inner `data` payload.',
  ];

  if (mode === 'stdio') {
    lines.push(
      'Both tools can read a file directly, so pass `path` rather than pasting the contents when you have one.',
    );
  }

  lines.push(
    '',
    'Then fix every error you find and validate again, repeating until it passes. Treat warnings as advice — mention them, but do not change behaviour to silence one without telling me.',
    '',
    'When you are done, tell me what was wrong and what you changed.',
  );

  return lines.join('\n');
}
