// Demo data for local development (never part of the production build).
// The real team and sample messages stay out of git: create
// src/dev/team.local.ts exporting `workers` (and optionally `samples`,
// an array of schedule messages) to try the screens with them.

import seedPlaces from '../../supabase/seed-places.json';
import { createMemoryStore } from '../lib/memoryStore';
import type { Store } from '../lib/store';
import type { Shipment } from '../imports/model';
import type { Place, Worker } from '../lib/types';

interface LocalTeam {
  workers: Worker[];
  samples?: string[];
}

const local = Object.values(import.meta.glob<LocalTeam>('./team.local.ts', { eager: true }))[0];
// The real 2026 shipments, when a local copy exists (git-ignored); otherwise a few made-up ones.
const localImports = Object.values(
  import.meta.glob<{ default: Shipment[] }>('./imports.local.json', { eager: true }),
)[0]?.default;

const demoShipment = (carrier: string, country: string, supplier: string, kg: number, freight: number, fees: number): Shipment => ({
  carrier,
  month: '2026-06',
  supplier,
  country,
  mode: 'air',
  incoterms: 'EXW',
  weight_kg: kg,
  cbm: null,
  chargeable_kg: kg,
  goods_value: kg * 900,
  freight,
  inland: 0,
  fees,
  freight_billed: true,
  in_comparison: true,
  excluded: false,
  notes: null,
});
const fallbackImports: Shipment[] = [
  demoShipment('KRIEF', 'איטליה', 'ACME MEDICAL', 25, 1500, 480),
  demoShipment('KRIEF', 'איטליה', 'ACME MEDICAL', 35, 1650, 500),
  demoShipment('מעיין', 'איטליה', 'BRAVO SURGICAL', 30, 1900, 650),
  demoShipment('מעיין', 'הולנד', 'DELTA ORTHO', 120, 1700, 700),
  demoShipment('KRIEF', 'ארה״ב', 'ECHO DEVICES', 150, 3200, 900),
];

const fallbackWorkers: Worker[] = ['דני', 'רוני', 'מאיה', 'שחר'].map((name, i) => ({
  id: `w${i + 1}`,
  name,
  aliases: [],
  can_drive: true,
  can_lift: i !== 2,
  can_assemble: i === 2,
  is_technical: i === 3,
  work_days: [0, 1, 2, 3, 4],
  active: true,
  sort_order: i,
}));

const fallbackSample = `שלום לכולם,
סידור צוות לוגיסטיקה למחר:

*דני*
• אסותא באר שבע - לאסוף רשתות
• סוריה - לספק הזמנות

*רוני*
• איכילוב - לספק רשתות + הזמנות
• הרצליה מדיקל - לאסוף רשתות

*מאיה*
מחסן
• הכנת הזמנות

*שחר* - שירות טכני
• כפר סבא - טיפול בקריאת שירות

*סידור רכב*
• שחר מהבוקר עד הצהריים

קחו בחשבון לשינויים`;

type SeedPlace = Pick<Place, 'name' | 'aliases' | 'region' | 'kind'> & {
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

export function createDemoStore(): Store {
  return createMemoryStore({
    startSignedOut: new URLSearchParams(window.location.search).get('demo') === 'new',
    workers: local?.workers ?? fallbackWorkers,
    places: (seedPlaces as unknown as SeedPlace[]).map((p) => ({
      name: p.name,
      aliases: p.aliases,
      region: p.region,
      kind: p.kind,
      city: p.city ?? null,
      address: p.address ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      notes: null,
    })),
    imports: localImports ?? fallbackImports,
  });
}

export function demoSamples(): string[] {
  return local?.samples?.length ? local.samples : [fallbackSample];
}
