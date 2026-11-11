/**
 * What the reply guard knows per language: how a draft claims a booking, how
 * it hedges, how it names the facts a host may not have confirmed, and how a
 * guest says yes, no or cancel. Ten languages; anything else is read as
 * English.
 *
 * The patterns are deliberately one-sided. A word that makes a sentence
 * conditional ("once", "sobald", "一旦") always clears a booking claim, even
 * when a stricter reading would flag it: the guard should rather miss a
 * mistake than block an honest sentence.
 */

export const GUARD_LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ja', 'zh'] as const;
export type GuardLanguage = (typeof GUARD_LANGUAGES)[number];

/** Subjects a host states facts about, and that an agent may talk about in its own words. */
export type Concept = 'enclosed' | 'garden' | 'dogs' | 'breakfast' | 'parking' | 'charger' | 'stepfree' | 'shower' | 'bathroom' | 'groundfloor' | 'quiet' | 'wifi';

/** Which subject a passport fact or a search requirement is about. */
export const KEY_CONCEPT: Record<string, Concept> = {
  'garden.fullyEnclosed': 'enclosed',
  enclosed_garden: 'enclosed',
  'garden.present': 'garden',
  'pets.dogsAllowed': 'dogs',
  dogs_allowed: 'dogs',
  'breakfast.included': 'breakfast',
  breakfast_included: 'breakfast',
  'parking.onSite': 'parking',
  'parking.free': 'parking',
  parking_on_site: 'parking',
  'parking.evCharger': 'charger',
  ev_charging: 'charger',
  'access.stepFree': 'stepfree',
  'access.stepsToUnit': 'stepfree',
  step_free_access: 'stepfree',
  'bathroom.walkInShower': 'shower',
  walk_in_shower: 'shower',
  'unit.privateBathroom': 'bathroom',
  private_bathroom: 'bathroom',
  'unit.groundFloor': 'groundfloor',
  ground_floor_unit: 'groundfloor',
  'location.quiet': 'quiet',
  quiet_location: 'quiet',
  'wifi.available': 'wifi',
};

export interface LanguagePack {
  /** Sentences that say a booking exists. Regex sources. */
  claims: string[];
  /** Words that make a sentence a condition, a negation or a plan instead of a claim. */
  notClaim: string[];
  /** Ways to say "this is not certain". */
  hedge: string[];
  facts: Record<Concept, string[]>;
  /** Ways to say that a price is not the whole price. */
  incomplete: string[];
  nonRefundable: string[];
  /** "about", "roughly": a rounded figure that says so is fair. */
  roughly: string[];
  /** Month names, January first. Empty for languages that write dates in digits. */
  months: string[];
  yes: string[];
  no: string[];
  cancel: string[];
  /** Common short words, to recognise the language of a draft. */
  common: string[];
  /** No spaces between words: patterns match anywhere. */
  cjk?: boolean;
}

export const PACKS: Record<GuardLanguage, LanguagePack> = {
  en: {
    claims: [
      "(?:your|the|this|that|our)\\s+(?:stay|booking|room|reservation|trip|request)\\b[^.!?]{0,60}?\\b(?:is|are|has been|have been|was|'s)\\s+(?:now\\s+|all\\s+|fully\\s+)?(?:booked|confirmed|reserved|secured)",
      "(?:i|we)(?:'ve| have)?\\s+(?:just\\s+|now\\s+|successfully\\s+)?(?:booked|reserved|secured)",
      "you(?:'re| are)\\s+(?:all\\s+)?(?:booked|confirmed|set)",
      'booking\\s+(?:is\\s+)?(?:confirmed|complete|completed|done)',
      '^(?:booked|confirmed|all set|done)\\b[.!]',
      "it(?:'s| is)\\s+(?:booked|confirmed|reserved)",
    ],
    notClaim: ['not', "n't", 'never', 'yet', 'pending', 'once', 'when', 'if', 'until', 'unless', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'want', 'whether', 'awaiting', 'waiting', 'as soon as', 'after the host', 'to be confirmed'],
    hedge: ['not (?:been )?(?:recently )?confirmed', 'unconfirmed', 'unverified', 'not verified', "hasn't confirmed", 'has not confirmed', "haven't confirmed", 'did not confirm', "didn't confirm", "can't promise", 'cannot promise', "can't guarantee", 'cannot guarantee', 'not sure', 'unknown', "don't know", 'do not know', 'not stated', "hasn't said", 'has not said', 'not certain', 'listed', 'according to (?:the|their) (?:website|listing)', "i(?:'ll| will) ask", 'ask the host', 'check with the host', 'to be confirmed', 'may', 'might', 'possibly', 'apparently'],
    facts: {
      enclosed: ['enclosed', 'fenced', 'fence', 'escape-proof', 'secure garden'],
      garden: ['garden'],
      dogs: ['dogs are welcome', 'dog is welcome', 'dog-friendly', 'dog friendly', 'pet-friendly', 'pets allowed', 'dogs allowed', 'dogs are allowed'],
      breakfast: ['breakfast is included', 'breakfast included', 'includes breakfast', 'with breakfast'],
      parking: ['parking'],
      charger: ['charger', 'ev charging', 'charging point'],
      stepfree: ['step-free', 'step free', 'wheelchair', 'no steps', 'accessible', 'steps', 'stairs'],
      shower: ['walk-in shower', 'walk in shower'],
      bathroom: ['private bathroom', 'en-suite', 'ensuite'],
      groundfloor: ['ground floor', 'ground-floor'],
      quiet: ['quiet', 'peaceful'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['not all', 'may be higher', 'might be higher', 'could be higher', 'additional', 'extra (?:costs|charges|fees)', 'excluding', 'excl\\.', 'not included', 'plus (?:any|local|tourist)', 'incomplete'],
    nonRefundable: ['non[- ]?refundable', 'no refund', 'cannot be refunded', "can't be refunded", 'not refundable'],
    roughly: ['about', 'around', 'roughly', 'approximately', 'approx\\.?', 'some', 'nearly', 'almost', 'just (?:over|under)'],
    months: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    yes: ['yes', 'yeah', 'yep', 'sure', 'ok(?:ay)?', 'please do', 'go ahead', 'book it', 'do it', 'confirm', 'sounds good', "let's do it", 'perfect'],
    no: ['no', 'not yet', 'wait', 'hold on', "don't", 'do not', 'stop', 'let me think', 'maybe later'],
    cancel: ['cancel', 'withdraw', 'call it off', "don't want it", 'do not want it'],
    common: ['the', 'is', 'and', 'your', 'for', 'with', 'has', 'not', 'are', 'this', 'you', 'that', 'will', 'have', 'been', 'yet', 'still'],
  },
  nl: {
    claims: [
      '(?:je|jouw|uw|jullie|het|de)\\s+(?:verblijf|boeking|kamer|reservering|reis|aanvraag)\\b[^.!?]{0,60}?\\b(?:is|zijn)\\s+(?:nu\\s+|helemaal\\s+)?(?:geboekt|bevestigd|gereserveerd|rond|geregeld)',
      'ik\\s+heb\\b[^.!?]{0,50}?(?:geboekt|gereserveerd)',
      'boeking\\s+is\\s+(?:bevestigd|rond|gelukt|voltooid)',
      'het\\s+is\\s+(?:geboekt|bevestigd|geregeld)',
      '^(?:geboekt|bevestigd|geregeld)[.!]',
    ],
    notClaim: ['niet', 'nog niet', 'geen', 'zodra', 'als', 'wanneer', 'totdat', 'tot', 'pas', 'zal', 'zou', 'wil', 'kan', 'moet nog', 'in afwachting', 'wacht', 'nadat'],
    hedge: ['niet bevestigd', 'onbevestigd', 'niet geverifieerd', 'heeft[^.!?]{0,25}niet bevestigd', 'kan (?:ik|dat|het) niet (?:beloven|garanderen)', 'niet zeker', 'onbekend', 'weet (?:ik|het) niet', 'niet vermeld', 'staat vermeld', 'volgens de website', 'vraag ik na', 'navragen', 'mogelijk', 'misschien', 'wellicht'],
    facts: {
      enclosed: ['omheind', 'omheinde', 'afgesloten tuin', 'omheining', 'afgezet'],
      garden: ['tuin'],
      dogs: ['honden zijn welkom', 'hond is welkom', 'hondvriendelijk', 'honden toegestaan', 'honden zijn toegestaan', 'honden mogen'],
      breakfast: ['ontbijt is inbegrepen', 'ontbijt inbegrepen', 'inclusief ontbijt', 'met ontbijt'],
      parking: ['parkeren', 'parkeerplaats', 'parkeerplek'],
      charger: ['laadpaal', 'oplaadpunt', 'laadpunt'],
      stepfree: ['drempelloos', 'rolstoel', 'zonder treden', 'zonder trap', 'treden', 'trap'],
      shower: ['inloopdouche'],
      bathroom: ['eigen badkamer', 'privébadkamer'],
      groundfloor: ['begane grond', 'gelijkvloers'],
      quiet: ['rustig', 'rustige', 'stil', 'stille'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['niet alle', 'kan hoger', 'mogelijk hoger', 'bijkomende', 'extra kosten', 'exclusief', 'excl\\.', 'niet inbegrepen', 'onvolledig'],
    nonRefundable: ['niet[- ]restitueerbaar', 'geen restitutie', 'niet terugbetaald', 'geen geld terug', 'niet kosteloos', 'niet annuleerbaar'],
    roughly: ['ongeveer', 'circa', 'rond de', "zo'n", 'bijna', 'ruim', 'grofweg'],
    months: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
    yes: ['ja', 'graag', 'prima', 'boek maar', 'doe maar', 'akkoord', 'oké', 'ok', 'is goed'],
    no: ['nee', 'nog niet', 'wacht', 'even denken', 'misschien later', 'stop'],
    cancel: ['annuleer', 'annuleren', 'intrekken', 'afzeggen', 'trek[^.!?]{0,20}in'],
    common: ['het', 'een', 'je', 'niet', 'voor', 'van', 'uw', 'wordt', 'naar', 'maar', 'heeft', 'nog', 'ook', 'zijn', 'op', 'aan', 'komt', 'dat', 'ik', 'wil', 'dus', 'als', 'moet'],
  },
  de: {
    claims: [
      '(?:ihr|ihre|dein|deine|der|die|das|euer|eure)\\s+(?:aufenthalt|buchung|zimmer|reservierung|reise|anfrage)\\b[^.!?]{0,60}?\\b(?:ist|sind|wurde|wurden)\\s+(?:jetzt\\s+|nun\\s+|fest\\s+)?(?:gebucht|bestätigt|reserviert)',
      'ich\\s+habe\\b[^.!?]{0,50}?(?:gebucht|reserviert)',
      'buchung\\s+ist\\s+(?:bestätigt|abgeschlossen|erfolgt)',
      'es\\s+ist\\s+(?:gebucht|bestätigt|reserviert)',
      '^(?:gebucht|bestätigt|erledigt)[.!]',
    ],
    notClaim: ['nicht', 'noch nicht', 'kein', 'keine', 'sobald', 'wenn', 'falls', 'bis', 'erst', 'wird', 'würde', 'möchte', 'möchten', 'kann', 'ausstehend', 'wartet', 'nachdem'],
    hedge: ['nicht bestätigt', 'unbestätigt', 'nicht verifiziert', 'hat[^.!?]{0,25}nicht bestätigt', 'kann (?:ich|das) nicht (?:versprechen|garantieren)', 'nicht sicher', 'unbekannt', 'weiß (?:ich|es) nicht', 'nicht angegeben', 'laut (?:der )?website', 'aufgeführt', 'frage ich nach', 'nachfragen', 'möglicherweise', 'vielleicht', 'eventuell', 'angeblich'],
    facts: {
      enclosed: ['eingezäunt', 'eingezäunte', 'eingezäunten', 'umzäunt', 'zaun'],
      garden: ['garten'],
      dogs: ['hunde sind willkommen', 'hund ist willkommen', 'hundefreundlich', 'hunde erlaubt', 'hunde sind erlaubt'],
      breakfast: ['frühstück ist inklusive', 'inklusive frühstück', 'mit frühstück', 'frühstück inbegriffen', 'frühstück ist inbegriffen', 'frühstück inklusive'],
      parking: ['parkplatz', 'parkplätze', 'parken'],
      charger: ['ladestation', 'wallbox', 'ladesäule'],
      stepfree: ['stufenlos', 'barrierefrei', 'rollstuhl', 'ohne stufen', 'stufen', 'treppe'],
      shower: ['ebenerdige dusche', 'bodengleiche dusche'],
      bathroom: ['eigenes bad', 'privates bad', 'eigenes badezimmer'],
      groundfloor: ['erdgeschoss'],
      quiet: ['ruhig', 'ruhige', 'ruhigen'],
      wifi: ['wlan', 'wifi', 'wi-fi'],
    },
    incomplete: ['nicht alle', 'kann höher', 'könnte höher', 'zusätzliche', 'zusatzkosten', 'exklusive', 'zuzüglich', 'zzgl\\.', 'nicht enthalten', 'unvollständig'],
    nonRefundable: ['nicht erstattbar', 'nicht erstattungsfähig', 'keine erstattung', 'nicht stornierbar', 'nicht rückerstattbar'],
    roughly: ['etwa', 'ungefähr', 'circa', 'ca\\.', 'rund', 'knapp', 'fast'],
    months: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
    yes: ['ja', 'gerne', 'bitte buchen', 'buchen sie', 'buch es', 'einverstanden', 'in ordnung', 'okay', 'ok', 'passt'],
    no: ['nein', 'noch nicht', 'warte', 'warten sie', 'moment', 'überlegen', 'später'],
    cancel: ['stornier', 'absagen', 'zurückziehen'],
    common: ['der', 'das', 'und', 'ist', 'nicht', 'für', 'mit', 'ein', 'sie', 'ihr', 'ihre', 'wird', 'aber', 'hat', 'ich', 'noch', 'am', 'den', 'wurde', 'bitte', 'muss', 'kann', 'als'],
  },
  fr: {
    claims: [
      '(?:votre|ton|ta|le|la|notre)\\s+(?:séjour|réservation|chambre|voyage|demande)\\b[^.!?]{0,60}?(?:est|sont|a été)\\s+(?:maintenant\\s+|bien\\s+|désormais\\s+)?(?:réservée?|confirmée?)',
      "j'ai\\b[^.!?]{0,50}?réservé",
      '(?:la\\s+)?réservation\\s+(?:est\\s+)?(?:confirmée|terminée|effectuée)',
      "c'est\\s+(?:réservé|confirmé)",
      '^(?:réservé|confirmé)[.!]',
    ],
    notClaim: ['ne', "n'", 'pas', 'pas encore', 'aucun', 'aucune', 'dès que', 'une fois', 'si', 'quand', 'lorsque', "jusqu'", 'sera', 'serait', 'voulez', 'souhaitez', 'peut', 'en attente', 'après que'],
    hedge: ['pas (?:été )?confirmée?', 'non confirmée?', 'non vérifiée?', "n'a pas confirmé", 'ne peux pas (?:le |la )?(?:promettre|garantir)', 'pas sûre?', 'inconnue?', 'ne sais pas', 'non précisée?', 'indiquée?', 'selon le site', 'je (?:vais )?demander', 'peut-être', 'éventuellement', 'possiblement', 'apparemment'],
    facts: {
      enclosed: ['clos', 'clôturé', 'clôturée', 'clôture'],
      garden: ['jardin'],
      dogs: ['chiens sont les bienvenus', 'chien est le bienvenu', 'chiens acceptés', 'chiens admis', 'chiens sont acceptés', 'chiens sont admis'],
      breakfast: ['petit-déjeuner est inclus', 'petit-déjeuner inclus', 'petit déjeuner inclus', 'petit déjeuner est inclus', 'avec petit-déjeuner', 'avec petit déjeuner'],
      parking: ['parking', 'stationnement'],
      charger: ['borne de recharge'],
      stepfree: ['de plain-pied', 'sans marche', 'fauteuil roulant', 'accessible', 'marches', 'escalier'],
      shower: ["douche à l'italienne"],
      bathroom: ['salle de bain privée', 'salle de bains privée', 'salle de bain privative'],
      groundfloor: ['rez-de-chaussée'],
      quiet: ['calme', 'tranquille'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['pas tous', 'pas toutes', 'peut être plus élevé', 'pourrait être plus élevé', 'supplémentaires', 'hors taxe', 'non inclus', 'non compris', 'incomplet'],
    nonRefundable: ['non remboursable', 'aucun remboursement', 'pas remboursable'],
    roughly: ['environ', 'à peu près', 'près de', 'presque', 'autour de'],
    months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    yes: ['oui', "d'accord", 'allez-y', 'vas-y', 'réservez', 'réserve', 'parfait', 'ok', 'très bien'],
    no: ['non', 'pas encore', 'attendez', 'attends', 'réfléchir', 'plus tard'],
    cancel: ['annul'],
    common: ['le', 'les', 'et', 'est', 'pas', 'pour', 'vous', 'votre', 'une', 'des', 'avec', 'mais', 'je', 'ce', 'du', 'au', 'été', 'encore', 'comme', 'doit'],
  },
  es: {
    claims: [
      '(?:su|tu|la|el|nuestra)\\s+(?:estancia|reserva|habitación|viaje|solicitud)\\b[^.!?]{0,60}?(?:está|están|ha sido|queda)\\s+(?:ya\\s+)?(?:reservad[oa]|confirmad[oa])',
      'he\\s+reservado',
      '(?:la\\s+)?reserva\\s+(?:está\\s+)?(?:confirmada|completada|hecha)',
      'está\\s+(?:reservad[oa]|confirmad[oa])',
      '^(?:reservado|confirmado|listo)[.!]',
    ],
    notClaim: ['no', 'aún no', 'todavía no', 'ningún', 'ninguna', 'cuando', 'una vez', 'si', 'hasta', 'será', 'sería', 'quiere', 'quieres', 'puede', 'pendiente', 'en espera', 'después de que'],
    hedge: ['no (?:está |ha sido )?confirmad[oa]', 'sin confirmar', 'no verificad[oa]', 'no ha confirmado', 'no puedo (?:prometer|garantizar)', 'no (?:estoy )?segur[oa]', 'desconocid[oa]', 'no (?:lo )?sé', 'no (?:se )?indica', 'figura', 'según (?:la|su) web', 'preguntar[ée]?', 'quizás?', 'tal vez', 'posiblemente', 'al parecer'],
    facts: {
      enclosed: ['vallado', 'vallada', 'cercado', 'cercada', 'cerrado', 'valla'],
      garden: ['jardín'],
      dogs: ['perros son bienvenidos', 'se admiten perros', 'admite perros', 'perros permitidos', 'perros están permitidos'],
      breakfast: ['desayuno está incluido', 'desayuno incluido', 'incluye desayuno', 'con desayuno'],
      parking: ['aparcamiento', 'estacionamiento', 'parking'],
      charger: ['cargador', 'punto de carga'],
      stepfree: ['sin escalones', 'silla de ruedas', 'accesible', 'escalones', 'escaleras'],
      shower: ['ducha a ras de suelo', 'plato de ducha'],
      bathroom: ['baño privado'],
      groundfloor: ['planta baja'],
      quiet: ['tranquilo', 'tranquila', 'silencioso', 'silenciosa'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['no todos', 'puede ser (?:más alto|mayor)', 'podría ser (?:más alto|mayor)', 'adicionales', 'sin incluir', 'no incluid[oa]s?', 'excluid[oa]s?', 'incompleto'],
    nonRefundable: ['no reembolsable', 'sin reembolso', 'no se reembolsa'],
    roughly: ['unos', 'aproximadamente', 'alrededor de', 'cerca de', 'casi'],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    yes: ['sí', 'vale', 'de acuerdo', 'adelante', 'resérvalo', 'reserva', 'perfecto', 'ok', 'claro'],
    no: ['no', 'todavía no', 'aún no', 'espera', 'espere', 'pensarlo', 'más tarde'],
    cancel: ['cancel', 'cancél', 'anul'],
    common: ['el', 'los', 'y', 'para', 'su', 'con', 'está', 'pero', 'las', 'del', 'sido', 'usted', 'todavía', 'por', 'lo', 'así', 'como', 'tiene', 'aún'],
  },
  it: {
    claims: [
      '(?:il tuo|la tua|il suo|la sua|il vostro|la vostra|il|la)\\s+(?:soggiorno|prenotazione|camera|viaggio|richiesta)\\b[^.!?]{0,60}?(?:è|sono|è stat[oa])\\s+(?:ora\\s+|già\\s+)?(?:prenotat[oa]|confermat[oa])',
      'ho\\s+prenotato',
      '(?:la\\s+)?prenotazione\\s+(?:è\\s+)?(?:confermata|completata|effettuata)',
      'è\\s+(?:prenotat[oa]|confermat[oa])',
      '^(?:prenotato|confermato|fatto)[.!]',
    ],
    notClaim: ['non', 'non ancora', 'nessun', 'nessuna', 'quando', 'una volta', 'se', 'finché', 'fino a', 'sarà', 'sarebbe', 'vuoi', 'vuole', 'può', 'in attesa', 'dopo che', 'appena'],
    hedge: ['non (?:è stat[oa] )?confermat[oa]', 'non verificat[oa]', 'non ha confermato', 'non posso (?:promettere|garantire)', 'non (?:sono )?sicur[oa]', 'sconosciut[oa]', 'non lo so', 'non (?:è )?indicat[oa]', 'risulta', 'secondo il sito', 'chieder[òe]', 'forse', 'possibilmente', 'magari', 'a quanto pare'],
    facts: {
      enclosed: ['recintato', 'recintata', 'recinzione', 'chiuso'],
      garden: ['giardino'],
      dogs: ['cani sono benvenuti', 'cani ammessi', 'accetta cani', 'cani sono ammessi', 'cani sono i benvenuti'],
      breakfast: ['colazione è inclusa', 'colazione inclusa', 'include la colazione', 'con colazione'],
      parking: ['parcheggio'],
      charger: ['colonnina', 'ricarica'],
      stepfree: ['senza gradini', 'sedia a rotelle', 'accessibile', 'gradini', 'scale'],
      shower: ['doccia a filo pavimento', 'doccia walk-in'],
      bathroom: ['bagno privato'],
      groundfloor: ['piano terra'],
      quiet: ['tranquillo', 'tranquilla', 'silenzioso', 'silenziosa'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['non tutti', 'potrebbe essere (?:più alto|superiore)', 'può essere (?:più alto|superiore)', 'aggiuntiv[ie]', 'esclus[oaie]', 'non inclus[oaie]', 'incompleto'],
    nonRefundable: ['non rimborsabile', 'nessun rimborso', 'senza rimborso'],
    roughly: ['circa', "all'incirca", 'quasi', 'intorno a'],
    months: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
    yes: ['sì', 'va bene', "d'accordo", 'procedi', 'prenota', 'perfetto', 'ok', 'certo'],
    no: ['no', 'non ancora', 'aspetta', 'aspetti', 'pensarci', 'più tardi'],
    cancel: ['annull', 'cancell', 'disdic'],
    common: ['il', 'è', 'non', 'per', 'che', 'tuo', 'tua', 'sono', 'della', 'gli', 'ma', 'di', 'ancora', 'quindi', 'può', 'deve', 'stata', 'arrivi'],
  },
  pt: {
    claims: [
      '(?:a sua|a tua|o seu|o teu|a nossa|a|o)\\s+(?:estadia|estada|reserva|quarto|viagem|pedido)\\b[^.!?]{0,60}?(?:está|estão|foi|ficou)\\s+(?:já\\s+)?(?:reservad[oa]|confirmad[oa])',
      'reservei',
      '(?:a\\s+)?reserva\\s+(?:está\\s+)?(?:confirmada|concluída|feita)',
      'está\\s+(?:reservad[oa]|confirmad[oa])',
      '^(?:reservado|confirmado|feito)[.!]',
    ],
    notClaim: ['não', 'ainda não', 'nenhum', 'nenhuma', 'quando', 'assim que', 'uma vez', 'se', 'até', 'será', 'seria', 'quer', 'pode', 'pendente', 'a aguardar', 'aguardando', 'depois de'],
    hedge: ['não (?:está |foi )?confirmad[oa]', 'por confirmar', 'não verificad[oa]', 'não confirmou', 'não posso (?:prometer|garantir)', 'não (?:tenho )?certeza', 'desconhecid[oa]', 'não sei', 'não (?:está )?indicad[oa]', 'consta', 'segundo o site', 'perguntar', 'talvez', 'possivelmente', 'aparentemente'],
    facts: {
      enclosed: ['vedado', 'vedada', 'cercado', 'cercada', 'murado', 'vedação'],
      garden: ['jardim'],
      dogs: ['cães são bem-vindos', 'aceita cães', 'cães permitidos', 'cães são permitidos', 'cachorros são bem-vindos', 'aceita cachorros'],
      breakfast: ['pequeno-almoço está incluído', 'pequeno-almoço incluído', 'café da manhã incluído', 'café da manhã está incluído', 'inclui pequeno-almoço', 'inclui café da manhã'],
      parking: ['estacionamento'],
      charger: ['carregador', 'posto de carregamento'],
      stepfree: ['sem degraus', 'cadeira de rodas', 'acessível', 'degraus', 'escadas'],
      shower: ['duche ao nível do chão', 'chuveiro walk-in'],
      bathroom: ['casa de banho privativa', 'casa de banho privada', 'banheiro privativo'],
      groundfloor: ['rés-do-chão', 'térreo'],
      quiet: ['tranquilo', 'tranquila', 'sossegado', 'sossegada', 'calmo', 'calma'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['nem todos', 'pode ser (?:mais alto|superior)', 'poderá ser (?:mais alto|superior)', 'adicionais', 'excluind[oa]', 'não incluíd[oa]s?', 'incompleto'],
    nonRefundable: ['não reembolsável', 'sem reembolso', 'não é reembolsável'],
    roughly: ['cerca de', 'aproximadamente', 'por volta de', 'quase'],
    months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    yes: ['sim', 'pode', 'de acordo', 'avance', 'reserve', 'reserva', 'perfeito', 'ok', 'está bem', 'claro'],
    no: ['não', 'ainda não', 'espere', 'espera', 'pensar', 'mais tarde'],
    cancel: ['cancel', 'anul'],
    common: ['os', 'não', 'um', 'uma', 'com', 'sua', 'seu', 'mas', 'do', 'da', 'ainda', 'tem', 'isso', 'foi', 'é', 'chega', 'pode', 'por isso'],
  },
  pl: {
    claims: [
      '(?:pobyt|rezerwacja|pokój|podróż|prośba)\\b[^.!?]{0,60}?(?:jest|został|została|zostały)\\s+(?:już\\s+)?(?:zarezerwowan[yae]|potwierdzon[yae])',
      'zarezerwował(?:em|am)',
      'rezerwacja\\s+(?:jest\\s+)?(?:potwierdzona|zakończona|dokonana)',
      '^(?:zarezerwowane|potwierdzone|gotowe)[.!]',
    ],
    notClaim: ['nie', 'jeszcze nie', 'żaden', 'żadna', 'gdy', 'kiedy', 'jak tylko', 'jeśli', 'dopóki', 'będzie', 'byłby', 'chcesz', 'może', 'oczekuje', 'w oczekiwaniu', 'po tym jak'],
    hedge: ['nie (?:został[ao]? )?potwierdzon[yae]', 'niepotwierdzon[yae]', 'niezweryfikowan[yae]', 'nie potwierdziła?', 'nie mogę (?:obiecać|zagwarantować)', 'nie (?:jestem )?pew(?:ien|na)', 'nieznan[yae]', 'nie wiem', 'nie podano', 'według strony', 'zapytam', 'zapytać', 'być może', 'możliwe', 'prawdopodobnie', 'podobno'],
    facts: {
      enclosed: ['ogrodzony', 'ogrodzona', 'ogrodzenie', 'ogrodzonym'],
      garden: ['ogród', 'ogrodu', 'ogrodem'],
      dogs: ['psy są mile widziane', 'psy mile widziane', 'akceptuje psy', 'psy dozwolone', 'psy są dozwolone'],
      breakfast: ['śniadanie jest wliczone', 'śniadanie wliczone', 'ze śniadaniem', 'śniadanie w cenie'],
      parking: ['parking'],
      charger: ['ładowarka', 'stacja ładowania'],
      stepfree: ['bez schodów', 'wózek inwalidzki', 'bez progów', 'schody', 'schodów'],
      shower: ['prysznic bez brodzika'],
      bathroom: ['prywatna łazienka', 'własna łazienka'],
      groundfloor: ['parter', 'parterze'],
      quiet: ['cichy', 'cicha', 'spokojny', 'spokojna'],
      wifi: ['wifi', 'wi-fi'],
    },
    incomplete: ['nie wszystkie', 'może być wyższ[ay]', 'dodatkowe', 'nie obejmuje', 'niepełn[ay]', 'bez podatku'],
    nonRefundable: ['bezzwrotn[yae]', 'bez zwrotu', 'nie podlega zwrotowi'],
    roughly: ['około', 'mniej więcej', 'prawie', 'blisko'],
    months: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
    yes: ['tak', 'dobrze', 'zgoda', 'proszę zarezerwować', 'rezerwuj', 'zarezerwuj', 'ok', 'w porządku'],
    no: ['nie', 'jeszcze nie', 'poczekaj', 'zaczekaj', 'zastanowię', 'później'],
    cancel: ['anuluj', 'anulować', 'odwołaj', 'wycofaj'],
    common: ['w', 'na', 'jest', 'się', 'do', 'że', 'to', 'dla', 'został', 'została', 'ale', 'przez', 'nie', 'jeszcze', 'proszę', 'tak', 'za', 'więc', 'tego'],
  },
  ja: {
    cjk: true,
    claims: ['予約(?:が|は)?(?:確定|完了|成立)', 'ご予約(?:が|は)?(?:確定|完了)', '予約(?:いた)?しました', '確定(?:いた)?しました', '予約できました', '予約済み'],
    notClaim: ['まだ', 'ません', 'ない', '次第', 'したら', 'すれば', '場合', '予定', 'でしょうか', '待ち', '保留', '仮', '後に'],
    hedge: ['未確認', '確認(?:され|でき|が取れ)ていません', '確認していません', '保証(?:は)?できません', '約束(?:は)?できません', '不明', 'わかりません', '分かりません', '記載(?:は)?(?:あり|され)ません', 'ウェブサイトによると', '記載されていますが', '問い合わせ', 'かもしれません', '可能性'],
    facts: {
      enclosed: ['囲まれ', 'フェンス', '柵'],
      garden: ['庭'],
      dogs: ['犬同伴可', '犬可', 'ペット可', '犬歓迎', '犬連れ'],
      breakfast: ['朝食付き', '朝食込み', '朝食が含まれ'],
      parking: ['駐車場'],
      charger: ['充電器', '充電スタンド', 'EV充電'],
      stepfree: ['段差なし', 'バリアフリー', '車椅子', '階段'],
      shower: ['ウォークインシャワー'],
      bathroom: ['専用バスルーム', '専用バス'],
      groundfloor: ['1階', '一階'],
      quiet: ['静か', '閑静'],
      wifi: ['wifi', 'wi-fi', 'ワイファイ'],
    },
    incomplete: ['含まれ(?:てい)?ません', '高くなる可能性', '追加(?:料金|費用)', '別途', '含まれていない'],
    nonRefundable: ['返金不可', '払い戻し不可', '返金できません', '返金されません'],
    roughly: ['約', 'およそ', 'ほぼ', '程度', '前後'],
    months: [],
    yes: ['はい', 'お願いします', '予約して', 'それで', 'ok', '大丈夫です'],
    no: ['いいえ', 'まだ', '待って', '考え', '後で'],
    cancel: ['キャンセル', '取り消'],
    common: [],
  },
  zh: {
    cjk: true,
    claims: ['(?:住宿|预订|预定|房间|行程)?已(?:经)?(?:预订|预定|确认|订好)', '(?:预订|预定)(?:已)?(?:成功|完成)', '已为您(?:预订|预定)', '订好了', '预订成功'],
    notClaim: ['尚未', '还没', '未', '没有', '不', '一旦', '如果', '等待', '待确认', '待房东', '将', '之后', '是否', '才'],
    hedge: ['未(?:经)?(?:确认|核实|验证)', '尚未确认', '没有确认', '无法(?:保证|承诺)', '不能(?:保证|承诺)', '不确定', '未知', '不清楚', '不知道', '未(?:说明|注明)', '据网站', '网站上(?:显示|列出)', '询问房东', '可能', '也许', '或许'],
    facts: {
      enclosed: ['封闭', '围栏', '围起来', '全封闭'],
      garden: ['花园', '院子'],
      dogs: ['欢迎狗', '可带狗', '允许带狗', '允许宠物', '宠物友好', '可携带宠物', '可以带狗'],
      breakfast: ['含早餐', '包含早餐', '包早餐', '早餐已包含'],
      parking: ['停车'],
      charger: ['充电桩'],
      stepfree: ['无台阶', '无障碍', '轮椅', '台阶', '楼梯'],
      shower: ['步入式淋浴'],
      bathroom: ['独立卫浴', '私人浴室', '独立浴室'],
      groundfloor: ['一楼', '底层'],
      quiet: ['安静', '幽静'],
      wifi: ['wifi', 'wi-fi', '无线网络'],
    },
    incomplete: ['并非全部', '未包含(?:全部|所有)', '可能(?:会)?更高', '额外(?:费用)?', '另付', '不含', '不包括'],
    nonRefundable: ['不可退款', '不可退', '不退款', '无法退款'],
    roughly: ['约', '大约', '左右', '将近', '大概'],
    months: [],
    yes: ['好的', '好', '可以', '行', '订吧', '预订吧', '确认', '没问题', '是的'],
    no: ['不', '还没', '等一下', '等等', '考虑', '再说', '稍后'],
    cancel: ['取消', '撤回'],
    common: [],
  },
};

/** One pattern from a list of alternatives. Words do not match inside longer words, except in languages without spaces. */
export function anyOf(alternatives: string[], cjk = false): RegExp {
  const body = alternatives.join('|');
  return cjk ? new RegExp(`(?:${body})`, 'iu') : new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]');
/** The same for literal words and phrases (fact words). */
export function anyWord(words: string[], cjk = false): RegExp {
  return anyOf(words.map(escape), cjk);
}

/** Which of the ten languages a text is written in. Anything unclear is read as English. */
export function detectLanguage(text: string): GuardLanguage {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  const words = text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  if (!words.length) return 'en';
  let best: GuardLanguage = 'en';
  let bestScore = 0;
  for (const lang of GUARD_LANGUAGES) {
    const common = new Set(PACKS[lang].common);
    if (!common.size) continue;
    const score = words.reduce((n, w) => n + (common.has(w) ? 1 : 0), 0) / words.length;
    // English wins a tie: it is the default.
    if (score > bestScore + (lang === 'en' ? -0.0001 : 0.0001)) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 0.08 ? best : 'en';
}
