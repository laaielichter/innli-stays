import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Idempotency-Key for state-changing calls. Agents retry: a timeout does not
 * tell them whether the booking went through. With a key, the retry gets the
 * first answer instead of a second booking.
 *
 * - Same key, same body: the stored answer, with `Idempotent-Replayed: true`.
 * - Same key, other body: 409 (the key was already used for something else).
 * - Same key while the first call still runs: 409 with Retry-After.
 * - Server errors (5xx) are not stored, so they can be retried.
 * Answers are kept for 24 hours, in memory.
 */
interface Entry {
  bodyHash: string;
  until: number;
  done?: { status: number; body: unknown };
}

const TTL_MS = 86_400_000;
const MAX_ENTRIES = 10_000;

export function idempotency() {
  const entries = new Map<string, Entry>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.headers['idempotency-key'] ?? '').trim();
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    if (!key) return next();
    if (key.length > 255) {
      res.status(400).json({ code: 'invalid_idempotency_key', content: 'Idempotency-Key is at most 255 characters.', error: 'Idempotency-Key is at most 255 characters.' });
      return;
    }
    const now = Date.now();
    // Keys are scoped to the caller, so one platform cannot read another's answer by guessing a key.
    const caller = createHash('sha256').update(`${req.headers.authorization ?? ''}|${req.headers['signature-agent'] ?? ''}|${req.ip ?? ''}`).digest('hex').slice(0, 24);
    const id = `${caller}:${req.method}:${req.originalUrl}:${key}`;
    const bodyHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const existing = entries.get(id);
    if (existing && existing.until > now) {
      if (existing.bodyHash !== bodyHash) {
        res.status(409).json({ code: 'idempotency_key_reused', content: 'This Idempotency-Key was already used with a different request body.', error: 'This Idempotency-Key was already used with a different request body.', retryable: false });
        return;
      }
      if (!existing.done) {
        res.status(409).set('retry-after', '2').json({ code: 'idempotency_in_progress', content: 'The first request with this Idempotency-Key is still being processed.', error: 'The first request with this Idempotency-Key is still being processed.', retryable: true, retryAfterSeconds: 2 });
        return;
      }
      res.status(existing.done.status).set('idempotent-replayed', 'true').json(existing.done.body);
      return;
    }
    const entry: Entry = { bodyHash, until: now + TTL_MS };
    entries.set(id, entry);
    if (entries.size > MAX_ENTRIES) for (const [k, v] of entries) if (v.until < now || entries.size > MAX_ENTRIES) entries.delete(k);
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      // Rate limits, auth failures and server errors are not the operation's answer: let the caller try again.
      if (res.statusCode >= 500 || res.statusCode === 429 || res.statusCode === 401) entries.delete(id);
      else entry.done = { status: res.statusCode, body };
      return json(body);
    }) as Response['json'];
    res.on('close', () => {
      if (!entry.done) entries.delete(id);
    });
    next();
  };
}
