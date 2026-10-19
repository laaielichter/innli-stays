/**
 * Runs the INNLI MCP server over stdio against the local data file, e.g. for
 * Claude Desktop or MCP Inspector during development:
 *
 *   npx @modelcontextprotocol/inspector node src/mcp/stdio.ts
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServices, loadConfig } from '../config.ts';
import { createMcpServer } from './server.ts';

// Read-only: the HTTP server owns the data file; stdio sessions do not write analytics.
const { catalog } = buildServices(loadConfig(), { readOnly: true });
const server = createMcpServer(catalog, process.env.INNLI_AGENT_NAME ?? 'lokaal (stdio)');
await server.connect(new StdioServerTransport());
