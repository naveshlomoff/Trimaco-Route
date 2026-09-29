// "Shadow mode": the advisor run quietly over saved days, to measure what it
// would have changed before anyone is asked to act on it.

import { adviseDay, DAY_WINDOW_MIN, type AdviceTask, type DayAdvice } from './advisor';
import type { Place, TaskRow, Worker } from './types';

export interface ShadowDay {
  date: string;
  advice: DayAdvice;
}

export interface DriverLoad {
  workerId: string;
  name: string;
  days: number;
  /** Average estimated day: driving plus time at stops, in minutes. */
  avgDayMin: number;
  avgDriveMin: number;
  /** Share of the 9:00–17:00 window. */
  utilization: number;
}

export interface Shadow {
  days: ShadowDay[];
  daysWithAdvice: number;
  driveMin: number;
  savedMin: number;
  freedDriverDays: number;
  drivers: DriverLoad[];
}

export function toAdviceTasks(rows: TaskRow[]): AdviceTask[] {
  return rows.map((t) => ({ workerId: t.worker_id, placeId: t.place_id, isField: t.is_field, types: t.task_types }));
}

export function computeShadow(tasks: TaskRow[], places: Place[], workers: Worker[]): Shadow {
  const byDate = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }

  const days: ShadowDay[] = [];
  const load = new Map<string, { name: string; days: number; total: number; drive: number }>();
  let driveMin = 0;
  for (const [date, rows] of [...byDate].sort((a, b) => b[0].localeCompare(a[0]))) {
    const advice = adviseDay(toAdviceTasks(rows), { places, workers });
    if (!advice) continue;
    days.push({ date, advice });
    for (const p of advice.before) {
      driveMin += p.route.driveMin;
      const l = load.get(p.workerId) ?? { name: p.name, days: 0, total: 0, drive: 0 };
      l.days++;
      l.total += p.totalMin;
      l.drive += p.route.driveMin;
      load.set(p.workerId, l);
    }
  }

  const order = new Map(workers.map((w, i) => [w.id, i]));
  return {
    days,
    daysWithAdvice: days.filter((d) => d.advice.moves.length > 0).length,
    driveMin,
    savedMin: days.reduce((s, d) => s + d.advice.savedMin, 0),
    freedDriverDays: days.reduce((s, d) => s + d.advice.freed.length, 0),
    drivers: [...load]
      .map(([workerId, l]) => ({
        workerId,
        name: l.name,
        days: l.days,
        avgDayMin: l.total / l.days,
        avgDriveMin: l.drive / l.days,
        utilization: l.total / l.days / DAY_WINDOW_MIN,
      }))
      .sort((a, b) => (order.get(a.workerId) ?? 99) - (order.get(b.workerId) ?? 99)),
  };
}
