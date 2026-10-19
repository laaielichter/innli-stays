import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ownerTextWarnings } from './agent/hostText.ts';
import { validateDeeplinkTemplate } from './booking/links.ts';
import { isValidMonthDay } from './domain/rates.ts';
import { t } from './i18n/index.ts';
import { CURRENCIES, currencyForCountry, LANGUAGES, POI_KINDS } from './domain/types.ts';

const photoSchema = z.object({
  // https, or a photo uploaded to this installation (which may run on http while testing locally).
  url: z.string().url().refine((u) => u.startsWith('https://') || MEDIA_URL.test(u), { error: () => t('own.photoHttps') }),
  caption: z.string().trim().min(3, { error: () => t('own.photoCaption') }).max(200),
});
import type { Property, Unit } from './domain/types.ts';
import { hashKey, newKey } from './http/auth.ts';
import { MEDIA_URL } from './http/media.ts';

export const addressSchema = z.object({
  street: z.string().max(200).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  country: z.string().min(2).max(2).transform((s) => s.toUpperCase()),
});

const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), { error: () => t('own.httpOnly') });
/** Weekdays, 0 = Sunday … 6 = Saturday. */
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export const connectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('ical'),
    calendars: z.record(z.string(), z.union([httpUrl.transform((u) => [u]), z.array(httpUrl).max(10)])),
  }),
  z.object({ kind: z.literal('live_api'), baseUrl: httpUrl, apiKey: z.string().max(500).optional() }),
  z.object({ kind: z.literal('beds24'), refreshToken: z.string().trim().min(10).max(500), apiUrl: httpUrl.optional() }),
]);

export const propertyPatchSchema = z
  .object({
    name: z.string().min(2).max(120),
    type: z.enum(['bnb', 'pension', 'guesthouse', 'holiday_home', 'unique_stay', 'hotel']),
    description: z.string().max(4000),
    language: z.enum(LANGUAGES),
    currency: z.enum(CURRENCIES),
    address: addressSchema,
    geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
    website: httpUrl.nullable(),
    contactEmail: z.string().email().nullable(),
    phone: z.string().max(40).nullable(),
    published: z.boolean(),
    photos: z.array(photoSchema).max(30),
    pointsOfInterest: z
      .array(
        z.object({
          kind: z.enum(POI_KINDS),
          name: z.string().trim().min(1).max(100),
          distanceKm: z.number().min(0).max(200),
          walkMinutes: z.number().int().min(0).max(600).optional(),
        }),
      )
      .max(30),
    translations: z.object(Object.fromEntries(LANGUAGES.map((l) => [l, z.object({ description: z.string().max(4000) }).optional()])) as Record<(typeof LANGUAGES)[number], z.ZodOptional<z.ZodObject<{ description: z.ZodString }>>>),
    notify: z.object({ ntfyUrl: z.string().url().refine((u) => u.startsWith('https://'), { error: () => t('own.useHttps') }).optional() }),
    ratePlans: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]{2,30}$/),
          name: z.string().trim().min(2).max(60),
          adjustmentPercent: z.number().min(-90).max(200),
          refundable: z.boolean(),
          breakfastIncluded: z.boolean().optional(),
          cancellation: z.string().trim().max(500).optional(),
        }),
      )
      .max(10)
      .refine((plans) => new Set(plans.map((p) => p.id)).size === plans.length && !plans.some((p) => p.id === 'standard'), { error: () => t('own.ratePlanIds') }),
    extras: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]{2,30}$/),
          name: z.string().trim().min(2).max(60),
          description: z.string().trim().max(300).optional(),
          price: z.number().min(0).max(10_000),
          per: z.enum(['stay', 'night', 'person', 'person_night', 'room_night']),
          max: z.number().int().min(1).max(50).optional(),
        }),
      )
      .max(20)
      .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length, { error: () => t('own.uniqueIds') }),
    discountCodes: z
      .array(
        z.object({
          code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/).transform((c) => c.toUpperCase()),
          percent: z.number().min(1).max(90),
          validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          minNights: z.number().int().min(1).max(60).optional(),
          maxUses: z.number().int().min(1).max(100_000).optional(),
          active: z.boolean(),
        }),
      )
      .max(50)
      .refine((xs) => new Set(xs.map((x) => x.code)).size === xs.length, { error: () => t('own.uniqueIds') }),
    cancellationRules: z.array(z.object({ daysBefore: z.number().int().min(0).max(365), percent: z.number().min(0).max(100) })).max(10),
    bookingRules: z.object({
      instantBooking: z.boolean(),
      minLeadDays: z.number().int().min(0).max(60),
      maxNights: z.number().int().min(1).max(60),
      holdHours: z.number().int().min(4).max(168),
      autoAnswer: z.boolean().optional(),
      deposit: z
        .object({
          percent: z.number().min(0).max(100),
          dueDays: z.number().int().min(0).max(60),
          instructions: z.string().trim().max(500).optional(),
          paymentUrl: z.string().url().refine((u) => u.startsWith('https://'), { error: () => t('own.paymentHttps') }).optional(),
        })
        .nullable()
        .optional()
        .transform((d) => d ?? undefined),
    }),
    booking: z.object({
      connector: connectorSchema,
      deeplinkTemplate: z
        .string()
        .max(1000)
        .nullable()
        .optional()
        .superRefine((t, ctx) => {
          const err = t ? validateDeeplinkTemplate(t) : null;
          if (err) ctx.addIssue({ code: 'custom', message: err });
        }),
      requestUrl: httpUrl.nullable().optional(),
    }),
  })
  .partial();

export const unitSchema = z.object({
  name: z.string().min(1).max(120),
  externalRef: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  maxGuests: z.number().int().min(1).max(30),
  includedGuests: z.number().int().min(1).max(30),
  baseRatePerNight: z.number().min(0).max(10_000),
  extraGuestPerNight: z.number().min(0).max(1_000).optional(),
  inventory: z.number().int().min(1).max(500).optional(),
  photos: z.array(photoSchema).max(20).optional(),
  rates: z
    .object({
      weekendSupplement: z.number().min(0).max(1_000).optional(),
      checkinDays: weekdays.optional(),
      singleNightSupplement: z.number().min(0).max(1_000).optional(),
      discounts: z
        .object({
          longStay: z.array(z.object({ minNights: z.number().int().min(2).max(60), percent: z.number().min(0).max(90) })).max(5).optional(),
          lastMinute: z.object({ withinDays: z.number().int().min(0).max(30), percent: z.number().min(0).max(90) }).optional(),
          earlyBird: z.object({ minDaysAhead: z.number().int().min(7).max(365), percent: z.number().min(0).max(90) }).optional(),
        })
        .optional(),
      seasons: z
        .array(
          z.object({
            name: z.string().min(1).max(60),
            from: z.string().refine(isValidMonthDay, { error: () => t('own.mmddFrom') }),
            to: z.string().refine(isValidMonthDay, { error: () => t('own.mmddTo') }),
            ratePerNight: z.number().min(0).max(10_000),
            minNights: z.number().int().min(1).max(30).optional(),
            checkinDays: weekdays.optional(),
          }),
        )
        .max(20),
    })
    .optional(),
});

export type PropertyPatch = z.infer<typeof propertyPatchSchema>;

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export function createProperty(input: { name: string; type?: Property['type']; description?: string; address: Property['address']; slug?: string }): { property: Property; ownerKey: string } {
  const now = new Date().toISOString();
  const ownerKey = newKey('innli_own');
  const property: Property = {
    id: `prop_${randomUUID().slice(0, 8)}`,
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    type: input.type ?? 'bnb',
    description: input.description ?? '',
    address: input.address,
    currency: currencyForCountry(input.address.country),
    facts: {},
    units: [],
    booking: { connector: { kind: 'none' } },
    published: false,
    ownerKeyHash: hashKey(ownerKey),
    webhookSecret: randomBytes(24).toString('base64url'),
    createdAt: now,
    updatedAt: now,
  };
  return { property, ownerKey };
}

export function applyPatch(property: Property, patch: PropertyPatch): void {
  const { geo, website, contactEmail, phone, booking, ...rest } = patch;
  Object.assign(property, rest);
  if (geo !== undefined) property.geo = geo ?? undefined;
  if (website !== undefined) property.website = website ?? undefined;
  if (contactEmail !== undefined) property.contactEmail = contactEmail ?? undefined;
  if (phone !== undefined) property.phone = phone ?? undefined;
  if (booking) {
    property.booking = {
      connector: booking.connector,
      deeplinkTemplate: booking.deeplinkTemplate === undefined ? property.booking.deeplinkTemplate : booking.deeplinkTemplate ?? undefined,
      requestUrl: booking.requestUrl === undefined ? property.booking.requestUrl : booking.requestUrl ?? undefined,
    };
  }
}

export function createUnit(input: z.infer<typeof unitSchema>, id?: string): Unit {
  return { id: id ?? `unit_${randomUUID().slice(0, 8)}`, ...input, facts: {} };
}

/** Owner-facing view: never expose key hashes; the webhook secret is shown so it can be put in the plugin. */
export function ownerView(property: Property) {
  const { ownerKeyHash: _omit, staff, ...rest } = property;
  return { ...rest, staff: staff?.map(({ keyHash: _k, ...member }) => member), agentTextWarnings: agentTextWarnings(property) };
}

/** Owner text that agents would receive with parts removed, so the owner can rewrite it (see agent/hostText.ts). */
export function agentTextWarnings(property: Property) {
  const fields: Record<string, string | undefined> = { description: property.description };
  for (const [lang, tr] of Object.entries(property.translations ?? {})) fields[`translations.${lang}.description`] = tr?.description;
  for (const u of property.units) fields[`units.${u.id}.description`] = u.description;
  for (const e of property.extras ?? []) fields[`extras.${e.id}.description`] = e.description;
  for (const [key, f] of Object.entries(property.facts)) if (typeof f.value === 'string') fields[`facts.${key}`] = f.value;
  return ownerTextWarnings(fields);
}
