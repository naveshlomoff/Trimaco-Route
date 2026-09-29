// The starting places catalog (Trimaco's warehouse, hospitals, cities) is
// public data kept in supabase/seed-places.json, with map coordinates from
// OpenStreetMap. Admin screens top up the live catalog with entries,
// spellings and coordinates added to that file since setup.

import seed from '../../supabase/seed-places.json';
import { store } from './store';
import { normalizeKey } from './text';
import type { Place, PlaceKind, Region } from './types';

interface SeedPlace {
  name: string;
  aliases: string[];
  region: Region;
  kind: PlaceKind;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

const SEED = seed as unknown as SeedPlace[];

/** True when the live catalog lacks seed places, spellings or coordinates. */
export function seedSyncNeeded(current: Place[]): boolean {
  const byKey = new Map(current.map((p) => [normalizeKey(p.name), p]));
  return SEED.some((s) => {
    const p = byKey.get(normalizeKey(s.name));
    if (!p) return true;
    if (s.lat != null && p.lat == null) return true;
    const known = new Set([p.name, ...p.aliases].map(normalizeKey));
    return s.aliases.some((a) => !known.has(normalizeKey(a)));
  });
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

/** Adds missing seed places, spellings and coordinates. */
export async function syncSeedPlaces(current: Place[]): Promise<{ places: number; aliases: number; located: number }> {
  const byKey = new Map(current.map((p) => [normalizeKey(p.name), p]));
  const toCreate: SeedPlace[] = [];
  const aliases: { id: string; alias: string }[] = [];
  const coords: { id: string; lat: number; lng: number }[] = [];

  for (const s of SEED) {
    const existing = byKey.get(normalizeKey(s.name));
    if (!existing) {
      toCreate.push(s);
      continue;
    }
    const known = new Set([existing.name, ...existing.aliases].map(normalizeKey));
    for (const alias of s.aliases) if (!known.has(normalizeKey(alias))) aliases.push({ id: existing.id, alias });
    if (s.lat != null && s.lng != null && existing.lat == null) coords.push({ id: existing.id, lat: s.lat, lng: s.lng });
  }

  await inBatches(toCreate, 8, async (s) => {
    await store().createPlace({
      name: s.name,
      aliases: s.aliases,
      region: s.region,
      kind: s.kind,
      city: s.city ?? null,
      address: s.address ?? null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    });
  });
  for (const a of aliases) await store().addPlaceAlias(a.id, a.alias);
  await inBatches(coords, 8, (c) => store().updatePlace(c.id, { lat: c.lat, lng: c.lng }));

  return { places: toCreate.length, aliases: aliases.length, located: coords.length };
}
