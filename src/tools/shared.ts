import { z } from 'zod';

import { ToolsApiError } from '../api.js';

/**
 * stdio runs on the developer's machine, so reading a file they name is expected.
 * http may be hosted, where the same capability would be an arbitrary-file-read hole,
 * so the property is left out of the advertised schema entirely rather than rejected
 * at call time.
 */
export type Mode = 'stdio' | 'http';

export const pathParameter = z
  .string()
  .min(1)
  .describe('Path to the file to validate, absolute or relative to the working directory.');

/** Shapes are permissive so unknown fields the API adds later still reach clients. */
export const errorEntrySchema = z.looseObject({});

export function toolResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
  };
}

/**
 * Only transport and protocol failures are tool errors. A document that fails
 * validation is a successful call with a `valid: false` result — flagging it as an
 * error makes agents treat the tool as broken and give up.
 */
export function toolFailure(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true as const,
  };
}

export function describeFailure(error: unknown): string {
  if (error instanceof ToolsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function readFileArgument(filePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`No such file: ${filePath}`);
    if (code === 'EISDIR') throw new Error(`Not a file: ${filePath}`);
    if (code === 'EACCES') throw new Error(`Permission denied reading ${filePath}`);
    throw new Error(`Could not read ${filePath}: ${describeFailure(error)}`);
  }
}
