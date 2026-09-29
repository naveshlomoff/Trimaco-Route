// Turns Adi's WhatsApp schedule message into structured tasks.
//
// The message looks like:
//   שלום לכולם,
//   סידור צוות לוגיסטיקה למחר:
//   *יואב*
//   • אסותא באר שבע - לאסוף רשתות ...
//   *נטשה*
//   מחסן
//   • הכנת הזמנות
//   *יהונתן* - שירות טכני
//   • ראשון לציון - טיפול בקריאת שירות
//   *סידור רכב*
//   • יהונתן מהבוקר עד הצהריים
//
//   קחו בחשבון לשינויים
//
// A worker's name on its own line opens that worker's section; every line
// under it is one task, usually written "place - what to do". Older messages
// also use numbered lines ("1.<tab>שוהם-אספקה"), a whole worker on one line
// ("1. *יואב* – צפת ..., נהריה ..."), and small add-ons to an existing
// schedule ("מוסיפה לסידור של היום:").

import { detectDateHint } from './dates';
import { findSeparator, findTightDash, normalizeKey, similarity, stripFormatting, stripMarks } from './text';
import type {
  ParsedDay,
  ParsedSection,
  ParsedTask,
  Place,
  PlaceCandidate,
  PlaceMatch,
  TaskType,
  VehicleNote,
  Worker,
} from './types';

export interface ParseContext {
  workers: Worker[];
  places: Place[];
}

// "•", "-", "1.", "2)" at the start of a line; a number may touch the text ("2.רפאל").
const BULLET = /^\s*(?:[•·●▪◦‣*\-–—]\s+|\d{1,2}[.)](?!\d)\s*)/;
const VEHICLE_HEADINGS = new Set(['סידור רכב', 'סידור רכבים', 'רכב', 'רכבים', 'רכב הובלות', 'סידור רכב הובלות']);
const CLOSING = /(קחו בחשבון|שבת שלום|חג שמח|חג \S+ שמח|סופ"?ש נעים|סוף שבוע נעים|יום טוב|ערב טוב|תודה רבה|בהצלחה)/;
// Words that open a description or a time of day, never a place name.
const ACTION_START =
  /^(לאסוף|איסוף|לספק|אספקה|אספקת|להביא|להחזיר|הכנת|טיפול|עבודה|התקנה|התקנת|להתקין|תיקו[נן]|תקלות|הרכבת|בין|עד|לתאם|להתקשר|להחתים|הזמנה|הזמנות|כתובת|הערה|שים לב|בבוקר|בצהריים|אחה"?צ|אחר הצהריים|בערב|מוקדם)/;
// After a dash with no spaces ("קרבופיקס-לאסוף"), these mean the dash separates place and task.
const TASK_START = /^(לאסוף|איסוף|לספק|אספקה|אספקת|להביא|להחזיר|התקנה|התקנת|להתקין|טיפול|תיקו[נן]|לגלגל|לסגור|להחתים|למסור)/;
// Work at a customer's site. A line with no place and none of these is warehouse work.
// (Hebrew final letters: "תיקון" but "תיקונים", so stems end before the letter that changes.)
const FIELD_VERB = /(לספק|אספק|לאסוף|איסו[פף]|אסיפה|להביא|להחזיר|התקנ|להתקין|קריאת\s+שירות|קריאות\s+שירות|תיקו[נן]|לגלגל|לסגור|להחתים|למסור|מסירת)/;
// Warehouse work even when a hospital is mentioned ("הכנת הזמנות לאיכילוב").
const INHOUSE_ALWAYS =
  /^(ה?מחסן|הזמנות|ה?משרד|ה?מפעל|ה?מעבדה)(\s|$|[-–—+,.:])|^(הכנת|אריזת|קליטת|הרכבת)\s|(במחסן|במפעל|במשרד|במעבדה)/;
// Warehouse work unless a customer site is named ("סידור מדפים באיכילוב" is a field visit).
const INHOUSE_UNLESS_PLACE = /^(סידור|ספירת|ספירה)\s/;
const ABSENCE = /^(חופש|חופשה|מחלה|מילואים|יום חופש|לא עובד|לא עובדת)(\s|$|[.,!])/;
// "שראל לספק חשבוניות": with no dash, the words before the first work verb may be the place.
const VERB_AT_WORD = /(?:^|\s)(לספק|אספק\S*|לאסוף|איסוף|להביא|להחזיר|להתקין|התקנ\S*|לגלגל|לסגור|להחתים|למסור)(?=\s|$)/;
const NOT_A_PLACE = /^(רשתות|רשת|ציוד|חבילה|חבילות|הזמנה|הזמנות|משלוח|סחורה|מזוודה|סיום|המשך|תחילת)(\s|$)/;
// A line that adds to the task above it ("+ להחזיר ארגז", "להתקשר לרופא ...").
const CONTINUATION = /^(\+|להתקשר|לתאם|שים לב|לשים לב|הערה|להחזיר תעודה)/;
const ADDENDUM = /(מוסיפ|תוספת|להוסיף|הוספה|הוספת)/;
// One-word hospital names that are also people's names or common words: a
// place only when written first on the line or before the dash.
const NOT_IN_TEXT = new Set(['מאיר', 'רפאל', 'שמיר', 'כרמל', 'העמק', 'השרון', 'הגליל']);

interface Line {
  text: string;
  raw: string;
  bullet: boolean;
}

export interface PlaceIndexEntry {
  key: string;
  place: Place;
  /** Matches the name inside free text, also with a ב/ל/מ/ה/ו prefix ("באיכילוב"). */
  inText: RegExp | null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All names and aliases, longest first, so "הרצליה מדיקל" wins over "הרצליה". */
export function buildPlaceIndex(places: Place[]): PlaceIndexEntry[] {
  const entries: PlaceIndexEntry[] = [];
  for (const place of places) {
    for (const name of [place.name, ...place.aliases]) {
      const key = normalizeKey(name);
      if (!key) continue;
      // The warehouse's names ("מחסן", "הזמנות", "משרד") are everyday words: never searched inside a line.
      const searchable = place.kind !== 'depot' && (key.includes(' ') || (key.length >= 4 && !NOT_IN_TEXT.has(key)));
      const inText = searchable ? new RegExp(`(?:^|\\s)[בלמהו]?${escapeRe(key)}(?=\\s|$)`) : null;
      entries.push({ key, place, inText });
    }
  }
  return entries.sort((a, b) => b.key.length - a.key.length);
}

export interface PlaceLookup {
  match: PlaceMatch;
  place: Place | null;
  rest: string | null;
  candidates: PlaceCandidate[];
}

const NO_PLACE: PlaceLookup = { match: 'none', place: null, rest: null, candidates: [] };

/** Resolves a place name against the catalog (with spelling guesses when `guess` is on). */
export function lookupPlace(text: string, index: PlaceIndexEntry[], guess = true): PlaceLookup {
  const key = normalizeKey(text);
  if (!key) return NO_PLACE;

  const exact = index.find((e) => e.key === key);
  if (exact) return { match: 'exact', place: exact.place, rest: null, candidates: [] };

  const prefix = index.find((e) => key.startsWith(e.key + ' '));
  if (prefix) {
    return { match: 'prefix', place: prefix.place, rest: key.slice(prefix.key.length).trim(), candidates: [] };
  }

  const inside = findPlaceInText(key, index);
  if (inside) return { match: 'contains', place: inside, rest: null, candidates: [] };

  return { match: 'unknown', place: null, rest: null, candidates: guess ? fuzzyCandidates(key, index) : [] };
}

/** A known place named somewhere inside a line. */
export function findPlaceInText(text: string, index: PlaceIndexEntry[]): Place | null {
  const key = normalizeKey(text);
  for (const e of index) {
    if (e.inText?.test(key)) return e.place;
  }
  return null;
}

function fuzzyCandidates(key: string, index: PlaceIndexEntry[]): PlaceCandidate[] {
  const words = key.split(' ');
  const best = new Map<string, PlaceCandidate>();
  for (const e of index) {
    let score = similarity(key, e.key);
    const keyWords = e.key.split(' ').length;
    if (words.length > keyWords) {
      score = Math.max(score, similarity(words.slice(0, keyWords).join(' '), e.key) - 0.05);
    }
    const prev = best.get(e.place.id);
    if (!prev || score > prev.score) best.set(e.place.id, { placeId: e.place.id, name: e.place.name, score });
  }
  return [...best.values()]
    .filter((c) => c.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function toLines(raw: string): Line[] {
  return stripMarks(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => ({
      raw: l.trim(),
      bullet: BULLET.test(l),
      text: stripFormatting(l.replace(BULLET, '')).replace(/\s+/g, ' ').trim(),
    }));
}

/**
 * "*יואב*", "יואב:", "יהונתן - שירות טכני" open a worker's section. On a
 * numbered line ("1. *יואב* – צפת ...") the name must be followed by a
 * dash or colon and the tasks.
 */
function matchWorkerHeading(
  text: string,
  workers: Worker[],
  needLabel: boolean,
): { worker: Worker; label: string } | null {
  const t = text.replace(/[:：]\s*$/, '').trim();
  for (const worker of workers) {
    for (const name of [worker.name, ...worker.aliases]) {
      if (!name) continue;
      if (t === name) return needLabel ? null : { worker, label: '' };
      if (!t.startsWith(name)) continue;
      const rest = t.slice(name.length);
      const m = rest.match(/^\s*[-–—:]\s*(.*)$/) ?? (needLabel ? null : rest.match(/^\s*\((.*)\)\s*$/));
      if (m && (!needLabel || m[1].trim())) return { worker, label: m[1].trim() };
    }
  }
  return null;
}

function findWorkerMention(text: string, workers: Worker[]): string | null {
  for (const w of workers) {
    for (const name of [w.name, ...w.aliases]) {
      if (name && new RegExp(`(?:^|\\s)${escapeRe(name)}(?=\\s|$|[,.:])`).test(text)) return w.id;
    }
  }
  return null;
}

function detectTypes(text: string, inhouse: boolean): TaskType[] {
  const types = new Set<TaskType>();
  if (inhouse) {
    if (/הזמנות/.test(text)) types.add('orders');
    if (/הכנת\s+(רשתות|ציוד)/.test(text)) types.add('sets_prep');
    if (/מחסן/.test(text)) types.add('warehouse');
    if (/ספיר/.test(text)) types.add('count');
    return [...types];
  }
  if (/(לאסוף|איסוף|אסיפה)(?!\s*(צ['׳]?ק|שיק))/.test(text)) types.add('pickup');
  if (/(לספק|אספקה|אספקת|להביא|למסור|מסירה|להעביר|לשלוח)/.test(text)) types.add('delivery');
  if (/(התקנה|התקנת|להתקין|הרכבה|להרכיב)/.test(text)) types.add('install');
  if (/(לגלגל|גלגול|להחליף|החלפת)/.test(text)) types.add('rotation');
  if (/(קריאת\s+שירות|קריאות\s+שירות|תיקון|תיקונים|שירות|שרות)/.test(text)) types.add('service');
  if (/(ספירה|לספור|ספירת)/.test(text)) types.add('count');
  if (/השלמ/.test(text)) types.add('completions');
  if (/(צ['׳]?ק|שיק|המחאה)/.test(text)) types.add('check');
  return [...types];
}

function hhmm(h: string, m: string | undefined): string {
  let hour = Number(h);
  if (hour < 7) hour += 12; // "עד 3" means 15:00
  return `${String(hour).padStart(2, '0')}:${m ?? '00'}`;
}

function parseWindow(text: string): { start: string | null; end: string | null } {
  const between = text.match(/בין\s+(?:ה)?שעות\s*(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/);
  if (between) return { start: hhmm(between[1], between[2]), end: hhmm(between[3], between[4]) };
  let start: string | null = null;
  let end: string | null = null;
  const until =
    text.match(/(?:עד|לפני)\s+(?:ה)?שעה\s*(\d{1,2})(?::(\d{2}))?/) ?? text.match(/(?:עד|לפני)\s+(\d{1,2}):(\d{2})/);
  if (until) end = hhmm(until[1], until[2]);
  const from =
    text.match(/(?:מ|אחרי\s+|החל\s+מ)(?:ה)?שעה\s*(\d{1,2})(?::(\d{2}))?/) ?? text.match(/בשעה\s*(\d{1,2})(?::(\d{2}))?/);
  if (from) start = hhmm(from[1], from[2]);
  return { start, end };
}

function detectFlags(text: string): string[] {
  const flags: string[] = [];
  if (/תעודה\s+חתומה|תעודות\s+חתומות|להחזיר\s+תעוד|להחתים/.test(text)) flags.push('signed_doc');
  if (/להתקשר|לתאם|תיאום/.test(text)) flags.push('call_ahead');
  if (/\?/.test(text)) flags.push('uncertain');
  if (/דחוף|דחופה/.test(text)) flags.push('urgent');
  return flags;
}

/**
 * Splits "איכילוב לספק ..., באר שבע לספק ..." into one task per place: a
 * comma starts a new task only when a known place follows it.
 */
export function splitByPlaces(text: string, index: PlaceIndexEntry[]): string[] {
  const parts = text.split(/\s*,\s+/);
  if (parts.length === 1) return [text];
  const out = [parts[0]];
  for (const part of parts.slice(1)) {
    const l = lookupPlace(part, index, false);
    if (l.place && (l.match === 'exact' || l.match === 'prefix')) out.push(part);
    else out[out.length - 1] += `, ${part}`;
  }
  return out;
}

export function parseTaskLine(
  text: string,
  rawLine: string,
  worker: { id: string | null; label: string },
  seq: number,
  ctx: ParseContext,
  index: PlaceIndexEntry[],
  context = '',
): ParsedTask {
  const depot = ctx.places.find((p) => p.kind === 'depot') ?? null;
  let locationText: string | null = null;
  let description = text;
  let lookup: PlaceLookup = NO_PLACE;
  let inhouse = false;
  const off = ABSENCE.test(text);

  if (!off) {
    // "place - task"
    const sep = findSeparator(text);
    if (sep > 0) {
      const loc = text.slice(0, sep).trim();
      if (loc && loc.split(' ').length <= 6 && !ACTION_START.test(loc)) {
        locationText = loc;
        description = text.slice(sep + 1).trim();
        lookup = lookupPlace(loc, index);
      }
    }
    // "place-task" (no spaces around the dash)
    if (locationText === null) {
      const dash = findTightDash(text);
      if (dash > 0) {
        const loc = text.slice(0, dash).trim();
        const rest = text.slice(dash + 1).trim();
        if (loc && loc.split(' ').length <= 5 && !ACTION_START.test(loc)) {
          const l = lookupPlace(loc, index);
          if (l.match === 'exact' || l.match === 'prefix' || TASK_START.test(rest)) {
            locationText = loc;
            description = rest;
            lookup = l;
          }
        }
      }
    }
    if (locationText !== null && lookup.place?.kind === 'depot') inhouse = true;

    // no "place -" part: a place at the start of or inside the line, or warehouse work
    if (locationText === null) {
      if (INHOUSE_ALWAYS.test(text)) {
        inhouse = true;
      } else {
        const l = lookupPlace(text, index, false);
        if (l.place && l.match !== 'unknown') {
          if (l.place.kind === 'depot') inhouse = true;
          else lookup = { ...l, rest: null };
        } else if (INHOUSE_UNLESS_PLACE.test(text) || !FIELD_VERB.test(`${text} ${context}`)) {
          inhouse = true;
        } else {
          const verb = VERB_AT_WORD.exec(text);
          const before = verb ? text.slice(0, verb.index).trim() : '';
          const isWorker = ctx.workers.some((w) => w.name === before || w.aliases.includes(before));
          if (before && before.split(' ').length <= 3 && !ACTION_START.test(before) && !NOT_A_PLACE.test(before) && !isWorker) {
            locationText = before;
            description = text.slice(verb!.index).trim();
            lookup = lookupPlace(before, index);
          }
        }
      }
    }
  }

  const match: PlaceMatch = off ? 'none' : inhouse ? 'inhouse' : lookup.match;
  const place = off ? null : inhouse ? depot : lookup.place;
  const writtenAddress = text.match(/כתובת[:\s]+([^.,;\n]+)/)?.[1]?.trim();
  const address = writtenAddress || (match === 'prefix' ? lookup.rest : null) || null;
  const window = parseWindow(text);

  return {
    workerId: worker.id,
    workerLabel: worker.label,
    seq,
    rawLine,
    locationText,
    description,
    match,
    placeId: place?.id ?? null,
    candidates: lookup.candidates,
    types: off ? ['off'] : detectTypes(context ? `${text} ${context}` : text, inhouse),
    isField: !inhouse && !off,
    windowStart: window.start,
    windowEnd: window.end,
    address,
    flags: detectFlags(text),
  };
}

export function parseSchedule(raw: string, ctx: ParseContext): ParsedDay {
  const index = buildPlaceIndex(ctx.places);
  const intro: string[] = [];
  const notes: string[] = [];
  const vehicle: VehicleNote[] = [];
  const sections: ParsedSection[] = [];
  const pending = new Map<ParsedSection, Line[]>();

  let current: ParsedSection | 'vehicle' | null = null;
  let blankBefore = false;
  let inNotes = false;

  for (const line of toLines(raw)) {
    if (!line.text) {
      blankBefore = true;
      continue;
    }
    const heading =
      line.bullet && current === 'vehicle' ? null : matchWorkerHeading(line.text, ctx.workers, line.bullet);
    if (heading) {
      const section: ParsedSection = {
        workerId: heading.worker.id,
        workerName: heading.worker.name,
        label: heading.label,
        tasks: [],
      };
      sections.push(section);
      pending.set(section, []);
      current = section;
      inNotes = false;
      blankBefore = false;
      continue;
    }
    if (!line.bullet && VEHICLE_HEADINGS.has(line.text.replace(/[:：]\s*$/, '').trim())) {
      current = 'vehicle';
      inNotes = false;
      blankBefore = false;
      continue;
    }
    if (current === null) {
      intro.push(line.text);
      continue;
    }
    const sectionHasLines = current === 'vehicle' ? vehicle.length > 0 : (pending.get(current)?.length ?? 0) > 0;
    // A plain line after an empty line, or a sign-off, ends the schedule.
    const startsNotes = !line.bullet && ((blankBefore && sectionHasLines) || CLOSING.test(line.text));
    blankBefore = false;
    if (inNotes || startsNotes) {
      inNotes = true;
      notes.push(line.text);
      continue;
    }
    if (current === 'vehicle') {
      vehicle.push({ workerId: findWorkerMention(line.text, ctx.workers), text: line.text });
    } else {
      pending.get(current)?.push(line);
    }
  }

  for (const section of sections) {
    const lines = pending.get(section) ?? [];
    // "גיא - מחסן" or "1. *יואב* – צפת ..." with nothing under it: the label holds the tasks
    if (lines.length === 0 && section.label) {
      lines.push({ text: section.label, raw: section.label, bullet: false });
      section.label = '';
    }
    let context = '';
    let seq = 0;
    for (const l of lines) {
      // "אספקת הזמנות PRO:" introduces the lines under it
      if (!l.bullet && /[:：]$/.test(l.text) && !findPlaceInText(l.text, index)) {
        context = l.text.replace(/[:：]$/, '');
        continue;
      }
      // "+ להחזיר ארגז השלמות" belongs to the task above it
      const prev = section.tasks[section.tasks.length - 1];
      if (prev && CONTINUATION.test(l.text) && !findPlaceInText(l.text, index)) {
        const extra = l.text.replace(/^\+\s*/, '');
        prev.description = prev.description ? `${prev.description} + ${extra}` : extra;
        prev.types = [...new Set([...prev.types, ...detectTypes(extra, !prev.isField)])];
        prev.flags = [...new Set([...prev.flags, ...detectFlags(extra)])];
        continue;
      }
      for (const part of splitByPlaces(l.text, index)) {
        section.tasks.push(
          parseTaskLine(part, l.raw, { id: section.workerId, label: section.workerName }, ++seq, ctx, index, context),
        );
      }
    }
  }

  const kind = ADDENDUM.test(intro.join(' ')) ? 'addendum' : 'full';
  return { intro, dateHint: detectDateHint(intro), sections, vehicle, notes, kind };
}

/**
 * 'schedule': a full daily schedule. 'addendum': a few lines added to an
 * existing one ("מוסיפה לסידור של היום:"). null: ordinary chat.
 */
export function classifyMessage(raw: string, workers: Worker[]): 'schedule' | 'addendum' | null {
  if (!/סידור/.test(raw)) return null;
  const headed = new Set<string>();
  let intro = '';
  for (const l of toLines(raw)) {
    const h = matchWorkerHeading(l.text, workers, l.bullet);
    if (h) headed.add(h.worker.id);
    else if (headed.size === 0) intro += ` ${l.text}`;
  }
  if (headed.size === 0) return null;
  if (ADDENDUM.test(intro)) return 'addendum';
  return headed.size >= 2 ? 'schedule' : null;
}

/** True when a chat message looks like a full daily schedule. */
export function looksLikeSchedule(raw: string, workers: Worker[]): boolean {
  return classifyMessage(raw, workers) === 'schedule';
}

/** Adds an addendum's tasks to the day it belongs to. */
export function mergeAddendum(day: ParsedDay, addendum: ParsedDay): ParsedDay {
  const sections = day.sections.map((s) => ({ ...s, tasks: [...s.tasks] }));
  for (const add of addendum.sections) {
    const target = sections.find((s) => s.workerId === add.workerId);
    if (target) {
      const start = target.tasks.length;
      target.tasks.push(...add.tasks.map((t, i) => ({ ...t, seq: start + i + 1 })));
    } else {
      sections.push({ ...add, tasks: [...add.tasks] });
    }
  }
  return {
    ...day,
    sections,
    vehicle: [...day.vehicle, ...addendum.vehicle],
    notes: [...day.notes, ...addendum.notes],
  };
}

/** Tasks whose place still needs a human decision. */
export function unresolvedTasks(day: ParsedDay): ParsedTask[] {
  return day.sections.flatMap((s) => s.tasks).filter((t) => t.match === 'unknown' && !t.placeId);
}
