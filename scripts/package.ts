/**
 * Builds the files a buyer downloads:
 *   dist/innli-<versie>.zip            ready to run: `npm start`, no `npm install` needed
 *   dist/innli-wordpress-<versie>.zip  upload in WordPress → Plugins → Nieuwe plugin
 *   dist/SHA256SUMS.txt
 *
 *   npm run pakket               release build: refuses while LICENSE or the licence key is not filled in
 *   npm run pakket -- --concept  test build, only warns
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { VENDOR_PUBLIC_KEY } from '../src/licensing/publicKey.ts';
import { VERSION } from '../src/version.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const concept = process.argv.includes('--concept');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const wpVersion = /Version:\s+(\S+)/.exec(readFileSync(join(root, 'wordpress-plugin/innli/innli.php'), 'utf8'))?.[1];

const problems: string[] = [];
if (pkg.version !== VERSION) problems.push(`package.json (${pkg.version}) en src/version.ts (${VERSION}) verschillen`);
if (wpVersion !== VERSION) problems.push(`WordPress-plugin (${wpVersion}) en src/version.ts (${VERSION}) verschillen`);
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${VERSION}`) problems.push(`tag ${tag} hoort v${VERSION} te zijn`);
const releaseOnly: string[] = [];
if (readFileSync(join(root, 'LICENSE'), 'utf8').includes('[VUL IN')) releaseOnly.push('LICENSE bevat nog [VUL IN …]: vul je naam en KvK-gegevens in');
if (!VENDOR_PUBLIC_KEY) releaseOnly.push('geen publieke licentiesleutel: draai eerst `npm run licentie -- sleutelpaar` en commit src/licensing/publicKey.ts');
if (concept) releaseOnly.forEach((p) => console.warn(`let op (concept): ${p}`));
else problems.push(...releaseOnly);
if (problems.length) {
  console.error(`Pakket niet gemaakt:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const name = `innli-${VERSION}`;
const stage = join(dist, name);
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// What the buyer gets. Seller-only material (licence tool, sales and pilot notes, tests, bench) stays out.
for (const entry of ['src', 'public', 'wordpress-plugin', 'agent-kit', 'docs', 'LICENSE', 'README.md', 'README.en.md', 'CHANGELOG.md', 'Dockerfile', 'docker-compose.yml', 'package-lock.json']) {
  cpSync(join(root, entry), join(stage, entry), { recursive: true });
}
cpSync(join(root, 'docs/installeren.md'), join(stage, 'INSTALLEREN.md'));
// The English install guide also sits at the top of the zip; its links then point into docs/en/.
if (existsSync(join(root, 'docs/en/install.md'))) {
  writeFileSync(join(stage, 'INSTALL.md'), readFileSync(join(root, 'docs/en/install.md'), 'utf8').replace(/\]\((?!https?:|#|\/)([^)]+)\)/g, '](docs/en/$1)'));
}
const { licentie: _l, gids: _g, bench: _b, pakket: _p, ...scripts } = pkg.scripts;
writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`);

// Production dependencies only, exactly as locked; pure JavaScript, so the zip runs on Windows, Mac, Linux and ARM.
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });

// The licences of every bundled package, in one readable file.
const lock = JSON.parse(readFileSync(join(stage, 'package-lock.json'), 'utf8'));
const notices: string[] = ['Onderdelen van derden in INNLI en hun licenties.', ''];
for (const [path, info] of Object.entries<{ dev?: boolean; version?: string; license?: string }>(lock.packages)) {
  if (!path.startsWith('node_modules/') || info.dev || !existsSync(join(stage, path))) continue;
  const dir = join(stage, path);
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `(geen licentiebestand meegeleverd; licentie volgens package.json: ${info.license ?? 'onbekend'})`;
  notices.push('='.repeat(78), `${path.slice('node_modules/'.length).replace(/\/node_modules\//g, ' > ')} ${info.version ?? ''} (${info.license ?? 'onbekend'})`, '', text, '');
}
writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));

const zip = (cwd: string, out: string, folder: string) => execFileSync('zip', ['-q', '-r', '-X', out, folder], { cwd });
zip(dist, `${name}.zip`, name);
zip(join(root, 'wordpress-plugin'), join(dist, `innli-wordpress-${VERSION}.zip`), 'innli');
rmSync(stage, { recursive: true, force: true });

const sums = [`${name}.zip`, `innli-wordpress-${VERSION}.zip`].map((f) => `${createHash('sha256').update(readFileSync(join(dist, f))).digest('hex')}  ${f}`);
writeFileSync(join(dist, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`Klaar in dist/:\n${sums.join('\n')}`);
