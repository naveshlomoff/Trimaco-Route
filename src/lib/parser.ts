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
// under it is one task, usually written "place - what to do".

import { detectDateHint } from './dates';
import { findSeparator, normalizeKey, similarity, stripFormatting, stripMarks } from './text';
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

const BULLET = /^\s*(?:[•·●▪◦‣*\-–—]|\d{1,2}[.)])\s+/;
const VEHICLE_HEADINGS = new Set(['סידור רכב', 'סידור רכבים', 'רכב', 'רכבים', 'רכב הובלות', 'סידור רכב הובלות']);
const CLOSING = /(קחו בחשבון|שבת שלום|חג שמח|סופ"?ש נעים|סוף שבוע נעים|יום טוב|ערב טוב|תודה רבה|בהצלחה)/;
// Words that open a description, never a place name.
const ACTION_START = /^(לאסוף|איסוף|לספק|אספקה|אספקת|להביא|להחזיר|הכנת|טיפול|עבודה|התקנה|התקנת|בין|עד|לתאם|להתקשר)/;
// Work done at the warehouse even when a hospital is mentioned ("הכנת הזמנות לאיכילוב").
const INHOUSE_ALWAYS = /^(ה?מחסן|הזמנות|ה?משרד|ה?מפעל)$|^(הכנת|אריזת|קליטת|הרכבת)\s|(במחסן|במפעל|במשרד)/;
// Warehouse work unless a customer site is named ("סידור מדפים באיכילוב" is a field visit).
const INHOUSE_UNLESS_PLACE = /^(סידור|ספירת|ספירה)\s/;

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
      // Short one-word names (מאיר, רפאל) are also people's names, so they
      // only count when written as the place of a "place - task" line.
      const searchable = key.includes(' ') || key.length >= 5;
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

/** Resolves the "place" part of a line against the catalog. */
export function lookupPlace(text: string, index: PlaceIndexEntry[]): PlaceLookup {
  const key = normalizeKey(text);
  if (!key) return { match: 'none', place: null, rest: null, candidates: [] };

  const exact = index.find((e) => e.key === key);
  if (exact) return { match: 'exact', place: exact.place, rest: null, candidates: [] };

  const prefix = index.find((e) => key.startsWith(e.key + ' '));
  if (prefix) {
    return { match: 'prefix', place: prefix.place, rest: key.slice(prefix.key.length).trim(), candidates: [] };
  }

  const inside = findPlaceInText(key, index);
  if (inside) return { match: 'contains', place: inside, rest: null, candidates: [] };

  return { match: 'unknown', place: null, rest: null, candidates: fuzzyCandidates(key, index) };
}

/** A known place named somewhere inside a line that has no "place -" part. */
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

function matchWorkerHeading(text: string, workers: Worker[]): { worker: Worker; label: string } | null {
  const t = text.replace(/[:：]\s*$/, '').trim();
  for (const worker of workers) {
    for (const name of [worker.name, ...worker.aliases]) {
      if (!name) continue;
      if (t === name) return { worker, label: '' };
      if (!t.startsWith(name)) continue;
      const rest = t.slice(name.length);
      const m = rest.match(/^\s*[-–—:]\s*(.*)$/) ?? rest.match(/^\s*\((.*)\)\s*$/);
      if (m) return { worker, label: m[1].trim() };
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
    if (/הכנת\s+רשתות/.test(text)) types.add('sets_prep');
    if (/מחסן/.test(text)) types.add('warehouse');
    if (/ספיר/.test(text)) types.add('count');
    return [...types];
  }
  if (/(לאסוף|איסוף|אסיפה)(?!\s*(צ['׳]?ק|שיק))/.test(text)) types.add('pickup');
  if (/(לספק|אספקה|אספקת|להביא|למסור|מסירה|להעביר|לשלוח)/.test(text)) types.add('delivery');
  if (/(התקנה|התקנת|להתקין|הרכבה|להרכיב)/.test(text)) types.add('install');
  if (/(לגלגל|גלגול|להחליף|החלפת)/.test(text)) types.add('rotation');
  if (/(קריאת\s+שירות|קריאות\s+שירות|תיקון|תיקונים|שירות)/.test(text)) types.add('service');
  if (/(ספירה|לספור|ספירת)/.test(text)) types.add('count');
  if (/השלמות/.test(text)) types.add('completions');
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
  if (/תעודה\s+חתומה|תעודות\s+חתומות|להחזיר\s+תעוד/.test(text)) flags.push('signed_doc');
  if (/להתקשר|לתאם|תיאום/.test(text)) flags.push('call_ahead');
  if (/\?/.test(text)) flags.push('uncertain');
  if (/דחוף|דחופה/.test(text)) flags.push('urgent');
  return flags;
}

export function parseTaskLine(
  text: string,
  rawLine: string,
  worker: { id: string | null; label: string },
  seq: number,
  ctx: ParseContext,
  index: PlaceIndexEntry[],
): ParsedTask {
  const depot = ctx.places.find((p) => p.kind === 'depot') ?? null;
  let locationText: string | null = null;
  let description = text;
  let lookup: PlaceLookup = { match: 'none', place: null, rest: null, candidates: [] };
  let inhouse = false;

  const sep = findSeparator(text);
  if (sep > 0) {
    const loc = text.slice(0, sep).trim();
    if (loc && loc.split(' ').length <= 6 && !ACTION_START.test(loc)) {
      locationText = loc;
      description = text.slice(sep + 1).trim();
      lookup = lookupPlace(loc, index);
      if (lookup.place?.kind === 'depot') inhouse = true;
    }
  }

  if (locationText === null) {
    if (INHOUSE_ALWAYS.test(text)) {
      inhouse = true;
    } else {
      const found = findPlaceInText(text, index);
      if (found && found.kind !== 'depot') lookup = { match: 'contains', place: found, rest: null, candidates: [] };
      else if (found || INHOUSE_UNLESS_PLACE.test(text)) inhouse = true;
    }
  }

  const match: PlaceMatch = inhouse ? 'inhouse' : lookup.match;
  const place = inhouse ? depot : lookup.place;
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
    types: detectTypes(text, inhouse),
    isField: !inhouse,
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
    const heading = line.bullet ? null : matchWorkerHeading(line.text, ctx.workers);
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

  const index2 = index;
  for (const section of sections) {
    const sectionLines = pending.get(section) ?? [];
    // "גיא - מחסן" with nothing under it: the label is the task
    if (sectionLines.length === 0 && section.label) {
      sectionLines.push({ text: section.label, raw: section.label, bullet: false });
      section.label = '';
    }
    section.tasks = sectionLines.map((l, i) =>
      parseTaskLine(l.text, l.raw, { id: section.workerId, label: section.workerName }, i + 1, ctx, index2),
    );
  }

  return { intro, dateHint: detectDateHint(intro), sections, vehicle, notes };
}

/** True when a chat message looks like a full daily schedule. */
export function looksLikeSchedule(raw: string, workers: Worker[]): boolean {
  if (!/סידור/.test(raw)) return false;
  const headed = new Set<string>();
  for (const l of toLines(raw)) {
    if (l.bullet) continue;
    const h = matchWorkerHeading(l.text, workers);
    if (h) headed.add(h.worker.id);
  }
  return headed.size >= 2;
}

/** Tasks whose place still needs a human decision. */
export function unresolvedTasks(day: ParsedDay): ParsedTask[] {
  return day.sections.flatMap((s) => s.tasks).filter((t) => t.match === 'unknown' && !t.placeId);
}
