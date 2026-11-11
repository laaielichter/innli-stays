import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The module map of INNLI, as a test. A module is a folder (or a file) directly
 * under src/. This list says which module may use which; a new dependency
 * between modules fails here, so it is a decision and not an accident.
 * The map is explained in docs/architecture.md.
 */
const MAY_USE: Record<string, string[]> = {
  // The core: rules of the business, no knowledge of how it is reached or stored.
  domain: ['i18n'],
  i18n: ['domain'],
  // Storage and what talks to the outside world.
  'store.ts': ['domain', 'acp', 'ucp'],
  security: ['store.ts'],
  connectors: ['domain', 'i18n', 'store.ts'],
  payments: ['connectors'],
  licensing: ['i18n', 'version.ts'],
  'backup.ts': ['store.ts'],
  // Application services: what an owner or an agent can do.
  booking: ['analytics', 'domain', 'store.ts'],
  analytics: ['domain', 'i18n', 'requests', 'store.ts'],
  readiness: ['connectors', 'domain', 'i18n'],
  agent: ['connectors', 'domain', 'i18n', 'mcp', 'security', 'store.ts', 'version.ts'],
  'catalog.ts': ['agent', 'agentErrors.ts', 'analytics', 'booking', 'connectors', 'domain', 'i18n', 'store.ts', 'util'],
  'properties.ts': ['agent', 'booking', 'domain', 'http', 'i18n'],
  'starters.ts': ['domain', 'properties.ts'],
  requests: ['agent', 'agentErrors.ts', 'analytics', 'catalog.ts', 'connectors', 'domain', 'http', 'i18n', 'readiness', 'security', 'store.ts'],
  // Ways in: each protocol is an adapter on the same services.
  mcp: ['agent', 'agentErrors.ts', 'catalog.ts', 'config.ts', 'domain', 'requests', 'version.ts'],
  ucp: ['agent', 'agentErrors.ts', 'catalog.ts', 'domain', 'i18n', 'requests', 'store.ts', 'version.ts'],
  acp: ['agent', 'agentErrors.ts', 'catalog.ts', 'domain', 'i18n', 'payments', 'requests', 'store.ts', 'ucp'],
  web: ['catalog.ts', 'connectors', 'domain', 'http', 'i18n', 'readiness', 'requests', 'store.ts'],
  http: ['acp', 'agent', 'agentErrors.ts', 'analytics', 'backup.ts', 'booking', 'catalog.ts', 'connectors', 'demo', 'directory', 'domain', 'i18n', 'licensing', 'mcp', 'payments', 'properties.ts', 'readiness', 'requests', 'starters.ts', 'store.ts', 'ucp', 'version.ts', 'web'],
  directory: ['agent', 'agentErrors.ts', 'connectors', 'domain', 'http', 'i18n', 'licensing', 'mcp', 'security', 'store.ts', 'version.ts'],
  // Start-up and tools.
  'config.ts': ['catalog.ts', 'connectors', 'http', 'store.ts'],
  demo: ['agent', 'booking', 'domain', 'http', 'properties.ts', 'store.ts'],
  'main.ts': ['analytics', 'backup.ts', 'config.ts', 'demo', 'directory', 'http', 'i18n', 'payments', 'requests'],
  'cli.ts': ['config.ts', 'domain', 'http', 'i18n', 'licensing', 'properties.ts', 'store.ts'],
  'conformance.ts': ['agent', 'security'],
  'agentErrors.ts': [],
  'version.ts': [],
  util: [],
};

const src = join(import.meta.dirname, '..', 'src');
const moduleOf = (file: string) => relative(src, file).split(sep)[0];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture', () => {
  it('modules only depend on the modules the map allows', () => {
    const unexpected: string[] = [];
    for (const file of files(src)) {
      const from = moduleOf(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
        const to = moduleOf(normalize(join(dirname(file), m[1])));
        if (to !== from && !(MAY_USE[from] ?? []).includes(to)) unexpected.push(`${relative(src, file)} uses ${to}`);
      }
    }
    assert.deepEqual(unexpected, [], 'A new dependency between modules. Decide whether it belongs, then add it to MAY_USE and docs/architecture.md.');
  });

  it('the business rules know nothing about HTTP, protocols or storage', () => {
    assert.deepEqual(MAY_USE.domain, ['i18n']);
    for (const file of files(join(src, 'domain'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from '(express|node:http|node:fs|@modelcontextprotocol)/, relative(src, file));
    }
  });
});
