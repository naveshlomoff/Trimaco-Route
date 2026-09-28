// Reads a WhatsApp "Export chat" file (without media).
//   iPhone:  [28.9.2026, 16:46:12] Name: text
//   Android: 28.9.2026, 16:46 - Name: text
// Lines without that prefix continue the previous message.

import { stripMarks } from './text';

export interface ChatMessage {
  sentAt: Date;
  sender: string;
  text: string;
}

const IOS =
  /^\[(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AaPp][Mm]))?\]\s+([^:]+?):\s?([\s\S]*)$/;
const ANDROID =
  /^(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AaPp][Mm]))?\s+[-–]\s+([^:]+?):\s?([\s\S]*)$/;
const NOISE = /^<?(Media omitted|המדיה לא נכללה|This message was deleted|ההודעה נמחקה|null)>?$/;
const EDITED = /\s*<(This message was edited|ההודעה נערכה)>\s*$/;

function header(line: string): RegExpMatchArray | null {
  const l = line.replace(/^[‎‏﻿]+/, '');
  return l.match(IOS) ?? l.match(ANDROID);
}

export function parseChatExport(txt: string): ChatMessage[] {
  const lines = txt.replace(/\r\n?/g, '\n').split('\n');

  // Israeli phones write day.month; a second number above 12 means month/day.
  let monthFirst = false;
  for (const line of lines) {
    const m = header(line);
    if (m && Number(m[2]) > 12) {
      monthFirst = true;
      break;
    }
  }

  const out: ChatMessage[] = [];
  let cur: ChatMessage | null = null;
  for (const line of lines) {
    const m = header(line);
    if (!m) {
      if (cur) cur.text += '\n' + line;
      continue;
    }
    if (cur) out.push(cur);
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hour = Number(m[4]);
    const ampm = m[7]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const day = monthFirst ? b : a;
    const month = monthFirst ? a : b;
    cur = {
      sentAt: new Date(year, month - 1, day, hour, Number(m[5]), Number(m[6] ?? 0)),
      sender: stripMarks(m[8]).trim(),
      text: m[9],
    };
  }
  if (cur) out.push(cur);

  return out
    .map((msg) => ({ ...msg, text: msg.text.replace(EDITED, '') }))
    .filter((msg) => {
      const t = stripMarks(msg.text).trim();
      return t.length > 0 && !NOISE.test(t);
    });
}
