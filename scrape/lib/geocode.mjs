// Nominatim geocoding for cinema addresses. Results are cached in cinemas.json (lat/lng per cinema).
// Run directly to geocode only: `node lib/geocode.mjs`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'milan-cinema-planner/1.0 (private)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;

async function nominatim(q) {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'it' } });
  if (!r.ok) throw new Error(`nominatim HTTP ${r.status}`);
  const j = await r.json();
  return j[0] ? { lat: +j[0].lat, lng: +j[0].lon, display: j[0].display_name } : null;
}

export const inMilan = (lat, lng) => lat >= 45.43 && lat <= 45.54 && lng >= 9.10 && lng <= 9.26;

// Fills lat/lng for every cinema that lacks a valid in-Milan coordinate. Saves cinemas.json after each change.
// Returns the list of cinema ids that could not be placed.
export async function ensureGeocoded(cinemas, file) {
  const failed = [];
  for (const c of cinemas) {
    if (typeof c.lat === 'number' && typeof c.lng === 'number' && inMilan(c.lat, c.lng)) continue;
    const queries = [
      `${c.address}, Italia`,
      `${c.address.replace(/\/\S*/, '')}, Milano, Italia`,
      `${c.name}, Milano, Italia`,
    ];
    let found = null;
    for (const q of queries) {
      try {
        const res = await nominatim(q);
        if (res && inMilan(res.lat, res.lng)) { found = res; console.log(`[geocode] ${c.id}: "${q}" -> ${res.lat},${res.lng}`); break; }
        console.warn(`[geocode] ${c.id}: "${q}" -> ${res ? 'outside Milan ' + res.lat + ',' + res.lng : 'no result'}`);
      } catch (e) { console.warn(`[geocode] ${c.id}: "${q}" failed: ${e.message}`); }
    }
    if (found) { c.lat = found.lat; c.lng = found.lng; }
    else { c.lat = null; c.lng = null; failed.push(c.id); }
    fs.writeFileSync(file, JSON.stringify(cinemas, null, 2) + '\n');
  }
  return failed;
}

// CLI: geocode cinemas.json in place
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cinemas.json');
  const cinemas = JSON.parse(fs.readFileSync(file, 'utf8'));
  const failed = await ensureGeocoded(cinemas, file);
  console.log(failed.length ? `Not placed: ${failed.join(', ')}` : 'All cinemas geocoded inside Milan.');
}
