// Every place in seed-places.json must lie inside its region. Places that
// don't (a same-named street elsewhere, e.g. "אבן יהודה" in Jerusalem) are
// looked up again in OpenStreetMap, this time only inside their region.
// Run: node scripts/validate-seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../supabase/seed-places.json', import.meta.url);
const places = JSON.parse(readFileSync(FILE, 'utf8'));
const UA = 'TrimacoRoute/1.0 (internal logistics tool; nave@trimaco.co.il)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// rough boxes: [south, north, west, east]
const BOX = {
  tlv: [31.98, 32.16, 34.73, 34.9],
  center: [31.72, 32.13, 34.68, 35.1],
  sharon: [32.1, 32.56, 34.78, 35.13],
  north: [32.45, 33.35, 34.9, 35.9],
  jerusalem: [31.65, 31.92, 34.95, 35.35],
  south: [29.4, 31.86, 34.2, 35.5],
};
const inside = (p, [s, n, w, e]) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e;

const report = [];
for (const p of places) {
  const box = BOX[p.region];
  if (!box || p.lat == null || inside(p, box)) continue;
  const [s, n, w, e] = box;
  let fixed = false;
  for (const q of [p.name, p.city ? `${p.name} ${p.city}` : null].filter(Boolean)) {
    await sleep(1100);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${w},${n},${e},${s}&accept-language=he&q=${encodeURIComponent(q)}`;
    const [hit] = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
    if (hit) {
      const was = `${p.lat},${p.lng}`;
      p.lat = Number(Number(hit.lat).toFixed(5));
      p.lng = Number(Number(hit.lon).toFixed(5));
      report.push(`fixed ${p.name}: ${was} → ${p.lat},${p.lng} (${hit.display_name.slice(0, 60)})`);
      fixed = true;
      break;
    }
  }
  if (!fixed) report.push(`STILL OUTSIDE ${p.region}: ${p.name} ${p.lat},${p.lng}`);
}
// A hospital lies within a few km of its own city ("קפלן" is not Kaplan Street in Tel Aviv).
const km = (a, b) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const byName = new Map(places.map((p) => [p.name, p]));
for (const p of places.filter((x) => x.kind !== 'city' && x.city && x.lat != null)) {
  const city = byName.get(p.city);
  if (!city || city.lat == null || km(p, city) <= 8) continue;
  const d = 0.09; // about 10 km around the city
  const box = `${city.lng - d},${city.lat + d},${city.lng + d},${city.lat - d}`;
  let fixed = false;
  for (const q of [`בית חולים ${p.name}`, p.name, `${p.name} hospital`]) {
    await sleep(1100);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${box}&accept-language=he&q=${encodeURIComponent(q)}`;
    const [hit] = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
    if (hit) {
      const was = `${p.lat},${p.lng} (${km(p, city).toFixed(0)} km from ${p.city})`;
      p.lat = Number(Number(hit.lat).toFixed(5));
      p.lng = Number(Number(hit.lon).toFixed(5));
      report.push(`fixed ${p.name}: ${was} → ${p.lat},${p.lng} (${hit.display_name.slice(0, 60)})`);
      fixed = true;
      break;
    }
  }
  if (!fixed) {
    report.push(`${p.name}: not found near ${p.city}, using the city's coordinates`);
    p.lat = city.lat;
    p.lng = city.lng;
  }
}

writeFileSync(FILE, '[\n' + places.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n');
console.log(report.join('\n') || 'every place is inside its region and near its city');
