// Adds lat/lng to supabase/seed-places.json from OpenStreetMap (Nominatim).
// Run: node scripts/geocode-seed.mjs   (about 1 request a second, as Nominatim asks)
// Only places without coordinates are looked up; hospitals are checked to be
// near their city, otherwise the city's coordinates are used.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../supabase/seed-places.json', import.meta.url);
const places = JSON.parse(readFileSync(FILE, 'utf8'));
const UA = 'TrimacoRoute/1.0 (internal logistics tool; nave@trimaco.co.il)';

// English names OpenStreetMap knows for hospitals whose Hebrew short name is ambiguous
const HOSPITAL_QUERIES = {
  'איכילוב': ['Tel Aviv Sourasky Medical Center'],
  'שיבא': ['Sheba Medical Center'],
  'וולפסון': ['Wolfson Medical Center'],
  'מעייני הישועה': ['Mayanei HaYeshua Medical Center'],
  'אסותא רמת החייל': ['Assuta Medical Center Tel Aviv', 'אסותא רמת החייל'],
  'רפאל': ['Raphael Hospital Tel Aviv', 'בית חולים רפאל'],
  'בילינסון': ['Beilinson Hospital', 'Rabin Medical Center'],
  'השרון': ['HaSharon Hospital'],
  'שניידר': ['Schneider Children\'s Medical Center'],
  'אסותא ראשון לציון': ['Assuta Rishon LeZion'],
  'שמיר (אסף הרופא)': ['Shamir Medical Center', 'Assaf Harofeh'],
  'קפלן': ['Kaplan Medical Center'],
  'הרצליה מדיקל סנטר': ['Herzliya Medical Center'],
  'מאיר': ['Meir Medical Center'],
  'לניאדו': ['Laniado Hospital'],
  'הלל יפה': ['Hillel Yaffe Medical Center'],
  'הדסה עין כרם': ['Hadassah Ein Kerem'],
  'הדסה הר הצופים': ['Hadassah Mount Scopus'],
  'שערי צדק': ['Shaare Zedek Medical Center'],
  'אסותא אשדוד': ['Samson Assuta Ashdod'],
  'אסותא באר שבע': ['Assuta Beer Sheva'],
  'סורוקה': ['Soroka Medical Center'],
  'ברזילי': ['Barzilai Medical Center'],
  'יוספטל': ['Yoseftal Hospital'],
  'רמב"ם': ['Rambam Health Care Campus'],
  'כרמל': ['Carmel Medical Center'],
  'בני ציון': ['Bnai Zion Medical Center'],
  'אסותא חיפה': ['Assuta Haifa'],
  'אלישע': ['Elisha Hospital Haifa'],
  'הגליל': ['Galilee Medical Center'],
  'פוריה': ['Poriya Medical Center', 'Baruch Padeh Medical Center'],
  'העמק': ['HaEmek Medical Center'],
  'זיו': ['Ziv Medical Center'],
  'סנט ג\'וזף': ['St. Joseph Hospital Jerusalem'],
  'הצרפתי נצרת': ['French Hospital Nazareth', 'Holy Family Hospital Nazareth'],
  'האנגלי נצרת': ['EMMS Nazareth Hospital', 'English Hospital Nazareth'],
  'לוינשטיין': ['Loewenstein Rehabilitation Center'],
  'אוניברסיטת תל אביב': ['Tel Aviv University'],
  'הקריה האקדמית אונו': ['Ono Academic College'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function search(q) {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${q}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(Number(hit.lat).toFixed(5)), lng: Number(Number(hit.lon).toFixed(5)) } : null;
}

function inIsrael(p) {
  return p && p.lat > 29.4 && p.lat < 33.4 && p.lng > 34.2 && p.lng < 35.95;
}

function km(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const byName = new Map(places.map((p) => [p.name, p]));
const log = [];

// cities first, so hospitals can be checked against them
for (const p of places.filter((x) => x.kind === 'city' && x.lat == null)) {
  const hit = await search(`${p.name}, ישראל`);
  if (inIsrael(hit)) Object.assign(p, hit);
  else log.push(`city not found: ${p.name}`);
}

for (const p of places.filter((x) => x.kind !== 'city' && x.lat == null)) {
  const city = p.city ? byName.get(p.city) : null;
  const queries = p.kind === 'depot' ? [p.address] : [...(HOSPITAL_QUERIES[p.name] ?? []), `${p.name}, ${p.city ?? ''}`];
  let found = null;
  for (const q of queries) {
    const hit = await search(q);
    if (!inIsrael(hit)) continue;
    if (city?.lat != null && km(hit, city) > 25) {
      log.push(`far from city, ignored: ${p.name} ← "${q}" (${km(hit, city).toFixed(0)} km)`);
      continue;
    }
    found = hit;
    break;
  }
  if (found) Object.assign(p, found);
  else if (city?.lat != null) {
    p.lat = city.lat;
    p.lng = city.lng;
    log.push(`used city coordinates: ${p.name} → ${city.name}`);
  } else log.push(`NOT FOUND: ${p.name}`);
}

// one place per line, like the hand-written file
const line = (p) => '  ' + JSON.stringify(p);
writeFileSync(FILE, '[\n' + places.map(line).join(',\n') + '\n]\n');
console.log(log.join('\n') || 'all found');
console.log(`with coordinates: ${places.filter((p) => p.lat != null).length}/${places.length}`);
