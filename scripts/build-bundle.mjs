#!/usr/bin/env node
/**
 * Builds the Claude Desktop (.mcpb) bundle.
 *
 * The bundle runs standalone, so it ships node_modules — but only production
 * dependencies, installed into a clean staging directory. Packing the repo itself would
 * drag in TypeScript, the test suite and the dev tree.
 *
 * Verifies the staged server actually starts before packing, because a bundle that
 * installs but fails to launch is worse than no bundle.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, 'dashboardbase-mcp.mcpb'));

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

const staging = await mkdtemp(join(tmpdir(), 'dashboardbase-mcpb-'));

try {
  for (const file of ['manifest.json', 'package.json', 'package-lock.json', 'logo-dark.png', '.mcpbignore']) {
    await cp(join(root, file), join(staging, file));
  }
  await cp(join(root, 'dist'), join(staging, 'dist'), { recursive: true });

  console.log('installing production dependencies...');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts'], staging);

  console.log('verifying the staged server starts...');
  const probe = join(staging, 'probe.mjs');
  await writeFile(
    probe,
    [
      'import { createServer } from "./dist/server.js";',
      'const server = createServer({ mode: "stdio" });',
      'if (!server) { throw new Error("createServer returned nothing"); }',
      'await server.close();',
      'console.log("staged server ok");',
    ].join('\n'),
    'utf8',
  );
  run(process.execPath, [probe], staging);
  await rm(probe);

  console.log('packing...');
  run('npx', ['--yes', '@anthropic-ai/mcpb', 'pack', '.', output], staging);
  console.log(`\nbundle written to ${output}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
