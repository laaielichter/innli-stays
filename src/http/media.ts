import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Image types accepted for upload, recognised by their first bytes (not by the name or the header). */
const SIGNATURES: { ext: 'jpg' | 'png' | 'webp'; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MAX_PHOTOS_PER_PROPERTY = 200;
export const MEDIA_FILE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
export const MEDIA_URL = /^https?:\/\/[^/]+\/media\/[A-Za-z0-9_-]+\/[a-f0-9]{24}\.(jpg|png|webp)$/;

export class MediaError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const contentTypeOf = (file: string) => SIGNATURES.find((s) => file.endsWith(`.${s.ext}`))?.type ?? 'application/octet-stream';

/** Stores an uploaded photo under <dir>/<propertyId>/<random>.<ext> and returns the file name. */
export function savePhoto(dir: string, propertyId: string, body: Buffer): string {
  if (!body.length) throw new MediaError('Empty file');
  if (body.length > MAX_PHOTO_BYTES) throw new MediaError('Photo larger than 6 MB', 413);
  const kind = SIGNATURES.find((s) => s.test(body));
  if (!kind) throw new MediaError('Only JPEG, PNG or WebP photos', 415);
  const folder = join(dir, propertyId.replace(/[^A-Za-z0-9_-]/g, ''));
  mkdirSync(folder, { recursive: true });
  if (existsSync(folder) && readdirSync(folder).length >= MAX_PHOTOS_PER_PROPERTY) throw new MediaError(`At most ${MAX_PHOTOS_PER_PROPERTY} photos`, 409);
  const name = `${randomBytes(12).toString('hex')}.${kind.ext}`;
  writeFileSync(join(folder, name), body, { flag: 'wx' });
  return name;
}

/** Removes uploaded photos the property no longer uses (older than an hour, so a fresh upload is not lost before saving). */
export function pruneUnused(dir: string, propertyId: string, usedUrls: string[]): number {
  const folder = join(dir, propertyId.replace(/[^A-Za-z0-9_-]/g, ''));
  if (!existsSync(folder)) return 0;
  const used = new Set(usedUrls.map((u) => u.split('/').pop()));
  let removed = 0;
  for (const f of readdirSync(folder)) {
    if (!MEDIA_FILE.test(f) || used.has(f)) continue;
    const p = join(folder, f);
    if (Date.now() - statSync(p).mtimeMs < 3_600_000) continue;
    unlinkSync(p);
    removed++;
  }
  return removed;
}

/**
 * Checks photo descriptions: agents and screen readers rely on them, so
 * "IMG_2031", "foto" or a one-word caption does not tell anyone what is shown.
 */
const VAGUE = /^(img|dsc|pxl|photo|foto|bild|image|afbeelding|picture|pic|untitled|naamloos)[\s_-]*\d*$/i;
export function captionProblem(caption: string): 'missing' | 'filename' | 'too_short' | undefined {
  const c = caption.trim();
  if (!c) return 'missing';
  if (VAGUE.test(c) || /\.(jpe?g|png|webp|heic)$/i.test(c)) return 'filename';
  if (c.split(/\s+/).length < 3 || c.length < 12) return 'too_short';
  return undefined;
}
