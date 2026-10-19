import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildServices, loadConfig } from './config.ts';
import { seedDemo } from './demo/seed.ts';
import { defaultLang } from './i18n/index.ts';
import { startGuideRegistration } from './directory/register.ts';
import { createApp } from './http/app.ts';
import { createMailer } from './requests/mailer.ts';
import { sendMonthlyReports } from './analytics/reports.ts';
import { backupNow } from './backup.ts';

const config = loadConfig();
/** Console messages follow the installation language (INNLI_LANG): Dutch, otherwise English. */
const tx = (nl: string, en: string) => (defaultLang() === 'nl' ? nl : en);
const { store, fetcher, catalog } = buildServices(config);
const dataDir = dirname(config.dataFile);
mkdirSync(dataDir, { recursive: true });

if (config.demo && store.listProperties().length === 0) {
  const creds = seedDemo(store, config.publicUrl, { international: process.env.INNLI_DEMO === 'intl', hotel: true });
  const file = join(dataDir, 'demo-credentials.json');
  writeFileSync(file, JSON.stringify(creds, null, 2));
  console.log(tx(`Demo-data aangemaakt. Sleutels staan in ${file}`, `Sample data created. Keys are in ${file}`));
}

// First run: a one-time code lets the owner set up the installation in the browser.
const codeFile = join(dataDir, 'installatiecode.txt');
let setupCode: string | undefined;
if (store.listProperties().length === 0) {
  setupCode = randomBytes(4).toString('hex').toUpperCase();
  writeFileSync(codeFile, `${setupCode}\n`);
} else {
  rmSync(codeFile, { force: true });
}

const mailer = createMailer(config.smtpUrl, config.mailFrom);
const backups = config.backupDir ? { dir: config.backupDir, run: () => backupNow(store, config.dataFile, config.backupDir!, { keep: config.backupKeep }) } : undefined;
const app = createApp({ store, catalog, fetcher, adminKey: config.adminKey, requireAgentKey: config.requireAgentKey, demo: config.demo, publicUrl: config.publicUrl, guideUrl: config.guideUrl, mailer, setupCode, mediaDir: join(dataDir, 'media'), backups });

// Daily backup to a second place (INNLI_BACKUP_DIR), shortly after start and then every day.
if (backups) {
  const backup = () => {
    try {
      const r = backups.run();
      console.log(tx(`Back-up gemaakt in ${r.folder}.`, `Backup written to ${r.folder}.`));
    } catch (err) {
      console.error(tx('Back-up mislukt:', 'Backup failed:'), (err as Error).message);
    }
  };
  setTimeout(backup, 60_000).unref();
  setInterval(backup, 86_400_000).unref();
}

if (config.guideUrl) startGuideRegistration(store, config.guideUrl, config.publicUrl);

// Hourly: expire unanswered requests, remind owners, pre-arrival messages, double-booking alerts.
const requestService = app.locals.requests as import('./requests/service.ts').RequestService;
const maintain = async () => {
  try {
    const r = await requestService.maintain();
    const conflicts = await requestService.notifyConflicts();
    const waitlisted = await (app.locals.waitlist as import('./requests/waitlist.ts').WaitlistService).check();
    const invited = await (app.locals.reviews as import('./requests/reviews.ts').ReviewService).invite();
    const reports = await sendMonthlyReports(store, mailer);
    if (r.expired || r.ownerReminders || r.preArrival || conflicts || waitlisted || invited || reports) {
      console.log(tx(
        `Onderhoud: ${r.expired} verlopen, ${r.ownerReminders} herinneringen, ${r.preArrival} berichten voor aankomst, ${conflicts} mogelijke dubbele boekingen, ${waitlisted} wachtlijstmeldingen, ${invited} uitnodigingen voor een beoordeling, ${reports} maandrapporten.`,
        `Maintenance: ${r.expired} expired, ${r.ownerReminders} reminders, ${r.preArrival} pre-arrival messages, ${conflicts} possible double bookings, ${waitlisted} waiting-list notices, ${invited} review invitations, ${reports} monthly reports.`,
      ));
    }
  } catch (err) {
    console.error(tx('Onderhoud mislukt:', 'Maintenance failed:'), (err as Error).message);
  }
};
setTimeout(maintain, 10_000).unref();
setInterval(maintain, 3_600_000).unref();

// Privacy: remove guests' personal data once it is no longer needed.
const purge = () => {
  store.pruneEvents(90);
  const n = store.anonymiseRequests(config.retentionDays);
  if (n) console.log(tx(`Privacy: persoonsgegevens van ${n} oude aanvraag/aanvragen verwijderd.`, `Privacy: personal data of ${n} old request(s) removed.`));
};
purge();
setInterval(purge, 86_400_000).unref();

const server = app.listen(config.port, config.host, () => {
  console.log(tx(`INNLI draait op ${config.publicUrl}`, `INNLI is running at ${config.publicUrl}`));
  console.log(`  Dashboard:    ${config.publicUrl}/dashboard/`);
  console.log(`  MCP (agents): ${config.publicUrl}/mcp`);
  if (setupCode) console.log(tx(`\n  Eerste keer? Open het dashboard en gebruik installatiecode: ${setupCode}\n  (ook in ${resolve(codeFile)})\n`, `\n  First time? Open the dashboard and use installation code: ${setupCode}\n  (also in ${resolve(codeFile)})\n`));
  if (!mailer.enabled) console.log(tx('  E-mail staat uit (INNLI_SMTP_URL): aanvragen verschijnen alleen in het dashboard.', '  E-mail is off (INNLI_SMTP_URL): requests only appear in the dashboard.'));
  if (config.demo) console.log(tx('  Demomodus actief (demo-boekingssysteem op /demo-engine)', '  Sample mode on (demo booking system at /demo-engine)'));
});

const shutdown = () => {
  store.flush();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
