/**
 * Checks the npm package the way a user gets it: packs it, installs the
 * tarball in an empty folder, starts the `innli-mcp` binary over stdio and
 * lists its tools. Catches a missing build, a wrong `bin` path or files left
 * out of the package before anything is published.
 *
 *   npm run smoke:npm
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'innli-npm-'));
try {
  const tarball = execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop()!;
  execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
  execFileSync('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: dir, stdio: 'inherit' });

  const client = new Client({ name: 'smoke-npm', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: join(dir, 'node_modules/.bin/innli-mcp'),
    cwd: dir,
    env: { ...process.env, INNLI_DATA: join(dir, 'data/innli.json') } as Record<string, string>,
  }));
  const { tools } = await client.listTools();
  await client.close();
  if (!tools.length) throw new Error('innli-mcp started but lists no tools');
  console.log(`npm package OK: ${tarball}, innli-mcp lists ${tools.length} tools`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
