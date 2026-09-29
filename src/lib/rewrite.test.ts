import { describe, expect, it } from 'vitest';
import seed from '../../supabase/seed-places.json';
import { parseSchedule } from './parser';
import { canRewrite, rewriteMove } from './rewrite';
import type { Place, Worker } from './types';

// Made-up team, as in parser.test.ts.
const workers: Worker[] = ['dani', 'roni', 'maya'].map((id, i) => ({
  id,
  name: ['דני', 'רוני', 'מאיה'][i],
  aliases: [],
  can_drive: true,
  can_lift: true,
  can_assemble: false,
  is_technical: false,
  work_days: [0, 1, 2, 3, 4],
  active: true,
  sort_order: i,
}));

type SeedPlace = Pick<Place, 'name' | 'aliases' | 'region' | 'kind'>;
const places: Place[] = (seed as unknown as SeedPlace[]).map((p) => ({
  ...p,
  id: p.name,
  city: null,
  address: null,
  lat: null,
  lng: null,
  notes: null,
}));
const ctx = { workers, places };

const placesOf = (text: string, worker: string) =>
  parseSchedule(text, ctx)
    .sections.filter((s) => s.workerId === worker)
    .flatMap((s) => s.tasks.map((t) => t.placeId));

describe('rewriteMove', () => {
  it('moves the stop and its "+" line to the end of the receiver\'s part', () => {
    const msg = [
      'שלום לכולם,',
      'סידור צוות לוגיסטיקה למחר:',
      '',
      '*דני*',
      '• שיבא - לספק רשתות',
      '• איכילוב - לאסוף ציוד',
      '+ להחזיר ארגז השלמות',
      '',
      '*רוני*',
      '• גבעתיים - לספק הזמנה',
      '',
      'קחו בחשבון לשינויים',
    ].join('\n');
    const out = rewriteMove(msg, parseSchedule(msg, ctx), { placeId: 'איכילוב', from: 'dani', to: 'roni' })!;
    expect(out.freed).toBe(false);
    expect(out.text).toBe(
      [
        'שלום לכולם,',
        'סידור צוות לוגיסטיקה למחר:',
        '',
        '*דני*',
        '• שיבא - לספק רשתות',
        '',
        '*רוני*',
        '• גבעתיים - לספק הזמנה',
        '• איכילוב - לאסוף ציוד',
        '+ להחזיר ארגז השלמות',
        '',
        'קחו בחשבון לשינויים',
      ].join('\n'),
    );
    const again = parseSchedule(out.text, ctx);
    expect(placesOf(out.text, 'roni')).toEqual(['גבעתיים', 'איכילוב']);
    expect(again.sections[1].tasks[1].description).toContain('להחזיר ארגז השלמות');
    expect(again.notes).toEqual(['קחו בחשבון לשינויים']);
  });

  it('leaves "מחסן" for a worker with nothing left, and renumbers numbered lines', () => {
    const msg = ['סידור לצוות לוגיסטיקה למחר:', '*דני*', '1.\tשיבא - לספק רשתות', '*רוני*', '1.\tגבעתיים - לספק', '2.\tבני ברק - לאסוף'].join('\n');
    const out = rewriteMove(msg, parseSchedule(msg, ctx), { placeId: 'שיבא', from: 'dani', to: 'roni' })!;
    expect(out.freed).toBe(true);
    expect(out.text.split('\n')).toEqual([
      'סידור לצוות לוגיסטיקה למחר:',
      '*דני*',
      '1.\tמחסן',
      '*רוני*',
      '1.\tגבעתיים - לספק',
      '2.\tבני ברק - לאסוף',
      '3.\tשיבא - לספק רשתות',
    ]);
    const again = parseSchedule(out.text, ctx);
    expect(again.sections[0].tasks[0].match).toBe('inhouse');
  });

  it('works when the receiver comes first in the message', () => {
    const msg = ['סידור צוות לוגיסטיקה למחר:', '*רוני*', '• גבעתיים - לספק', '*דני*', '• שיבא - לספק', '• איכילוב - לאסוף'].join('\n');
    const out = rewriteMove(msg, parseSchedule(msg, ctx), { placeId: 'שיבא', from: 'dani', to: 'roni' })!;
    expect(placesOf(out.text, 'roni')).toEqual(['גבעתיים', 'שיבא']);
    expect(placesOf(out.text, 'dani')).toEqual(['איכילוב']);
  });

  it('declines to rewrite a stop that shares its line with other stops', () => {
    const msg = 'סידור לצוות לוגיסטיקה למחר:\n1.\t*דני* – איכילוב לספק ארגז, שיבא לספק הזמנה\n2.\t*רוני* – גבעתיים לספק';
    const day = parseSchedule(msg, ctx);
    const m = { placeId: 'שיבא', from: 'dani', to: 'roni' };
    expect(canRewrite(day, m)).toBe(false);
    expect(rewriteMove(msg, day, m)).toBeNull();
  });
});
