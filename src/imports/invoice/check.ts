// Checks a carrier's invoice against what the same carrier charged before
// (the 2026 invoices) and against the lane's usual freight (the shipments).
// Every finding says what was charged, what was expected and why.

import { bandOf, KG_PER_CBM, regionOf, supplierPays, type Shipment } from '../model';
import { complete, ITEM_LABELS, type InvoiceLine, type Item, type ParsedInvoice } from './parse';

/** Charges that are the same on every invoice of a carrier (a delivery order varies: courier or not). */
const FIXED: Item[] = ['broker_fee', 'global_gate', 'cyber', 'docs', 'formalities'];
/** Fewer earlier shipments than this and the lane's freight isn't a yardstick. */
const MIN_LANE = 3;

export type Status = 'ok' | 'over' | 'check';

export interface Row {
  line: InvoiceLine;
  expected: number | null;
  diff: number | null;
  status: Status;
  note: string | null;
}

export interface Finding {
  status: 'over' | 'check';
  /** For Adi. */
  text: string;
  /** The same, as said to the carrier in the letter. */
  letter: string;
  /** Possible overcharge in ₪, when it can be measured. */
  diff: number | null;
}

export interface Report {
  rows: Row[];
  findings: Finding[];
  /** Sum of the measurable overcharges. */
  overcharge: number;
  status: 'ok' | 'flagged';
  /** The invoice's own lines didn't add up to its subtotal: something wasn't read. */
  incomplete: boolean;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round = (x: number) => Math.round(x * 100) / 100;
const shekels = (x: number) => `${Math.round(x).toLocaleString('he-IL')} ₪`;

/** What the carrier usually charges for each fixed item (at least 3 earlier invoices). */
export function feeNorms(history: ParsedInvoice[], carrier: string, mode: 'air' | 'sea'): Map<Item, { median: number; n: number }> {
  const by = new Map<Item, number[]>();
  for (const inv of history) {
    if (inv.carrier !== carrier || inv.mode !== mode) continue;
    for (const l of inv.lines) {
      if (!FIXED.includes(l.item) || l.amount <= 0) continue;
      by.set(l.item, [...(by.get(l.item) ?? []), l.amount]);
    }
  }
  const norms = new Map<Item, { median: number; n: number }>();
  for (const [item, xs] of by) if (xs.length >= 3) norms.set(item, { median: median(xs)!, n: xs.length });
  return norms;
}

/** Items the carrier has charged before, to notice a new one. */
function seenItems(history: ParsedInvoice[], carrier: string): Set<string> {
  const seen = new Set<string>();
  for (const inv of history) if (inv.carrier === carrier) inv.lines.forEach((l) => seen.add(l.item === 'other' ? `other:${l.label}` : l.item));
  return seen;
}

/**
 * The usual freight for this carrier on the lane (same country and weight
 * band, else the region): per shipment up to 50 kg, where minimum charges
 * rule, and per kg above. null with fewer than MIN_LANE earlier shipments.
 */
export function freightNorm(
  shipments: Shipment[],
  carrier: string,
  country: string,
  kg: number,
): { expected: number; perKg: boolean; n: number; basis: 'lane' | 'region' } | null {
  const band = bandOf(kg);
  const perKg = kg > 50;
  const pool = shipments.filter(
    (s) => s.mode === 'air' && s.in_comparison && s.carrier === carrier && s.freight > 0 && bandOf(s.chargeable_kg ?? s.weight_kg ?? 0) === band,
  );
  for (const [basis, set] of [
    ['lane', pool.filter((s) => s.country === country)],
    ['region', pool.filter((s) => regionOf(s.country) === regionOf(country))],
  ] as const) {
    if (set.length < MIN_LANE) continue;
    const xs = set.map((s) => (perKg ? s.freight / Math.max(s.chargeable_kg ?? s.weight_kg ?? 1, 1) : s.freight));
    return { expected: median(xs)! * (perKg ? kg : 1), perKg, n: xs.length, basis };
  }
  return null;
}

export function checkInvoice(inv: ParsedInvoice, history: ParsedInvoice[], shipments: Shipment[]): Report {
  const norms = feeNorms(history, inv.carrier, inv.mode);
  const seen = seenItems(history, inv.carrier);
  const findings: Finding[] = [];
  const counted = new Map<Item, number>();

  const rows: Row[] = inv.lines.map((line) => {
    const row: Row = { line, expected: null, diff: null, status: 'ok', note: null };
    if (line.item === 'tax') {
      row.note = 'מיסים, לא חלק מעלות הלוגיסטיקה';
      return row;
    }
    const norm = norms.get(line.item);
    const times = (counted.get(line.item) ?? 0) + 1;
    counted.set(line.item, times);
    if (FIXED.includes(line.item) && times > 1) {
      row.status = 'over';
      row.diff = line.amount;
      row.expected = 0;
      row.note = 'הסעיף מופיע פעמיים';
      findings.push({
        status: 'over',
        diff: line.amount,
        text: `${line.label} חויב פעמיים בחשבונית (${shekels(line.amount)} נוספים).`,
        letter: `הסעיף "${line.label}" חויב פעמיים (${shekels(line.amount)} נוספים).`,
      });
      return row;
    }
    if (norm) {
      row.expected = norm.median;
      const over = line.amount - norm.median;
      if (over > Math.max(10, norm.median * 0.1)) {
        row.status = 'over';
        row.diff = round(over);
        row.note = `בדרך כלל ${shekels(norm.median)} (${norm.n} חשבוניות קודמות)`;
        findings.push({
          status: 'over',
          diff: row.diff,
          text: `${line.label}: חויב ${shekels(line.amount)}, ובחשבוניות קודמות של ${inv.carrier} בדרך כלל ${shekels(norm.median)}.`,
          letter: `${line.label}: חויב ${shekels(line.amount)}, בעוד שבחשבוניות קודמות שלכם החיוב היה ${shekels(norm.median)}.`,
        });
      }
      return row;
    }
    const key = line.item === 'other' ? `other:${line.label}` : line.item;
    if (history.some((h) => h.carrier === inv.carrier) && !seen.has(key)) {
      row.status = 'check';
      row.note = 'סעיף שלא הופיע בחשבוניות קודמות';
      findings.push({
        status: 'check',
        diff: null,
        text: `סעיף חדש שלא הופיע בחשבוניות קודמות: ${line.label}, ${shekels(line.amount)}.`,
        letter: `הסעיף "${line.label}" (${shekels(line.amount)}) לא הופיע בחשבוניות קודמות שלכם. נבקש פירוט.`,
      });
    }
    return row;
  });

  const freightRows = rows.filter((r) => r.line.item === 'freight');
  const freight = freightRows.reduce((s, r) => s + r.line.amount, 0);

  // the supplier pays the main freight on these terms
  if (freight > 0 && supplierPays(inv.incoterms)) {
    freightRows.forEach((r) => {
      r.status = 'over';
      r.expected = 0;
      r.diff = r.line.amount;
      r.note = `לפי תנאי המכר (${inv.incoterms}) הספק משלם את ההובלה`;
    });
    findings.push({
      status: 'over',
      diff: round(freight),
      text: `חויבה הובלה בינלאומית של ${shekels(freight)}, אבל לפי תנאי המכר (${inv.incoterms}) את ההובלה משלם הספק.`,
      letter: `חויבה הובלה בינלאומית של ${shekels(freight)}, אף שלפי תנאי המכר (${inv.incoterms}) ההובלה על חשבון הספק.`,
    });
  } else if (freight > 0 && inv.mode === 'air') {
    // charged by more weight than the goods and their volume explain
    const physical = Math.max(inv.weightKg ?? 0, (inv.cbm ?? 0) * KG_PER_CBM);
    const charged = inv.chargeableKg;
    if (charged && physical && charged > physical * 1.1 + 1) {
      const actual = `${Math.round((inv.weightKg ?? 0) * 100) / 100} ק״ג`;
      const volume = inv.cbm ? ` והנפח ${inv.cbm} CBM (${Math.round(inv.cbm * KG_PER_CBM * 10) / 10} ק״ג נפחי)` : '';
      findings.push({
        status: inv.cbm ? 'over' : 'check',
        diff: inv.cbm ? round(freight * (1 - physical / charged)) : null,
        text: `משקל לחיוב ${charged} ק״ג, כשהמשקל בפועל ${actual}${volume || ' והנפח לא מופיע בחשבונית'}. כדאי לבקש מהמוביל את המידות שלפיהן חויב.`,
        letter: `משקל החיוב הוא ${charged} ק״ג, בעוד שמשקל המשלוח בפועל הוא ${actual}${volume}. נבקש את המידות שלפיהן חושב משקל החיוב.`,
      });
    }
    // freight per kg against the lane
    const kg = charged ?? physical;
    const lane = inv.country && kg ? freightNorm(shipments, inv.carrier, inv.country, kg) : null;
    if (lane && kg) {
      const expected = lane.expected;
      const limit = lane.perKg ? 1.25 : 1.4;
      freightRows.forEach((r) => (r.expected = round(expected * (r.line.amount / freight))));
      if (freight > expected * limit && freight - expected > 200) {
        const diff = round(freight - expected);
        const where = lane.basis === 'lane' ? `מ${inv.country}` : 'מאותו אזור';
        const usual = lane.perKg
          ? `${Math.round(expected / kg)} ₪ לק״ג`
          : `${shekels(expected)} למשלוח`;
        freightRows.forEach((r) => {
          r.status = r.status === 'ok' ? 'over' : r.status;
          r.diff = round(diff * (r.line.amount / freight));
          r.note = `בדרך כלל ${usual}`;
        });
        findings.push({
          status: 'over',
          diff,
          text: `ההובלה הבינלאומית ${shekels(freight)}${lane.perKg ? ` (${Math.round(freight / kg)} ₪ לק״ג)` : ''}, כשבמשלוחים דומים של ${inv.carrier} ${where}, ${bandOf(kg)} ק״ג, היא בדרך כלל ${usual} (${lane.n} משלוחים). הפרש של כ-${shekels(diff)}.`,
          letter: `ההובלה הבינלאומית חויבה ${shekels(freight)}${lane.perKg ? ` (${Math.round(freight / kg)} ₪ לק״ג)` : ''}, בעוד שבמשלוחים דומים שלכם ${where} החיוב היה בדרך כלל ${usual}, הפרש של כ-${shekels(diff)}.`,
        });
      }
    }
  }

  const incomplete = !complete(inv);
  const overcharge = round(findings.filter((f) => f.status === 'over').reduce((s, f) => s + (f.diff ?? 0), 0));
  return { rows, findings, overcharge, status: findings.length || incomplete ? 'flagged' : 'ok', incomplete };
}

/** A letter to the carrier about what was found, ready to edit and send. */
export function letterFor(inv: ParsedInvoice, report: Report, signer: string): string {
  const what = [inv.supplier, inv.country ? `מ${inv.country}` : null, inv.chargeableKg ?? inv.weightKg ? `${inv.chargeableKg ?? inv.weightKg} ק״ג` : null]
    .filter(Boolean)
    .join(', ');
  const lines = report.findings.map((f) => `- ${f.letter ?? f.text}`);
  return [
    'שלום רב,',
    '',
    `בבדיקת חשבונית ${inv.invoiceNo ?? ''}${inv.date ? ` מתאריך ${inv.date.split('-').reverse().join('.')}` : ''}${what ? `, עבור המשלוח (${what})` : ''}, מצאנו:`,
    ...lines,
    '',
    report.overcharge > 0
      ? `נבקש הסבר לסעיפים האלה, ואם אין הצדקה, זיכוי של כ-${shekels(report.overcharge)}.`
      : 'נבקש הסבר לסעיפים האלה.',
    '',
    'בברכה,',
    `${signer}, טרימקו`,
  ].join('\n');
}

export { ITEM_LABELS };
