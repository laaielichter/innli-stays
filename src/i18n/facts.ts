import { getFactDefinition } from '../domain/facts.ts';
import type { Lang } from './index.ts';

type Tr = { en: string; de: string; fr: string };

/** Fact labels for guests, agents and the English dashboard. Dutch lives in the fact catalog itself. */
const LABELS: Record<string, Tr> = {
  'pets.dogsAllowed': { en: 'Dogs allowed', de: 'Hunde erlaubt', fr: 'Chiens admis' },
  'pets.maxDogs': { en: 'Maximum number of dogs', de: 'Höchstzahl Hunde', fr: 'Nombre maximum de chiens' },
  'pets.feePerDogPerNight': { en: 'Fee per dog per night', de: 'Gebühr pro Hund und Nacht', fr: 'Supplément par chien et par nuit' },
  'pets.rules': { en: 'House rules for dogs', de: 'Hausregeln für Hunde', fr: 'Règles pour les chiens' },
  'garden.present': { en: 'Garden', de: 'Garten', fr: 'Jardin' },
  'garden.fullyEnclosed': { en: 'Fully enclosed garden', de: 'Vollständig eingezäunter Garten', fr: 'Jardin entièrement clos' },
  'garden.shared': { en: 'Garden shared with other guests/hosts', de: 'Garten mit anderen Gästen/Gastgebern geteilt', fr: "Jardin partagé avec d'autres hôtes" },
  'breakfast.included': { en: 'Breakfast included in the price', de: 'Frühstück im Preis inbegriffen', fr: 'Petit-déjeuner inclus' },
  'breakfast.available': { en: 'Breakfast available', de: 'Frühstück erhältlich', fr: 'Petit-déjeuner disponible' },
  'breakfast.pricePerPerson': { en: 'Breakfast price per person per day (if not included)', de: 'Frühstückspreis pro Person und Tag (falls nicht inbegriffen)', fr: 'Prix du petit-déjeuner par personne et par jour (si non inclus)' },
  'breakfast.times': { en: 'Breakfast times', de: 'Frühstückszeiten', fr: 'Horaires du petit-déjeuner' },
  'breakfast.contents': { en: 'What breakfast includes', de: 'Was zum Frühstück gehört', fr: 'Composition du petit-déjeuner' },
  'breakfast.dietsOnRequest': { en: 'Dietary options (confirm in advance)', de: 'Ernährungswünsche (vorab bestätigen)', fr: 'Régimes alimentaires (à confirmer à l’avance)' },
  'checkin.from': { en: 'Check-in from', de: 'Check-in ab', fr: 'Arrivée à partir de' },
  'checkin.until': { en: 'Check-in until', de: 'Check-in bis', fr: "Arrivée jusqu'à" },
  'checkout.until': { en: 'Check-out by', de: 'Check-out bis', fr: 'Départ avant' },
  'policy.cancellation': { en: 'Cancellation policy', de: 'Stornobedingungen', fr: "Conditions d'annulation" },
  'policy.minNights': { en: 'Minimum number of nights', de: 'Mindestanzahl Nächte', fr: 'Nombre minimum de nuits' },
  'policy.childrenWelcome': { en: 'Children welcome', de: 'Kinder willkommen', fr: 'Enfants bienvenus' },
  'fees.cleaningPerStay': { en: 'Cleaning fee per stay', de: 'Endreinigung pro Aufenthalt', fr: 'Frais de ménage par séjour' },
  'fees.touristTaxPerPersonPerNight': { en: 'Tourist tax per person per night', de: 'Kurtaxe pro Person und Nacht', fr: 'Taxe de séjour par personne et par nuit' },
  'fees.touristTaxAppliesToChildren': { en: 'Tourist tax also for children', de: 'Kurtaxe auch für Kinder', fr: 'Taxe de séjour aussi pour les enfants' },
  'direct.perk': { en: 'Perk for booking direct', de: 'Vorteil bei Direktbuchung', fr: 'Avantage en réservant en direct' },
  'location.quiet': { en: 'Quiet location', de: 'Ruhige Lage', fr: 'Emplacement calme' },
  'location.noiseSources': { en: 'Known noise sources', de: 'Bekannte Lärmquellen', fr: 'Sources de bruit connues' },
  'parking.onSite': { en: 'Parking on site', de: 'Parkplatz auf dem Grundstück', fr: 'Parking sur place' },
  'parking.free': { en: 'Free parking', de: 'Kostenloses Parken', fr: 'Parking gratuit' },
  'rules.smokingAllowed': { en: 'Smoking allowed indoors', de: 'Rauchen im Haus erlaubt', fr: 'Fumer autorisé à l’intérieur' },
  'rules.partiesAllowed': { en: 'Parties allowed', de: 'Partys erlaubt', fr: 'Fêtes autorisées' },
  'rules.quietHours': { en: 'Quiet hours', de: 'Ruhezeiten', fr: 'Heures de calme' },
  'rules.minAge': { en: 'Minimum age of the person booking', de: 'Mindestalter der buchenden Person', fr: 'Âge minimum de la personne qui réserve' },
  'rules.other': { en: 'Other house rules', de: 'Weitere Hausregeln', fr: 'Autres règles de la maison' },
  'eco.label': { en: 'Sustainability label', de: 'Nachhaltigkeitssiegel', fr: 'Label de durabilité' },
  'eco.renewableEnergy': { en: 'Green electricity or own solar panels', de: 'Ökostrom oder eigene Solaranlage', fr: 'Électricité verte ou panneaux solaires' },
  'eco.evCharging': { en: 'EV charging point', de: 'Ladestation für E-Autos', fr: 'Borne de recharge pour voiture électrique' },
  'eco.carFreeReachable': { en: 'Easy to reach without a car', de: 'Gut ohne Auto erreichbar', fr: 'Facile d’accès sans voiture' },
  'access.stepFreeEntrance': { en: 'Step-free main entrance', de: 'Stufenloser Haupteingang', fr: 'Entrée principale de plain-pied' },
  'unit.floor': { en: 'Floor (0 = ground floor)', de: 'Etage (0 = Erdgeschoss)', fr: 'Étage (0 = rez-de-chaussée)' },
  'unit.privateBathroom': { en: 'Private bathroom', de: 'Eigenes Bad', fr: 'Salle de bains privée' },
  'unit.privateEntrance': { en: 'Private entrance', de: 'Eigener Eingang', fr: 'Entrée privée' },
  'unit.noiseNotes': { en: 'Noise (room location, shared areas)', de: 'Geräusche (Lage des Zimmers, Gemeinschaftsräume)', fr: 'Bruit (emplacement, espaces communs)' },
  'bed.lengthCm': { en: 'Bed length', de: 'Bettlänge', fr: 'Longueur du lit' },
  'bed.widthCm': { en: 'Bed width', de: 'Bettbreite', fr: 'Largeur du lit' },
  'bed.footboard': { en: 'Bed has a footboard', de: 'Bett mit Fußteil', fr: 'Lit avec pied de lit' },
  'access.stepsToUnit': { en: 'Steps to the room', de: 'Stufen bis zum Zimmer', fr: "Marches jusqu'à la chambre" },
  'access.thresholdFree': { en: 'No thresholds in the room', de: 'Schwellenlos im Zimmer', fr: 'Sans seuil dans la chambre' },
  'access.doorWidthCm': { en: 'Narrowest door width', de: 'Schmalste Türbreite', fr: 'Largeur de porte la plus étroite' },
  'bathroom.walkInShower': { en: 'Walk-in shower without step', de: 'Bodengleiche Dusche', fr: 'Douche à l’italienne sans marche' },
  'bathroom.grabBars': { en: 'Grab bars in bathroom', de: 'Haltegriffe im Bad', fr: 'Barres d’appui dans la salle de bains' },
};

const CATEGORIES: Record<string, Tr> = {
  Huisdieren: { en: 'Pets', de: 'Haustiere', fr: 'Animaux' },
  Buitenruimte: { en: 'Outdoor space', de: 'Außenbereich', fr: 'Extérieur' },
  Ontbijt: { en: 'Breakfast', de: 'Frühstück', fr: 'Petit-déjeuner' },
  'Aankomst & vertrek': { en: 'Arrival & departure', de: 'An- & Abreise', fr: 'Arrivée & départ' },
  Voorwaarden: { en: 'Conditions', de: 'Bedingungen', fr: 'Conditions' },
  'Verplichte kosten': { en: 'Mandatory costs', de: 'Pflichtkosten', fr: 'Frais obligatoires' },
  'Direct boeken': { en: 'Booking direct', de: 'Direkt buchen', fr: 'Réserver en direct' },
  Ligging: { en: 'Location', de: 'Lage', fr: 'Emplacement' },
  Toegankelijkheid: { en: 'Accessibility', de: 'Barrierefreiheit', fr: 'Accessibilité' },
  Kamer: { en: 'Room', de: 'Zimmer', fr: 'Chambre' },
  Huisregels: { en: 'House rules', de: 'Hausregeln', fr: 'Règles de la maison' },
  Duurzaamheid: { en: 'Sustainability', de: 'Nachhaltigkeit', fr: 'Durabilité' },
  Bed: { en: 'Bed', de: 'Bett', fr: 'Lit' },
};

const HINTS_EN: Record<string, string> = {
  'pets.feePerDogPerNight': 'Enter 0 if there is no fee.',
  'garden.fullyEnclosed': 'A photo of a garden is no proof: only confirm when the garden is closed all round, including the gate.',
  'breakfast.dietsOnRequest': 'E.g. vegetarian, gluten-free, lactose-free. Always shown as "confirm in advance".',
  'fees.cleaningPerStay': 'Enter 0 if there is no cleaning fee.',
  'direct.perk': 'E.g. free late check-out, a welcome bottle or 5% below booking sites. Agents mention this to guests.',
  'location.noiseSources': 'Honesty pays: guests looking for quiet read this.',
  'rules.quietHours': 'E.g. 22:00-07:00.',
  'eco.label': 'Only a label you really hold, e.g. Green Key or EU Ecolabel.',
};

export function factLabel(key: string, lang: Lang): string {
  if (lang === 'nl') return getFactDefinition(key)?.label ?? key;
  return LABELS[key]?.[lang] ?? getFactDefinition(key)?.label ?? key;
}

export function factCategory(category: string, lang: Lang): string {
  return lang === 'nl' ? category : (CATEGORIES[category]?.[lang] ?? category);
}

export function factHint(key: string, lang: Lang): string | undefined {
  const nl = getFactDefinition(key)?.hint;
  return lang === 'nl' ? nl : (HINTS_EN[key] ?? nl);
}
