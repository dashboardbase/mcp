#!/usr/bin/env node
/**
 * Fails when package.json, server.json and manifest.json disagree.
 *
 * The MCP registry verifies that package.json's `mcpName` matches server.json's `name`
 * and that the published npm version matches — a mismatch fails the publish after npm
 * has already gone out, which is not undoable. Cheaper to catch in CI.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));

const pkg = await read('package.json');
const server = await read('server.json');
const manifest = await read('manifest.json');

const problems = [];

if (!pkg.mcpName) {
  problems.push('package.json is missing "mcpName" — the registry needs it to verify package ownership.');
} else if (pkg.mcpName !== server.name) {
  problems.push(`package.json mcpName (${pkg.mcpName}) !== server.json name (${server.name})`);
}

if (server.version !== pkg.version) {
  problems.push(`server.json version (${server.version}) !== package.json version (${pkg.version})`);
}

if (manifest.version !== pkg.version) {
  problems.push(`manifest.json version (${manifest.version}) !== package.json version (${pkg.version})`);
}

for (const [index, entry] of (server.packages ?? []).entries()) {
  if (entry.identifier !== pkg.name) {
    problems.push(`server.json packages[${index}].identifier (${entry.identifier}) !== package.json name (${pkg.name})`);
  }
  if (entry.version !== pkg.version) {
    problems.push(`server.json packages[${index}].version (${entry.version}) !== package.json version (${pkg.version})`);
  }
}

if (problems.length > 0) {
  console.error('Manifest mismatch:\n' + problems.map((problem) => `  - ${problem}`).join('\n'));
  console.error('\nRun `node scripts/sync-version.mjs` to fix the version fields.');
  process.exit(1);
}

console.log(`manifests agree: ${pkg.name}@${pkg.version} (${pkg.mcpName})`);
