// Each driver's load since the schedule started being pasted every day, next
// to the months before it (the WhatsApp history).

import { fromISODate } from './dates';
import { computeShadow } from './shadow';
import type { DaySummary } from './store';
import type { Place, Profile, TaskRow, Worker } from './types';
import { addDays, BASELINE_DAYS, teamUtilization } from './week';

export interface DriverPeriod {
  workerId: string;
  name: string;
  days: number;
  utilization: number;
  avgDayMin: number;
  /** Over the months before `from`, for comparison. */
  baseline: number | null;
}

export interface UtilizationReport {
  from: string;
  to: string;
  drivers: DriverPeriod[];
  team: { utilization: number | null; baseline: number | null };
}

/** The first schedule a planner pasted, when the app went into daily use; the first pasted one if none. */
export function startOfUse(days: DaySummary[], profiles: Profile[]): string | null {
  const planners = new Set(profiles.filter((p) => p.role === 'planner').map((p) => p.id));
  const pasted = days.filter((d) => d.source === 'paste').sort((a, b) => a.date.localeCompare(b.date));
  return (pasted.find((d) => d.saved_by && planners.has(d.saved_by)) ?? pasted[0])?.date ?? null;
}

export function computeUtilization(input: {
  from: string;
  to: string;
  /** Tasks from BASELINE_DAYS before `from` to `to`. */
  tasks: TaskRow[];
  places: Place[];
  workers: Worker[];
}): UtilizationReport {
  const { from, to, places, workers } = input;
  const now = computeShadow(
    input.tasks.filter((t) => t.date >= from && t.date <= to),
    places,
    workers,
  );
  const before = computeShadow(
    input.tasks.filter((t) => t.date < from && t.date >= addDays(from, -BASELINE_DAYS)),
    places,
    workers,
  );
  const baseById = new Map(before.drivers.map((d) => [d.workerId, d.utilization]));
  return {
    from,
    to,
    drivers: now.drivers.map((d) => ({
      workerId: d.workerId,
      name: d.name,
      days: d.days,
      utilization: d.utilization,
      avgDayMin: d.avgDayMin,
      baseline: baseById.get(d.workerId) ?? null,
    })),
    team: { utilization: teamUtilization(now.drivers), baseline: teamUtilization(before.drivers) },
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const dm = (iso: string) => `${fromISODate(iso).getDate()}.${fromISODate(iso).getMonth() + 1}`;
const before = (x: number | null) => (x === null ? '' : ` · לפני: ${pct(x)}`);

/** The summary as a WhatsApp message. */
export function utilizationText(r: UtilizationReport): string {
  const lines = [`ניצולת נהגים ${dm(r.from)}–${dm(r.to)} · Trimaco Route`];
  for (const d of r.drivers) {
    lines.push(`${d.name}: ${pct(d.utilization)} (${d.days === 1 ? 'יום אחד' : `${d.days} ימים`} בשטח)${before(d.baseline)}`);
  }
  if (r.team.utilization !== null) lines.push(`כל הצוות: ${pct(r.team.utilization)}${before(r.team.baseline)}`);
  lines.push('ניצולת = נהיגה + זמן בעצירות, חלקי 9:00–17:00, בימים שהנהג יצא לשטח. "לפני" = 3 החודשים שלפני.');
  return lines.join('\n');
}
