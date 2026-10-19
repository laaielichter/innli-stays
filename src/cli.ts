#!/usr/bin/env node
/**
 * Command line tool for local installs and small self-hosted setups.
 *
 *   npm run setup                         first accommodation (interactive)
 *   node src/cli.ts list                  list accommodations          (Dutch: lijst)
 *   node src/cli.ts new-key <id>          replace a lost owner key     (nieuwe-sleutel)
 *   node src/cli.ts agent <name> [--read-only]   key for an agent partner (--alleen-lezen)
 *   node src/cli.ts license <key>         activate a purchased licence (licentie)
 *
 * Stop the server first: it keeps its own copy of the data in memory.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config.ts';
import { hashKey, newKey } from './http/auth.ts';
import { defaultLang } from './i18n/index.ts';
import { describeLicense, verifyLicense } from './licensing/license.ts';
import { createProperty } from './properties.ts';
import { Store } from './store.ts';

const config = loadConfig();
const store = new Store(config.dataFile);
const [command = 'help', ...args] = process.argv.slice(2);
/** Messages follow the installation language (INNLI_LANG): Dutch, otherwise English. */
const tx = (nl: string, en: string) => (defaultLang() === 'nl' ? nl : en);

function saveKeyFile(name: string, content: string): string {
  const file = resolve(join(dirname(config.dataFile), name));
  writeFileSync(file, `${content}\n`);
  try {
    chmodSync(file, 0o600);
  } catch {
    // not supported on every filesystem
  }
  return file;
}

async function init() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  // Iterating lines (instead of rl.question) also works when answers are piped in.
  const ask = async (q: string, fallback = '') => {
    process.stdout.write(fallback ? `${q} [${fallback}]: ` : `${q}: `);
    const next = await lines.next();
    if (!process.stdin.isTTY) process.stdout.write('\n');
    return (next.done ? '' : String(next.value)).trim() || fallback;
  };
  console.log(tx('\nINNLI – nieuwe accommodatie\n', '\nINNLI – new accommodation\n'));
  const name = await ask(tx('Naam van je accommodatie', 'Name of your accommodation'));
  const city = await ask(tx('Plaats', 'Town'));
  const country = (await ask(tx('Land (2 letters)', 'Country (2 letters)'), defaultLang() === 'nl' ? 'NL' : '')).toUpperCase();
  const typeAnswer = await ask(tx('Type: 1 = B&B, 2 = pension, 3 = gastenverblijf, 4 = vakantiewoning, 5 = bijzonder verblijf, 6 = hotel', 'Type: 1 = B&B, 2 = guesthouse (pension), 3 = guest house, 4 = holiday home, 5 = unique stay, 6 = hotel'), '1');
  const website = await ask(tx('Website (mag leeg)', 'Website (may be empty)'));
  const email = await ask(tx('E-mailadres voor aanvragen (mag leeg)', 'E-mail address for requests (may be empty)'));
  rl.close();
  if (name.length < 2 || !city || country.length !== 2) {
    console.error(tx('Naam, plaats en land zijn verplicht.', 'Name, town and country are required.'));
    process.exit(1);
  }
  const types = ['bnb', 'pension', 'guesthouse', 'holiday_home', 'unique_stay', 'hotel'] as const;
  const { property, ownerKey } = createProperty({ name, type: types[Number(typeAnswer) - 1] ?? 'bnb', address: { city, country } });
  property.language = defaultLang();
  if (store.getProperty(property.slug)) property.slug = `${property.slug}-${randomUUID().slice(0, 4)}`;
  if (/^https?:\/\//.test(website)) property.website = website;
  if (email.includes('@')) property.contactEmail = email;
  // Start with INNLI's own room calendar; the owner can connect feeds or a booking system later.
  property.booking = { connector: { kind: 'manual' } };
  store.saveProperty(property);
  store.flush();
  const file = saveKeyFile(`eigenaar-sleutel-${property.slug}.txt`, ownerKey);
  console.log(
    tx(
      `
Klaar. "${property.name}" is aangemaakt (nog niet zichtbaar voor agents).

  Eigenaarssleutel: ${ownerKey}
  (ook bewaard in ${file})

Volgende stappen:
  1. Start INNLI:          npm start
  2. Open het dashboard:   ${config.publicUrl}/dashboard/  en log in met de sleutel
  3. Voeg kamers toe, koppel je agenda('s) en bevestig je gegevens
  4. Zet "Zichtbaar voor agents" aan
`,
      `
Done. "${property.name}" has been created (not yet visible to agents).

  Owner key: ${ownerKey}
  (also saved in ${file})

Next steps:
  1. Start INNLI:          npm start
  2. Open the dashboard:   ${config.publicUrl}/dashboard/  and log in with the key
  3. Add rooms, connect your calendar(s) and confirm your details
  4. Switch on "Visible to agents"
`,
    ),
  );
}

function list() {
  const props = store.listProperties();
  if (!props.length) console.log(tx('Nog geen accommodaties. Begin met: npm run setup', 'No accommodations yet. Start with: npm run setup'));
  for (const p of props) console.log(`${p.id}\t${p.published ? tx('zichtbaar', 'visible') : tx('verborgen', 'hidden')}\t${p.name} (${p.address.city})`);
}

function resetKey(id: string | undefined) {
  const p = id ? store.getProperty(id) : undefined;
  if (!p) {
    console.error(tx('Onbekende accommodatie. Gebruik: node src/cli.ts nieuwe-sleutel <id>  (zie "lijst")', 'Unknown accommodation. Use: node src/cli.ts new-key <id>  (see "list")'));
    process.exit(1);
  }
  const key = newKey('innli_own');
  p.ownerKeyHash = hashKey(key);
  store.saveProperty(p);
  store.flush();
  const file = saveKeyFile(`eigenaar-sleutel-${p.slug}.txt`, key);
  console.log(tx(`Nieuwe eigenaarssleutel voor ${p.name}: ${key}\n(ook bewaard in ${file}; de oude sleutel werkt niet meer)`, `New owner key for ${p.name}: ${key}\n(also saved in ${file}; the old key no longer works)`));
}

function agent(args: string[]) {
  const readOnly = args.includes('--alleen-lezen') || args.includes('--read-only');
  const name = args.filter((a) => a !== '--alleen-lezen' && a !== '--read-only').join(' ');
  if (name.length < 2) {
    console.error(tx('Gebruik: node src/cli.ts agent "Naam van de agent"', 'Use: node src/cli.ts agent "Name of the agent"'));
    process.exit(1);
  }
  const key = newKey('innli_agt');
  store.saveAgent({ id: `agt_${randomUUID().slice(0, 8)}`, name, keyHash: hashKey(key), scopes: readOnly ? ['read'] : ['read', 'act'], createdAt: new Date().toISOString() });
  store.flush();
  console.log(tx(`Agentsleutel voor ${name}${readOnly ? ' (alleen lezen)' : ''}: ${key}\nDe agent gebruikt: Authorization: Bearer <sleutel> op ${config.publicUrl}/mcp`, `Agent key for ${name}${readOnly ? ' (read only)' : ''}: ${key}\nThe agent uses: Authorization: Bearer <key> on ${config.publicUrl}/mcp`));
}

function license(key: string | undefined) {
  if (!key) {
    const d = describeLicense(verifyLicense(store.getSettings().license));
    console.log(`${d.title}\n${d.detail}`);
    return;
  }
  const status = verifyLicense(key);
  const d = describeLicense(status);
  if (status.state === 'invalid') {
    console.error(`${d.title}: ${d.detail}`);
    process.exit(1);
  }
  store.updateSettings({ license: key });
  store.flush();
  console.log(`${d.title}\n${d.detail}`);
}

switch (command) {
  case 'init':
    await init();
    break;
  case 'list':
  case 'lijst':
    list();
    break;
  case 'new-key':
  case 'nieuwe-sleutel':
    resetKey(args[0]);
    break;
  case 'agent':
    agent(args);
    break;
  case 'license':
  case 'licentie':
    license(args[0]);
    break;
  default:
    console.log(tx('Gebruik: node src/cli.ts init | lijst | nieuwe-sleutel <id> | agent <naam> | licentie [sleutel]', 'Use: node src/cli.ts init | list | new-key <id> | agent <name> | license [key]'));
}
