#!/usr/bin/env node
/**
 * Copies the version from package.json into server.json and manifest.json.
 *
 * server.json carries the version twice — top level and inside packages[] — and the
 * registry rejects a publish where either has drifted from the npm package.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(name) {
  return JSON.parse(await readFile(join(root, name), 'utf8'));
}

async function writeJson(name, value) {
  await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const { version, name: packageName, mcpName } = await readJson('package.json');
if (!version) throw new Error('package.json has no version');

const server = await readJson('server.json');
server.version = version;
server.name = mcpName;
for (const entry of server.packages ?? []) {
  entry.version = version;
  entry.identifier = packageName;
}
await writeJson('server.json', server);

const manifest = await readJson('manifest.json');
manifest.version = version;
await writeJson('manifest.json', manifest);

console.log(`synced version ${version} into server.json and manifest.json`);
