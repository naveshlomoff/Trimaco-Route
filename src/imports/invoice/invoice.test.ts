import { describe, expect, it } from 'vitest';
import type { Shipment } from '../model';
import { checkInvoice, letterFor } from './check';
import { complete, costsOf, docName, goodsInvoiceOf, parseInvoices, type ParsedInvoice } from './parse';

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

  it('reads a KRIEF payment request: the charges before the invoice', () => {
    const request = [
      "10:15 :שעה 11/10/26 :תאריך",
      "10000001 'מס לתיק תשלום בקשת",
      'USD 5000.00 1.50 1,500.00 400.00 ACME CO., LTD',
      'PUSAN ASHDOD 14/10/26 FOB',
      'ח"בש טובין ערך',
      '18,000.00',
      'תשלום פרטי',
      '600.00 BTBמ"מע כולל נמל חיוב 16',
      '1,000.00 בינלאומית הובלה 975',
      '3,000.00 מ"מע 3',
      '700.00 בארץ יבשתית הובלה 102 *',
      '250.00 עמלה 103 *',
      '5,600.00 :תשלום דרישת כ"סה',
      '50.00 :לתשלום מ"מע כ"סה',
      'www.krief.co.il',
    ];
    const [inv] = parseInvoices([request]);
    expect(inv).toMatchObject({
      carrier: 'KRIEF',
      document: 'request',
      invoiceNo: 'בקשה 10000001',
      date: '2026-10-11',
      supplier: 'ACME CO., LTD',
      country: 'דרום קוריאה',
      mode: 'sea',
      incoterms: 'FOB',
      weightKg: 400,
      chargeableKg: 1500,
      cbm: 1.5,
      goodsValue: 18000,
      subtotal: 5550,
    });
    expect(inv.lines.map((l) => l.item)).toEqual(['terminal', 'freight', 'tax', 'inland', 'broker_fee']);
    expect(complete(inv)).toBe(true);
    expect(docName(inv)).toBe('בקשת תשלום 10000001');
  });

  it('reads a טוטל קר invoice, with charges in another currency', () => {
    const invoice = [
      'מקור 21/06/26 : תאריך',
      '190001 מספר: חיוב מס חשבונית',
      '2 : כמות שתלים : │ת.טובין',
      'אריזה:קרטונים 15/06/26 : ת.הגעה NETHERLNDS מוצא │ארץ',
      '10.00 : 26044600000000משקל: יבוא הצהרת │ח.תעופה/אוניה:',
      ': נפח הצהרה: AMSTERDAMאריך : טעינה │נמל',
      'ACME EMEA : ספק 00000001 : ראשי │ש/מ',
      '50,000 : ערך 00000002 : פנימי │ש/מ',
      'EXW : מכר │תנאי',
      '│ 9,000.00 │ILS 9,000.00 │ למכס מע"מ 1│',
      '│ 1,900.00 │ILS 1,900.00 לעמילות│ משילוח הובלה 14│',
      '250.00 │ │ILS 250.00 │ מכס עמילות 18│',
      '45.00 │ │ILS 45.00 │ פורמאליות 59│',
      '100.00 │ │ILS 100.00 │ חייב אוירי מסוף 94│',
      '60.00 │ │USD 20.00 │ עולמי שער 98│',
      '10,900.00 : מע"מ חייב לא סה"כ',
      '455.00 : במע"מ חייב סה"כ',
      '11,436.90 סה"כ',
      'בע"מ לוג\'יסטיקס קר טוטל לפקודת לרשום יש │שקים',
    ];
    const [inv] = parseInvoices([invoice, ['ʮʲʮ declaration page']]);
    expect(inv).toMatchObject({
      carrier: 'טוטל קר',
      invoiceNo: '190001',
      date: '2026-06-21',
      declarationNo: '26044600000000',
      supplier: 'ACME EMEA',
      country: 'הולנד',
      mode: 'air',
      incoterms: 'EXW',
      weightKg: 10,
      goodsValue: 50000,
    });
    expect(inv.lines.map((l) => l.item)).toEqual(['tax', 'freight', 'broker_fee', 'formalities', 'terminal', 'global_gate']);
    expect(inv.lines[1].label).toBe('הובלה משילוח לעמילות');
    expect(costsOf(inv)).toEqual({ freight: 1900, inland: 0, fees: 455 });
    expect(complete(inv)).toBe(true);
  });

  it('reads a טוטל קר payment request', () => {
    const request = [
      'יבוא 460001: מספרנו 10/09/26 : תאריך',
      'ם ו ל ש ת ת ש ק ב',
      '│ISTANBUL GRAND (N │ASHDOD │ │SOME SHIP ║',
      '1 │כמות: │נפח: 1,200.00 │ת.הפלגה:│06/09/26משקל: 09/09/26 ║ת.הגעה:',
      '│100000 : │ACMEמצהר TRADING B.V : ║הספק',
      '20,000 : בש"ח למכס מקובל מחיר',
      '5,000.00 │ 10/09/26 │1500001 לעמילות משילוח הובלה ║',
      '3,600.00 │ │ │ למכס מע"מ ║',
      '250.00 │ │ │ מכס ║*עמילות',
      '45.00 │ │ │ ║*פורמאליות',
      '850.00 │ │ │ חייב נמל ║*מיסי',
      '1,800.00 │ │ │ יבשתית ║*הובלה',
      '8,600.00 מע"מ: חייב לא סה"כ',
      '2,945.00 : במע"מ חייב סה"כ בלבד. אומדן היא הכספית ההזמנה',
      '12075.1 : סה"כ',
      'בע"מ לוג\'יסטיקס קר טוטל',
    ];
    const [inv] = parseInvoices([request]);
    expect(inv).toMatchObject({
      carrier: 'טוטל קר',
      document: 'request',
      invoiceNo: 'בקשה 460001',
      supplier: 'ACME TRADING B.V',
      country: 'טורקיה',
      mode: 'sea',
      weightKg: 1200,
      cbm: null,
      goodsValue: 20000,
      total: 12075.1,
    });
    expect(inv.lines.map((l) => [l.label, l.item])).toEqual([
      ['הובלה משילוח לעמילות', 'freight'],
      ['מע"מ למכס', 'tax'],
      ['עמילות מכס', 'broker_fee'],
      ['פורמאליות', 'formalities'],
      ['מיסי נמל חייב', 'terminal'],
      ['הובלה יבשתית', 'inland'],
    ]);
    expect(complete(inv)).toBe(true);
  });

  it('tells a goods invoice of Total Care B.V from a shipping one', () => {
    const page = ['Invoice', 'Total Care Logistics B.V', 'Invoice Number: 1000001', 'Handling charges 250.00 EUR', 'Bank charges 70.00 EUR'];
    expect(parseInvoices([page])).toEqual([]);
    expect(goodsInvoiceOf([page])?.fees).toEqual([
      { label: 'עמלת טיפול', amount: 250, currency: 'EUR' },
      { label: 'עמלת בנק', amount: 70, currency: 'EUR' },
    ]);
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
