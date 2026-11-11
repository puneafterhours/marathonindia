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
    const m = metaTxt.match(/^(.*?),\s*([A-Za-z ]+?)\s+(.+)$/);
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
  const text = strip(html);
  const races = [];
  // Race blocks carry "Next confirmed event: <date>" or "Last event: <date>".
  const re = /([A-Z][A-Za-z0-9 .&'()\/-]{4,80?}?)\s+(?:[A-Z][a-z]+ [A-Z][a-z]+ )?(?:(?:Last event: [A-Za-z0-9 ,]+?)\s+)?Next confirmed event: ([A-Za-z0-9 ,]+)/g;
  let m;
  while ((m = re.exec(text))) races.push({ raw: m[1].trim(), next: m[2].trim() });
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
      cur.lastChecked = `Checked ${TODAY} against punerunners.com/races`;
      if (changed) updated++;
    }
  }
  console.log(`punerunners: ${prc.length} cards, ${added} added, ${updated} updated`);
} catch (e) { errors.push('punerunners: ' + e.message); }

try {
  const aims = await fetchAims();
  let matched = 0, aimsAdded = 0;
  for (const a of aims) {
    const key = norm(a.raw);
    const cur = races.find(r => norm(r.name).includes(key.slice(0, 18)) || key.includes(norm(r.name).slice(0, 18)));
    if (cur) {
      matched++;
      if (!/AIMS member/i.test(cur.certification || '')) {
        cur.certification = ((cur.certification || '') + (cur.certification ? ' · ' : '') + 'AIMS member').trim();
      }
    } else {
      races.push({
        id: slug(a.raw), name: a.raw, city: '', state: '', dateText: `Next confirmed: ${a.next}`,
        month: '', scope: 'india', distances: [], url: '', certification: 'AIMS member',
        note: 'AIMS member directory listing; city, distances, fees and requirements not yet checked.',
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
