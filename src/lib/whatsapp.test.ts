import { describe, expect, it } from 'vitest';
import { parseChatExport } from './whatsapp';

describe('parseChatExport', () => {
  it('reads an iPhone export with multi-line messages', () => {
    const txt = [
      '‎[1.10.2026, 16:46:12] עדי: שלום לכולם,',
      'סידור צוות לוגיסטיקה ליום ראשון:',
      '*דני*',
      '• איכילוב - לספק רשתות',
      '[1.10.2026, 16:50:03] רוני: 👍',
      '[2.10.2026, 9:01:00] עדי: ‎<המדיה לא נכללה>',
      '[2.10.2026, 9:05:00] עדי: תיקון <ההודעה נערכה>',
    ].join('\n');
    const msgs = parseChatExport(txt);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].sender).toBe('עדי');
    expect(msgs[0].sentAt).toEqual(new Date(2026, 9, 1, 16, 46, 12));
    expect(msgs[0].text.split('\n')).toHaveLength(4);
    expect(msgs[1].text).toBe('👍');
    expect(msgs[2].text).toBe('תיקון');
  });

  it('reads an Android export and detects month/day order', () => {
    const msgs = parseChatExport('10/13/26, 4:46 PM - Adi: hello\nsecond line');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].sentAt).toEqual(new Date(2026, 9, 13, 16, 46));
    expect(msgs[0].text).toBe('hello\nsecond line');
  });

  it('reads an Israeli Android export (day.month)', () => {
    const msgs = parseChatExport('28.9.2026, 16:46 - עדי: שלום');
    expect(msgs[0].sentAt).toEqual(new Date(2026, 8, 28, 16, 46));
  });
});
