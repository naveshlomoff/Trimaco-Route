// Numbers for the manager dashboard, computed from saved tasks.
// No travel times yet: "same region, several drivers, same day" is the
// first signal that routes could have been combined.

import type { Place, Region, TaskRow, Worker } from './types';

export interface OverlapEntry {
  workerId: string;
  places: string[];
}

export interface Overlap {
  date: string;
  region: Region;
  entries: OverlapEntry[];
}

export interface WorkerStat {
  workerId: string;
  name: string;
  fieldDays: number;
  fieldStops: number;
  warehouseDays: number;
  topRegions: { region: Region; count: number }[];
}

export interface PlaceStat {
  placeId: string;
  name: string;
  region: Region;
  visits: number;
  topWorker: string | null;
}

export interface Dashboard {
  days: number;
  fieldStops: number;
  avgStopsPerDay: number;
  unresolvedTexts: number;
  overlaps: Overlap[];
  overlapDaysByRegion: Partial<Record<Region, number>>;
  workers: WorkerStat[];
  topPlaces: PlaceStat[];
}

export function computeDashboard(tasks: TaskRow[], workers: Worker[], places: Place[]): Dashboard {
  const placeById = new Map(places.map((p) => [p.id, p]));
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const dates = new Set(tasks.map((t) => t.date));
  const field = tasks.filter((t) => t.is_field);

  // Same region, same day, two or more delivery drivers (the technician is left out).
  const overlaps: Overlap[] = [];
  const byDate = groupBy(field, (t) => t.date);
  for (const [date, dayTasks] of byDate) {
    const byRegion = new Map<Region, Map<string, string[]>>();
    for (const t of dayTasks) {
      const place = t.place_id ? placeById.get(t.place_id) : undefined;
      const worker = t.worker_id ? workerById.get(t.worker_id) : undefined;
      if (!place || !worker || worker.is_technical || place.region === 'unknown' || place.kind === 'depot') continue;
      const perWorker = byRegion.get(place.region) ?? new Map<string, string[]>();
      const list = perWorker.get(worker.id) ?? [];
      if (!list.includes(place.name)) list.push(place.name);
      perWorker.set(worker.id, list);
      byRegion.set(place.region, perWorker);
    }
    for (const [region, perWorker] of byRegion) {
      if (perWorker.size < 2) continue;
      overlaps.push({
        date,
        region,
        entries: [...perWorker].map(([workerId, names]) => ({ workerId, places: names })),
      });
    }
  }
  overlaps.sort((a, b) => b.date.localeCompare(a.date));
  const overlapDaysByRegion: Partial<Record<Region, number>> = {};
  for (const o of overlaps) overlapDaysByRegion[o.region] = (overlapDaysByRegion[o.region] ?? 0) + 1;

  const workerStats: WorkerStat[] = workers.map((w) => {
    const mine = tasks.filter((t) => t.worker_id === w.id);
    const mineField = mine.filter((t) => t.is_field);
    const regionCounts = new Map<Region, number>();
    for (const t of mineField) {
      const region = (t.place_id && placeById.get(t.place_id)?.region) || 'unknown';
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
    return {
      workerId: w.id,
      name: w.name,
      fieldDays: new Set(mineField.map((t) => t.date)).size,
      fieldStops: mineField.length,
      warehouseDays: new Set(mine.filter((t) => !t.is_field && !t.task_types.includes('off')).map((t) => t.date)).size,
      topRegions: [...regionCounts]
        .filter(([r]) => r !== 'unknown')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([region, count]) => ({ region, count })),
    };
  });

  const visits = groupBy(
    field.filter((t) => t.place_id && placeById.get(t.place_id)?.kind !== 'depot'),
    (t) => t.place_id as string,
  );
  const topPlaces: PlaceStat[] = [...visits]
    .map(([placeId, list]) => {
      const place = placeById.get(placeId);
      const byWorker = groupBy(list, (t) => t.worker_id ?? '');
      const top = [...byWorker].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
      return {
        placeId,
        name: place?.name ?? '?',
        region: place?.region ?? 'unknown',
        visits: new Set(list.map((t) => t.date)).size,
        topWorker: top ? workerById.get(top)?.name ?? null : null,
      };
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15);

  const unresolved = new Set(field.filter((t) => !t.place_id && t.location_text).map((t) => t.location_text));

  return {
    days: dates.size,
    fieldStops: field.length,
    avgStopsPerDay: dates.size ? field.length / dates.size : 0,
    unresolvedTexts: unresolved.size,
    overlaps,
    overlapDaysByRegion,
    workers: workerStats,
    topPlaces,
  };
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}
