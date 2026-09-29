// Re-checks city coordinates in seed-places.json against OpenStreetMap
// settlements only (a street called "אבן יהודה" in Jerusalem is not the town),
// and fixes any city that moved more than 3 km.
// Run: node scripts/check-cities.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../supabase/seed-places.json', import.meta.url);
const places = JSON.parse(readFileSync(FILE, 'utf8'));
const UA = 'TrimacoRoute/1.0 (internal logistics tool; nave@trimaco.co.il)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function km(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const fixes = [];
for (const p of places.filter((x) => x.kind === 'city')) {
  await sleep(1100);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&featuretype=settlement&accept-language=he&q=${encodeURIComponent(p.name)}`;
  const [hit] = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
  if (!hit) {
    fixes.push(`no settlement found: ${p.name} (kept)`);
    continue;
  }
  const found = { lat: Number(Number(hit.lat).toFixed(5)), lng: Number(Number(hit.lon).toFixed(5)) };
  const moved = p.lat == null ? Infinity : km(p, found);
  if (moved > 3) {
    fixes.push(`${p.name}: moved ${moved === Infinity ? '–' : moved.toFixed(0)} km → ${hit.display_name.slice(0, 70)}`);
    Object.assign(p, found);
  }
}
writeFileSync(FILE, '[\n' + places.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n');
console.log(fixes.join('\n') || 'all cities confirmed');
