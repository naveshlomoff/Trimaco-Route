// What the suggestions saved since they went live, and what the declined ones
// would have saved: in driving, and in money at rates the manager sets.

import { addDays, hoursLabel, weekStart } from './week';
import type { AdviceDecision } from './types';

export interface Rates {
  /** ₪ per km: a delivery van's fuel and wear. */
  perKm: number;
  /** ₪ per hour of a driver, with the employer's costs. */
  perHour: number;
}

export const DEFAULT_RATES: Rates = { perKm: 1.2, perHour: 70 };

export interface Amount {
  count: number;
  min: number;
  km: number;
  money: number;
}

export interface SavingsWeek {
  start: string;
  accepted: Amount;
  declined: Amount;
  ignored: Amount;
}

export interface SavingsReport {
  /** The first suggestion's day; null before any. */
  from: string | null;
  to: string;
  accepted: Amount;
  declined: Amount;
  ignored: Amount;
  weeks: SavingsWeek[];
  /** The declined suggestions, the biggest first. */
  declinedList: AdviceDecision[];
  /** Weeks since the first suggestion, for a yearly pace. */
  weeksElapsed: number;
}

export const moneyOf = (min: number, km: number, rates: Rates) => km * rates.perKm + (min / 60) * rates.perHour;

function amount(ds: AdviceDecision[], rates: Rates): Amount {
  const min = ds.reduce((s, d) => s + d.saved_min, 0);
  const km = ds.reduce((s, d) => s + d.saved_km, 0);
  return { count: ds.length, min, km, money: moneyOf(min, km, rates) };
}

export function computeSavings(input: {
  decisions: AdviceDecision[];
  rates: Rates;
  today: string;
}): SavingsReport {
  const { rates, today } = input;
  const decisions = input.decisions.filter((d) => d.date <= today);
  const of = (ds: AdviceDecision[], k: AdviceDecision['decision']) =>
    amount(
      ds.filter((d) => d.decision === k),
      rates,
    );
  const from = decisions.length ? decisions.map((d) => d.date).sort()[0] : null;

  const weeks: SavingsWeek[] = [];
  if (from) {
    for (let start = weekStart(from); start <= today; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      const ds = decisions.filter((d) => d.date >= start && d.date <= end);
      weeks.push({ start, accepted: of(ds, 'accepted'), declined: of(ds, 'declined'), ignored: of(ds, 'ignored') });
    }
  }
  const days = from ? (Date.parse(today) - Date.parse(from)) / 86_400_000 + 1 : 0;

  return {
    from,
    to: today,
    accepted: of(decisions, 'accepted'),
    declined: of(decisions, 'declined'),
    ignored: of(decisions, 'ignored'),
    weeks,
    declinedList: decisions.filter((d) => d.decision === 'declined').sort((a, b) => b.saved_min - a.saved_min),
    weeksElapsed: days / 7,
  };
}

export const shekels = (x: number) => `${Math.round(x).toLocaleString('he-IL')} ₪`;

/** A year at the pace of the weeks so far; null with less than two weeks behind. */
export function perYear(money: number, r: SavingsReport): number | null {
  return r.weeksElapsed >= 2 ? (money / r.weeksElapsed) * 52 : null;
}

const dm = (iso: string) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}`;

/** The summary as a message, to send on. */
export function savingsText(r: SavingsReport, rates: Rates): string {
  if (!r.from) return 'עוד לא הוצגו הצעות לשיפור.';
  const line = (a: Amount) => `${shekels(a.money)} (${hoursLabel(a.min)} נהיגה, ${a.km} ק״מ)`;
  const lines = [
    `סיכום חיסכון, ${dm(r.from)}–${dm(r.to)}`,
    `הצעות שהועברו: ${r.accepted.count}. נחסכו כ-${line(r.accepted)}`,
    `הצעות שנדחו: ${r.declined.count}. היה אפשר לחסוך עוד כ-${line(r.declined)}`,
  ];
  if (r.ignored.count) lines.push(`הצעות בלי תשובה: ${r.ignored.count}. עוד כ-${line(r.ignored)}`);
  const year = perYear(r.accepted.money, r);
  const all = perYear(r.accepted.money + r.declined.money + r.ignored.money, r);
  if (year !== null && all !== null) lines.push(`בקצב הזה: כ-${shekels(year)} בשנה, וכ-${shekels(all)} אם כל ההצעות היו מועברות`);
  lines.push(`הערכה: ${rates.perKm} ₪ לק״מ ו-${rates.perHour} ₪ לשעת נהג, זמני נסיעה בלי פקקים.`);
  return lines.join('\n');
}

/** Work days (Sunday to Thursday) from `from` to `today`, and how many of them had a schedule pasted. */
export function pastedDays(from: string, today: string, saved: string[]): { pasted: number; due: number } {
  const have = new Set(saved);
  let pasted = 0;
  let due = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (new Date(`${d}T12:00:00`).getDay() > 4) continue;
    due++;
    if (have.has(d)) pasted++;
  }
  return { pasted, due };
}
