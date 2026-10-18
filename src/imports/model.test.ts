import { describe, expect, it } from 'vitest';
import { bandOf, chargeableKg, recommend, suppliersOf, type Shipment } from './model';

// Made-up shipments; the real ones stay out of the public repo.
const ship = (carrier: string, country: string, kg: number, freight: number, handling: number, extra: Partial<Shipment> = {}): Shipment => ({
  carrier,
  month: '2026-05',
  supplier: 'ACME',
  country,
  mode: 'air',
  incoterms: 'EXW',
  weight_kg: kg,
  cbm: null,
  chargeable_kg: kg,
  goods_value: 20000,
  freight,
  inland: 0,
  fees: handling,
  freight_billed: true,
  in_comparison: true,
  excluded: false,
  notes: null,
  ...extra,
});

const history = [
  ship('A', 'איטליה', 20, 1500, 500),
  ship('A', 'איטליה', 30, 1600, 450),
  ship('A', 'איטליה', 40, 1700, 500),
  ship('B', 'איטליה', 25, 2000, 600),
  ship('B', 'איטליה', 35, 2100, 600),
  ship('B', 'גרמניה', 200, 4000, 800),
  ship('A', 'ארה״ב', 150, 3000, 900),
  ship('B', 'סין', 20, 0, 400, { in_comparison: false, freight_billed: false, incoterms: 'CPT' }),
  ship('B', 'סין', 30, 0, 420, { in_comparison: false, freight_billed: false, incoterms: 'CPT' }),
  ship('A', 'איטליה', 30, 9000, 500, { excluded: true }),
];

describe('recommend', () => {
  it('picks the carrier with the lowest median on the same lane', () => {
    const r = recommend({ country: 'איטליה', weightKg: 30, incoterms: 'EXW' }, history);
    expect(r).toMatchObject({ kind: 'history', band: '10–50', confidence: 'medium' });
    expect(r.best).toMatchObject({ carrier: 'A', cost: 2050, basis: 'lane' });
    expect(r.alternative).toMatchObject({ carrier: 'B', cost: 2650 });
  });

  it('sends up to 10 kg to DHL express', () => {
    const r = recommend({ country: 'איטליה', weightKg: 8 }, history);
    expect(r.kind).toBe('express');
    expect(r.best).toMatchObject({ carrier: 'DHL', cost: 306 + 65 * 8 });
  });

  it('charges by volume when the box is big for its weight', () => {
    expect(chargeableKg(20, 0.4)).toBeCloseTo(66.8);
    const r = recommend({ country: 'איטליה', weightKg: 9, cbm: 0.2 }, history);
    expect(r).toMatchObject({ volumetric: true, kind: 'history', band: '10–50' });
    expect(r.warnings[0]).toContain('לפי נפח');
  });

  it('prices heavy shipments by the kg, and falls back to the region with a warning', () => {
    const r = recommend({ country: 'צרפת', weightKg: 100.5, incoterms: 'FCA' }, history);
    expect(bandOf(100.5)).toBe('מעל 100');
    expect(r.best).toMatchObject({ carrier: 'B', basis: 'region' });
    expect(r.best!.cost).toBeCloseTo((4800 / 200) * 100.5);
    expect(r.confidence).toBe('very_low');
    expect(r.warnings.join(' ')).toContain('מאזור קרוב');
  });

  it('never guesses freight from another part of the world', () => {
    const r = recommend({ country: 'יפן', weightKg: 30, incoterms: 'EXW' }, history);
    expect(r).toMatchObject({ kind: 'no_data', best: null });
  });

  it('compares only release and delivery when the supplier pays the freight', () => {
    const r = recommend({ country: 'סין', weightKg: 25, incoterms: 'CPT' }, history);
    expect(r.kind).toBe('supplier_pays');
    // release and delivery from every country in the band: A 450–500, B 400–600
    expect(r.best).toMatchObject({ carrier: 'A', cost: 500, basis: 'band' });
    expect(r.alternative).toMatchObject({ carrier: 'B', cost: 510 });
  });
});

describe('suppliersOf', () => {
  it('remembers a supplier Adi entered, with its country', () => {
    const list = suppliersOf(history, [{ supplier: 'NEW MED', country: 'פולין' }, { supplier: null, country: 'סין' }]);
    expect(list.find((s) => s.name === 'NEW MED')).toMatchObject({ country: 'פולין', count: 1 });
    expect(list.find((s) => s.name === 'ACME')).toMatchObject({ country: 'איטליה' });
  });
});
