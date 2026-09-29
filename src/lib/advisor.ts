// The advisor: given one day's schedule, which stops would be better handed
// to another driver who is already nearby? Each suggestion moves one stop
// (every task at that place) from one driver to another, only when it saves
// real driving and keeps the receiving driver's day within 9:00–17:00.
// Distances are estimates without traffic (see geo.ts).

import { haversineKm, locate, type LatLng } from './geo';
import { planRoute, serviceMinutes, type Route } from './routing';
import type { Place, TaskType, Worker } from './types';

export const DAY_WINDOW_MIN = 480; // 9:00–17:00, the window Liraz measures against
const MIN_SAVING_MIN = 10;
const EXTRA_TASK_MIN = 5; // each further task at the same stop
// Only hand a stop to a driver who already has a stop this close to it (road km):
// the advice stays "he's there anyway", never "drive across the country instead".
const NEAR_KM = 15;

export interface AdviceTask {
  workerId: string | null;
  placeId: string | null;
  isField: boolean;
  types: TaskType[];
}

export interface AdviceContext {
  places: Place[];
  workers: Worker[];
}

export interface AdviseOptions {
  maxMoves?: number;
  /** Leave out moves the planner already turned down. */
  allow?: (m: { placeId: string; from: string; to: string }) => boolean;
}

export interface Stop {
  placeId: string;
  name: string;
  point: LatLng;
  serviceMin: number;
}

export interface DriverPlan {
  workerId: string;
  name: string;
  stops: Stop[];
  route: Route;
  serviceMin: number;
  totalMin: number;
}

export interface Move {
  placeId: string;
  placeName: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  /** The receiving driver's closest stop that day, and how far it is. */
  nearName: string | null;
  nearKm: number | null;
  savedMin: number;
  savedKm: number;
}

export interface DayAdvice {
  before: DriverPlan[];
  after: DriverPlan[];
  moves: Move[];
  savedMin: number;
  savedKm: number;
  /** Drivers left with no field stops: free for the warehouse. */
  freed: string[];
  /** Field tasks whose place is unknown, so not in the calculation. */
  unplaced: number;
}

function makePlan(depot: LatLng, workerId: string, name: string, stops: Stop[]): DriverPlan {
  const route = planRoute(
    depot,
    stops.map((s) => s.point),
  );
  const serviceMin = stops.reduce((sum, s) => sum + s.serviceMin, 0);
  return { workerId, name, stops, route, serviceMin, totalMin: route.driveMin + serviceMin };
}

export function adviseDay(tasks: AdviceTask[], ctx: AdviceContext, opts: AdviseOptions = {}): DayAdvice | null {
  const { maxMoves = 3, allow } = opts;
  const byId = new Map(ctx.places.map((p) => [p.id, p]));
  const byName = new Map(ctx.places.map((p) => [p.name, p]));
  const depotPlace = ctx.places.find((p) => p.kind === 'depot');
  const depot = depotPlace ? locate(depotPlace, byName) : null;
  if (!depot) return null;

  const drivers = new Map(ctx.workers.filter((w) => w.can_drive && !w.is_technical).map((w) => [w.id, w]));

  // one stop per driver and place, with the work done there
  const grouped = new Map<string, Map<string, { types: Set<TaskType>; count: number }>>();
  let unplaced = 0;
  for (const t of tasks) {
    if (!t.isField || !t.workerId || !drivers.has(t.workerId)) continue;
    const place = t.placeId ? byId.get(t.placeId) : undefined;
    if (!place || place.kind === 'depot' || !locate(place, byName)) {
      unplaced++;
      continue;
    }
    const perWorker = grouped.get(t.workerId) ?? new Map();
    const stop = perWorker.get(place.id) ?? { types: new Set<TaskType>(), count: 0 };
    t.types.forEach((ty) => stop.types.add(ty));
    stop.count++;
    perWorker.set(place.id, stop);
    grouped.set(t.workerId, perWorker);
  }

  const before: DriverPlan[] = [...grouped].map(([workerId, perWorker]) =>
    makePlan(
      depot,
      workerId,
      drivers.get(workerId)!.name,
      [...perWorker].map(([placeId, s]) => {
        const place = byId.get(placeId)!;
        return {
          placeId,
          name: place.name,
          point: locate(place, byName)!,
          serviceMin: serviceMinutes([...s.types]) + EXTRA_TASK_MIN * (s.count - 1),
        };
      }),
    ),
  );

  let plans = before;
  const moves: Move[] = [];
  for (let k = 0; k < maxMoves; k++) {
    let best: { saved: number; savedKm: number; a: number; b: number; s: number; newA: DriverPlan; newB: DriverPlan } | null =
      null;
    for (let a = 0; a < plans.length; a++) {
      for (let s = 0; s < plans[a].stops.length; s++) {
        const stop = plans[a].stops[s];
        for (let b = 0; b < plans.length; b++) {
          if (b === a || !drivers.get(plans[b].workerId)?.can_lift) continue;
          const A = plans[a];
          const B = plans[b];
          if (allow && !allow({ placeId: stop.placeId, from: A.workerId, to: B.workerId })) continue;
          const nearest = Math.min(...B.stops.map((o) => haversineKm(o.point, stop.point) * 1.25));
          if (nearest > NEAR_KM) continue;
          const newA = makePlan(depot, A.workerId, A.name, A.stops.filter((_, i) => i !== s));
          const newB = makePlan(depot, B.workerId, B.name, [...B.stops, stop]);
          if (newB.totalMin > DAY_WINDOW_MIN) continue;
          const saved = A.route.driveMin + B.route.driveMin - newA.route.driveMin - newB.route.driveMin;
          if (!best || saved > best.saved) {
            best = { saved, savedKm: A.route.km + B.route.km - newA.route.km - newB.route.km, a, b, s, newA, newB };
          }
        }
      }
    }
    if (!best || best.saved < MIN_SAVING_MIN) break;

    const stop = plans[best.a].stops[best.s];
    const receiver = plans[best.b];
    let near: Stop | null = null;
    for (const other of receiver.stops) {
      if (!near || haversineKm(other.point, stop.point) < haversineKm(near.point, stop.point)) near = other;
    }
    moves.push({
      placeId: stop.placeId,
      placeName: stop.name,
      from: plans[best.a].workerId,
      to: receiver.workerId,
      fromName: plans[best.a].name,
      toName: receiver.name,
      nearName: near?.name ?? null,
      nearKm: near ? Math.round(haversineKm(near.point, stop.point) * 1.25) : null,
      savedMin: Math.round(best.saved),
      savedKm: Math.round(best.savedKm),
    });
    const { a, b, newA, newB } = best;
    plans = plans.map((p, i) => (i === a ? newA : i === b ? newB : p));
  }

  return {
    before,
    after: plans,
    moves,
    savedMin: moves.reduce((s, m) => s + m.savedMin, 0),
    savedKm: moves.reduce((s, m) => s + m.savedKm, 0),
    freed: before.filter((p) => p.stops.length > 0 && !plans.find((q) => q.workerId === p.workerId)?.stops.length).map((p) => p.workerId),
    unplaced,
  };
}
