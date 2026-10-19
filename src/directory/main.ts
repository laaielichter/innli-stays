/**
 * The INNLI guide (gids): one MCP address for agent partners that routes to all
 * self-hosted installations. Tiny and stateless apart from a list of
 * installations; runs fine on a free VM or a Raspberry Pi.
 */
import { safeFetcher } from '../http/safeFetch.ts';
import { createGuideApp } from './app.ts';
import { Guide } from './guide.ts';

const port = Number(process.env.PORT ?? 4000);
const allowPrivate = process.env.GIDS_ALLOW_PRIVATE === '1';
// Open by default: every installation is listed for free. GIDS_LICENTIE_VEREIST=1 lists only licensed ones.
const guide = new Guide({ path: process.env.GIDS_DATA ?? 'data/gids.json', fetcher: safeFetcher(allowPrivate), requireHttps: !allowPrivate, requireLicense: process.env.GIDS_LICENTIE_VEREIST === '1' });

createGuideApp(guide).listen(port, process.env.HOST ?? '0.0.0.0', () => {
  console.log(`INNLI-gids draait op poort ${port}`);
  console.log(`  MCP voor agents:       /mcp`);
  console.log(`  Aanmelden installaties: POST /api/gids/register`);
});
