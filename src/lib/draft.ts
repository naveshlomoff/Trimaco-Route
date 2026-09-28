// Between parsing and saving: the places a person still has to confirm,
// and turning a parsed day into the rows the database stores.

import type { NewTask, SaveDayInput } from './store';
import { store } from './store';
import { normalizeKey } from './text';
import type { ParsedDay, Place, PlaceCandidate, PlaceKind, Region } from './types';

export type Resolution =
  | { type: 'existing'; placeId: string }
  | { type: 'new'; name: string; region: Region; placeKind: PlaceKind };

/** One unrecognised place, however many times and spellings it appeared. */
export interface UnknownGroup {
  key: string;
  texts: string[];
  count: number;
  candidates: PlaceCandidate[];
}

export function collectUnknowns(days: ParsedDay[]): UnknownGroup[] {
  const groups = new Map<string, UnknownGroup>();
  for (const day of days) {
    for (const section of day.sections) {
      for (const t of section.tasks) {
        if (t.match !== 'unknown' || !t.locationText) continue;
        const key = normalizeKey(t.locationText);
        const g = groups.get(key) ?? { key, texts: [], count: 0, candidates: t.candidates };
        if (!g.texts.includes(t.locationText)) g.texts.push(t.locationText);
        g.count++;
        groups.set(key, g);
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Creates the new places and records the new spellings; returns place id per
 * group key. A "new" place that already exists by now (a retry after a failed
 * save) is reused instead of created twice.
 */
export async function applyResolutions(
  groups: UnknownGroup[],
  resolutions: Map<string, Resolution>,
  knownPlaces: Place[],
): Promise<Map<string, string>> {
  const placeIdByKey = new Map<string, string>();
  for (const g of groups) {
    const r = resolutions.get(g.key);
    if (!r) continue;
    let placeId: string;
    if (r.type === 'existing') {
      placeId = r.placeId;
    } else {
      const same = knownPlaces.find((p) => normalizeKey(p.name) === normalizeKey(r.name));
      const aliases = g.texts.filter((t) => normalizeKey(t) !== normalizeKey(r.name));
      placeId = same
        ? same.id
        : (await store().createPlace({ name: r.name, region: r.region, kind: r.placeKind, aliases })).id;
    }
    for (const text of g.texts) await store().addPlaceAlias(placeId, text);
    placeIdByKey.set(g.key, placeId);
  }
  return placeIdByKey;
}

export function buildSaveInput(
  day: ParsedDay,
  meta: { date: string; rawText: string; source: SaveDayInput['source']; messageSentAt: string | null },
  placeIdByKey: Map<string, string>,
): SaveDayInput {
  const tasks: NewTask[] = day.sections.flatMap((s) =>
    s.tasks.map((t) => ({
      worker_id: t.workerId,
      worker_label: t.workerLabel,
      seq: t.seq,
      place_id: t.placeId ?? (t.locationText ? placeIdByKey.get(normalizeKey(t.locationText)) ?? null : null),
      location_text: t.locationText,
      description: t.description,
      task_types: t.types,
      is_field: t.isField,
      window_start: t.windowStart,
      window_end: t.windowEnd,
      address: t.address,
      flags: t.flags,
      raw_line: t.rawLine,
    })),
  );
  return {
    date: meta.date,
    rawText: meta.rawText,
    intro: day.intro.join('\n') || null,
    vehicleNotes: day.vehicle.map((v) => v.text),
    notes: day.notes,
    source: meta.source,
    messageSentAt: meta.messageSentAt,
    tasks,
  };
}

// The pasted text survives a reload of the review screen.
const DRAFT_KEY = 'trimaco-route-draft';

export interface Draft {
  text: string;
  date?: string;
}

export function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(d: Draft | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode: the draft just won't survive a reload */
  }
}
