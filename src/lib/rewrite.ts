// Writing an accepted suggestion into the WhatsApp message itself: the lines
// of the moved stop leave one worker's part of the message and join the
// other's, so Adi can copy the updated message and send it to the group.

import type { ParsedDay, ParsedTask } from './types';

export interface StopMove {
  placeId: string;
  from: string;
  to: string;
}

// Invisible direction marks phones put before a line.
const MARKS = '[\\s\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*';
// "3.\tשיבא - ..." or "3) ...": the number is rewritten when lines move.
const NUMBERED = new RegExp(`^(${MARKS})(\\d{1,2})([.)])(?!\\d)`);
// The same line starts as parser.ts reads them.
const BULLET = new RegExp(`^${MARKS}(?:[•·●▪◦‣*\\-–—]\\s+|\\d{1,2}[.)](?!\\d)\\s*)`);

export type PlaceOf = (t: ParsedTask) => string | null;

const ownPlace: PlaceOf = (t) => t.placeId;

function sectionsFor(day: ParsedDay, m: StopMove, placeOf: PlaceOf) {
  const isMoved = (t: ParsedTask) => t.isField && placeOf(t) === m.placeId;
  const source = day.sections.find((s) => s.workerId === m.from && s.tasks.some(isMoved));
  // the receiver needs lines of its own to add to ("*יואב* – צפת, נהריה" on one line has none)
  const target = day.sections.find((s) => s.workerId === m.to && s.tasks.some((t) => t.lineIndex !== null));
  const tasks = source ? source.tasks.filter(isMoved) : [];
  return { source, target, tasks };
}

/**
 * True when the move can be written into the message: each of the stop's
 * tasks sits on a line of its own ("שיבא - לספק", not "שיבא ..., איכילוב ...").
 */
export function canRewrite(day: ParsedDay, m: StopMove, placeOf: PlaceOf = ownPlace): boolean {
  const { source, target, tasks } = sectionsFor(day, m, placeOf);
  return Boolean(source && target && tasks.length > 0 && tasks.every((t) => t.lineIndex !== null && !t.sharedLine));
}

export interface Rewritten {
  text: string;
  /** The giver had nothing else that day and now has "מחסן". */
  freed: boolean;
}

/**
 * The message with the stop's lines (and their "+ ..." lines) moved to the end
 * of the receiver's part. A worker left with nothing gets "מחסן", the way Adi
 * writes a warehouse day. Numbered lines are renumbered. null when the move
 * can't be written cleanly (see canRewrite).
 */
export function rewriteMove(raw: string, day: ParsedDay, m: StopMove, placeOf: PlaceOf = ownPlace): Rewritten | null {
  if (!canRewrite(day, m, placeOf)) return null;
  const { source, target, tasks } = sectionsFor(day, m, placeOf);
  if (!source || !target) return null;

  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const moving = new Set(tasks.flatMap((t) => [t.lineIndex!, ...t.extraLines]));
  if ([...moving, target.lastLine].some((i) => i >= lines.length)) return null; // not the parsed text
  const firstMoved = Math.min(...moving);
  const emptied = source.tasks.every((t) => tasks.includes(t));

  const inPart = (i: number, s: { headingLine: number; lastLine: number }) => i > s.headingLine && i <= s.lastLine;
  const out: { text: string; part: 'source' | 'target' | null }[] = [];
  lines.forEach((line, i) => {
    const part = inPart(i, source) ? 'source' : inPart(i, target) ? 'target' : null;
    if (!moving.has(i)) out.push({ text: line, part });
    else if (emptied && i === firstMoved) out.push({ text: `${line.match(BULLET)?.[0] ?? ''}מחסן`, part });
    if (i === target.lastLine) {
      for (const j of [...moving].sort((a, b) => a - b)) out.push({ text: lines[j], part: 'target' });
    }
  });

  for (const part of ['source', 'target'] as const) {
    let n = 0;
    for (const o of out) {
      const num = o.part === part ? o.text.match(NUMBERED) : null;
      if (num) o.text = `${num[1]}${++n}${num[3]}${o.text.slice(num[0].length)}`;
    }
  }
  return { text: out.map((o) => o.text).join('\n'), freed: emptied };
}
