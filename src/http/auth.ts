import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Property, StaffRole } from '../domain/types.ts';
import type { Store } from '../store.ts';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const newKey = (prefix: string) => `${prefix}_${randomBytes(24).toString('base64url')}`;

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Who is logged in to the dashboard: the owner, or a staff member with their own key. */
export type OwnerRequest = Request & { property: Property; role: 'owner' | StaffRole; staffName?: string };

/**
 * What staff may do. Reception: day-to-day work (requests, questions, room calendar,
 * reviews). Manager: everything except staff keys, licence and full backups.
 */
const RECEPTION: [string, RegExp][] = [
  ['GET', /^\/(me|property|requests|questions|reviews|waitlist|wishes|audit-log|conflicts|insights|analytics|agent-preview|stats|bookings\/feed|export\/requests\.csv|units\/[^/]+\/calendar)$/],
  ['POST', /^\/(requests\/[^/]+\/(accept|decline|paid)|questions\/[^/]+\/answer|reviews\/[^/]+\/reply)$/],
  ['PUT', /^\/units\/[^/]+\/closed$/],
];
const OWNER_ONLY = /^\/(staff(\/.*)?|license|backup|backups(\/.*)?|restore|guide\/register)$/;

export function staffMayAccess(role: StaffRole, method: string, path: string): boolean {
  if (role === 'manager') return !OWNER_ONLY.test(path) || (method === 'GET' && path === '/license');
  return RECEPTION.some(([m, re]) => m === method && re.test(path));
}

export function requireOwner(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = bearer(req);
    const hash = key ? hashKey(key) : undefined;
    const property = hash ? store.findPropertyByOwnerKeyHash(hash) : undefined;
    if (property) {
      Object.assign(req as OwnerRequest, { property, role: 'owner' });
      next();
      return;
    }
    const staff = hash ? store.findStaffByKeyHash(hash) : undefined;
    if (!staff) {
      res.status(401).json({ error: 'Ongeldige of ontbrekende eigenaarssleutel' });
      return;
    }
    if (!staffMayAccess(staff.staff.role, req.method, req.path)) {
      res.status(403).json({ error: staff.staff.role === 'reception' ? 'Not allowed for reception staff' : 'Only the owner can do this' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (staff.staff.lastSeenAt?.slice(0, 10) !== today) {
      staff.staff.lastSeenAt = new Date().toISOString();
      store.saveProperty(staff.property);
    }
    Object.assign(req as OwnerRequest, { property: staff.property, role: staff.staff.role, staffName: staff.staff.name });
    next();
  };
}

export function requireAdmin(adminKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = bearer(req);
    if (!adminKey || !key || !safeEqual(key, adminKey)) {
      res.status(401).json({ error: 'Beheerderssleutel vereist' });
      return;
    }
    next();
  };
}
