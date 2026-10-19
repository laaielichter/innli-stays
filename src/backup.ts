import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Store } from './store.ts';

/**
 * Daily copy of all data (passport, requests, questions, events, photos) to a
 * second place, e.g. a USB disk, a NAS share or a synced cloud folder. Keeps
 * the newest `keep` days. A folder per day, so restoring is: stop INNLI, copy
 * one day's files back, start INNLI.
 */
export function backupNow(store: Store, dataFile: string, targetDir: string, opts: { keep?: number; now?: Date } = {}): { folder: string; files: number; removed: number } {
  const now = opts.now ?? new Date();
  store.flush();
  const source = dirname(resolve(dataFile));
  const target = resolve(targetDir);
  if (target === source || target.startsWith(`${source}/`)) throw new Error('The backup folder must be outside the data folder');
  const day = now.toISOString().slice(0, 10);
  const folder = join(target, `innli-${day}`);
  mkdirSync(folder, { recursive: true });
  const prefix = basename(dataFile).replace(/\.json$/, '');
  let files = 0;
  for (const f of readdirSync(source)) {
    // The data file and its logs; never secrets like the licence private key.
    if (!(f === basename(dataFile) || (f.startsWith(`${prefix}.`) && f.endsWith('.jsonl')))) continue;
    cpSync(join(source, f), join(folder, f));
    files++;
  }
  if (existsSync(join(source, 'media'))) {
    cpSync(join(source, 'media'), join(folder, 'media'), { recursive: true });
    files++;
  }
  // Retention: remove the oldest day folders beyond `keep`.
  const keep = Math.max(1, opts.keep ?? 14);
  const days = readdirSync(target).filter((f) => /^innli-\d{4}-\d{2}-\d{2}$/.test(f) && statSync(join(target, f)).isDirectory()).sort();
  let removed = 0;
  for (const old of days.slice(0, Math.max(0, days.length - keep))) {
    rmSync(join(target, old), { recursive: true, force: true });
    removed++;
  }
  return { folder, files, removed };
}

/** Latest backup folders, newest first, for the dashboard. */
export function listBackups(targetDir: string): { day: string; folder: string }[] {
  if (!existsSync(targetDir)) return [];
  return readdirSync(targetDir)
    .filter((f) => /^innli-\d{4}-\d{2}-\d{2}$/.test(f))
    .sort()
    .reverse()
    .map((f) => ({ day: f.slice(6), folder: join(resolve(targetDir), f) }));
}
