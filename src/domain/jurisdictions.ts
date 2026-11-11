/**
 * What differs between countries for someone who rents out, or rents, a
 * camper. Deliberately small: only rules of thumb that are stable and that
 * change what an agent should ask.
 *
 * None of this is legal advice and none of it overrides the rental company.
 * A company's own confirmed answer always decides; these defaults only tell
 * an owner when an answer looks unusual, and tell an agent what to check.
 */
export type LicenceArea = 'europe' | 'us' | 'canada' | 'australia' | 'new_zealand' | 'japan' | 'other';

export interface Jurisdiction {
  area: LicenceArea;
  /** Heaviest vehicle (maximum authorised mass, kg) an ordinary car licence usually covers. null = differs within the country or not known. */
  carLicenceMaxKg: number | null;
  /** How the ordinary car licence is called there. */
  carLicenceName: string;
  distanceUnit: 'km' | 'mi';
  /** One sentence an agent can use; always to be read with `disclaimer`. */
  licenceNote: string;
}

/** EU and EEA member states, plus Switzerland and the United Kingdom: licence categories B, C1 and C mean the same in all of them. */
const EUROPE = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB'.split(' '));

const AREAS: Record<LicenceArea, Omit<Jurisdiction, 'area' | 'distanceUnit'>> = {
  europe: { carLicenceMaxKg: 3500, carLicenceName: 'category B', licenceNote: 'A category B licence covers vehicles up to 3,500 kg; heavier motorhomes need C1 (up to 7,500 kg) or C.' },
  us: { carLicenceMaxKg: 11793, carLicenceName: 'regular (non-commercial) licence', licenceNote: 'A regular licence usually covers motorhomes up to 26,000 lb (about 11,800 kg); some states ask for more above that.' },
  canada: { carLicenceMaxKg: null, carLicenceName: 'regular licence', licenceNote: 'What a regular licence covers differs by province, especially for vehicles with air brakes.' },
  australia: { carLicenceMaxKg: 4500, carLicenceName: 'car (class C) licence', licenceNote: 'A car licence covers vehicles up to 4.5 tonnes; heavier motorhomes need a light rigid licence.' },
  new_zealand: { carLicenceMaxKg: 6000, carLicenceName: 'class 1 licence', licenceNote: 'A class 1 car licence covers vehicles up to 6,000 kg.' },
  japan: { carLicenceMaxKg: 3500, carLicenceName: 'ordinary licence', licenceNote: 'An ordinary licence issued since 2017 covers vehicles under 3,500 kg.' },
  other: { carLicenceMaxKg: null, carLicenceName: 'car licence', licenceNote: 'INNLI has no default for this country: ask the rental company which licence is needed.' },
};

export const JURISDICTION_DISCLAIMER = 'General rule of thumb, not legal advice. The rental company decides; check anything that matters with the company.';

export function licenceArea(country: string | undefined): LicenceArea {
  const c = (country ?? '').toUpperCase();
  if (EUROPE.has(c)) return 'europe';
  return ({ US: 'us', CA: 'canada', AU: 'australia', NZ: 'new_zealand', JP: 'japan' } as Record<string, LicenceArea>)[c] ?? 'other';
}

export function jurisdictionOf(country: string | undefined): Jurisdiction {
  const area = licenceArea(country);
  const c = (country ?? '').toUpperCase();
  return { area, ...AREAS[area], distanceUnit: c === 'US' || c === 'GB' ? 'mi' : 'km' };
}

/**
 * Is a licence from `licenceCountry` a foreign licence for a company in `companyCountry`?
 * Within Europe (EU, EEA, Switzerland, UK) licences are recognised across borders, so they are not.
 */
export function isForeignLicence(licenceCountry: string, companyCountry: string | undefined): boolean {
  const a = licenceCountry.toUpperCase();
  const b = (companyCountry ?? '').toUpperCase();
  if (a === b) return false;
  return !(licenceArea(a) === 'europe' && licenceArea(b) === 'europe');
}

export const kmToMiles = (km: number) => Math.round(km * 0.621371);
