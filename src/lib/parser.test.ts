import { describe, expect, it } from 'vitest';
import seed from '../../supabase/seed-places.json';
import { detectDateHint, resolveDate } from './dates';
import { readHistory } from './history';
import { looksLikeSchedule, parseSchedule, unresolvedTasks } from './parser';
import type { Place, Worker } from './types';

// Made-up team and message in the same format Adi uses.
const workers: Worker[] = [
  ['dani', 'דני', false],
  ['roni', 'רוני', false],
  ['maya', 'מאיה', false],
  ['shahar', 'שחר', true],
  ['guy', 'גיא', false],
].map(([id, name, tech], i) => ({
  id: id as string,
  name: name as string,
  aliases: [],
  can_drive: true,
  can_lift: true,
  can_assemble: false,
  is_technical: tech as boolean,
  work_days: [0, 1, 2, 3, 4],
  active: true,
  sort_order: i,
}));

type SeedPlace = Pick<Place, 'name' | 'aliases' | 'region' | 'kind'> & { city?: string; address?: string };

const places: Place[] = (seed as unknown as SeedPlace[]).map((p) => ({
  ...p,
  id: p.name,
  city: p.city ?? null,
  address: p.address ?? null,
  lat: null,
  lng: null,
  notes: null,
}));

const ctx = { workers, places };

const MESSAGE = `שלום לכולם,
סידור צוות לוגיסטיקה ליום ראשון:

*דני*
• אסותא באר שבע - לאסוף רשתות A + רשתות B (סה"כ 10)
• סוריה - לספק הזמנות
• רעננה אחוזה 301- לספק הזמנה ?

*רוני*
• בית עריף – אספקה והתקנת מכשיר ללקוח – בין השעות 10-12, להתקשר להכוונה. להחזיר תעודה חתומה.
• גבעתיים – ד"ר לקוח, כתובת: הרצל 1. להחזיר תעודה חתומה.
• הרצליה - אספקת הזמנה + איסוף צ'ק.
• אסותא ת"א - לספק רשתות + לגלגל רשתות C
• סידור מדפים באיכילוב

*מאיה*
מחסן
• הכנת רשתות לניתוחים
• הכנת הזמנות לאיכילוב

*שחר* - שירות טכני
• כפר סבא - טיפול בקריאת שירות
• עבודה במפעל

*גיא* - מחסן

*סידור רכב*
• שחר מהבוקר עד הצהריים

קחו בחשבון לשינויים
שבת שלום`;

describe('parseSchedule', () => {
  const day = parseSchedule(MESSAGE, ctx);
  const tasksOf = (id: string) => day.sections.find((s) => s.workerId === id)!.tasks;

  it('splits the message into worker sections, vehicle notes and closing notes', () => {
    expect(day.sections.map((s) => s.workerId)).toEqual(['dani', 'roni', 'maya', 'shahar', 'guy']);
    expect(day.intro).toEqual(['שלום לכולם,', 'סידור צוות לוגיסטיקה ליום ראשון:']);
    expect(day.vehicle).toEqual([{ workerId: 'shahar', text: 'שחר מהבוקר עד הצהריים' }]);
    expect(day.notes).toEqual(['קחו בחשבון לשינויים', 'שבת שלום']);
    expect(day.sections[3].label).toBe('שירות טכני');
  });

  it('recognises places by name, alias, city prefix and inside the line', () => {
    const [bs, , raanana] = tasksOf('dani');
    expect(bs).toMatchObject({ placeId: 'אסותא באר שבע', match: 'exact', types: ['pickup'] });
    expect(raanana).toMatchObject({ placeId: 'רעננה', match: 'prefix', address: 'אחוזה 301' });
    expect(raanana.flags).toContain('uncertain');

    const roni = tasksOf('roni');
    expect(roni[3]).toMatchObject({ placeId: 'אסותא רמת החייל', match: 'exact' });
    expect(roni[3].types).toEqual(['delivery', 'rotation']);
    expect(roni[4]).toMatchObject({ placeId: 'איכילוב', match: 'contains', isField: true });
  });

  it('suggests the closest known places for an unrecognised one', () => {
    const unknown = tasksOf('dani')[1];
    expect(unknown.match).toBe('unknown');
    expect(unknown.placeId).toBeNull();
    // "סוריה" is one letter from פוריה and two from סורוקה: both are offered, closest first
    expect(unknown.candidates[0].name).toBe('פוריה');
    expect(unknown.candidates.map((c) => c.name)).toContain('סורוקה');
    expect(unresolvedTasks(day)).toHaveLength(1);
  });

  it('reads time windows, addresses and flags', () => {
    const [install, clinic, herzliya] = tasksOf('roni');
    expect(install).toMatchObject({ windowStart: '10:00', windowEnd: '12:00', placeId: 'בית עריף' });
    expect(install.types).toEqual(['delivery', 'install']);
    expect(install.flags).toEqual(expect.arrayContaining(['signed_doc', 'call_ahead']));
    expect(clinic).toMatchObject({ placeId: 'גבעתיים', address: 'הרצל 1' });
    expect(herzliya.types).toEqual(['delivery', 'check']);
  });

  it('treats warehouse work as in-house, even when a hospital is mentioned', () => {
    const maya = tasksOf('maya');
    expect(maya.map((t) => t.match)).toEqual(['inhouse', 'inhouse', 'inhouse']);
    expect(maya.every((t) => !t.isField && t.placeId === 'מחסן נס ציונה')).toBe(true);
    expect(tasksOf('shahar')[1].match).toBe('inhouse');
  });

  it('turns a heading label into the task when nothing is listed under it', () => {
    const guy = day.sections.find((s) => s.workerId === 'guy')!;
    expect(guy.label).toBe('');
    expect(guy.tasks).toHaveLength(1);
    expect(guy.tasks[0].match).toBe('inhouse');
  });
});

describe('dates', () => {
  it('reads the target day from the header', () => {
    expect(detectDateHint(['סידור צוות לוגיסטיקה למחר:'])).toEqual({ kind: 'tomorrow' });
    expect(detectDateHint(['סידור צוות לוגיסטיקה ליום ראשון:'])).toEqual({ kind: 'weekday', weekday: 0 });
    expect(detectDateHint(["סידור ליום ה'"])).toEqual({ kind: 'weekday', weekday: 4 });
    expect(detectDateHint(['סידור ל-5.10'])).toEqual({ kind: 'explicit', day: 5, month: 10, year: null });
  });

  it('resolves the date relative to when the message was sent', () => {
    const thursday = new Date(2026, 9, 1, 16, 46); // Thu 1.10.2026
    expect(resolveDate({ kind: 'weekday', weekday: 0 }, thursday)).toBe('2026-10-04');
    expect(resolveDate({ kind: 'tomorrow' }, new Date(2026, 8, 28, 15))).toBe('2026-09-29');
    expect(resolveDate({ kind: 'none' }, thursday)).toBe('2026-10-04'); // skips Friday and Saturday
    expect(resolveDate({ kind: 'explicit', day: 5, month: 1, year: null }, new Date(2026, 11, 28))).toBe('2027-01-05');
  });
});

describe('looksLikeSchedule', () => {
  it('accepts a schedule and rejects ordinary chat', () => {
    expect(looksLikeSchedule(MESSAGE, workers)).toBe(true);
    expect(looksLikeSchedule('דני תביא בבקשה את הרשת לאיכילוב', workers)).toBe(false);
  });
});

describe('older message formats', () => {
  it('reads numbered lines, dashes without spaces, sub-headings, add-on lines and days off', () => {
    const msg = [
      'שלום לכולם,',
      'סידור לצוות לוגיסטיקה למחר:',
      '',
      '*דני*',
      '1.\t⁠שוהם-אספקת משלוח ללקוח',
      '2.\tרפאל לסגור רשתות',
      '+ להחזיר ארגז השלמות',
      '3.\tמשרד להכין הזמנות',
      '4.\tבדיקות רשתות שחזרו מניתוחים',
      '',
      '*רוני*',
      'אספקת הזמנות PRO:',
      '1.\tאבן יהודה – כללית',
      '2.קרבופיקס-לאסוף רשת לניתוח',
      '3.\tבוטיק לספק ציוד',
      '',
      '*מאיה*',
      'חופש',
    ].join('\n');
    const day = parseSchedule(msg, ctx);
    const [dani, roni, maya] = day.sections.map((s) => s.tasks);

    expect(dani.map((t) => t.match)).toEqual(['exact', 'prefix', 'inhouse', 'inhouse']);
    expect(dani[0].placeId).toBe('שוהם');
    expect(dani[1].placeId).toBe('רפאל');
    expect(dani[1].description).toContain('להחזיר ארגז השלמות');
    expect(dani[1].types).toContain('completions');

    expect(roni[0]).toMatchObject({ placeId: 'אבן יהודה', types: ['delivery'] });
    expect(roni[1]).toMatchObject({ locationText: 'קרבופיקס', match: 'unknown' });
    expect(roni[2]).toMatchObject({ locationText: 'בוטיק', match: 'unknown' });

    expect(maya).toHaveLength(1);
    expect(maya[0]).toMatchObject({ isField: false, types: ['off'] });
  });

  it('knows field work written with a final letter changed ("תיקון" → "תיקונים")', () => {
    const day = parseSchedule('סידור צוות לוגיסטיקה למחר:\n*שחר* - שירות טכני\n• שירות תיקונים אצל לקוחות\n• עבודה במפעל', ctx);
    const [repairs, factory] = day.sections[0].tasks;
    expect(repairs).toMatchObject({ isField: true, match: 'none' });
    expect(factory.match).toBe('inhouse');
  });

  it('reads a whole worker on one numbered line, one task per place', () => {
    const msg = 'סידור לצוות לוגיסטיקה למחר:\n1.\t*דני* – איכילוב לספק ארגז, באר שבע לספק הזמנה של PRO\n2.\t*רוני* – מחסן';
    const day = parseSchedule(msg, ctx);
    expect(day.sections.map((s) => s.workerId)).toEqual(['dani', 'roni']);
    expect(day.sections[0].tasks.map((t) => t.placeId)).toEqual(['איכילוב', 'באר שבע']);
    expect(day.sections[1].tasks[0].match).toBe('inhouse');
  });
});

describe('readHistory', () => {
  const schedule = (place: string) =>
    `שלום לכולם,\nסידור צוות לוגיסטיקה למחר:\n*דני*\n• ${place} - לספק רשתות\n*רוני*\n• מחסן`;
  const addon = 'היי\nמוסיפה לסידור של היום:\n*רוני*\nאסותא אשדוד - אספקת 7 רשתות';
  const exportText = [
    `[27.9.2026, 16:00:00] עדי: ${schedule('איכילוב')}`,
    `[28.9.2026, 9:30:00] עדי: ${addon}`,
    '[28.9.2026, 9:31:00] רוני: 👍',
    `[28.9.2026, 16:10:00] עדי: ${schedule('איכילוב')}`,
    `[28.9.2026, 16:40:00] עדי: ${schedule('שיבא')}`,
  ].join('\n');

  it('keeps one schedule per day, the latest version, with add-ons merged in', () => {
    const h = readHistory(exportText, ctx);
    expect(h.days.map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29']);
    expect(h.replaced).toBe(1);

    const [d28, d29] = h.days;
    expect(d28.messages).toHaveLength(2);
    const roni28 = d28.day.sections.find((s) => s.workerId === 'roni')!.tasks;
    expect(roni28.map((t) => t.placeId)).toEqual(['מחסן נס ציונה', 'אסותא אשדוד']);
    expect(d29.day.sections[0].tasks[0].placeId).toBe('שיבא');
  });
});
