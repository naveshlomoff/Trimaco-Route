// Turns a WhatsApp chat export into one parsed schedule per work day.
// Shared by the import screen and the local dry-run report.

import { resolveDate } from './dates';
import { classifyMessage, mergeAddendum, parseSchedule, type ParseContext } from './parser';
import type { ParsedDay } from './types';
import { parseChatExport, type ChatMessage } from './whatsapp';

export interface HistoryDay {
  date: string;
  day: ParsedDay;
  /** The schedule message itself, plus any add-ons sent for the same day. */
  messages: ChatMessage[];
}

export interface HistoryResult {
  messageCount: number;
  days: HistoryDay[];
  /** Earlier versions of a day that a later full schedule replaced. */
  replaced: number;
  /** Add-ons that had no schedule for their day and were left out. */
  orphanAddenda: number;
}

export function readHistory(exportText: string, ctx: ParseContext): HistoryResult {
  const messages = parseChatExport(exportText);
  const byDate = new Map<string, HistoryDay>();
  const addenda: { date: string; day: ParsedDay; message: ChatMessage }[] = [];
  let replaced = 0;

  for (const m of messages) {
    const kind = classifyMessage(m.text, ctx.workers);
    if (!kind) continue;
    const day = parseSchedule(m.text, ctx);
    // "מוסיפה לסידור של היום" usually has no day word; before noon it means today
    const hint = kind === 'addendum' && day.dateHint.kind === 'none' && m.sentAt.getHours() < 12 ? { kind: 'today' as const } : day.dateHint;
    const date = resolveDate(hint, m.sentAt);
    if (kind === 'addendum') {
      addenda.push({ date, day, message: m });
      continue;
    }
    const prev = byDate.get(date);
    if (prev) replaced++;
    // a later full schedule for the same day is a corrected version
    if (!prev || prev.messages[0].sentAt <= m.sentAt) byDate.set(date, { date, day, messages: [m] });
  }

  let orphanAddenda = 0;
  for (const a of addenda) {
    const target = byDate.get(a.date);
    if (!target) {
      orphanAddenda++;
      continue;
    }
    target.day = mergeAddendum(target.day, a.day);
    target.messages.push(a.message);
  }

  return {
    messageCount: messages.length,
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    replaced,
    orphanAddenda,
  };
}

/** The text stored for a day: the schedule and its add-ons, in order. */
export function historyRawText(d: HistoryDay): string {
  return d.messages.map((m) => m.text).join('\n\n— תוספת —\n');
}
