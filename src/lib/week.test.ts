import { describe, expect, it } from 'vitest';
import type { DaySummary } from './store';
import type { AdviceDecision } from './types';
import { computeWeek, weekStart, weekText } from './week';

const day = (date: string): DaySummary => ({ date, saved_at: `${date}T13:30:00Z`, source: 'paste', version: 1 });
const decision = (date: string, d: AdviceDecision['decision'], saved_min: number): AdviceDecision => ({
  date,
  place_id: 'p',
  place_name: 'שיבא',
  from_worker: 'dani',
  to_worker: 'roni',
  saved_min,
  saved_km: 10,
  decision: d,
});

describe('weekStart', () => {
  it('starts the week on Sunday; Friday and Saturday belong to the week just ended', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-11'); // Thursday
    expect(weekStart('2026-10-16')).toBe('2026-10-11'); // Friday
    expect(weekStart('2026-10-11')).toBe('2026-10-11'); // Sunday
  });
});

describe('computeWeek', () => {
  const base = { start: '2026-10-11', tasks: [], places: [], workers: [] };

  it('shows which work days were pasted, missed, or are not due yet', () => {
    const r = computeWeek({ ...base, today: '2026-10-13', days: [day('2026-10-11'), day('2026-10-12')], decisions: [] });
    expect(r.days.map((d) => d.status)).toEqual(['saved', 'saved', 'missing', 'upcoming', 'upcoming']);
    expect(r).toMatchObject({ pasted: 2, due: 3, missing: ['2026-10-13'] });
  });

  it('counts the answers to suggestions and the driving saved by the accepted ones', () => {
    const r = computeWeek({
      ...base,
      today: '2026-10-16',
      days: ['11', '12', '13', '14'].map((d) => day(`2026-10-${d}`)),
      decisions: [decision('2026-10-12', 'accepted', 35), decision('2026-10-13', 'declined', 20), decision('2026-10-20', 'accepted', 50)],
    });
    expect(r).toMatchObject({ pasted: 4, due: 5, shown: 2, accepted: 1, declined: 1, savedMin: 35 });
    const text = weekText(r);
    expect(text).toContain('סידורים שהודבקו: 4 מתוך 5. לא הודבק: ה׳ 15.10');
    expect(text).toContain('2 הוצגו · 1 הועברו (50% מהנענות) · 1 נדחו');
    expect(text).toContain('נהיגה שנחסכה: כ-35 דק׳');
  });

  it('lists Friday only when a schedule was sent for it', () => {
    const r = computeWeek({ ...base, today: '2026-10-17', days: [day('2026-10-16')], decisions: [] });
    expect(r.days.map((d) => d.date)).toContain('2026-10-16');
    expect(r).toMatchObject({ pasted: 0, due: 5 });
  });
});
