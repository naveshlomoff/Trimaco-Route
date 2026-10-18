// Reads a carrier's invoice (lines from extract.ts) into its charges and the
// shipment's details. Two formats so far, the two biggest brokers:
// - KRIEF: every charge line ends with a numeric code (975 international
//   freight, 102 inland, 103 fee...); the Hebrew comes out word-reversed.
// - מעיין (printed by UNIFREIGHT): "date NIS amount amount label".
// A PDF may hold several invoices, each followed by its customs declaration
// pages; an invoice runs until the next one starts.

export type Item =
  | 'freight'
  | 'inland'
  | 'broker_fee'
  | 'global_gate'
  | 'terminal'
  | 'storage'
  | 'cyber'
  | 'docs'
  | 'formalities'
  | 'courier'
  | 'delivery_order'
  | 'tax'
  | 'other';

export const ITEM_LABELS: Record<Item, string> = {
  freight: 'הובלה בינלאומית',
  inland: 'הובלה יבשתית',
  broker_fee: 'עמלת עמילות',
  global_gate: 'שער עולמי',
  terminal: 'מסוף וממ״ן',
  storage: 'אחסנה',
  cyber: 'דמי סייבר',
  docs: 'מסמכים ותקשורת',
  formalities: 'פורמליות',
  courier: 'שליח',
  delivery_order: 'פקודת מסירה',
  tax: 'מיסים ואגרות מכס',
  other: 'אחר',
};

export interface InvoiceLine {
  item: Item;
  label: string;
  amount: number;
  code?: string;
}

export type Carrier = 'KRIEF' | 'מעיין';

export interface ParsedInvoice {
  carrier: Carrier;
  invoiceNo: string | null;
  /** yyyy-mm-dd */
  date: string | null;
  declarationNo: string | null;
  supplier: string | null;
  country: string | null;
  mode: 'air' | 'sea';
  incoterms: string | null;
  weightKg: number | null;
  chargeableKg: number | null;
  cbm: number | null;
  goodsValue: number | null;
  lines: InvoiceLine[];
  /** The invoice's total before VAT (exempt + taxable lines): the lines read must add up to it. */
  subtotal: number | null;
  /** The total to pay, VAT included. */
  total: number | null;
}

/** True when the lines read add up to the invoice's own subtotal. */
export function complete(inv: ParsedInvoice): boolean {
  if (inv.subtotal === null) return false;
  const sum = inv.lines.reduce((s, l) => s + l.amount, 0);
  return Math.abs(sum - inv.subtotal) < 1;
}

const sumOf = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const x = Number(s.replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};

const KRIEF_CODES: Record<string, Item> = {
  '3': 'tax',
  '42': 'tax',
  '45': 'tax',
  '975': 'freight',
  '102': 'inland',
  '103': 'broker_fee',
  '104': 'formalities',
  '120': 'docs',
  '134': 'global_gate',
  '300': 'terminal',
  '301': 'terminal',
};

/** By the words of the charge, for codes and labels not seen before. */
export function itemOf(label: string): Item {
  const t = label.replace(/["״׳']/g, '').trim();
  // VAT and customs on the goods, not a service: "מע"מ רשימון", "מכס כולל אגרות" (but not "רנ"ר ללא מע"מ")
  if (/^מעמ( רשימון)?$|מעמ רשימון|(^|\s)מכס($|\s)|אגרת ביטחון|אגרת מחשב|מס קניה/.test(t)) return 'tax';
  if (/ממן|מסוף|נרר|רנר|טרמינל|סוויספורט|SWISSPORT/i.test(t)) return 'terminal';
  if (/יבשתית/.test(t)) return 'inland';
  if (/הובלה|אווירית|ימית|בינלאומית|FREIGHT/i.test(t)) return 'freight';
  if (/שער עולמי/.test(t)) return 'global_gate';
  if (/עמלה|עמילות/.test(t)) return 'broker_fee';
  if (/אחסנה|אחסון/.test(t)) return 'storage';
  if (/סייבר/.test(t)) return 'cyber';
  if (/מסמכים|תקשורת/.test(t)) return 'docs';
  if (/פורמליות/.test(t)) return 'formalities';
  if (/קורייר|שליח|פדקס|FEDEX/i.test(t)) return 'courier';
  if (/פקודת מסירה/.test(t)) return 'delivery_order';
  return 'other';
}

const COUNTRIES_EN: [RegExp, string][] = [
  [/ITAL|MILAN|MALPENSA|BOLOGNA|ROME|VERONA/, 'איטליה'],
  [/NETHERLAND|HOLLAND|AMSTERDAM|SCHIPHOL|ROTTERDAM/, 'הולנד'],
  [/GERMAN|FRANKFURT|MUNICH|HAMBURG|BERLIN|DUSSELDORF|STUTTGART/, 'גרמניה'],
  [/FRANCE|PARIS|LYON|MARSEILLE/, 'צרפת'],
  [/SWITZERLAND|ZURICH|GENEVA|BASEL/, 'שווייץ'],
  [/DENMARK|COPENHAGEN|BILLUND/, 'דנמרק'],
  [/BELGIUM|BRUSSELS|LIEGE|ANTWERP/, 'בלגיה'],
  [/IRELAND|DUBLIN|SHANNON|CORK/, 'אירלנד'],
  [/UNITED KINGDOM|ENGLAND|LONDON|HEATHROW|MANCHESTER|\bUK\b/, 'בריטניה'],
  [/SPAIN|MADRID|BARCELONA/, 'ספרד'],
  [/PORTUGAL|LISBON|PORTO/, 'פורטוגל'],
  [/FINLAND|HELSINKI/, 'פינלנד'],
  [/AUSTRIA|VIENNA/, 'אוסטריה'],
  [/SWEDEN|STOCKHOLM/, 'שוודיה'],
  [/POLAND|WARSAW/, 'פולין'],
  [/TURKEY|ISTANBUL/, 'טורקיה'],
  [/CANADA|TORONTO|MONTREAL|VANCOUVER/, 'קנדה'],
  [/\bUSA\b|\bU\.S\.A|UNITED STATES|NEW YORK|\bJFK\b|CHICAGO|LOS ANGELES|MIAMI|ATLANTA|BOSTON|MEMPHIS|NEWARK/, 'ארה״ב'],
  [/HONG KONG/, 'הונג קונג'],
  [/CHINA|SHANGHAI|BEIJING|SHENZHEN|GUANGZHOU|HUAIYIN|NINGBO/, 'סין'],
  [/KOREA|SEOUL|INCHEON|BUSAN/, 'דרום קוריאה'],
  [/SINGAPORE/, 'סינגפור'],
  [/JAPAN|TOKYO|OSAKA/, 'יפן'],
  [/TAIWAN|TAIPEI/, 'טייוואן'],
  [/INDIA|MUMBAI|DELHI|BANGALORE|CHENNAI/, 'הודו'],
];

const COUNTRIES_HE = [
  'איטליה', 'הולנד', 'גרמניה', 'צרפת', 'שווייץ', 'דנמרק', 'בלגיה', 'אירלנד', 'בריטניה', 'ספרד', 'פורטוגל',
  'פינלנד', 'אוסטריה', 'שוודיה', 'פולין', 'טורקיה', 'קנדה', 'ארה"ב', 'ארה״ב', 'ארצות הברית', 'הונג קונג', 'סין',
  'דרום קוריאה', 'קוריאה הדרומית', 'קוריאה', 'סינגפור', 'יפן', 'טייוואן', 'הודו',
];

function countryFromEnglish(s: string | null | undefined): string | null {
  if (!s) return null;
  const u = s.toUpperCase();
  return COUNTRIES_EN.find(([re]) => re.test(u))?.[1] ?? null;
}

function normalizeCountry(c: string): string {
  if (c === 'ארה"ב' || c === 'ארצות הברית') return 'ארה״ב';
  if (c === 'קוריאה' || c === 'קוריאה הדרומית') return 'דרום קוריאה';
  return c;
}

function isoDate(d: string | undefined | null): string | null {
  const m = d?.match(/^(\d\d)[./](\d\d)[./](\d\d(?:\d\d)?)$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

const INCOTERMS_RE = /\b(EXW|FCA|FOB|FAS|CPT|CIP|CFR|CIF|DAP|DPU|DDU|DDP)\b(?! ʪʸʲ)(?! ערך)/;
const first = (lines: string[], re: RegExp): RegExpMatchArray | null => {
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m;
  }
  return null;
};

/** Hebrew words come out right to left in KRIEF's PDF: "בינלאומית הובלה" → "הובלה בינלאומית". */
const unreverse = (s: string) => s.split(' ').filter(Boolean).reverse().join(' ');

function parseKrief(own: string[], all: string[]): ParsedInvoice {
  const lines: InvoiceLine[] = [];
  for (const l of own) {
    const m = l.match(/^(-?[\d,]+\.\d\d) -?[\d,]+\.\d\d ILS ?(.*?) (\d{1,4})$/);
    if (!m) continue;
    const label = unreverse(m[2].replace(/\b\d{5,}\b/g, '').replace(/\d\d\/\d\d\/\d\d/g, '').trim());
    lines.push({ code: m[3], label, amount: num(m[1])!, item: KRIEF_CODES[m[3]] ?? itemOf(label) });
  }
  const origin = first(own, /(\S+(?: \S+)?) :מוצא נמל/)?.[1];
  const text = own.join('\n');
  return {
    carrier: 'KRIEF',
    invoiceNo: first(own, /(\d{5,}) ?:מספר מס חשבונית/)?.[1] ?? null,
    date: isoDate(first(own, /(\d\d\/\d\d\/\d\d) ?:תאריך/)?.[1]),
    declarationNo: first(own, /(\d{14}) הצהרת/)?.[1] ?? null,
    supplier: first(own, /^(.*?) :ספק/)?.[1]?.trim() || null,
    country: countryFromEnglish(origin),
    mode: /ASHDOD|HAIFA|אשדוד|חיפה/.test(first(own, /(\S+) :יעד נמל/)?.[1] ?? '') ? 'sea' : 'air',
    incoterms: first(own, /(\S+) :מכר תנאי/)?.[1] ?? first(all, INCOTERMS_RE)?.[1] ?? null,
    weightKg: num(first(own, /([\d.,]+) :משקל(?: |$)/)?.[1]),
    chargeableKg: num(first(own, /([\d.,]+) :לחיוב משקל/)?.[1]),
    cbm: num(first(own, /([\d.,]+) :ק"במ נפח/)?.[1]),
    goodsValue: num(first(own, /([\d.,]+) :הטובין ערך/)?.[1]),
    lines,
    subtotal: sumOf(num(text.match(/([\d,]+\.\d\d) ILS :מ"מע פטור כ"סה/)?.[1]), num(text.match(/([\d,]+\.\d\d) ILS :מ"מע חייב כ"סה/)?.[1])),
    total: num(text.match(/([\d,]+\.\d\d) ILS :לתשלום כ"סה/)?.[1]),
  };
}

function parseMaayan(own: string[], all: string[]): ParsedInvoice {
  const lines: InvoiceLine[] = [];
  let inCharges = false;
  for (const l of own) {
    if (/פירוט חיובים/.test(l)) inCharges = true;
    if (/סה"כ לא חייב/.test(l)) inCharges = false;
    if (!inCharges) continue;
    // a credit comes with a minus: "NIS -1,137.00 -1,137.00 מכס כולל אגרות"
    const m = l.match(/(\d\d\.\d\d\.\d\d) NIS (-?[\d,]+\.\d\d)(?: -?[\d,]+\.\d\d)? (.+)$/);
    if (!m) continue;
    lines.push({ label: m[3].trim(), amount: num(m[2])!, item: itemOf(m[3]) });
  }
  const countryLine = own.find((l) => /ארץ מוצא/.test(l)) ?? '';
  // longest first: "קוריאה הדרומית" before "קוריאה"
  const country = [...COUNTRIES_HE].sort((a, b) => b.length - a.length).find((c) => countryLine.includes(`${c} ארץ מוצא`)) ?? null;
  const station = first(own, /(.+) תחנה$/)?.[1] ?? '';
  return {
    carrier: 'מעיין',
    invoiceNo: first(own, /(\S+) חשבונית מס מספר/)?.[1] ?? null,
    date: isoDate(first(own, /(\d\d\.\d\d\.\d\d) תאריך החשבונית/)?.[1]),
    declarationNo: first(own, /(\d{14}) רשימון/)?.[1] ?? null,
    supplier: first(own, /([A-Z0-9][A-Za-z0-9 .,&'()\-/]*[A-Za-z0-9.)])\s*שם ספק/)?.[1]?.trim() ?? null,
    country: country ? normalizeCountry(country) : countryFromEnglish(first(own, /(\S+) נמל מוצא/)?.[1]),
    mode: /אשדוד|חיפה|נמל/.test(station) && !/נתב"ג/.test(station) ? 'sea' : 'air',
    incoterms: first(all, INCOTERMS_RE)?.[1] ?? null,
    weightKg: num(first(own, /([\d.,]+) משקל בק"ג/)?.[1]),
    chargeableKg: null,
    cbm: num(first(own, /([\d.,]+) נפח CBM/)?.[1]),
    goodsValue: num(first(own, /([\d,]+\.\d\d) ערך המשלוח/)?.[1]),
    lines,
    subtotal: sumOf(num(first(own, /^([\d,]+\.\d\d) סה"כ לא חייב מע"מ/)?.[1]), num(first(own, /^([\d,]+\.\d\d) סה"כ חייב מע"מ/)?.[1])),
    total: num(first(own, /NIS ([\d,]+\.\d\d) סה"כ חשבונית/)?.[1]),
  };
}

function carrierOf(page: string[]): Carrier | null {
  const text = page.join('\n');
  if (/krief\.co\.il/i.test(text) && /:מספר מס חשבונית/.test(text)) return 'KRIEF';
  if (/חשבונית מס מספר/.test(text) && /מעין לוגיסטיקה|UNIFREIGHT/.test(text)) return 'מעיין';
  return null;
}

/** Every invoice in the PDF (a single upload, or a whole bundle). */
export function parseInvoices(pages: string[][]): ParsedInvoice[] {
  const groups: { carrier: Carrier; pages: string[][] }[] = [];
  for (const page of pages) {
    const carrier = carrierOf(page);
    // a second page of the same KRIEF invoice ("2 מתוך 2 עמוד") carries no number: it continues
    const continues = carrier === 'KRIEF' && !page.some((l) => /:מספר מס חשבונית/.test(l));
    if (carrier && !continues) groups.push({ carrier, pages: [page] });
    else groups[groups.length - 1]?.pages.push(page);
  }
  return groups.map((g) => {
    const own = g.pages.filter((p) => carrierOf(p) || g.pages.indexOf(p) === 0).flat();
    const all = g.pages.flat();
    return g.carrier === 'KRIEF' ? parseKrief(own, all) : parseMaayan(own, all);
  });
}

/** The charges that are logistics, as Liraz counted them: no taxes, no VAT. */
export function costsOf(inv: ParsedInvoice): { freight: number; inland: number; fees: number } {
  let freight = 0;
  let inland = 0;
  let fees = 0;
  for (const l of inv.lines) {
    if (l.item === 'tax') continue;
    if (l.item === 'freight') freight += l.amount;
    else if (l.item === 'inland') inland += l.amount;
    else fees += l.amount;
  }
  return { freight, inland, fees };
}
