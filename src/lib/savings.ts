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

export interface ImportsSavings {
  /** Carrier choices recorded. */
  choices: number;
  withAdvice: number;
  followed: number;
  /** A carrier other than the recommended one, at a known higher cost. */
  missedCount: number;
  missed: number;
  /** Possible overcharges found in the checked invoices. */
  flagged: number;
  overcharge: number;
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
  imports: ImportsSavings;
}

export const moneyOf = (min: number, km: number, rates: Rates) => km * rates.perKm + (min / 60) * rates.perHour;

function amount(ds: AdviceDecision[], rates: Rates): Amount {
  const min = ds.reduce((s, d) => s + d.saved_min, 0);
  const km = ds.reduce((s, d) => s + d.saved_km, 0);
  return { count: ds.length, min, km, money: moneyOf(min, km, rates) };
}

export function computeSavings(input: {
  decisions: AdviceDecision[];
  requests: { recommended: string | null; recommended_cost: number | null; chosen: string; chosen_cost: number | null }[];
  invoices: { overcharge: number }[];
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

  const withAdvice = input.requests.filter((r) => r.recommended);
  const missed = withAdvice.filter(
    (r) => r.chosen !== r.recommended && r.chosen_cost !== null && r.recommended_cost !== null && r.chosen_cost > r.recommended_cost,
  );
  const flagged = input.invoices.filter((i) => i.overcharge > 0);

  return {
    from,
    to: today,
    accepted: of(decisions, 'accepted'),
    declined: of(decisions, 'declined'),
    ignored: of(decisions, 'ignored'),
    weeks,
    declinedList: decisions.filter((d) => d.decision === 'declined').sort((a, b) => b.saved_min - a.saved_min),
    weeksElapsed: days / 7,
    imports: {
      choices: input.requests.length,
      withAdvice: withAdvice.length,
      followed: withAdvice.filter((r) => r.chosen === r.recommended).length,
      missedCount: missed.length,
      missed: missed.reduce((s, r) => s + (r.chosen_cost! - r.recommended_cost!), 0),
      flagged: flagged.length,
      overcharge: flagged.reduce((s, i) => s + i.overcharge, 0),
    },
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
  const im = r.imports;
  if (im.missedCount) lines.push(`יבוא: ${im.missedCount} משלוחים לא עם המוביל המומלץ, הפרש של כ-${shekels(im.missed)}`);
  if (im.flagged) lines.push(`יבוא: חריגות אפשריות בחשבוניות כ-${shekels(im.overcharge)}`);
  lines.push(`הערכה: ${rates.perKm} ₪ לק״מ ו-${rates.perHour} ₪ לשעת נהג, זמני נסיעה בלי פקקים.`);
  return lines.join('\n');
}
