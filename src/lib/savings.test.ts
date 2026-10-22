import { describe, expect, it } from 'vitest';
import { computeSavings, perYear, savingsText } from './savings';
import type { AdviceDecision } from './types';

const d = (date: string, decision: AdviceDecision['decision'], saved_min: number, saved_km: number): AdviceDecision => ({
  date,
  place_id: `${date}-${saved_min}`,
  place_name: 'מקום',
  from_worker: 'a',
  to_worker: 'b',
  saved_min,
  saved_km,
  decision,
});

const rates = { perKm: 1, perHour: 60 };

describe('computeSavings', () => {
  const decisions = [
    d('2026-09-29', 'accepted', 30, 20),
    d('2026-09-30', 'declined', 60, 50),
    d('2026-10-06', 'accepted', 15, 10),
    d('2026-10-07', 'ignored', 10, 5),
    d('2026-10-08', 'declined', 20, 15),
  ];
  const r = computeSavings({ decisions, requests: [], invoices: [], rates, today: '2026-10-22' });

  it('adds up what was saved, what was declined and what got no answer, in money', () => {
    // minutes at 1 ₪ a minute, plus a shekel a km
    expect(r.accepted).toEqual({ count: 2, min: 45, km: 30, money: 75 });
    expect(r.declined).toEqual({ count: 2, min: 80, km: 65, money: 145 });
    expect(r.ignored).toMatchObject({ count: 1, money: 15 });
    expect(r.declinedList.map((x) => x.saved_min)).toEqual([60, 20]);
  });

  it('splits by week from the first suggestion to today', () => {
    expect(r.from).toBe('2026-09-29');
    expect(r.weeks.map((w) => w.accepted.count)).toEqual([1, 1, 0, 0]);
    expect(r.weeks[1].declined.money).toBe(35);
  });

  it('gives a yearly pace and a message to send', () => {
    expect(perYear(r.accepted.money, r)).toBeCloseTo((75 / (24 / 7)) * 52);
    const text = savingsText(r, rates);
    expect(text).toContain('הצעות שהועברו: 2. נחסכו כ-75 ₪');
    expect(text).toContain('הצעות שנדחו: 2. היה אפשר לחסוך עוד כ-145 ₪');
  });

  it('counts imports choices away from a cheaper recommendation', () => {
    const im = computeSavings({
      decisions: [],
      requests: [
        { recommended: 'KRIEF', recommended_cost: 1000, chosen: 'KRIEF', chosen_cost: 1000 },
        { recommended: 'KRIEF', recommended_cost: 1000, chosen: 'מעיין', chosen_cost: 1300 },
        { recommended: 'KRIEF', recommended_cost: 1000, chosen: 'אחר', chosen_cost: null },
      ],
      invoices: [{ overcharge: 0 }, { overcharge: 250 }],
      rates,
      today: '2026-10-22',
    }).imports;
    expect(im).toEqual({ choices: 3, withAdvice: 3, followed: 1, missedCount: 1, missed: 300, flagged: 1, overcharge: 250 });
  });
});
