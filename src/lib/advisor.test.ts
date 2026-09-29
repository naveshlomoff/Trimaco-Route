import { describe, expect, it } from 'vitest';
import { adviseDay, fixedTasks, type AdviceTask } from './advisor';
import { planRoute } from './routing';
import type { Place, Worker } from './types';

const place = (name: string, lat: number, lng: number, kind: Place['kind'] = 'hospital'): Place => ({
  id: name,
  name,
  aliases: [],
  region: 'unknown',
  kind,
  city: null,
  address: null,
  lat,
  lng,
  notes: null,
});

const places = [
  place('מחסן', 31.93, 34.8, 'depot'),
  place('איכילוב', 32.08, 34.789),
  place('סורוקה', 31.258, 34.8),
  place('אסותא באר שבע', 31.25, 34.77),
];

const worker = (id: string, name: string): Worker => ({
  id,
  name,
  aliases: [],
  can_drive: true,
  can_lift: true,
  can_assemble: false,
  is_technical: false,
  work_days: [0, 1, 2, 3, 4],
  active: true,
  sort_order: 0,
});
const workers = [worker('dani', 'דני'), worker('roni', 'רוני')];
const task = (workerId: string, placeId: string): AdviceTask => ({ workerId, placeId, isField: true, types: ['delivery'] });

describe('planRoute', () => {
  it('visits every stop and drives no further than out to the farthest one and back', () => {
    const depot = { lat: 31.9, lng: 34.8 };
    const route = planRoute(depot, [
      { lat: 32.3, lng: 34.8 },
      { lat: 32.1, lng: 34.8 },
      { lat: 32.5, lng: 34.8 },
    ]);
    expect([...route.order].sort()).toEqual([0, 1, 2]);
    // 0.6° of latitude ≈ 66.7 km each way, times the road factor of 1.25
    expect(route.km).toBeGreaterThan(160);
    expect(route.km).toBeLessThan(175);
  });
});

describe('adviseDay', () => {
  it('hands a stop to the driver who is already next to it, freeing the other one', () => {
    const advice = adviseDay(
      [task('dani', 'איכילוב'), task('dani', 'אסותא באר שבע'), task('roni', 'סורוקה')],
      { places, workers },
    )!;
    // Roni drives to Be'er Sheva only for Soroka, 3 km from where Dani is anyway
    expect(advice.moves).toHaveLength(1);
    expect(advice.moves[0]).toMatchObject({ placeName: 'סורוקה', fromName: 'רוני', toName: 'דני', nearName: 'אסותא באר שבע' });
    expect(advice.savedMin).toBeGreaterThan(100);
    expect(advice.freed).toEqual(['roni']);
  });

  it('leaves a stop with a set time with its driver', () => {
    const soroka = { ...task('roni', 'סורוקה'), fixed: true };
    const advice = adviseDay([task('dani', 'איכילוב'), task('dani', 'אסותא באר שבע'), soroka], { places, workers })!;
    // Soroka stays with Roni; the stop next to it goes to him instead
    expect(advice.moves.map((m) => m.placeName)).not.toContain('סורוקה');
    expect(advice.moves[0]).toMatchObject({ placeName: 'אסותא באר שבע', fromName: 'דני', toName: 'רוני' });
  });

  it('knows which stops stay put: a set time, or two stops of one driver that go together', () => {
    const fact = (workerId: string, placeId: string, description: string, timed = false) => ({
      workerId,
      placeId,
      isField: true,
      timed,
      description,
    });
    const fixed = fixedTasks(
      [
        fact('dani', 'איכילוב', 'לאסוף רשתות ולהעביר לסורוקה'),
        fact('dani', 'סורוקה', 'לספק רשתות'),
        fact('roni', 'אסותא באר שבע', 'לספק הזמנה'),
        fact('roni', 'איכילוב', 'אספקה', true),
      ],
      places,
    );
    // Dani carries the sets from Ichilov to Soroka; Roni's other stop just names no stop of his
    expect(fixed).toEqual([true, true, false, true]);
  });

  it('does not send a driver across the country', () => {
    const advice = adviseDay([task('dani', 'איכילוב'), task('roni', 'סורוקה')], { places, workers })!;
    expect(advice.moves).toEqual([]);
  });
});
