/**
 * Seller tool for one-time-purchase licences. Run on YOUR computer, not on a customer's.
 *
 *   npm run licentie -- sleutelpaar
 *       Creates licentie-prive-sleutel.pem (keep it secret, back it up) and writes the
 *       public key into src/licensing/publicKey.ts. Do this once, before the first sale.
 *
 *   npm run licentie -- uitgeven --naam "B&B De Hooiberg" --email info@x.nl --pakket start
 *       Prints a licence key for one sale. Packages: oprichter, start, plus, groep (src/licensing/plans.ts).
 *       Or set it by hand: [--accommodaties 1] [--updates-jaren 1].
 *
 *   npm run licentie -- verlengen <sleutel> [--jaren 1]
 *       Same licence (same id, so the same installation stays in the guide) with a later update date.
 *
 *   npm run licentie -- pakketten
 *
 *   npm run licentie -- controleer <sleutel>
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describeLicense, generateVendorKeys, issueLicense, verifyLicense } from '../src/licensing/license.ts';
import { INSTALL_SERVICE_PRICE, PLANS, planById, RENEWAL_PRICE_PER_YEAR, RESELLER_DISCOUNT_PERCENT } from '../src/licensing/plans.ts';

const PRIVATE_KEY_FILE = process.env.INNLI_LICENSE_PRIVATE_KEY ?? 'licentie-prive-sleutel.pem';
const PUBLIC_KEY_SOURCE = new URL('../src/licensing/publicKey.ts', import.meta.url);

const [command, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

switch (command) {
  case 'sleutelpaar': {
    if (existsSync(PRIVATE_KEY_FILE)) fail(`${PRIVATE_KEY_FILE} bestaat al. Een nieuw sleutelpaar maakt alle verkochte licenties ongeldig; verwijder het bestand zelf als je dat echt wilt.`);
    const { privateKeyPem, publicKeyBase64 } = generateVendorKeys();
    writeFileSync(PRIVATE_KEY_FILE, privateKeyPem);
    chmodSync(PRIVATE_KEY_FILE, 0o600);
    const source = readFileSync(PUBLIC_KEY_SOURCE, 'utf8').replace(/export const VENDOR_PUBLIC_KEY = '.*';/, `export const VENDOR_PUBLIC_KEY = '${publicKeyBase64}';`);
    writeFileSync(PUBLIC_KEY_SOURCE, source);
    console.log(`Privésleutel: ${PRIVATE_KEY_FILE}  ← geheim houden en back-uppen, NIET in git.
Publieke sleutel is gezet in src/licensing/publicKey.ts (die mag wel in git).`);
    break;
  }
  case 'uitgeven': {
    if (!existsSync(PRIVATE_KEY_FILE)) fail(`Geen ${PRIVATE_KEY_FILE}. Maak eerst een sleutelpaar: npm run licentie -- sleutelpaar`);
    const name = flag('naam');
    if (!name) fail('Gebruik: npm run licentie -- uitgeven --naam "Naam koper" [--email x] [--pakket start] [--accommodaties 1] [--kamers 20] [--updates-jaren 1]');
    const planId = flag('pakket');
    const plan = planId ? planById(planId) : undefined;
    if (planId && !plan) fail(`Onbekend pakket "${planId}". Kies uit: ${PLANS.map((p) => p.id).join(', ')}`);
    const years = Number(flag('updates-jaren') ?? plan?.updateYears ?? 1);
    const until = new Date();
    until.setUTCFullYear(until.getUTCFullYear() + years);
    const license = issueLicense(readFileSync(PRIVATE_KEY_FILE, 'utf8'), {
      id: `lic_${randomUUID().slice(0, 8)}`,
      name,
      email: flag('email'),
      maxProperties: Number(flag('accommodaties') ?? plan?.properties ?? 1),
      ...(flag('kamers') || plan?.maxRooms ? { maxRooms: Number(flag('kamers') ?? plan?.maxRooms) } : {}),
      updatesUntil: until.toISOString().slice(0, 10),
    });
    const status = verifyLicense(license, { publicKeyBase64: readPublicKey() });
    console.log(license);
    console.error(`\n${describeLicense(status).title} – ${describeLicense(status).detail}${plan ? `\nPakket ${plan.name}: € ${plan.price}` : ''}`);
    break;
  }
  case 'verlengen': {
    if (!existsSync(PRIVATE_KEY_FILE)) fail(`Geen ${PRIVATE_KEY_FILE}.`);
    const status = verifyLicense(rest[0], { publicKeyBase64: readPublicKey(), releaseDate: '0000-00-00' });
    if (status.state !== 'licensed') fail(`Deze sleutel kan niet worden verlengd: ${describeLicense(status).detail}`);
    const old = status.license;
    const years = Number(flag('jaren') ?? 1);
    // Extend from the old end date, or from today when it already lapsed.
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(`${old.updatesUntil > today ? old.updatesUntil : today}T00:00:00Z`);
    from.setUTCFullYear(from.getUTCFullYear() + years);
    const license = issueLicense(readFileSync(PRIVATE_KEY_FILE, 'utf8'), { id: old.id, name: old.name, email: old.email, maxProperties: old.maxProperties, maxRooms: old.maxRooms, updatesUntil: from.toISOString().slice(0, 10) });
    console.log(license);
    const perYear = old.maxRooms ? (PLANS.filter((p) => p.maxRooms && p.maxRooms <= old.maxRooms!).sort((a, b) => b.maxRooms! - a.maxRooms!)[0]?.renewalPerYear ?? RENEWAL_PRICE_PER_YEAR) : RENEWAL_PRICE_PER_YEAR;
    console.error(`\nUpdates tot ${from.toISOString().slice(0, 10)} (was ${old.updatesUntil}). Prijs: € ${perYear * years}.`);
    break;
  }
  case 'pakketten': {
    for (const p of PLANS) console.log(`${p.id.padEnd(11)} € ${String(p.price).padStart(4)}  ${p.properties} verblijf/verblijven, ${p.maxRooms === undefined ? 'tot 20 kamers' : p.maxRooms >= 10_000 ? 'onbeperkt kamers' : `tot ${p.maxRooms} kamers`}, ${p.updateYears} jaar updates, verlengen € ${p.renewalPerYear}/jaar – ${p.note}`);
    console.log(`\nVerlengen: € ${RENEWAL_PRICE_PER_YEAR} per jaar · Installatieservice: € ${INSTALL_SERVICE_PRICE} · Wederverkopers: ${RESELLER_DISCOUNT_PERCENT}% korting`);
    break;
  }
  case 'controleer': {
    const d = describeLicense(verifyLicense(rest[0], { publicKeyBase64: readPublicKey() }));
    console.log(`${d.title}\n${d.detail}`);
    break;
  }
  default:
    console.log('Gebruik: npm run licentie -- sleutelpaar | pakketten | uitgeven --naam "…" --pakket start | verlengen <sleutel> | controleer <sleutel>');
}

function readPublicKey(): string | undefined {
  return /VENDOR_PUBLIC_KEY = '([^']*)'/.exec(readFileSync(PUBLIC_KEY_SOURCE, 'utf8'))?.[1] || undefined;
}
