// MarathonIndia weekly fetcher.
// Connectors (permission-checked):
//  1. punerunners.com/races  - robots.txt allows all but /admin and /api.
//  2. aims-worldrunning.org/directory.html - robots.txt allows (its /events
//     and /members paths are disallowed and are NOT fetched).
// Rules: manual fields (fees, gstNote, requirements, certTag) are never
// overwritten. Unknown stays unknown. Conflicts are flagged in notes.
import { readFileSync, writeFileSync } from 'node:fs';

const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const UA = 'MarathonIndiaFetcher/1.0 (+https://marathonindia.vercel.app)';

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// --- Connector 1: punerunners.com/races ---
async function fetchPuneRunners() {
  const html = await getText('https://punerunners.com/races/');
  const races = [];
  const blocks = html.split(/<div data-race="/).slice(1);
  for (const b of blocks) {
    const id = b.slice(0, b.indexOf('"'));
    const link = b.match(/<a href="([^"]+)" class="stretched"[^>]*>([\s\S]*?)<span/);
    const meta = b.match(/race-card__meta"[^>]*>([\s\S]*?)<\/p>/);
    const note = b.match(/race-card__note"[^>]*>([\s\S]*?)<\/p>/);
    if (!link || !meta) continue;
    const metaTxt = strip(meta[1]);
    let m = null;
    const comma = metaTxt.indexOf(',');
    if (comma > -1) {
      const city = metaTxt.slice(0, comma).trim();
      const rest = metaTxt.slice(comma + 1).trim();
      const KNOWN = ['Tamil Nadu','West Bengal','Andhra Pradesh','Madhya Pradesh','Uttar Pradesh','Himachal Pradesh','Arunachal Pradesh','Jammu and Kashmir','Dadra and Nagar Haveli and Daman and Diu','Andaman and Nicobar Islands','Maharashtra','Karnataka','Telangana','Rajasthan','Uttarakhand','Chhattisgarh','Meghalaya','Gujarat','Odisha','Punjab','Haryana','Kerala','Bihar','Assam','Sikkim','Manipur','Mizoram','Nagaland','Tripura','Jharkhand','Delhi','Goa','Ladakh','Puducherry','Chandigarh','Lakshadweep'].sort((a,b)=>b.length-a.length);
      const st = KNOWN.find(k => rest.startsWith(k));
      if (st) m = [null, city, st, rest.slice(st.length).trim()];
      else m = metaTxt.match(/^(.*?),\s*([A-Za-z]+)\s+(.+)$/);
    }
    const scope = (b.match(/data-scope="([^"]+)"/) || [])[1] || '';
    const month = (b.match(/data-month="([^"]+)"/) || [])[1] || '';
    const tags = [...b.matchAll(/<span class="tag(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/g)]
      .map(t => strip(t[1])).filter(t => t && !/past race/i.test(t));
    races.push({
      id, name: strip(link[2]), url: link[1],
      city: m ? m[1].trim() : '', state: m ? m[2].trim() : '',
      dateText: m ? m[3].trim() : '', month, scope,
      distances: tags.filter(t => /^(1K|3K|5K|10K|10 mile|10K|Half|Full|Ultra|Trail|\d+K)$/i.test(t)),
      note: note ? strip(note[1]) : '',
    });
  }
  return races;
}

// --- Connector 2: AIMS member directory (India) ---
async function fetchAims() {
  const html = await getText('https://aims-worldrunning.org/directory.html');
  const races = [];
  // The India section runs from the IND country anchor to the next country anchor.
  const start = html.indexOf('name="IND"');
  const rest = html.slice(start);
  const endM = rest.slice(20).match(/name="[A-Z]{3}"/);
  const india = endM ? rest.slice(0, 20 + endM.index) : rest;
  const blocks = india.split('<div class="rcde row">').slice(1);
  for (const b of blocks) {
    const nameM = b.match(/<h3 class="notranslate"><a href="([^"]+)">([^<]+)<\/a>/);
    if (!nameM) continue;
    const details = b.match(/<div class="racedetails notranslate"[\s\S]*?<p class="phone">/);
    const htmlLines = details ? details[0].split(/<br\s*\/?>/) : [];
    const lines = htmlLines.map(strip).filter(l => l && !/<\/?(div|h3)/.test(l));
    const stateLine = lines.find(l => /, India$/.test(l)) || '';
    const orgState = stateLine.replace(/, India$/, '').trim();
    // The directory address is the ORGANISER's office, often not the race city
    // (e.g. Procam's Mumbai office for the Bengaluru 10K). Derive location from
    // the race name first; organiser state is only a flagged fallback.
    const CITY_STATE = { ahmedabad: 'Gujarat', amdavad: 'Gujarat', vadodara: 'Gujarat', bengaluru: 'Karnataka', bangalore: 'Karnataka', mumbai: 'Maharashtra', pune: 'Maharashtra', satara: 'Maharashtra', delhi: 'Delhi', kolkata: 'West Bengal', durgapur: 'West Bengal', tigerhill: 'West Bengal', chennai: 'Tamil Nadu', hyderabad: 'Telangana', vizag: 'Andhra Pradesh', dehradun: 'Uttarakhand', bhopal: 'Madhya Pradesh', indore: 'Madhya Pradesh', jaipur: 'Rajasthan', abu: 'Rajasthan', kashmir: 'Jammu and Kashmir', ladakh: 'Ladakh', spiti: 'Himachal Pradesh', tawang: 'Arunachal Pradesh', sohra: 'Meghalaya', bodhgaya: 'Bihar', trivandrum: 'Kerala' };
    const nameL = strip(nameM[2]).toLowerCase();
    let city = '', state = '', locNote = '';
    for (const [c, st] of Object.entries(CITY_STATE)) {
      if (nameL.includes(c)) { city = c.replace(/\b\w/g, x => x.toUpperCase()); state = st; break; }
    }
    if (!state && orgState) { state = orgState; locNote = ' State from the organiser address; race venue to confirm.'; }
    const next = (b.match(/Next confirmed event:\s*<\/em>|Next confirmed event:([\s\S]*?)<i class/) || [])[1] || '';
    const nextTxt = strip(next);
    const site = (b.match(/<p class="web"><a href="([^"]+)"/) || [])[1] || '';
    races.push({ raw: strip(nameM[2]), racePage: nameM[1], city, state, locNote, next: nextTxt, site });
  }
  return races;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const races = JSON.parse(readFileSync('races.json', 'utf8'));
const byId = new Map(races.map(r => [r.id, r]));
let added = 0, updated = 0, errors = [];

try {
  const prc = await fetchPuneRunners();
  for (const p of prc) {
    const cur = byId.get(p.id);
    if (!cur) {
      races.push({ ...p, certification: '', lastChecked: `Checked ${TODAY} against punerunners.com/races`, source: 'punerunners.com/races' });
      byId.set(p.id, races[races.length - 1]); added++;
    } else {
      let changed = false;
      for (const k of ['dateText', 'month', 'url', 'scope', 'city', 'state']) {
        if (p[k] && cur[k] !== p[k]) { cur[k] = p[k]; changed = true; }
      }
      if (p.distances.length && JSON.stringify(cur.distances) !== JSON.stringify(p.distances)) {
        if ((cur.distances || []).length && JSON.stringify(cur.distances) !== JSON.stringify(p.distances)) {
          cur.note = (cur.note || '') + ` Distance list differs between manual entry and punerunners - verify.` ;
        }
        cur.distances = p.distances; changed = true;
      }
      if (!/Fees and requirements checked/.test(cur.lastChecked || '')) cur.lastChecked = `Checked ${TODAY} against punerunners.com/races`;
      if (changed) updated++;
    }
  }
  console.log(`punerunners: ${prc.length} cards, ${added} added, ${updated} updated`);
} catch (e) { errors.push('punerunners: ' + e.message); }

try {
  const aims = await fetchAims();
  const ZONE = { North: ['Jammu and Kashmir','Ladakh','Himachal Pradesh','Punjab','Haryana','Delhi','Uttarakhand','Uttar Pradesh','Rajasthan','Chandigarh'],
    South: ['Tamil Nadu','Kerala','Karnataka','Andhra Pradesh','Telangana','Puducherry','Lakshadweep'],
    East: ['West Bengal','Odisha','Bihar','Jharkhand','Assam','Meghalaya','Manipur','Mizoram','Nagaland','Tripura','Arunachal Pradesh','Sikkim','Andaman and Nicobar Islands'],
    West: ['Maharashtra','Goa','Gujarat','Madhya Pradesh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu'] };
  const S2Z = {}; for (const [z, ss] of Object.entries(ZONE)) ss.forEach(x => S2Z[x] = z);
  let matched = 0, aimsAdded = 0;
  for (const a of aims) {
    const key = norm(a.raw);
    const cur = races.find(r => norm(r.name).includes(key.slice(0, 18)) || key.includes(norm(r.name).slice(0, 18)));
    if (cur) {
      matched++;
      if (!/AIMS member/i.test(cur.certification || '')) {
        cur.certification = ((cur.certification || '') + (cur.certification ? ' \u00b7 ' : '') + 'AIMS member').trim();
      }
    } else {
      races.push({
        id: slug(a.raw), name: a.raw, city: a.city, state: a.state, zone: S2Z[a.state] || '',
        dateText: a.next ? `Next confirmed: ${a.next}` : 'Date to be confirmed',
        month: '', scope: 'india', distances: [], url: a.site || a.racePage, certification: 'AIMS member',
        note: ('AIMS member directory listing; distances, fees and requirements not yet checked.' + (a.locNote || '')).trim(),
        lastChecked: `Checked ${TODAY} against the AIMS member directory`,
        source: 'aims-worldrunning.org/directory.html',
      });
      aimsAdded++;
    }
  }
  console.log(`aims: ${aims.length} listings, ${matched} matched, ${aimsAdded} added`);
} catch (e) { errors.push('aims: ' + e.message); }

if (errors.length) { console.error('CONNECTOR ERRORS:', errors); }
writeFileSync('races.json', JSON.stringify(races, null, 1) + '\n');
console.log('total races:', races.length);
