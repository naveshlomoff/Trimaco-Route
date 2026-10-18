import { describe, expect, it } from 'vitest';
import type { Shipment } from '../model';
import { checkInvoice, letterFor } from './check';
import { complete, costsOf, parseInvoices, type ParsedInvoice } from './parse';

// Made-up invoices, laid out the way pdf.js reads the two carriers' PDFs.
const krief = (no: string, freight: string, fee: string, chargeable: string) => [
  '512132994 מספר. מ.ע',
  `30/08/26:תאריך ${no}:מספר מס חשבונית`,
  '3.92 :משקל MILANO :מוצא נמל :ספנות חברת',
  `${chargeable} :לחיוב משקל TLV :יעד נמל`,
  'ACME SRL :ספק :סוכן שם 05/08/26 :טיסה/הפלגה תאריך',
  'EXW :מכר תנאי 26044711111111 הצהרת',
  '25,000 :הטובין ערך',
  ':חיובים פירוט',
  '4500.00 4500.00 ILS 473575041 18/08/26 מ"מע 3',
  `${freight} ${freight} ILS 3188320 16/08/26 בינלאומית הובלה 975`,
  '300.00 300.00 ILS בארץ יבשתית הובלה 102',
  `${fee} ${fee} ILS עמלה 103`,
  '100.00 100.00 ILS עולמי שער 134',
  `${(4500 + Number(freight) + 300 + Number(fee) + 100).toFixed(2)} ILS :מ"מע פטור כ"סה`,
  'Tel: +972-747-555-555 | www.krief.co.il',
];

const maayan = [
  '31.01.26 תאריך החשבונית 510751274 מספר עוסק מורשה',
  'מקור L-A00000001 חשבונית מס מספר מסמך ממוחשב',
  'בית מכס נתב"ג תחנה',
  '26044400000000 רשימון 1 כמות',
  '5666 מצהר 25.000 משקל בק"ג',
  'ממן אתר אחסון 0.0500 נפח CBM',
  '27.01.26 תאריך הגעה גוש קוריאה הדרומית ארץ מוצא',
  'ש"ח 12,000.00 ערך המשלוח מס\' מכולה BRAVO MEDICAL CO שם ספק',
  'פירוט חיובים',
  '441522307 27.01.26 NIS -100.00 -100.00 מכס כולל אגרות',
  'L75260660 27.01.26 NIS 1,800.00 1,800.00 הובלה אווירית',
  '31.01.26 NIS 250.00 250.00 עמלה',
  '31.01.26 NIS 98.00 98.00 שער עולמי',
  'A12845061 19.03.26 NIS 57.00 57.00 רנ"ר ללא מע"מ',
  '1,700.00 סה"כ לא חייב מע"מ',
  '405.00 סה"כ חייב מע"מ',
  'NIS 2,177.90 סה"כ חשבונית בש"ח',
  'מעין לוגיסטיקה ) 1977 ( בע"מ',
];

describe('parseInvoices', () => {
  it('reads a KRIEF invoice: details, charges by code, and a total that adds up', () => {
    const [inv] = parseInvoices([krief('4890001', '1192.00', '250.00', '11.00')]);
    expect(inv).toMatchObject({
      carrier: 'KRIEF',
      invoiceNo: '4890001',
      date: '2026-08-30',
      supplier: 'ACME SRL',
      country: 'איטליה',
      incoterms: 'EXW',
      weightKg: 3.92,
      chargeableKg: 11,
      goodsValue: 25000,
      mode: 'air',
    });
    expect(inv.lines.map((l) => l.item)).toEqual(['tax', 'freight', 'inland', 'broker_fee', 'global_gate']);
    expect(inv.lines[1].label).toBe('הובלה בינלאומית');
    expect(costsOf(inv)).toEqual({ freight: 1192, inland: 300, fees: 350 });
    expect(complete(inv)).toBe(true);
  });

  it('reads a מעיין invoice, with a credit line and a two-word country', () => {
    const [inv] = parseInvoices([maayan, ['ʮʲʮ declaration page', 'BRAVO 3166913 FCA ₪57', 'CIF ʪʸʲ']]);
    expect(inv).toMatchObject({
      carrier: 'מעיין',
      invoiceNo: 'L-A00000001',
      country: 'דרום קוריאה',
      supplier: 'BRAVO MEDICAL CO',
      weightKg: 25,
      cbm: 0.05,
      incoterms: 'FCA',
    });
    expect(inv.lines[0]).toMatchObject({ item: 'tax', amount: -100 });
    expect(inv.lines.find((l) => l.label.startsWith('רנ'))?.item).toBe('terminal');
    expect(complete(inv)).toBe(true);
  });

  it('splits a PDF holding several invoices', () => {
    const pages = [krief('4890001', '1500.00', '250.00', '30.00'), ['page 2 of the same invoice', 'www.krief.co.il'], krief('4890002', '1600.00', '250.00', '35.00')];
    expect(parseInvoices(pages).map((i) => i.invoiceNo)).toEqual(['4890001', '4890002']);
  });
});

describe('checkInvoice', () => {
  const history = ['4880001', '4880002', '4880003'].map((no) => parseInvoices([krief(no, '1500.00', '250.00', '30.00')])[0]);
  const lane: Shipment[] = [25, 30, 35].map((kg, i) => ({
    carrier: 'KRIEF',
    month: '2026-05',
    supplier: 'ACME',
    country: 'איטליה',
    mode: 'air',
    incoterms: 'EXW',
    weight_kg: kg,
    cbm: null,
    chargeable_kg: kg,
    goods_value: 20000,
    freight: 1400 + i * 100,
    inland: 300,
    fees: 350,
    freight_billed: true,
    in_comparison: true,
    excluded: false,
    notes: null,
  }));

  it('passes an invoice like the earlier ones', () => {
    const [inv] = parseInvoices([krief('4890010', '1550.00', '250.00', '30.00')]);
    const r = checkInvoice({ ...inv, weightKg: 30 }, history, lane);
    expect(r).toMatchObject({ status: 'ok', overcharge: 0, findings: [] });
  });

  it('flags a fee above the usual, chargeable weight above the goods, and freight the supplier pays', () => {
    const [inv] = parseInvoices([krief('4890011', '1192.00', '350.00', '11.00')]);
    const r = checkInvoice({ ...inv, cbm: 0.02, incoterms: 'CIP' }, history, lane);
    const texts = r.findings.map((f) => f.text).join('\n');
    expect(texts).toContain('עמלה: חויב 350');
    expect(texts).toContain('לפי תנאי המכר (CIP)');
    expect(r.overcharge).toBeCloseTo(100 + 1192);
    const letter = letterFor(inv, r, 'עדי');
    expect(letter).toContain('בעוד שבחשבוניות קודמות שלכם החיוב היה 250 ₪');
    expect(letter).toContain('עדי, טרימקו');
  });

  it('asks about chargeable weight when the volume is unknown', () => {
    const [inv] = parseInvoices([krief('4890012', '1192.00', '250.00', '11.00')]);
    const r = checkInvoice(inv, history, lane);
    expect(r.findings[0]).toMatchObject({ status: 'check', diff: null });
    expect(r.findings[0].letter).toContain('נבקש את המידות');
  });

  it('flags freight far above the lane', () => {
    const [inv] = parseInvoices([krief('4890013', '3200.00', '250.00', '30.00')]);
    const r = checkInvoice({ ...inv, weightKg: 30 } as ParsedInvoice, history, lane);
    expect(r.findings[0].text).toContain('בדרך כלל');
    expect(r.overcharge).toBeCloseTo(3200 - 1500);
  });
});
