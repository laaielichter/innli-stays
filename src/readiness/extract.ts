import { visibleText } from './html.ts';

export interface FactSuggestion {
  key: string;
  value: boolean | number | string | string[];
  evidence: string;
}

export interface UnitHint {
  topic: 'ground_floor' | 'bed_length' | 'walk_in_shower' | 'private_bathroom';
  evidence: string;
  value?: number;
}

export interface ExtractionResult {
  suggestions: FactSuggestion[];
  /** Mentions that belong to a specific room; the owner must say which one. */
  unitHints: UnitHint[];
}

const num = (s: string) => Number(s.replace(',', '.'));
const WORD_NUMBERS: Record<string, number> = { een: 1, één: 1, twee: 2, drie: 3, one: 1, two: 2, three: 3, ein: 1, einen: 1, zwei: 2, drei: 3, un: 1, deux: 2, trois: 3 };
const time = (s: string) => s.replace(/[.h]/, ':').padStart(5, '0');
/** The first captured number in a match (amounts may be written before or after the currency). */
const firstNum = (m: RegExpExecArray) => num(m.slice(1).find((g) => g !== undefined && /\d/.test(g)) ?? 'NaN');

// An amount in any of the usual notations: € 7,50 · £7.50 · 7,50 € · 7.50 EUR · CHF 8 · 30 kr
const AMOUNT = String.raw`(?:(?:[€£$]|CHF|EUR|GBP|Fr\.)\s?(\d+(?:[.,]\d{1,2})?)|(?<![\d.,])(\d+(?:[.,]\d{1,2})?)\s?(?:[€£]|CHF|EUR|GBP|euros?|kr|zł|Kč))`;
const re = (source: string, flags = 'i') => new RegExp(source, flags);

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1, index - 80);
  let end = text.indexOf('\n', index + length);
  if (end < 0 || end > index + length + 120) end = Math.min(text.length, index + length + 120);
  return text.slice(start, end).trim();
}

interface Pattern {
  key: string;
  re: RegExp;
  value: (m: RegExpExecArray) => FactSuggestion['value'] | null;
}

// Dutch, English, German and French. Negative patterns come before positive
// ones for the same key: the first match per key wins.
const PATTERNS: Pattern[] = [
  { key: 'pets.dogsAllowed', re: /\b(geen (honden|huisdieren)|(honden|huisdieren) (zijn )?niet toegestaan|no (pets|dogs)( allowed)?|(pets|dogs) (are )?not allowed|keine (hunde|haustiere)|(hunde|haustiere) (sind )?nicht erlaubt|(chiens|animaux) (ne sont )?(pas |non )?(admis|acceptés)|pas d'animaux)\b/i, value: () => false },
  { key: 'pets.dogsAllowed', re: /\b((honden?|huisdieren) (zijn )?(van harte |ook )?(welkom|toegestaan)|hondvriendelijk|dogs? (are )?(very )?welcome|pets? (are )?welcome|pet[- ]friendly|dog[- ]friendly|hunde (sind )?(herzlich )?willkommen|hundefreundlich|haustiere erlaubt|chiens? (sont )?(les )?(bienvenus|acceptés|admis)|animaux (sont )?(acceptés|admis|bienvenus))\b/i, value: () => true },
  { key: 'pets.maxDogs', re: /\b(?:max(?:imaal|imum|imal|\.)?|höchstens|up to|jusqu'à)\s+(\d|één|een|twee|drie|one|two|three|ein|einen|zwei|drei|un|deux|trois)\s+(honden|hond|huisdieren|dogs?|pets?|hunde?|haustiere|chiens?|animaux)\b/i, value: (m) => WORD_NUMBERS[m[1].toLowerCase()] ?? num(m[1]) },
  { key: 'pets.feePerDogPerNight', re: re(String.raw`${AMOUNT}\s*(?:per|p\/|pro|par)\s*(?:hond|huisdier|dog|pet|hund|haustier|chien|animal)\s*(?:per|p\/|pro|par|a|\/)\s*(?:nacht|night|nuit)`), value: firstNum },
  { key: 'garden.fullyEnclosed', re: /\b((volledig |helemaal )?(omheinde|afgesloten|omsloten|afgeschermde) tuin|tuin is (volledig |helemaal )?(omheind|afgesloten)|(fully )?(fenced|enclosed|walled|secure) garden|garden is (fully )?(fenced|enclosed)|(vollständig )?(eingezäunter|umzäunter|eingefriedeter) garten|garten ist (vollständig )?(eingezäunt|umzäunt)|jardin (entièrement )?(clos|clôturé))\b/i, value: () => true },
  { key: 'garden.present', re: /\b(tuin|garden|garten|jardin)\b/i, value: () => true },
  { key: 'breakfast.included', re: /\b(inclusief ontbijt|ontbijt (is )?inbegrepen|incl\.? ontbijt|breakfast (is )?included|including breakfast|bed (&|and) breakfast rate|frühstück (ist )?inklusive|inklusive frühstück|inkl\.? frühstück|petit[- ]déjeuner (est )?(inclus|compris))\b/i, value: () => true },
  { key: 'breakfast.available', re: /\b(ontbijt|breakfast|frühstück|petit[- ]déjeuner)\b/i, value: () => true },
  { key: 'breakfast.pricePerPerson', re: re(String.raw`(?:ontbijt|breakfast|frühstück|petit[- ]déjeuner)[^\n€£]{0,40}?${AMOUNT}\s*(?:per|p\.?\s?p\.?|p\/p|pro|par|a)`), value: firstNum },
  { key: 'breakfast.times', re: /(?:ontbijt|breakfast|frühstück|petit[- ]déjeuner)[^\n]{0,40}?(?:van|tussen|vanaf|from|between|served|von|zwischen|ab|de|entre)\s*(\d{1,2}[:.h]\d{2})\s*(?:tot|en|-|–|to|and|until|bis|und|à|et)\s*(\d{1,2}[:.h]\d{2})/i, value: (m) => `${time(m[1])}-${time(m[2])}` },
  { key: 'checkin.from', re: /\b(?:inchecken|aankomst|check-?in|anreise|arrivée)\b[^\n]{0,20}?(?:vanaf|tussen|from|after|ab|von|à partir de|dès|entre)\s*(\d{1,2}[:.h]\d{2})/i, value: (m) => time(m[1]) },
  { key: 'checkout.until', re: /\b(?:uitchecken|vertrek|check-?out|abreise|départ)\b[^\n]{0,20}?(?:voor|tot|uiterlijk|before|by|until|bis|vor|avant|jusqu'à)\s*(\d{1,2}[:.h]\d{2})/i, value: (m) => time(m[1]) },
  { key: 'fees.touristTaxPerPersonPerNight', re: re(String.raw`(?:toeristenbelasting|tourist tax|city tax|kurtaxe|kurbeitrag|gästetaxe|ortstaxe|taxe de séjour|tassa di soggiorno)[^\n€£]{0,40}?${AMOUNT}`), value: firstNum },
  { key: 'fees.cleaningPerStay', re: re(String.raw`(?:schoonmaak(?:kosten)?|cleaning(?: fee)?|endreinigung|reinigungsgebühr|frais de ménage)[^\n€£]{0,30}?${AMOUNT}`), value: firstNum },
  { key: 'parking.onSite', re: /\b(parkeren op (eigen )?terrein|eigen parkeerplaats|parkeerplaats bij|(free )?parking on site|on-site parking|private parking|parkplatz am haus|eigener parkplatz|parking privé|parking sur place)\b/i, value: () => true },
  { key: 'parking.free', re: /\b(gratis parkeren|parkeren is gratis|free parking|kostenlose[rs]? park(en|platz)|parking gratuit)\b/i, value: () => true },
  { key: 'policy.minNights', re: /\bminimaal\s+(\d)\s+nachten\b|\bminimum (?:stay )?(?:of )?(\d) nights\b|\bmindestens\s+(\d)\s+nächte\b|\bmindestaufenthalt:?\s+(\d)\s+nächte\b|\bminimum\s+(\d)\s+nuits\b/i, value: firstNum },
  { key: 'policy.childrenWelcome', re: /\b(kinderen (zijn )?(van harte )?welkom|children (are )?welcome|kindvriendelijk|family[- ]friendly|kinder (sind )?(herzlich )?willkommen|kinderfreundlich|enfants (sont )?(les )?bienvenus)\b/i, value: () => true },
  { key: 'location.quiet', re: /\b(rustig gelegen|rustige ligging|in alle rust|quiet location|peaceful|ruhige lage|ruhig gelegen|au calme|endroit calme)\b/i, value: () => true },
  { key: 'policy.cancellation', re: /\b(kosteloos annuleren|gratis annuleren|annulering|annuleringsvoorwaarden|cancellation|free cancellation|stornierung|stornobedingungen|kostenlos stornierbar|annulation)\b/i, value: () => null },
];

/**
 * Turns website text into a draft passport. Everything here is a suggestion:
 * the owner confirms or corrects it in the dashboard. Text is evidence; a
 * photo or a vague word like "dog-friendly" is not proof of an enclosed garden.
 */
export function extractFromHtml(html: string): ExtractionResult {
  const text = visibleText(html);
  const suggestions: FactSuggestion[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    if (seen.has(p.key)) continue;
    const m = p.re.exec(text);
    if (!m) continue;
    const evidence = snippet(text, m.index, m[0].length);
    let value = p.value(m);
    if (p.key === 'policy.cancellation') value = evidence.slice(0, 400);
    if (value === null || (typeof value === 'number' && !Number.isFinite(value))) continue;
    suggestions.push({ key: p.key, value, evidence });
    seen.add(p.key);
  }
  // If dogs are not allowed, a pet fee or max-dogs mention is noise.
  if (suggestions.some((s) => s.key === 'pets.dogsAllowed' && s.value === false)) {
    for (let i = suggestions.length - 1; i >= 0; i--) if (['pets.maxDogs', 'pets.feePerDogPerNight'].includes(suggestions[i].key)) suggestions.splice(i, 1);
  }
  if (suggestions.some((s) => s.key === 'breakfast.included' && s.value === true)) {
    const idx = suggestions.findIndex((s) => s.key === 'breakfast.pricePerPerson');
    if (idx >= 0) suggestions.splice(idx, 1);
  }

  const unitHints: UnitHint[] = [];
  const hint = (topic: UnitHint['topic'], re: RegExp, value?: (m: RegExpExecArray) => number) => {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
      unitHints.push({ topic, evidence: snippet(text, m.index ?? 0, m[0].length), value: value?.(m as RegExpExecArray) });
      if (unitHints.filter((h) => h.topic === topic).length >= 3) break;
    }
  };
  hint('ground_floor', /\b(begane grond|gelijkvloers|ground floor|ground-floor|erdgeschoss|ebenerdig|rez-de-chaussée|plain-pied)\b/i);
  hint('bed_length', /\b(\d{3})\s?(?:cm|centimeter|zentimeter)\s?(?:lang|lengte|long|länge)\b|\b(?:bedlengte|bed length|bettlänge|longueur du lit)\s?(?:van\s|of\s|von\s|de\s)?(\d{3})/i, (m) => num(m[1] ?? m[2]));
  hint('walk_in_shower', /\b(inloopdouche|walk-in shower|bodengleiche dusche|douche à l'italienne)\b/i);
  hint('private_bathroom', /\b(eigen badkamer|privé[- ]badkamer|private bathroom|en-suite|ensuite|eigenes bad(ezimmer)?|salle de bains privée)\b/i);

  return { suggestions, unitHints };
}
