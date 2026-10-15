// The weekly summary for managers: which schedules were pasted, what the
// advisor suggested and what was done with it, and how loaded the drivers
// were compared with the months before.

import { formatDayShort, fromISODate, toISODate } from './dates';
import { computeShadow } from './shadow';
import type { DaySummary } from './store';
import type { AdviceDecision, Place, TaskRow, Worker } from './types';

const WORK_DAYS = 5; // Sunday to Thursday
export const BASELINE_DAYS = 91;

export function addDays(iso: string, n: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** The Sunday that starts the week of `iso` (Friday and Saturday belong to the week just ended). */
export function weekStart(iso: string): string {
  return addDays(iso, -fromISODate(iso).getDay());
}

/** 'upcoming': not due yet (tomorrow's schedule is sent today). */
export type DayStatus = 'saved' | 'missing' | 'upcoming';

export interface WeekDay {
  date: string;
  status: DayStatus;
  day: DaySummary | null;
}

export interface DriverWeek {
  workerId: string;
  name: string;
  days: number;
  utilization: number;
  /** Over the months before this week, for comparison. */
  baseline: number | null;
}

export interface WeekReport {
  from: string;
  /** Thursday. */
  to: string;
  days: WeekDay[];
  pasted: number;
  /** Work days already due. */
  due: number;
  missing: string[];
  decisions: AdviceDecision[];
  shown: number;
  accepted: number;
  declined: number;
  ignored: number;
  /** Driving saved by the suggestions that were accepted. */
  savedMin: number;
  /** What the advisor would still change in the saved schedules. */
  open: { days: number; savedMin: number };
  drivers: DriverWeek[];
  team: { utilization: number | null; baseline: number | null };
}

export interface WeekInput {
  start: string;
  today: string;
  /** Days saved from `start` to `start` + 6. */
  days: DaySummary[];
  /** Tasks from BASELINE_DAYS before `start` to the end of the week. */
  tasks: TaskRow[];
  decisions: AdviceDecision[];
  places: Place[];
  workers: Worker[];
}

const isWorkDay = (iso: string) => fromISODate(iso).getDay() < WORK_DAYS;

function teamUtilization(drivers: { days: number; utilization: number }[]): number | null {
  const days = drivers.reduce((s, d) => s + d.days, 0);
  return days ? drivers.reduce((s, d) => s + d.utilization * d.days, 0) / days : null;
}

export function computeWeek(input: WeekInput): WeekReport {
  const { start, today, places, workers } = input;
  const to = addDays(start, WORK_DAYS - 1);
  const end = addDays(start, 6);
  const saved = new Map(input.days.map((d) => [d.date, d]));

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const day = saved.get(date) ?? null;
    if (i >= WORK_DAYS && !day) continue; // Friday and Saturday only when something was sent
    days.push({ date, day, status: day ? 'saved' : date <= today ? 'missing' : 'upcoming' });
  }

  const decisions = input.decisions.filter((d) => d.date >= start && d.date <= end);
  const count = (k: AdviceDecision['decision']) => decisions.filter((d) => d.decision === k).length;
  const weekTasks = input.tasks.filter((t) => t.date >= start && t.date <= end);
  const before = input.tasks.filter((t) => t.date < start && t.date >= addDays(start, -BASELINE_DAYS));
  const week = computeShadow(weekTasks, places, workers);
  const base = computeShadow(before, places, workers);
  const baseById = new Map(base.drivers.map((d) => [d.workerId, d]));

  return {
    from: start,
    to,
    days,
    pasted: days.filter((d) => d.status === 'saved' && isWorkDay(d.date)).length,
    due: days.filter((d) => d.status !== 'upcoming' && isWorkDay(d.date)).length,
    missing: days.filter((d) => d.status === 'missing').map((d) => d.date),
    decisions,
    shown: decisions.length,
    accepted: count('accepted'),
    declined: count('declined'),
    ignored: count('ignored'),
    savedMin: decisions.filter((d) => d.decision === 'accepted').reduce((s, d) => s + d.saved_min, 0),
    open: { days: week.daysWithAdvice, savedMin: week.savedMin },
    drivers: week.drivers.map((d) => ({
      workerId: d.workerId,
      name: d.name,
      days: d.days,
      utilization: d.utilization,
      baseline: baseById.get(d.workerId)?.utilization ?? null,
    })),
    team: { utilization: teamUtilization(week.drivers), baseline: teamUtilization(base.drivers) },
  };
}

export function hoursLabel(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m} דק׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ש׳`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The summary as a WhatsApp message, to send on to Liraz. */
export function weekText(r: WeekReport): string {
  const range = `${fromISODate(r.from).getDate()}.${fromISODate(r.from).getMonth() + 1}–${fromISODate(r.to).getDate()}.${fromISODate(r.to).getMonth() + 1}`;
  const lines = [`סיכום שבוע ${range} · Trimaco Route`];
  let pasted = `סידורים שהודבקו: ${r.pasted} מתוך ${r.due}`;
  if (r.missing.length) pasted += `. לא הודבק: ${r.missing.map(formatDayShort).join(', ')}`;
  lines.push(pasted);
  if (r.shown) {
    const answered = r.accepted + r.declined;
    lines.push(
      `הצעות: ${r.shown} הוצגו · ${r.accepted} הועברו${answered ? ` (${Math.round((100 * r.accepted) / answered)}% מהנענות)` : ''} · ${r.declined} נדחו`,
    );
    if (r.savedMin) lines.push(`נהיגה שנחסכה: כ-${hoursLabel(r.savedMin)}`);
  } else {
    lines.push('הצעות: לא הוצגו השבוע');
  }
  if (r.drivers.length) {
    const team = r.team.utilization !== null ? ` · צוות ${pct(r.team.utilization)}` : '';
    const base = r.team.baseline !== null ? ` (3 החודשים שלפני: ${pct(r.team.baseline)})` : '';
    lines.push(`ניצולת: ${r.drivers.map((d) => `${d.name} ${pct(d.utilization)}`).join(' · ')}${team}${base}`);
  }
  return lines.join('\n');
}
