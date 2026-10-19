import type { Fetcher } from '../connectors/availability.ts';
import { getFactDefinition, readFact } from '../domain/facts.ts';
import { extractFromHtml } from './extract.ts';
import type { Property } from '../domain/types.ts';
import { extractJsonLd, extractLinks, extractTitle, htmlLang, jsonLdTypes, metaContent, visibleText } from './html.ts';
import { AI_CRAWLERS, crawlerExplanation, isAllowed, parseRobots, type Robots } from './robots.ts';
import { factLabel } from '../i18n/facts.ts';
import { currentLang, type Lang } from '../i18n/index.ts';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface AuditCheck {
  id: string;
  category: 'crawlers' | 'indexing' | 'structured_data' | 'content' | 'consistency';
  status: CheckStatus;
  title: string;
  detail: string;
  advice?: string;
}

export interface AuditReport {
  url: string;
  checkedAt: string;
  summary: Record<CheckStatus, number>;
  checks: AuditCheck[];
  crawlers: { userAgent: string; operator: string; purpose: string; allowed: boolean; rule?: string; explanation: string }[];
  disclaimer: string;
}

const LODGING_TYPES = ['LodgingBusiness', 'BedAndBreakfast', 'Hotel', 'Motel', 'Hostel', 'Resort', 'VacationRental', 'Campground', 'GuestHouse'];
const ROOM_LINK_RE = /\b(kamers?|rooms?|suites?|appartements?|appartementen|apartments?|studio|accommodatie|accommodation|verblijf|verblijven|lodges?|huisjes?|cottages?|zimmer|ferienwohnung(en)?|chambres?|camere|habitaciones)\b/i;
const UA = 'Mozilla/5.0 (compatible; INNLI-Audit/0.1; +https://innli.nl/audit)';

const DISCLAIMER = {
  nl: 'Deze controle kijkt naar technische toegankelijkheid en kwaliteit van je gegevens. Zoekmachines en AI-assistenten bepalen zelf wat ze tonen: opname of ranking is nooit gegarandeerd. Google geeft aan dat voor AI Overviews en AI Mode de gewone SEO-basisprincipes gelden; er is geen speciaal AI-bestand nodig.',
  en: 'This check looks at technical accessibility and the quality of your data. Search engines and AI assistants decide for themselves what they show: inclusion or ranking is never guaranteed. Google states that ordinary SEO fundamentals apply to AI Overviews and AI Mode; no special AI file is needed.',
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function get(fetcher: Fetcher, url: string): Promise<{ status: number; text: string; headers: Headers } | null> {
  try {
    const res = await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    return { status: res.status, text: await res.text(), headers: res.headers };
  } catch {
    return null;
  }
}

/** Website check for AI search and agent readiness. Never promises rankings. */
export async function auditWebsite(url: string, property: Property | null, fetcher: Fetcher = fetch, lang: Lang = currentLang()): Promise<AuditReport> {
  const nl = lang === 'nl';
  const tx = (dutch: string, english: string) => (nl ? dutch : english);
  const checks: AuditCheck[] = [];
  const add = (c: AuditCheck) => checks.push(c);
  const base = new URL(url);

  // robots.txt
  const robotsRes = await get(fetcher, new URL('/robots.txt', base).toString());
  let robots: Robots = { groups: [], sitemaps: [] };
  if (!robotsRes || robotsRes.status >= 500) {
    add({ id: 'robots.reachable', category: 'crawlers', status: 'warn', title: tx('robots.txt niet bereikbaar', 'robots.txt not reachable'), detail: tx('Bij een serverfout op robots.txt stellen sommige crawlers het bezoek uit.', 'When robots.txt returns a server error, some crawlers postpone their visit.'), advice: tx('Controleer of /robots.txt een 200 of 404 teruggeeft.', 'Check that /robots.txt returns 200 or 404.') });
  } else if (robotsRes.status === 200) {
    robots = parseRobots(robotsRes.text);
    add({ id: 'robots.reachable', category: 'crawlers', status: 'pass', title: tx('robots.txt gevonden', 'robots.txt found'), detail: tx(`${robots.groups.length} regelgroep(en).`, `${robots.groups.length} rule group(s).`) });
  } else {
    add({ id: 'robots.reachable', category: 'crawlers', status: 'info', title: tx('Geen robots.txt', 'No robots.txt'), detail: tx('Zonder robots.txt mogen alle crawlers alles bezoeken.', 'Without robots.txt all crawlers may visit everything.') });
  }

  const path = base.pathname || '/';
  const crawlers = AI_CRAWLERS.map((c) => {
    const r = isAllowed(robots, c.userAgent, path);
    return { userAgent: c.userAgent, operator: c.operator, purpose: c.purpose, allowed: r.allowed, rule: r.rule, explanation: crawlerExplanation(c, lang) };
  });
  const blockedSearch = crawlers.filter((c) => c.purpose !== 'training' && !c.allowed);
  const blockedTraining = crawlers.filter((c) => c.purpose === 'training' && !c.allowed);
  add(
    blockedSearch.length
      ? { id: 'robots.search', category: 'crawlers', status: 'fail', title: tx('Zoekcrawlers geblokkeerd', 'Search crawlers blocked'), detail: `${tx('Geblokkeerd', 'Blocked')}: ${blockedSearch.map((c) => `${c.userAgent} (${c.explanation})`).join('; ')}.`, advice: tx('Sta deze crawlers toe in robots.txt. Dit staat los van modeltraining: je kunt zoeken toestaan en training blokkeren. De INNLI-plugin kan dit voor je instellen.', 'Allow these crawlers in robots.txt. This is separate from model training: you can allow search and block training. The INNLI plugin can set this up for you.') }
      : { id: 'robots.search', category: 'crawlers', status: 'pass', title: tx('Zoekcrawlers toegestaan', 'Search crawlers allowed'), detail: tx('Google, Bing, OAI-SearchBot, Claude-SearchBot en PerplexityBot mogen je site bezoeken.', 'Google, Bing, OAI-SearchBot, Claude-SearchBot and PerplexityBot may visit your site.') },
  );
  add({
    id: 'robots.training',
    category: 'crawlers',
    status: 'info',
    title: blockedTraining.length ? tx('Trainingscrawlers geblokkeerd', 'Training crawlers blocked') : tx('Trainingscrawlers toegestaan', 'Training crawlers allowed'),
    detail: blockedTraining.length ? `${tx('Geblokkeerd', 'Blocked')}: ${blockedTraining.map((c) => c.userAgent).join(', ')}.` : tx('GPTBot, ClaudeBot, Google-Extended en CCBot zijn niet geblokkeerd.', 'GPTBot, ClaudeBot, Google-Extended and CCBot are not blocked.'),
    advice: tx('Dit is jouw keuze. Het blokkeren van trainingscrawlers heeft geen invloed op zoekresultaten in ChatGPT, Claude of Google.', 'This is your choice. Blocking training crawlers does not affect search results in ChatGPT, Claude or Google.'),
  });

  // Homepage
  const page = await get(fetcher, url);
  if (!page || page.status !== 200) {
    add({ id: 'page.reachable', category: 'indexing', status: 'fail', title: tx('Pagina niet bereikbaar', 'Page not reachable'), detail: page ? `HTTP ${page.status}` : tx('Geen verbinding mogelijk.', 'Could not connect.') });
    return finish(url, checks, crawlers, lang);
  }
  const html = page.text;
  const text = visibleText(html);
  const ntext = norm(text);
  add({ id: 'page.https', category: 'indexing', status: base.protocol === 'https:' ? 'pass' : 'warn', title: base.protocol === 'https:' ? tx('HTTPS actief', 'HTTPS active') : tx('Geen HTTPS', 'No HTTPS'), detail: base.protocol === 'https:' ? tx('De site gebruikt een beveiligde verbinding.', 'The site uses a secure connection.') : tx('Zonder HTTPS waarschuwen browsers bezoekers.', 'Without HTTPS, browsers warn visitors.'), advice: base.protocol === 'https:' ? undefined : tx('Activeer een SSL-certificaat bij je hostingpartij.', 'Enable an SSL certificate with your hosting provider.') });

  const robotsMeta = `${metaContent(html, 'robots') ?? ''} ${page.headers.get('x-robots-tag') ?? ''}`.toLowerCase();
  add(
    robotsMeta.includes('noindex')
      ? { id: 'page.noindex', category: 'indexing', status: 'fail', title: tx('Pagina staat op noindex', 'Page is set to noindex'), detail: tx('Zoekmachines mogen deze pagina niet opnemen.', 'Search engines may not include this page.'), advice: tx('Verwijder "noindex" (in WordPress: Instellingen → Lezen → "Zoekmachines ontmoedigen" uitzetten).', 'Remove "noindex" (in WordPress: Settings → Reading → untick "Discourage search engines").') }
      : { id: 'page.noindex', category: 'indexing', status: 'pass', title: tx('Pagina mag geïndexeerd worden', 'Page may be indexed'), detail: tx('Geen noindex gevonden.', 'No noindex found.') },
  );
  const title = extractTitle(html);
  add(title ? { id: 'page.title', category: 'indexing', status: 'pass', title: tx('Paginatitel aanwezig', 'Page title present'), detail: title } : { id: 'page.title', category: 'indexing', status: 'fail', title: tx('Geen paginatitel', 'No page title'), detail: tx('De pagina heeft geen <title>.', 'The page has no <title>.'), advice: tx('Gebruik de naam van je accommodatie en de plaats, bijv. "B&B De Hooiberg – Ede, Veluwe".', 'Use the name of your accommodation and the place, e.g. "Seaview House – Dingle, Kerry".') });
  const desc = metaContent(html, 'description');
  add(desc ? { id: 'page.description', category: 'indexing', status: 'pass', title: tx('Metabeschrijving aanwezig', 'Meta description present'), detail: desc.slice(0, 160) } : { id: 'page.description', category: 'indexing', status: 'warn', title: tx('Geen metabeschrijving', 'No meta description'), detail: tx('Zoekmachines kiezen dan zelf een tekstfragment.', 'Search engines will then pick a text snippet themselves.'), advice: tx('Schrijf 1–2 zinnen met wat je verblijf bijzonder maakt.', 'Write 1–2 sentences on what makes your stay special.') });
  if (!htmlLang(html)) add({ id: 'page.lang', category: 'indexing', status: 'warn', title: tx('Taal niet ingesteld', 'Language not set'), detail: tx('Het <html>-element heeft geen lang-attribuut.', 'The <html> element has no lang attribute.'), advice: tx('Stel de taal van de site in (bijv. lang="nl").', 'Set the language of the site (e.g. lang="en").') });

  const sitemapListed = robots.sitemaps.length > 0;
  const sitemap = sitemapListed ? null : await get(fetcher, new URL('/sitemap.xml', base).toString());
  const hasSitemap = sitemapListed || (sitemap?.status === 200 && /<(urlset|sitemapindex)\b/.test(sitemap.text));
  add(hasSitemap ? { id: 'page.sitemap', category: 'indexing', status: 'pass', title: tx('Sitemap gevonden', 'Sitemap found'), detail: sitemapListed ? robots.sitemaps.join(', ') : '/sitemap.xml' } : { id: 'page.sitemap', category: 'indexing', status: 'warn', title: tx('Geen sitemap gevonden', 'No sitemap found'), detail: tx('Een sitemap helpt zoekmachines alle kamerpagina\'s te vinden.', 'A sitemap helps search engines find all room pages.'), advice: tx('WordPress maakt standaard /wp-sitemap.xml; vermeld die in robots.txt.', 'WordPress creates /wp-sitemap.xml by default; list it in robots.txt.') });

  // Content
  const links = extractLinks(html, url).filter((l) => new URL(l.href).host === base.host);
  const roomLinks = links.filter((l) => ROOM_LINK_RE.test(l.text) || ROOM_LINK_RE.test(new URL(l.href).pathname));
  add(roomLinks.length ? { id: 'content.rooms', category: 'content', status: 'pass', title: tx('Kamerpagina\'s gelinkt', 'Room pages linked'), detail: tx(`${new Set(roomLinks.map((l) => l.href)).size} link(s) naar kamers of verblijven.`, `${new Set(roomLinks.map((l) => l.href)).size} link(s) to rooms or units.`) } : { id: 'content.rooms', category: 'content', status: 'warn', title: tx('Geen kamerpagina\'s gevonden', 'No room pages found'), detail: tx('Er zijn geen duidelijke links naar kamers of verblijven.', 'There are no clear links to rooms or units.'), advice: tx('Geef iedere kamer een eigen pagina met bedmaten, ligging, badkamer en prijs vanaf.', 'Give every room its own page with bed sizes, location, bathroom and a "from" price.') });
  add(/(€|£|\$|CHF|kr|zł|Kč|Ft|lei)\s?\d|\d\s?(€|£|CHF|kr|zł|Kč|Ft|lei)/.test(text) ? { id: 'content.prices', category: 'content', status: 'pass', title: tx('Prijzen zichtbaar', 'Prices visible'), detail: tx('Er staan bedragen op de pagina.', 'The page shows amounts.') } : { id: 'content.prices', category: 'content', status: 'warn', title: tx('Geen prijzen zichtbaar', 'No prices visible'), detail: tx('Bezoekers en agents zien geen prijsindicatie.', 'Visitors and agents see no price indication.'), advice: tx('Toon minimaal een "vanaf"-prijs en alle verplichte toeslagen.', 'Show at least a "from" price and all mandatory fees.') });
  const policyHits = ['annuler', 'voorwaarden', 'inchecken', 'check-in', 'huisregels', 'cancel', 'terms', 'house rules', 'storn', 'hausordnung', 'annulation', 'arrivee', 'reglement'].filter((w) => ntext.includes(w));
  add(policyHits.length >= 2 ? { id: 'content.policies', category: 'content', status: 'pass', title: tx('Voorwaarden vindbaar', 'Conditions findable'), detail: `${tx('Gevonden', 'Found')}: ${policyHits.join(', ')}.` } : { id: 'content.policies', category: 'content', status: 'warn', title: tx('Voorwaarden niet duidelijk vindbaar', 'Conditions not clearly findable'), detail: tx('Annulering, inchecktijden of huisregels zijn niet duidelijk zichtbaar.', 'Cancellation, check-in times or house rules are not clearly visible.'), advice: tx('Maak een pagina met annuleringsvoorwaarden, in- en uitchecktijden en huisregels, en link ernaar.', 'Create a page with the cancellation policy, check-in and check-out times and house rules, and link to it.') });

  // Structured data
  const { items, errors } = extractJsonLd(html);
  if (errors) add({ id: 'sd.parse', category: 'structured_data', status: 'fail', title: tx('Ongeldige gestructureerde gegevens', 'Invalid structured data'), detail: tx(`${errors} JSON-LD-blok(ken) bevatten fouten.`, `${errors} JSON-LD block(s) contain errors.`), advice: tx('Controleer met de Rich Results Test van Google.', "Check with Google's Rich Results Test.") });
  const lodging = items.find((i) => jsonLdTypes(i).some((t) => LODGING_TYPES.includes(t)));
  if (!lodging) {
    add({ id: 'sd.lodging', category: 'structured_data', status: 'warn', title: tx('Geen accommodatiegegevens (schema.org)', 'No accommodation data (schema.org)'), detail: tx('Er is geen LodgingBusiness of BedAndBreakfast in JSON-LD gevonden.', 'No LodgingBusiness or BedAndBreakfast found in JSON-LD.'), advice: tx('De INNLI-plugin voegt dit toe op basis van je bevestigde gegevens. Niet verplicht voor AI-zoeken, wel nuttig voor consistentie.', 'The INNLI plugin adds this from your confirmed facts. Not required for AI search, but useful for consistency.') });
  } else {
    add({ id: 'sd.lodging', category: 'structured_data', status: 'pass', title: tx('Accommodatiegegevens (schema.org) aanwezig', 'Accommodation data (schema.org) present'), detail: `Type: ${jsonLdTypes(lodging).join(', ')}` });
    const sdName = typeof lodging.name === 'string' ? lodging.name : null;
    if (sdName && !ntext.includes(norm(sdName))) {
      add({ id: 'sd.visible', category: 'structured_data', status: 'warn', title: tx('Gestructureerde naam niet zichtbaar op pagina', 'Structured name not visible on the page'), detail: tx(`"${sdName}" staat in de gestructureerde gegevens maar niet in de zichtbare tekst.`, `"${sdName}" is in the structured data but not in the visible text.`), advice: tx('Gestructureerde gegevens moeten overeenkomen met wat bezoekers zien.', 'Structured data must match what visitors see.') });
    }
    const pets = lodging.petsAllowed;
    if (property && typeof pets === 'boolean') {
      const fact = readFact(property.facts, 'pets.dogsAllowed');
      if (fact.status === 'confirmed' && fact.value !== pets) add({ id: 'sd.pets', category: 'consistency', status: 'fail', title: tx('Tegenstrijdige huisdierinformatie', 'Contradicting pet information'), detail: tx(`Gestructureerde gegevens: petsAllowed=${pets}; jouw paspoort: ${fact.value ? 'honden toegestaan' : 'geen honden'}.`, `Structured data: petsAllowed=${pets}; your passport: ${fact.value ? 'dogs allowed' : 'no dogs'}.`), advice: tx('Pas de website aan of laat de INNLI-plugin de gestructureerde gegevens beheren.', 'Update the website or let the INNLI plugin manage the structured data.') });
    }
  }

  // Consistency with the passport
  if (property) {
    if (!ntext.includes(norm(property.name))) add({ id: 'consistency.name', category: 'consistency', status: 'warn', title: tx('Naam niet gevonden op de pagina', 'Name not found on the page'), detail: tx(`"${property.name}" komt niet voor in de zichtbare tekst.`, `"${property.name}" does not appear in the visible text.`), advice: tx('Gebruik overal dezelfde naam als in je paspoort en op boekingsplatforms.', 'Use the same name everywhere as in your passport and on booking platforms.') });
    else add({ id: 'consistency.name', category: 'consistency', status: 'pass', title: tx('Naam consistent', 'Name consistent'), detail: tx(`"${property.name}" staat op de pagina.`, `"${property.name}" is on the page.`) });
    const postal = property.address.postalCode?.replace(/\s/g, '').toLowerCase();
    if (postal) {
      const found = text.replace(/\s/g, '').toLowerCase().includes(postal);
      add(found ? { id: 'consistency.address', category: 'consistency', status: 'pass', title: tx('Adres zichtbaar', 'Address visible'), detail: tx('De postcode staat op de pagina.', 'The postcode is on the page.') } : { id: 'consistency.address', category: 'consistency', status: 'warn', title: tx('Adres niet zichtbaar', 'Address not visible'), detail: tx('De postcode uit je paspoort staat niet op deze pagina.', 'The postcode from your passport is not on this page.'), advice: tx('Zet je volledige adres in de footer of op de contactpagina.', 'Put your full address in the footer or on the contact page.') });
    }
    // Website text versus confirmed passport facts. Agents cross-check sources and drop
    // the property (not the OTA) when they disagree.
    const COMPARED = ['checkin.from', 'checkout.until', 'breakfast.included', 'fees.touristTaxPerPersonPerNight', 'fees.cleaningPerStay', 'pets.feePerDogPerNight', 'pets.maxDogs', 'policy.minNights'];
    const fmt = (v: unknown) => (typeof v === 'boolean' ? (v ? tx('ja', 'yes') : tx('nee', 'no')) : String(v));
    let agreeing = 0;
    for (const sug of extractFromHtml(html).suggestions) {
      if (!COMPARED.includes(sug.key)) continue;
      const fact = readFact(property.facts, sug.key);
      if (fact.status !== 'confirmed' || fact.value === null) continue;
      if (fact.value === sug.value) {
        agreeing++;
        continue;
      }
      const label = getFactDefinition(sug.key) ? factLabel(sug.key, lang) : sug.key;
      add({
        id: `consistency.${sug.key}`,
        category: 'consistency',
        status: 'fail',
        title: `${tx('Tegenstrijdig', 'Contradiction')}: ${label}`,
        detail: `Website: ${fmt(sug.value)} ("${sug.evidence.slice(0, 120)}") · ${tx('paspoort', 'passport')}: ${fmt(fact.value)}.`,
        advice: tx('AI-agents vergelijken bronnen en laten je vallen als ze elkaar tegenspreken. Maak website, paspoort en je vermeldingen op boekingssites gelijk.', 'AI agents compare sources and drop you when they contradict each other. Make your website, passport and booking-site listings say the same.'),
      });
    }
    if (agreeing) add({ id: 'consistency.facts', category: 'consistency', status: 'pass', title: tx('Website en paspoort komen overeen', 'Website and passport agree'), detail: tx(`${agreeing} gegeven(s) op je website kloppen met je paspoort.`, `${agreeing} fact(s) on your website match your passport.`) });

    const dogs = readFact(property.facts, 'pets.dogsAllowed');
    const sayNoDogs = /\b(geen (honden|huisdieren)|no (pets|dogs)|keine (hunde|haustiere)|(chiens|animaux) non admis|pas d'animaux)\b/i.test(text);
    const sayDogs = /\b(honden?|huisdieren) (zijn )?(van harte )?(welkom|toegestaan)|hondvriendelijk|dog[- ]friendly|dogs (are )?welcome|pets (are )?welcome|hunde (sind )?willkommen|hundefreundlich|chiens (sont )?(les )?bienvenus|animaux (sont )?acceptés\b/i.test(text);
    if (dogs.status === 'confirmed' && ((dogs.value === true && sayNoDogs) || (dogs.value === false && sayDogs))) {
      add({ id: 'consistency.dogs', category: 'consistency', status: 'fail', title: tx('Website en paspoort spreken elkaar tegen over honden', 'Website and passport contradict each other about dogs'), detail: tx(`Paspoort: ${dogs.value ? 'honden toegestaan' : 'geen honden'}; de website zegt het tegendeel.`, `Passport: ${dogs.value ? 'dogs allowed' : 'no dogs'}; the website says the opposite.`), advice: tx('Agents en gasten haken af bij tegenstrijdige informatie. Pas één van beide aan.', 'Agents and guests drop out on contradicting information. Change one of the two.') });
    }
  }

  return finish(url, checks, crawlers, lang);
}

function finish(url: string, checks: AuditCheck[], crawlers: AuditReport['crawlers'], lang: Lang): AuditReport {
  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) summary[c.status]++;
  return { url, checkedAt: new Date().toISOString(), summary, checks, crawlers, disclaimer: lang === 'nl' ? DISCLAIMER.nl : DISCLAIMER.en };
}
