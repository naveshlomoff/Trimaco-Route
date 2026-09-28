import type { DateHint } from './types';

export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const LETTER_DAYS: Record<string, number> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

/** Reads "למחר", "ליום ראשון", "ליום ה'" or "5.10" from the message header. */
export function detectDateHint(introLines: string[]): DateHint {
  const text = introLines.join(' ').replace(/["״]/g, '');

  const explicit = text.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]);
    let year: number | null = explicit[3] ? Number(explicit[3]) : null;
    if (year !== null && year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { kind: 'explicit', day, month, year };
  }

  const named = text.match(/יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי)/);
  if (named) return { kind: 'weekday', weekday: WEEKDAY_NAMES.indexOf(named[1]) };

  const letter = text.match(/יום\s+([א-ו])['׳]?(?=[\s:,.]|$)/);
  if (letter) return { kind: 'weekday', weekday: LETTER_DAYS[letter[1]] };

  if (/מחר/.test(text)) return { kind: 'tomorrow' };
  return { kind: 'none' };
}

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  r.setDate(r.getDate() + n);
  return r;
}

/** The work day a schedule refers to, given when it was written. */
export function resolveDate(hint: DateHint, sentAt: Date): string {
  switch (hint.kind) {
    case 'tomorrow':
      return toISODate(addDays(sentAt, 1));
    case 'weekday': {
      for (let i = 1; i <= 7; i++) {
        const d = addDays(sentAt, i);
        if (d.getDay() === hint.weekday) return toISODate(d);
      }
      return toISODate(addDays(sentAt, 1));
    }
    case 'explicit': {
      let year = hint.year ?? sentAt.getFullYear();
      let d = new Date(year, hint.month - 1, hint.day, 12);
      // "5.1" written in late December means next January
      if (hint.year === null && d.getTime() < addDays(sentAt, -180).getTime()) {
        year += 1;
        d = new Date(year, hint.month - 1, hint.day, 12);
      }
      return toISODate(d);
    }
    default: {
      let d = addDays(sentAt, 1);
      while (d.getDay() === 5 || d.getDay() === 6) d = addDays(d, 1);
      return toISODate(d);
    }
  }
}

/** "יום ראשון, 5.10.2026" */
export function formatDayLong(iso: string): string {
  const d = fromISODate(iso);
  return `יום ${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** "א׳ 5.10" */
export function formatDayShort(iso: string): string {
  const d = fromISODate(iso);
  const letters = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  return `${letters[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
}
