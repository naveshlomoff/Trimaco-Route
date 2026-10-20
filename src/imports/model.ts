// Trimaco Imports, stage A: which carrier to use for an air shipment, and
// what it should cost, from the history of past shipments (Liraz's analysis,
// "השוואת מובילים יבוא אווירי 2026"). No quotes: every number here is a median
// of shipments that already happened, and the screen shows which ones.
//
// The rules, as Liraz set them:
// - air only;
// - up to 10 kg goes to DHL express (306 ₪ release + about 65 ₪ a kg);
// - above that, the cheapest carrier on the lane (country + weight band);
// - when the supplier pays the freight (CPT, DAP...), only the release is ours;
// - when there isn't enough history, say so.

export type Mode = 'air' | 'sea';

export interface Shipment {
  id?: string;
  carrier: string;
  /** "2026-08" */
  month: string | null;
  supplier: string;
  country: string;
  mode: Mode;
  incoterms: string | null;
  weight_kg: number | null;
  cbm: number | null;
  chargeable_kg: number | null;
  goods_value: number | null;
  /** International freight, inland freight and every other charge, ₪ without VAT and taxes. */
  freight: number;
  inland: number;
  fees: number;
  /** The freight was billed to Trimaco (not paid by the supplier). */
  freight_billed: boolean;
  /** Counted in the carrier comparison (Liraz's column): air, freight billed, not excluded. */
  in_comparison: boolean;
  excluded: boolean;
  notes: string | null;
}

export type Region = 'europe' | 'north_america' | 'far_east' | 'south_asia' | 'other';

export const REGION_LABELS: Record<Region, string> = {
  europe: 'אירופה',
  north_america: 'צפון אמריקה',
  far_east: 'המזרח הרחוק',
  south_asia: 'הודו',
  other: 'שאר העולם',
};

const REGION_OF: Record<string, Region> = {
  איטליה: 'europe',
  הולנד: 'europe',
  צרפת: 'europe',
  גרמניה: 'europe',
  אירלנד: 'europe',
  שווייץ: 'europe',
  דנמרק: 'europe',
  בלגיה: 'europe',
  פורטוגל: 'europe',
  פינלנד: 'europe',
  בריטניה: 'europe',
  ספרד: 'europe',
  אוסטריה: 'europe',
  שוודיה: 'europe',
  פולין: 'europe',
  'ארה״ב': 'north_america',
  קנדה: 'north_america',
  סין: 'far_east',
  'הונג קונג': 'far_east',
  'דרום קוריאה': 'far_east',
  סינגפור: 'far_east',
  יפן: 'far_east',
  טייוואן: 'far_east',
  הודו: 'south_asia',
};

export function regionOf(country: string): Region {
  return REGION_OF[country] ?? 'other';
}

export type Band = 'עד 5' | '5–10' | '10–50' | '50–100' | 'מעל 100';

export function bandOf(kg: number): Band {
  if (kg <= 5) return 'עד 5';
  if (kg <= 10) return '5–10';
  if (kg <= 50) return '10–50';
  if (kg <= 100) return '50–100';
  return 'מעל 100';
}

/** Up to 50 kg a shipment is compared by its total; above, by the price per kg. */
const perKg = (band: Band) => band === '50–100' || band === 'מעל 100';

/** IATA: 1 CBM is charged as 167 kg. */
export const KG_PER_CBM = 167;
export const EXPRESS_MAX_KG = 10;
export const DHL_RELEASE = 306;
export const DHL_PER_KG = 65;

/** Terms where the supplier pays the main freight. */
const SUPPLIER_PAYS = new Set(['CPT', 'CIP', 'DAP', 'DPU', 'DDU', 'DDP', 'CFR', 'CIF']);
export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CPT', 'CIP', 'DAP', 'DDU', 'DDP'];

export function supplierPays(incoterms: string | null | undefined): boolean {
  return Boolean(incoterms && SUPPLIER_PAYS.has(incoterms.toUpperCase()));
}

export function chargeableKg(weightKg: number, cbm: number | null | undefined): number {
  return Math.max(weightKg, (cbm ?? 0) * KG_PER_CBM);
}

export const totalCost = (s: Shipment) => s.freight + s.inland + s.fees;
export const handlingCost = (s: Shipment) => s.inland + s.fees;
const kgOf = (s: Shipment) => s.chargeable_kg ?? s.weight_kg ?? 0;

export interface Request {
  country: string;
  weightKg: number;
  cbm?: number | null;
  incoterms?: string | null;
  goodsValue?: number | null;
}

/** How close the past shipments behind an estimate are to the request. */
export type Basis = 'lane' | 'region' | 'band' | 'rule';

export interface Estimate {
  carrier: string;
  cost: number;
  low: number;
  high: number;
  /** The past shipments it is based on. */
  shipments: Shipment[];
  basis: Basis;
}

export type Confidence = 'high' | 'medium' | 'low' | 'very_low';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
  very_low: 'נמוכה מאוד',
};

export interface Recommendation {
  kind: 'express' | 'history' | 'supplier_pays' | 'no_data';
  chargeableKg: number;
  /** Charged by volume, not by weight. */
  volumetric: boolean;
  band: Band;
  region: Region;
  /** Every carrier with history, cheapest first. */
  options: Estimate[];
  best: Estimate | null;
  alternative: Estimate | null;
  confidence: Confidence;
  warnings: string[];
  /** Logistics cost as a share of the goods' value, when the value is known. */
  shareOfValue: number | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One carrier's estimate from the narrowest set of its past shipments that has
 * any, among `levels`: the same country and weight band ('lane'), the same
 * region ('region'), or the band from anywhere ('band'). `metric` turns a
 * shipment into the number compared.
 */
function estimateFor(
  carrier: string,
  pool: Shipment[],
  req: { country: string; band: Band; kg: number },
  metric: (s: Shipment) => number,
  scaleByKg: boolean,
  levels: Basis[],
): Estimate | null {
  const mine = pool.filter((s) => s.carrier === carrier && bandOf(kgOf(s)) === req.band);
  const sets: Record<Basis, Shipment[]> = {
    lane: mine.filter((s) => s.country === req.country),
    region: mine.filter((s) => regionOf(s.country) === regionOf(req.country)),
    band: mine,
    rule: [],
  };
  for (const basis of levels) {
    const shipments = sets[basis];
    if (shipments.length === 0) continue;
    const values = shipments.map((s) => (scaleByKg ? metric(s) / Math.max(kgOf(s), 1) : metric(s)));
    const k = scaleByKg ? req.kg : 1;
    return {
      carrier,
      cost: median(values) * k,
      low: Math.min(...values) * k,
      high: Math.max(...values) * k,
      shipments,
      basis,
    };
  }
  return null;
}

function confidenceOf(e: Estimate | null): Confidence {
  if (!e || e.basis === 'band') return 'very_low';
  if (e.basis === 'rule') return 'medium';
  const n = e.shipments.length;
  if (e.basis === 'region') return n >= 3 ? 'low' : 'very_low';
  return n >= 5 ? 'high' : n >= 2 ? 'medium' : 'low';
}

const BASIS_ORDER: Record<Basis, number> = { rule: 0, lane: 1, region: 2, band: 3 };

export function recommend(req: Request, history: Shipment[]): Recommendation {
  const kg = chargeableKg(req.weightKg, req.cbm);
  const band = bandOf(kg);
  const region = regionOf(req.country);
  const volumetric = kg > req.weightKg + 0.01;
  const warnings: string[] = [];
  if (volumetric) {
    warnings.push(
      `המשלוח יחויב לפי נפח: ${round(kg)} ק״ג לחיוב במקום ${round(req.weightKg)} ק״ג בפועל. כדאי לבקש מהספק אריזה קטנה יותר.`,
    );
  }

  const air = history.filter((s) => s.mode === 'air' && !s.excluded);
  const carriers = [...new Set(air.map((s) => s.carrier))];
  const lane = { country: req.country, band, kg };
  const byCost = (a: Estimate, b: Estimate) =>
    BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis] || a.cost - b.cost || b.shipments.length - a.shipments.length;
  const done = (kind: Recommendation['kind'], options: Estimate[], best: Estimate | null): Recommendation => {
    const alternative = options.find((o) => o !== best) ?? null;
    const share = best && req.goodsValue ? best.cost / req.goodsValue : null;
    // release and delivery cost about the same from anywhere: only the number of shipments counts
    const n = best?.shipments.length ?? 0;
    const confidence: Confidence =
      kind === 'supplier_pays' ? (n >= 5 ? 'high' : n >= 2 ? 'medium' : n ? 'low' : 'very_low') : confidenceOf(best);
    return { kind, chargeableKg: kg, volumetric, band, region, options, best, alternative, confidence, warnings, shareOfValue: share };
  };

  // The supplier pays the freight: what's left for us is the release and delivery.
  if (supplierPays(req.incoterms)) {
    const options = carriers
      .map((c) => estimateFor(c, air, lane, handlingCost, false, ['band']))
      .filter((e): e is Estimate => e !== null)
      .sort(byCost);
    // a single cheap shipment isn't a pattern: prefer a carrier seen at least twice
    const best = options.find((o) => o.shipments.length >= 2) ?? options[0] ?? null;
    warnings.push('לפי תנאי המכר הספק משלם את ההובלה. נשארים לנו השחרור מהמכס והמסירה, וזה מה שמושווה כאן.');
    return done('supplier_pays', options, best);
  }

  // Freight billed to us, and the history to compare by.
  const pool = air.filter((s) => s.in_comparison);
  const options = carriers
    .map((c) => estimateFor(c, pool, lane, totalCost, perKg(band), ['lane', 'region']))
    .filter((e): e is Estimate => e !== null);

  if (kg <= EXPRESS_MAX_KG) {
    const cost = DHL_RELEASE + DHL_PER_KG * kg;
    const dhl: Estimate = {
      carrier: 'DHL',
      cost,
      low: cost * 0.85,
      high: cost * 1.2,
      shipments: pool.filter((s) => s.carrier === 'DHL'),
      basis: 'rule',
    };
    const rest = options.filter((o) => o.carrier !== 'DHL').sort(byCost);
    return done('express', [dhl, ...rest], dhl);
  }

  if (options.length === 0) return done('no_data', [], null);
  // the cheapest among the closest evidence: a lane estimate beats a cheaper guess from the region
  options.sort(byCost);
  const best = options[0];
  if (best.basis !== 'lane') warnings.push('אין משלוחים קודמים מהמדינה הזו בטווח המשקל הזה. ההערכה לפי משלוחים מאזור קרוב.');
  const sameLevel = options.filter((o) => o.basis === best.basis);
  if (sameLevel.length === 1) {
    warnings.push(
      options.length > 1
        ? `רק ${best.carrier} שלח משלוחים כאלה מ${req.country}. לשאר יש נתונים רק מאזור קרוב, אז ההשוואה חלשה.`
        : 'רק מוביל אחד שלח משלוחים כאלה, אז אין עם מה להשוות.',
    );
  }
  else if ((sameLevel[1].cost - best.cost) / sameLevel[1].cost < 0.05) {
    warnings.push(`ההפרש מול ${sameLevel[1].carrier} קטן מ-5%, אפשר לבחור גם לפי נוחות או זמן.`);
  }
  return done('history', options, best);
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

/** A carrier choice Adi recorded on the recommendation screen. */
export interface ImportRequest {
  id?: string;
  created_at?: string;
  created_by?: string | null;
  /** Adi's own number for the shipment (an order or file number). */
  reference?: string | null;
  supplier: string | null;
  country: string;
  weight_kg: number;
  cbm: number | null;
  incoterms: string | null;
  goods_value: number | null;
  chargeable_kg: number;
  kind: Recommendation['kind'];
  recommended: string | null;
  recommended_cost: number | null;
  confidence: Confidence | null;
  chosen: string;
  chosen_cost: number | null;
  notes: string | null;
}

/**
 * The suppliers seen so far, with the country they usually ship from: the
 * history, plus every supplier Adi entered since (`more`), so a new one is
 * remembered from its first shipment.
 */
export function suppliersOf(
  history: Shipment[],
  more: { supplier: string | null; country: string | null }[] = [],
): { name: string; country: string; countries: string[]; count: number }[] {
  const by = new Map<string, { name: string; countries: Map<string, number>; count: number }>();
  const all = [
    ...history,
    ...more.flatMap((m) => (m.supplier && m.country ? [{ supplier: m.supplier, country: m.country }] : [])),
  ];
  for (const s of all) {
    const key = s.supplier.trim().toUpperCase();
    if (!key) continue;
    const e = by.get(key) ?? { name: s.supplier.trim(), countries: new Map(), count: 0 };
    e.count++;
    e.countries.set(s.country, (e.countries.get(s.country) ?? 0) + 1);
    by.set(key, e);
  }
  return [...by.values()]
    .map((e) => {
      const countries = [...e.countries].sort((a, b) => b[1] - a[1]).map(([c]) => c);
      return { name: e.name, count: e.count, country: countries[0], countries };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countriesOf(history: Shipment[]): string[] {
  return [...new Set([...history.map((s) => s.country), ...Object.keys(REGION_OF)])].sort((a, b) => a.localeCompare(b, 'he'));
}
