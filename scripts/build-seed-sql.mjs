// Builds supabase/seed_places.sql from supabase/seed-places.json.
// Run: node scripts/build-seed-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const places = JSON.parse(readFileSync(new URL('../supabase/seed-places.json', import.meta.url), 'utf8'));
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const num = (n) => (n == null ? 'null' : String(n));
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`;

const rows = places.map(
  (p) =>
    `  (${q(p.name)}, ${arr(p.aliases ?? [])}, ${q(p.region)}, ${q(p.kind)}, ${q(p.city ?? null)}, ${q(p.address ?? null)}, ${num(p.lat)}, ${num(p.lng)})`,
);

const sql = `-- Generated from seed-places.json by scripts/build-seed-sql.mjs; edit the JSON, not this file.
-- Starting catalog: Trimaco's warehouse, major hospitals and cities, with map
-- coordinates from OpenStreetMap. Safe to run again.
insert into public.places (name, aliases, region, kind, city, address, lat, lng) values
${rows.join(',\n')}
on conflict (name) do nothing;
`;

writeFileSync(new URL('../supabase/seed_places.sql', import.meta.url), sql);
console.log(`wrote ${places.length} places`);
