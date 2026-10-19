/**
 * What an agent pays in context: the tool definitions it loads on every turn,
 * and the size of typical answers in full and brief form. Tokens are estimated
 * at 4 characters per token.
 *
 *   npm run measure
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { freeWindow, startTestServer } from '../test/helpers.ts';

const server = await startTestServer();
const connect = async (profile: string) => {
  const client = new Client({ name: 'measure', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp${profile ? `?profile=${profile}` : ''}`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
  return client;
};
const tokens = (v: unknown) => Math.round(JSON.stringify(v).length / 4);
const text = async (client: Client, name: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return res.content[0].text;
};

const full = await connect('');
const core = await connect('core');
const fullInit = { tools: (await full.listTools()).tools, instructions: full.getInstructions() };
const coreInit = { tools: (await core.listTools()).tools, instructions: core.getInstructions() };

const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer', 'kraaiennest-bos'], 2);
const search = { area: 'Veluwe', checkin, checkout, guests: { adults: 2, children: 0, dogs: 1 }, requirements: ['enclosed_garden', 'breakfast_available'] };
const rows: [string, number, number][] = [
  ['Tools + instructions per turn', tokens(fullInit), tokens(coreInit)],
  ['search_stays (Veluwe, dog, 2 nights)', Math.round((await text(full, 'search_stays', search)).length / 4), Math.round((await text(full, 'search_stays', { ...search, detail: 'brief' })).length / 4)],
  ['get_stay_details', Math.round((await text(full, 'get_stay_details', { propertyId: 'prop_hooiberg' })).length / 4), Math.round((await text(full, 'get_stay_details', { propertyId: 'prop_hooiberg', detail: 'brief' })).length / 4)],
];

console.log(`\nTools: full ${fullInit.tools.length}, core ${coreInit.tools.length}\n`);
console.log('| What | Full | Core / brief | Saved |\n|---|---:|---:|---:|');
for (const [what, a, b] of rows) console.log(`| ${what} | ~${a} tokens | ~${b} tokens | ${Math.round((1 - b / a) * 100)}% |`);
await full.close();
await core.close();
await server.close();
