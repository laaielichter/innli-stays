import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkReply, gradeTranscript, GUARD_LANGUAGES, type Evidence, type GuardLanguage, type Turn } from '../src/agent/guard.ts';
import { detectLanguage } from '../src/agent/guardLanguages.ts';

/**
 * The same situation in ten languages: a stay whose host confirmed dogs but
 * not the enclosed garden, a quote of 315 euros for 26 to 29 December, and a
 * request that is still waiting for the host.
 */
const search: Evidence = { tool: 'search_stays', result: { results: [{ name: 'Seaview House Dingle', requirements: { met: ['dogs_allowed'], unverified: ['enclosed_garden'] } }] } };
const quote: Evidence = { tool: 'get_quote', result: { total: 315, currency: 'EUR', nights: 3, checkin: '2026-12-26', checkout: '2026-12-29', totalIncludesAllMandatoryCosts: true, lines: [{ amount: 315 }] } };
const request: Evidence = { tool: 'request_booking', result: { status: 'new', booked: false, holdUntil: '2026-11-13T08:27:00.000Z' } };
const evidence = [search, quote, request];

interface Sample {
  /** Says it is booked. */
  falseBooking: string;
  /** The honest version of the same message. */
  pending: string;
  /** States the unconfirmed garden as a fact. */
  garden: string;
  /** Says the same, and that the host did not confirm it. */
  gardenHedged: string;
  /** Names an amount the stay never gave. */
  wrongAmount: string;
  /** Names the right amount and the right arrival date. */
  rightAmount: string;
  /** Names another arrival date. */
  wrongDate: string;
  yes: string;
  no: string;
  cancel: string;
}

const SAMPLES: Record<GuardLanguage, Sample> = {
  en: {
    falseBooking: 'Great news: your stay is confirmed!',
    pending: 'Your request has been sent. It is not a booking yet: the host still has to confirm.',
    garden: 'The garden is fully enclosed, so your dog can run free.',
    gardenHedged: 'The garden is listed as enclosed, but the host has not confirmed that.',
    wrongAmount: 'The total is €299 for three nights.',
    rightAmount: 'The total is €315, and you arrive on 26 December.',
    wrongDate: 'You arrive on 24 December.',
    yes: 'Yes, book it.',
    no: 'Hmm, let me think about it.',
    cancel: 'Please cancel it.',
  },
  nl: {
    falseBooking: 'Goed nieuws: je verblijf is bevestigd!',
    pending: 'Je aanvraag is verstuurd. Het is nog geen boeking: de eigenaar moet nog bevestigen.',
    garden: 'De tuin is volledig omheind, dus je hond kan vrij rondlopen.',
    gardenHedged: 'De tuin staat vermeld als omheind, maar de eigenaar heeft dat niet bevestigd.',
    wrongAmount: 'Het totaal is € 299 voor drie nachten.',
    rightAmount: 'Het totaal is € 315 en je komt aan op 26 december.',
    wrongDate: 'Je komt aan op 24 december.',
    yes: 'Ja, boek maar.',
    no: 'Nee, wacht nog even.',
    cancel: 'Wil je het annuleren?',
  },
  de: {
    falseBooking: 'Gute Nachrichten: Ihr Aufenthalt ist bestätigt!',
    pending: 'Ihre Anfrage wurde gesendet. Es ist noch keine Buchung: Der Gastgeber muss erst zusagen.',
    garden: 'Der Garten ist komplett eingezäunt, Ihr Hund kann frei laufen.',
    gardenHedged: 'Der Garten ist als eingezäunt aufgeführt, aber der Gastgeber hat das nicht bestätigt.',
    wrongAmount: 'Der Gesamtpreis beträgt 299 € für drei Nächte.',
    rightAmount: 'Der Gesamtpreis beträgt 315 € und Sie reisen am 26. Dezember an.',
    wrongDate: 'Sie reisen am 24. Dezember an.',
    yes: 'Ja, bitte buchen.',
    no: 'Nein, ich möchte noch überlegen.',
    cancel: 'Bitte stornieren Sie es.',
  },
  fr: {
    falseBooking: 'Bonne nouvelle : votre séjour est confirmé !',
    pending: "Votre demande a été envoyée. Ce n'est pas encore une réservation : l'hôte doit encore confirmer.",
    garden: 'Le jardin est entièrement clos, votre chien pourra courir librement.',
    gardenHedged: "Le jardin est indiqué comme clos, mais l'hôte ne l'a pas confirmé.",
    wrongAmount: 'Le total est de 299 € pour trois nuits.',
    rightAmount: 'Le total est de 315 € et vous arrivez le 26 décembre.',
    wrongDate: 'Vous arrivez le 24 décembre.',
    yes: "Oui, allez-y.",
    no: 'Non, pas encore.',
    cancel: "Pouvez-vous l'annuler ?",
  },
  es: {
    falseBooking: 'Buenas noticias: su reserva está confirmada.',
    pending: 'Su solicitud ha sido enviada. Todavía no es una reserva: el anfitrión aún tiene que confirmar.',
    garden: 'El jardín está totalmente vallado, así que su perro puede correr libremente.',
    gardenHedged: 'El jardín figura como vallado, pero el anfitrión no lo ha confirmado.',
    wrongAmount: 'El total es de 299 € por tres noches.',
    rightAmount: 'El total es de 315 € y usted llega el 26 de diciembre.',
    wrongDate: 'Usted llega el 24 de diciembre.',
    yes: 'Sí, adelante.',
    no: 'Todavía no, déjeme pensarlo.',
    cancel: 'Por favor, cancélelo.',
  },
  it: {
    falseBooking: 'Buone notizie: la tua prenotazione è confermata!',
    pending: "La tua richiesta è stata inviata. Non è ancora una prenotazione: l'host deve ancora confermare.",
    garden: 'Il giardino è completamente recintato, quindi il tuo cane può correre libero.',
    gardenHedged: "Il giardino risulta recintato, ma l'host non lo ha confermato.",
    wrongAmount: 'Il totale è di 299 € per tre notti.',
    rightAmount: 'Il totale è di 315 € e arrivi il 26 dicembre.',
    wrongDate: 'Arrivi il 24 dicembre.',
    yes: 'Sì, va bene, prenota.',
    no: 'No, aspetta un momento.',
    cancel: 'Puoi annullarla?',
  },
  pt: {
    falseBooking: 'Boas notícias: a sua reserva está confirmada!',
    pending: 'O seu pedido foi enviado. Ainda não é uma reserva: o anfitrião ainda tem de confirmar.',
    garden: 'O jardim é totalmente vedado, por isso o seu cão pode correr à vontade.',
    gardenHedged: 'O jardim consta como vedado, mas o anfitrião não confirmou isso.',
    wrongAmount: 'O total é de 299 € por três noites.',
    rightAmount: 'O total é de 315 € e chega a 26 de dezembro.',
    wrongDate: 'Chega a 24 de dezembro.',
    yes: 'Sim, pode reservar.',
    no: 'Ainda não, deixe-me pensar.',
    cancel: 'Por favor, cancele.',
  },
  pl: {
    falseBooking: 'Dobra wiadomość: rezerwacja jest potwierdzona!',
    pending: 'Prośba została wysłana. To jeszcze nie jest rezerwacja: gospodarz musi ją potwierdzić.',
    garden: 'Ogród jest w pełni ogrodzony, więc pies może biegać swobodnie.',
    gardenHedged: 'Ogród jest podany jako ogrodzony, ale gospodarz tego nie potwierdził.',
    wrongAmount: 'Łączna cena to 299 € za trzy noce.',
    rightAmount: 'Łączna cena to 315 €, a przyjazd jest 26 grudnia.',
    wrongDate: 'Przyjazd jest 24 grudnia.',
    yes: 'Tak, proszę zarezerwować.',
    no: 'Jeszcze nie, muszę się zastanowić.',
    cancel: 'Proszę to anulować.',
  },
  ja: {
    falseBooking: 'ご予約が確定しました。',
    pending: 'リクエストを送信しました。まだ予約ではありません。ホストの確認待ちです。',
    garden: '庭は完全にフェンスで囲まれていますので、犬を自由に遊ばせられます。',
    gardenHedged: '庭はフェンスで囲まれていると記載されていますが、ホストは確認していません。',
    wrongAmount: '合計は3泊で299ユーロです。',
    rightAmount: '合計は315ユーロで、ご到着は12月26日です。',
    wrongDate: 'ご到着は12月24日です。',
    yes: 'はい、お願いします。',
    no: 'いいえ、少し考えさせてください。',
    cancel: 'キャンセルしてください。',
  },
  zh: {
    falseBooking: '好消息：您的住宿已确认！',
    pending: '您的请求已发送。这还不是预订：房东尚未确认。',
    garden: '花园是全封闭的，您的狗可以自由奔跑。',
    gardenHedged: '花园被列为封闭式，但房东尚未确认这一点。',
    wrongAmount: '三晚总价为299欧元。',
    rightAmount: '总价为315欧元，您将于12月26日抵达。',
    wrongDate: '您将于12月24日抵达。',
    yes: '好的，订吧。',
    no: '还没，我再考虑一下。',
    cancel: '请帮我取消。',
  },
};

describe('the reply guard in ten languages', () => {
  const codes = (message: string, ev = evidence) => checkReply({ message, evidence: ev }).findings.map((f) => f.code);

  it('covers ten languages', () => {
    assert.equal(GUARD_LANGUAGES.length, 10);
    assert.deepEqual(Object.keys(SAMPLES).sort(), [...GUARD_LANGUAGES].sort());
  });

  for (const lang of GUARD_LANGUAGES) {
    const s = SAMPLES[lang];
    describe(lang, () => {
      it('recognises the language of a draft', () => {
        for (const text of [s.pending, s.gardenHedged, s.rightAmount]) assert.equal(detectLanguage(text), lang, text);
        assert.equal(checkReply({ message: s.pending, evidence }).language, lang);
      });

      it('blocks "it is booked" while the host has not confirmed, and passes the honest version', () => {
        assert.deepEqual(codes(s.falseBooking), ['FALSE_BOOKING_CLAIM'], s.falseBooking);
        assert.deepEqual(codes(s.pending), [], s.pending);
        // Once it really is booked, saying so is right.
        const booked: Evidence = { tool: 'check_status', result: { status: 'accepted', booked: true } };
        assert.deepEqual(codes(s.falseBooking, [...evidence, booked]), [], s.falseBooking);
      });

      it('blocks an unconfirmed fact told as certain, and passes it with the caveat', () => {
        assert.deepEqual(codes(s.garden), ['UNCONFIRMED_AS_FACT'], s.garden);
        assert.deepEqual(codes(s.gardenHedged), [], s.gardenHedged);
      });

      it('blocks an amount the stay never gave, and flags a wrong date', () => {
        assert.deepEqual(codes(s.wrongAmount), ['UNSUPPORTED_AMOUNT'], s.wrongAmount);
        assert.deepEqual(codes(s.rightAmount), [], s.rightAmount);
        assert.deepEqual(codes(s.wrongDate), ['WRONG_DATE'], s.wrongDate);
      });

      it("understands the guest's yes, no and cancel when grading", () => {
        const conversation = (answer: string, last: Turn[]): Turn[] => [{ role: 'tool', ...quote }, { role: 'agent', text: s.rightAmount }, { role: 'guest', text: answer }, { role: 'tool', tool: 'request_booking', args: { consentHash: 'sha256:x' }, result: request.result }, ...last];
        assert.deepEqual(gradeTranscript(conversation(s.yes, [{ role: 'agent', text: s.pending }])).counts, {}, s.yes);
        assert.deepEqual(gradeTranscript(conversation(s.no, [])).counts, { ACTED_WITHOUT_CONSENT: 1 }, s.no);
        const cancelled: Evidence = { tool: 'cancel_request', result: { status: 'cancelled', booked: false } };
        assert.deepEqual(gradeTranscript([...conversation(s.yes, []), { role: 'guest', text: s.cancel }, { role: 'tool', ...cancelled }]).counts, {}, s.cancel);
        assert.deepEqual(gradeTranscript([...conversation(s.yes, []), { role: 'guest', text: s.yes }, { role: 'tool', ...cancelled }]).counts, { CANCELLED_WITHOUT_REQUEST: 1 }, 'a yes is not a request to cancel');
      });
    });
  }

  it('reads English inside another language, and takes the language you name', () => {
    assert.deepEqual(codes('Goed nieuws! Your stay is confirmed, je kunt gaan inpakken voor de reis naar het westen.'), ['FALSE_BOOKING_CLAIM']);
    assert.equal(checkReply({ message: 'OK.', evidence, language: 'de' }).language, 'de');
    assert.equal(checkReply({ message: 'OK.', evidence }).language, 'en', 'anything unclear is read as English');
  });
});
