// A driver's day as a round trip: warehouse → stops → warehouse.
// The visiting order is nearest-neighbour followed by 2-opt, which is exact
// or very close for the handful of stops a driver has in a day.

import { driveMinutes, roadKm, type LatLng } from './geo';
import type { TaskType } from './types';

/** Minutes at a stop by the kind of work (Liraz's defaults: pickup/delivery 20, both 30, install 50). */
export function serviceMinutes(types: TaskType[]): number {
  if (types.includes('install')) return 50;
  if (types.includes('service')) return 45;
  if (types.includes('count')) return 45;
  if (types.includes('pickup') && types.includes('delivery')) return 30;
  if (types.includes('rotation')) return 25;
  if (types.includes('pickup') || types.includes('delivery')) return 20;
  return 15;
}

export interface Route {
  /** Indexes into the stops given, in visiting order. */
  order: number[];
  driveMin: number;
  km: number;
}

export function planRoute(depot: LatLng, pts: LatLng[]): Route {
  if (pts.length === 0) return { order: [], driveMin: 0, km: 0 };
  const all = [depot, ...pts]; // 0 is the warehouse
  const m = all.length;
  const d = all.map((a) => all.map((b) => driveMinutes(a, b)));

  // nearest neighbour from the warehouse
  const tour = [0];
  const used = new Array<boolean>(m).fill(false);
  used[0] = true;
  for (let k = 1; k < m; k++) {
    const last = tour[tour.length - 1];
    let best = -1;
    for (let i = 1; i < m; i++) if (!used[i] && (best < 0 || d[last][i] < d[last][best])) best = i;
    tour.push(best);
    used[best] = true;
  }
  tour.push(0);

  // 2-opt: reverse any stretch that shortens the round trip, until nothing does
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 1; i < tour.length - 2; i++) {
      for (let j = i + 1; j < tour.length - 1; j++) {
        const delta = d[tour[i - 1]][tour[j]] + d[tour[i]][tour[j + 1]] - d[tour[i - 1]][tour[i]] - d[tour[j]][tour[j + 1]];
        if (delta < -0.01) {
          tour.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }

  let driveMin = 0;
  let km = 0;
  for (let k = 1; k < tour.length; k++) {
    driveMin += d[tour[k - 1]][tour[k]];
    km += roadKm(all[tour[k - 1]], all[tour[k]]);
  }
  return { order: tour.slice(1, -1).map((i) => i - 1), driveMin, km };
}
