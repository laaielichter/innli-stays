import { getFactDefinition, isStale, readFact } from '../domain/facts.ts';
import type { FactMap, Property } from '../domain/types.ts';
import { factLabel } from '../i18n/facts.ts';
import { currentLang, t, type Lang } from '../i18n/index.ts';
import { displayFact } from '../readiness/jsonld.ts';
import type { Store } from '../store.ts';

/**
 * The answer agent: answers a guest's (or an agent's) question straight from
 * the host-confirmed passport and the host's published FAQ, in four languages.
 *
 * It never guesses. It only answers when every relevant fact is confirmed by
 * the host (or the host answered the same question before). Otherwise it says
 * what is known, what is not, and that the question should go to the host.
 * No language model is involved: the answer is traceable to its sources.
 */

/** Topics guests ask about, with words in Dutch, English, German and French (a trailing * matches word starts). */
const TOPICS: { words: string[]; facts: string[] }[] = [
  { words: ['hond*', 'huisdier*', 'dog*', 'pet', 'pets', 'puppy', 'hund*', 'haustier*', 'chien*', 'animal', 'animaux'], facts: ['pets.dogsAllowed', 'pets.maxDogs', 'pets.feePerDogPerNight', 'pets.rules'] },
  { words: ['tuin*', 'garden*', 'garten', 'jardin*', 'omheind*', 'afgesloten', 'fenced', 'enclosed', 'eingezaunt*', 'umzaunt*', 'clos', 'cloture*'], facts: ['garden.present', 'garden.fullyEnclosed', 'garden.shared'] },
  { words: ['ontbijt*', 'breakfast*', 'fruhstuck*', 'petit-dejeuner', 'petit dejeuner', 'vegetari*', 'vegan*', 'gluten*', 'lactose*', 'dieet*', 'diet*', 'allerg*', 'regime'], facts: ['breakfast.included', 'breakfast.available', 'breakfast.pricePerPerson', 'breakfast.times', 'breakfast.contents', 'breakfast.dietsOnRequest'] },
  { words: ['inchecken', 'check-in', 'checkin', 'check in', 'aankomst*', 'aankomen', 'arriv*', 'anreise', 'ankunft', 'ankommen', 'laat aan*', 'late arrival', 'spat*', 'tard'], facts: ['checkin.from', 'checkin.until'] },
  { words: ['uitchecken', 'check-out', 'checkout', 'check out', 'vertrek*', 'departure', 'leave', 'abreise', 'abfahrt', 'depart'], facts: ['checkout.until'] },
  { words: ['annuler*', 'cancel*', 'refund*', 'terugbetal*', 'storn*', 'annulation', 'annuler', 'rembours*'], facts: ['policy.cancellation'] },
  { words: ['minimum', 'minimaal', 'mindestaufenthalt', 'minimum stay', 'sejour minimum', 'minste nachten', 'one night', 'een nacht', 'eine nacht', 'une nuit'], facts: ['policy.minNights'] },
  { words: ['kind', 'kinderen', 'kids', 'child', 'children', 'baby', "baby's", 'kinder', 'enfant*', 'bebe', 'gezin', 'family', 'familie', 'famille'], facts: ['policy.childrenWelcome'] },
  { words: ['schoonmaak*', 'cleaning', 'reinigung', 'endreinigung', 'menage', 'extra kosten', 'bijkomende kosten', 'extra costs', 'additional costs', 'hidden', 'zusatzkosten', 'frais', 'toeristenbelasting', 'tourist tax', 'city tax', 'kurtaxe', 'ortstaxe', 'taxe de sejour', 'total price', 'totaalprijs'], facts: ['fees.cleaningPerStay', 'fees.touristTaxPerPersonPerNight', 'fees.touristTaxAppliesToChildren'] },
  { words: ['parkeer*', 'parkeren', 'parking', 'park', 'parkplatz', 'parken', 'auto', 'car', 'garage', 'stationnement', 'voiture'], facts: ['parking.onSite', 'parking.free'] },
  { words: ['rustig*', 'stil', 'stilte', 'lawaai*', 'geluid*', 'quiet', 'noise', 'noisy', 'peaceful', 'ruhig*', 'larm*', 'laut', 'calme', 'bruit*', 'silencieux'], facts: ['location.quiet', 'location.noiseSources', 'unit.noiseNotes'] },
  { words: ['rolstoel*', 'wheelchair*', 'rollstuhl*', 'fauteuil roulant', 'rollator', 'drempel*', 'threshold*', 'schwelle*', 'trap', 'trappen', 'treden', 'stair*', 'steps', 'stufe*', 'treppe*', 'marche*', 'escalier*', 'toegankelijk*', 'accessib*', 'barrierefrei*', 'mobility', 'mindervalide', 'handicap*', 'invalide', 'lift', 'elevator', 'aufzug', 'ascenseur'], facts: ['access.stepFreeEntrance', 'access.stepsToUnit', 'access.thresholdFree', 'access.doorWidthCm', 'unit.floor', 'bathroom.walkInShower', 'bathroom.grabBars'] },
  { words: ['begane grond', 'gelijkvloers', 'ground floor', 'ground-floor', 'verdieping', 'floor', 'erdgeschoss', 'etage', 'rez-de-chaussee', 'plain-pied'], facts: ['unit.floor'] },
  { words: ['douche*', 'shower*', 'dusche*', 'badkamer*', 'bathroom*', 'badezimmer', 'eigenes bad', 'salle de bain*', 'toilet*', 'wc', 'en-suite', 'ensuite'], facts: ['unit.privateBathroom', 'bathroom.walkInShower', 'bathroom.grabBars'] },
  { words: ['bed', 'bedden', 'beds', 'bedlengte', 'lang bed', 'long bed', 'langer bed', 'tall', 'lang ben', 'bett', 'betten', 'lit', 'lits', 'matras*', 'mattress*', 'matratze*', 'voetplank*', 'footboard*', 'kingsize', 'king size', 'queen'], facts: ['bed.lengthCm', 'bed.widthCm', 'bed.footboard'] },
  { words: ['ingang*', 'entrance*', 'eingang*', 'entree', 'eigen ingang', 'private entrance'], facts: ['unit.privateEntrance', 'access.stepFreeEntrance'] },
  { words: ['roken', 'rook*', 'gerookt', 'rookvrij', 'smok*', 'cigaret*', 'rauch*', 'fumer', 'fumeur*'], facts: ['rules.smokingAllowed'] },
  { words: ['feest*', 'party', 'parties', 'partys', 'fete*', 'vrijgezel*', 'bachelor*'], facts: ['rules.partiesAllowed', 'rules.quietHours'] },
  { words: ['stiltetijd*', 'quiet hours', 'nachtrust', 'ruhezeit*', 'heures de calme'], facts: ['rules.quietHours'] },
  { words: ['laadpaal*', 'opladen', 'elektrische auto', 'charging', 'charger', 'ev', 'tesla', 'ladestation*', 'laden', 'borne', 'recharge*'], facts: ['eco.evCharging'] },
  { words: ['duurzaam*', 'groen*', 'keurmerk*', 'zonnepane*', 'sustainab*', 'eco*', 'green key', 'solar', 'nachhaltig*', 'durable*', 'ecolo*'], facts: ['eco.label', 'eco.renewableEnergy'] },
  { words: ['zonder auto', 'openbaar vervoer', 'trein', 'bus', 'without a car', 'public transport', 'train', 'ohne auto', 'zug', 'sans voiture', 'transport en commun'], facts: ['eco.carFreeReachable'] },
  { words: ['direct boeken', 'book direct*', 'booking direct*', 'direkt buchen', 'direktbuchung', 'reserver en direct', 'voordeel', 'perk', 'korting', 'discount', 'rabatt', 'reduction'], facts: ['direct.perk'] },
];

const STOP = new Set('de het een en of is zijn er in op bij van voor met je jullie u we wij ik mag kan kunnen hebben heeft the a an and or is are there in on at of for with you we i can could do does have has der die das und oder ist sind es im am mit ich wir sie kann konnen haben hat le la les un une et ou est sont il y a dans sur avec pour vous nous je peut peux avez ont'.split(' '));

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matches(question: string, word: string): boolean {
  const w = norm(word);
  if (w.endsWith('*')) return new RegExp(`(^|[^a-z])${escape(w.slice(0, -1))}`).test(question);
  return new RegExp(`(^|[^a-z])${escape(w)}($|[^a-z])`).test(question);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const contentWords = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

export interface AnswerSource {
  type: 'fact' | 'faq';
  key?: string;
  label: string;
  value?: string;
  status: 'confirmed' | 'unconfirmed' | 'unknown';
  unit?: string;
  lastVerified?: string;
}

export interface AnswerResult {
  /** True only when the answer rests entirely on confirmed facts or an earlier host answer. */
  answered: boolean;
  answer: string;
  confidence: 'confirmed' | 'faq' | 'partial' | 'unknown';
  topics: string[];
  sources: AnswerSource[];
  /** Facts the guest asked about that are unknown: ask the host about these. */
  unknown: { key: string; label: string; unit?: string }[];
  next: string;
}

export class AnswerAgent {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  answer(property: Property, question: string, opts: { unitId?: string; lang?: Lang } = {}): AnswerResult {
    const lang = opts.lang ?? currentLang();
    const q = ` ${norm(question)} `;

    // 1. The host answered (nearly) the same question before and published it.
    const asked = contentWords(question);
    let bestFaq: { question: string; answer: string; score: number } | undefined;
    for (const f of this.store.questionsFor(property.id)) {
      if (f.status !== 'answered' || !f.publishAsFaq || !f.answer) continue;
      const words = contentWords(f.question);
      const overlap = [...asked].filter((w) => words.has(w)).length;
      const score = overlap / Math.max(1, Math.min(asked.size, words.size));
      if (overlap >= 2 && score >= 0.6 && (!bestFaq || score > bestFaq.score)) bestFaq = { question: f.question, answer: f.answer, score };
    }

    // 2. Passport facts for the topics the question is about.
    const topics = TOPICS.filter((topic) => topic.words.some((w) => matches(q, w)));
    const keys = [...new Set(topics.flatMap((topic) => topic.facts))];
    const units = opts.unitId ? property.units.filter((u) => u.id === opts.unitId) : property.units.filter((u) => matches(q, u.name)).length ? property.units.filter((u) => matches(q, u.name)) : property.units;
    const sources: AnswerSource[] = [];
    const unknown: AnswerResult['unknown'] = [];
    const visit = (facts: FactMap, key: string, unit?: string) => {
      const def = getFactDefinition(key);
      if (!def) return;
      const f = readFact(facts, key);
      const label = factLabel(key, lang);
      if (f.status === 'unknown' || f.value === null) {
        // Only decisive facts count as a gap; "no noise notes" is not a missing answer.
        if (def.critical) unknown.push({ key, label, unit });
        return;
      }
      sources.push({ type: 'fact', key, label, value: displayFact(key, f.value, property.currency, lang), status: f.status === 'confirmed' && !isStale(f) ? 'confirmed' : 'unconfirmed', unit, lastVerified: f.verifiedAt?.slice(0, 10) });
    };
    for (const key of keys) {
      if (getFactDefinition(key)?.scope === 'unit') for (const u of units) visit(u.facts, key, u.name);
      else visit(property.facts, key);
    }

    const lines: string[] = [];
    if (bestFaq) lines.push(t('ans.faq', { answer: bestFaq.answer }, lang));
    const confirmed = sources.filter((s) => s.status === 'confirmed');
    const unconfirmed = sources.filter((s) => s.status === 'unconfirmed');
    const line = (s: AnswerSource) => `- ${s.unit ? `${s.unit} – ` : ''}${s.label}: ${s.value}`;
    if (confirmed.length) lines.push(t('ans.confirmed', {}, lang), ...confirmed.map(line));
    if (unconfirmed.length) lines.push(t('ans.unconfirmed', {}, lang), ...unconfirmed.map(line));
    if (unknown.length) lines.push(t('ans.unknown', { list: unknown.map((u) => (u.unit ? `${u.unit} – ${u.label}` : u.label)).join('; ') }, lang));

    const faqSources: AnswerSource[] = bestFaq ? [{ type: 'faq', label: bestFaq.question, value: bestFaq.answer, status: 'confirmed' }] : [];
    const answered = Boolean(bestFaq) || (confirmed.length > 0 && unconfirmed.length === 0 && unknown.length === 0);
    const confidence: AnswerResult['confidence'] = bestFaq ? 'faq' : answered ? 'confirmed' : sources.length || bestFaq ? 'partial' : 'unknown';
    if (!lines.length) lines.push(t('ans.nothing', {}, lang));
    return {
      answered,
      answer: lines.join('\n'),
      confidence,
      topics: topics.map((topic) => topic.facts[0].split('.')[0]),
      sources: [...faqSources, ...sources],
      unknown,
      next: answered
        ? 'Answered from the host-confirmed passport. Tell the guest, and mention that these are the host’s own details. If the guest asked something more specific than these details (a size, a time, an exception), use ask_host for that part.'
        : unknown.length || unconfirmed.length
          ? 'Partly known. Present the confirmed details as fact, the unconfirmed ones as unverified, and use ask_host (with factKey) for what is unknown.'
          : 'No confirmed information about this. Use ask_host; never guess.',
    };
  }
}
