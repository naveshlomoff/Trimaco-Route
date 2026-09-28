// Text helpers for Hebrew WhatsApp messages.

// Direction marks WhatsApp and phones insert invisibly around Hebrew/English runs.
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;

export function stripMarks(s: string): string {
  return s.replace(DIRECTION_MARKS, '');
}

/** Removes WhatsApp formatting markers: *bold*, _italic_, ~strike~. */
export function stripFormatting(s: string): string {
  return s.replace(/[*_~]/g, '');
}

const QUOTES = /["'`״׳”“’‘]/g;

/**
 * Canonical form used to compare place names: no quotes or punctuation,
 * single spaces, and without generic prefixes such as "בית חולים".
 * 'אסותא ת"א' and "אסותא תא" end up identical.
 */
export function normalizeKey(s: string): string {
  let t = stripFormatting(stripMarks(s)).replace(QUOTES, '');
  t = t.replace(/[-–—/\\.,:;()[\]!?+]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(בית ה?חולים|ביה?ח|ה?מרכז ה?רפואי)\s+/, '');
  return t;
}

/** 1 = identical, 0 = nothing in common (normalised Levenshtein distance). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[lb] / Math.max(la, lb);
}

/**
 * Index of the first dash that separates "place - what to do".
 * A dash counts only when it touches a space on at least one side, so
 * "תל-אביב" and "10-12" are not split. Returns -1 when there is none.
 */
export function findSeparator(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '-' && ch !== '–' && ch !== '—') continue;
    if (s[i - 1] === ' ' || s[i + 1] === ' ') return i;
  }
  return -1;
}
