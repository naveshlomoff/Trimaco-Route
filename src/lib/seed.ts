// The starting places catalog (Trimaco's warehouse, hospitals, cities) is
// public data kept in supabase/seed-places.json. Admins can top up the live
// catalog with entries and spellings added to that file since setup.

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
}

/** Adds missing seed places and spellings; returns how many places and spellings were added. */
export async function syncSeedPlaces(current: Place[]): Promise<{ places: number; aliases: number }> {
  const byKey = new Map<string, Place>();
  for (const p of current) byKey.set(normalizeKey(p.name), p);
  let placesAdded = 0;
  let aliasesAdded = 0;
  for (const s of seed as unknown as SeedPlace[]) {
    const existing = byKey.get(normalizeKey(s.name));
    if (!existing) {
      await store().createPlace({
        name: s.name,
        aliases: s.aliases,
        region: s.region,
        kind: s.kind,
        city: s.city ?? null,
        address: s.address ?? null,
      });
      placesAdded++;
      continue;
    }
    const known = new Set([existing.name, ...existing.aliases].map(normalizeKey));
    for (const alias of s.aliases) {
      if (known.has(normalizeKey(alias))) continue;
      await store().addPlaceAlias(existing.id, alias);
      aliasesAdded++;
    }
  }
  return { places: placesAdded, aliases: aliasesAdded };
}
