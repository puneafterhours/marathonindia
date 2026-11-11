// MarathonIndia weekly fetcher.
// Connectors (permission-checked):
//  1. punerunners.com/races  - robots.txt allows all but /admin and /api.
//  2. aims-worldrunning.org/directory.html - robots.txt allows (its /events
//     and /members paths are disallowed and are NOT fetched).
// Rules: manual fields (fees, gstNote, requirements, certTag) are never
// overwritten. Unknown stays unknown. Conflicts are flagged in notes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchFees } from './fees.mjs';

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


const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ZONE = { North: ['Jammu and Kashmir','Ladakh','Himachal Pradesh','Punjab','Haryana','Delhi','Uttarakhand','Uttar Pradesh','Rajasthan','Chandigarh'],
  South: ['Tamil Nadu','Kerala','Karnataka','Andhra Pradesh','Telangana','Puducherry','Lakshadweep'],
  East: ['West Bengal','Odisha','Bihar','Jharkhand','Assam','Meghalaya','Manipur','Mizoram','Nagaland','Tripura','Arunachal Pradesh','Sikkim','Andaman and Nicobar Islands'],
  West: ['Maharashtra','Goa','Gujarat','Madhya Pradesh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu'] };
const S2Z = {}; for (const [z, ss] of Object.entries(ZONE)) ss.forEach(x => S2Z[x] = z);
const STATE_ALIAS = { 'wb': 'West Bengal', 'west bengal': 'West Bengal', 'mh': 'Maharashtra', 'maharashtra': 'Maharashtra', 'ka': 'Karnataka', 'karnataka': 'Karnataka', 'tn': 'Tamil Nadu', 'tamil nadu': 'Tamil Nadu', 'dl': 'Delhi', 'delhi': 'Delhi', 'new delhi': 'Delhi', 'ncr': 'Delhi', 'gj': 'Gujarat', 'gujarat': 'Gujarat', 'rj': 'Rajasthan', 'rajasthan': 'Rajasthan', 'hp': 'Himachal Pradesh', 'himachal pradesh': 'Himachal Pradesh', 'himachal': 'Himachal Pradesh', 'uk': 'Uttarakhand', 'uttarakhand': 'Uttarakhand', 'up': 'Uttar Pradesh', 'uttar pradesh': 'Uttar Pradesh', 'mp': 'Madhya Pradesh', 'madhya pradesh': 'Madhya Pradesh', 'ts': 'Telangana', 'telangana': 'Telangana', 'ap': 'Andhra Pradesh', 'andhra pradesh': 'Andhra Pradesh', 'kl': 'Kerala', 'kerala': 'Kerala', 'ga': 'Goa', 'goa': 'Goa', 'pb': 'Punjab', 'punjab': 'Punjab', 'hr': 'Haryana', 'haryana': 'Haryana', 'jk': 'Jammu and Kashmir', 'jammu and kashmir': 'Jammu and Kashmir', 'ladakh': 'Ladakh', 'as': 'Assam', 'assam': 'Assam', 'odisha': 'Odisha', 'orissa': 'Odisha', 'bihar': 'Bihar', 'jharkhand': 'Jharkhand', 'chhattisgarh': 'Chhattisgarh', 'meghalaya': 'Meghalaya', 'manipur': 'Manipur', 'mizoram': 'Mizoram', 'nagaland': 'Nagaland', 'tripura': 'Tripura', 'sikkim': 'Sikkim', 'arunachal pradesh': 'Arunachal Pradesh', 'puducherry': 'Puducherry', 'pondicherry': 'Puducherry', 'chandigarh': 'Chandigarh' };
const STATE_NAMES = [...new Set(Object.values(STATE_ALIAS).concat(['Jammu and Kashmir']))];
function normState(s) {
  if (!s) return '';
  const t = s.replace(/[.,]+$/, '').trim();
  return STATE_ALIAS[t.toLowerCase()] || STATE_NAMES.find(n => n.toLowerCase() === t.toLowerCase()) || '';
}
const CITY_ALIAS = { 'bangalore': 'Bengaluru', 'bengaluru': 'Bengaluru', 'bombay': 'Mumbai', 'mumbai': 'Mumbai', 'madras': 'Chennai', 'chennai': 'Chennai', 'calcutta': 'Kolkata', 'kolkata': 'Kolkata', 'poona': 'Pune', 'pune': 'Pune', 'new delhi': 'New Delhi', 'delhi': 'New Delhi', 'leh': 'Leh', 'vizag': 'Visakhapatnam', 'visakhapatnam': 'Visakhapatnam', 'trivandrum': 'Thiruvananthapuram', 'thiruvananthapuram': 'Thiruvananthapuram', 'gurugram': 'Gurugram', 'gurgaon': 'Gurugram' };
function normCity(s) {
  if (!s) return '';
  const t = s.replace(/[.,]+$/, '').trim();
  return CITY_ALIAS[t.toLowerCase()] || t.replace(/\b\w/g, c => c.toUpperCase());
}
const NEAR_PUNE = ['Lonavala', 'Mahabaleshwar', 'Satara', 'Kolhapur', 'Ahmednagar', 'Nashik', 'Matheran', 'Alibaug', 'Bhimashankar'];
function scopeFor(city, distances) {
  const ultra = (distances || []).some(d => /ultra/i.test(d));
  if (city === 'Pune') return ultra ? 'pune ultra' : 'pune';
  if (NEAR_PUNE.includes(city)) return ultra ? 'near-pune ultra' : 'near-pune';
  return ultra ? 'india ultra' : 'india';
}
function monthKey(y, m) { return y && m ? `${y}-${String(m).padStart(2, '0')}` : ''; }
function dateTextFrom(y, m, d) { return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`; }
// Map assorted category labels to the standard distance tags.
function mapDistances(list) {
  const out = [];
  for (let raw of list || []) {
    const t = String(raw).trim();
    if (!t || /^(other|fun run|dream run|virtual|relay|walk|kids? run|elite)$/i.test(t)) continue;
    if (/^(marathon|full marathon|full)$/i.test(t)) out.push('Full');
    else if (/^(half marathon|half|hm)$/i.test(t)) out.push('Half');
    else if (/ultra/i.test(t)) out.push('Ultra');
    else { const m = t.match(/^(\d+(?:\.\d+)?)\s*(k|km|k\s*run)$/i); if (m) out.push(m[1] + 'K'); }
  }
  return [...new Set(out)];
}
const TODAY_UTC = new Date().toISOString().slice(0, 10);
function pastMark(dt) {
  if (!dt || !dt.d) return dt ? ' (date to be confirmed for the next edition)' : '';
  const key = `${dt.y}-${String(dt.m).padStart(2, '0')}-${String(dt.d).padStart(2, '0')}`;
  return key < TODAY_UTC ? ' (last edition)' : '';
}
function extractDate(text) {
  // "17 th January 2027", "13 September 2026", "02-03 Aug 2025"
  let m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?[ ,]*\s*(20\d{2})/i);
  if (m) {
    const mi = MONTHS_LONG.findIndex(x => x.toLowerCase().startsWith(m[3].toLowerCase().slice(0, 3)));
    return { y: +m[4], m: mi + 1, d: m[2], label: `${m[1]}-${m[2]} ${MONTHS[mi]} ${m[4]}` };
  }
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?[ ,]*\s*(20\d{2})/i);
  if (m) {
    const mi = MONTHS_LONG.findIndex(x => x.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
    return { y: +m[3], m: mi + 1, d: m[1], label: `${m[1]} ${MONTHS[mi]} ${m[3]}` };
  }
  m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*(20\d{2})/i);
  if (m) {
    const mi = MONTHS_LONG.findIndex(x => x.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
    return { y: +m[2], m: mi + 1, d: 0, label: `${MONTHS[mi]} ${m[2]}` };
  }
  return null;
}
function findState(text) {
  const hits = STATE_NAMES.filter(n => new RegExp('\\b' + n.replace(/ /g, '\\s+') + '\\b', 'i').test(text));
  hits.sort((a, b) => b.length - a.length);
  return hits[0] || '';
}

// --- Connector 3: indiarunning.com (event listings API used by its pages) ---
async function fetchIndiaRunning() {
  const races = [];
  let page = 1, pages = 1;
  do {
    const r = await fetch('https://registrations-api.indiarunning.com/ir/events/filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ pageNo: page, sortBy: 'event-date-closest', filters: {} }),
    });
    if (!r.ok) throw new Error('indiarunning api -> HTTP ' + r.status);
    const d = await r.json();
    pages = Math.min(d.pageCount || 1, 40);
    for (const e of d.events || []) {
      const loc = e.locationInfo || {};
      if ((loc.country || 'India') !== 'India') continue;
      if ((e.sportsType || []).length && !(e.sportsType || []).some(s => /run|marathon|athletics/i.test(s))) continue;
      const start = e.eventDate && e.eventDate.start ? new Date(e.eventDate.start) : null;
      const distances = mapDistances((e.categories || []).map(c => c.category));
      const city = normCity(loc.area || '');
      const state = normState(loc.state || '') || normState(loc.city || '');
      races.push({
        id: 'ir-' + (e.slug || e.id),
        name: String(e.title || '').replace(/\s+/g, ' ').trim(),
        city, state, zone: S2Z[state] || '',
        dateText: start ? dateTextFrom(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()) : 'Date to be confirmed',
        month: start ? monthKey(start.getUTCFullYear(), start.getUTCMonth() + 1) : '',
        scope: scopeFor(city, distances),
        distances,
        url: e.website || ('https://indiarunning.com/event/' + (e.slug || e.id)),
        certification: '',
        note: 'Listed on indiarunning.com' + (e.orgName ? ` (organiser: ${e.orgName})` : '') + (/^yes$/i.test(e.wrEvent || '') ? '. World Athletics label event per indiarunning.' : '.') ,
        lastChecked: `Checked ${TODAY} on indiarunning.com`,
        source: 'indiarunning.com',
      });
    }
    page++;
  } while (page <= pages);
  return races;
}

// --- Connector 4: Geeks on Feet race calendar (region=domestic) ---
async function fetchGeeksOnFeet() {
  const races = [];
  for (let page = 1; page <= 25; page++) {
    const html = await getText(`https://www.geeksonfeet.com/races?region=domestic&scope=upcoming&page=${page}`);
    const cards = html.match(/<article class="rcard"[\s\S]*?<\/article>/g) || [];
    if (!cards.length) break;
    for (const c of cards) {
      const link = (c.match(/class="rcard-link" href="([^"]+)"/) || [])[1] || '';
      const mo = (c.match(/rcard-date-mo">([A-Z]+)</) || [])[1] || '';
      const yr = (c.match(/rcard-date-yr">(\d{4})</) || [])[1] || '';
      const day = (c.match(/rcard-date-day">(\d{1,2})</) || [])[1] || '';
      const title = strip((c.match(/rcard-title">([\s\S]*?)<\/h3>/) || [])[1] || '');
      const loc = strip((c.match(/rcard-loc">([\s\S]*?)<\/div>/) || [])[1] || '');
      const dists = mapDistances([...c.matchAll(/rcard-dist[^"]*">([^<]+)</g)].map(m => m[1]));
      const aims = /rcard-aims/.test(c);
      const mi = MONTHS.findIndex(x => x.toUpperCase() === mo.toUpperCase());
      const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
      const state = normState(parts[parts.length - 1] || '');
      const city = normCity(parts.slice(0, -1).join(', ') || parts[0] || '');
      races.push({
        id: 'gof-' + ((link.match(/id=([A-Z0-9-]+)/) || [])[1] || slug(title)),
        name: title, city, state, zone: S2Z[state] || '',
        dateText: yr ? dateTextFrom(+yr, mi + 1, +day) : 'Date to be confirmed',
        month: yr ? monthKey(+yr, mi + 1) : '',
        scope: scopeFor(city, dists),
        distances: dists,
        url: link,
        certification: '',
        note: 'Listed on the Geeks on Feet race calendar' + (aims ? '; AIMS flag shown there.' : '.'),
        lastChecked: `Checked ${TODAY} on geeksonfeet.com/races`,
        source: 'geeksonfeet.com/races',
      });
    }
    if (!new RegExp(`page=${page + 1}[^\d]`).test(html)) break;
  }
  return races;
}

// --- Connector 5: The Hell Race (organiser race pages) ---
function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]+/g, w => (w === 'ghrf' || w === 'srut') ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));
}
async function fetchHellRace() {
  const links = new Map();
  for (const pageUrl of ['https://thehellrace.com/hell-race-calendar/', 'https://thehellrace.com/']) {
    const html = await getText(pageUrl);
    for (const m of html.matchAll(/href="(https:\/\/thehellrace\.com\/(?:the-hell-race\/)?[a-z0-9-]+\/?)"[^>]*>([^<]{3,90})</g)) {
      const url = m[1], label = strip(m[2]);
      if (/contact|privacy|terms|return|sitemap|press|partner|volunteer|results|\/races\/?$/.test(url)) continue;
      if (url.replace(/\/$/, '') === 'https://thehellrace.com') continue;
      if (/^(race detail|read more|register|view|result)/i.test(label) || label.length < 4) continue;
      if (!links.has(url.replace(/\/$/, ''))) links.set(url.replace(/\/$/, ''), { url, label });
    }
  }
  const races = [];
  for (const l of links.values()) {
    try {
      const page = strip(await getText(l.url));
      const dt = extractDate(page);
      const nameState = findState(l.label) || findState(l.url.replace(/-/g, ' '));
      const state = nameState || findState(page);
      races.push({
        id: 'hellrace-' + slug(l.label), name: titleCase(l.label),
        city: '', state, zone: S2Z[state] || '',
        dateText: dt ? dt.label + pastMark(dt) : 'Date to be confirmed',
        month: dt ? monthKey(dt.y, dt.m) : '',
        scope: scopeFor('', ['Ultra']), distances: ['Ultra'],
        url: l.url, certification: '',
        note: 'The Hell Race organiser listing; venue per the race page.',
        lastChecked: `Checked ${TODAY} on thehellrace.com`, source: 'thehellrace.com',
      });
    } catch (e) { /* page moved or blocked - skip this race link */ }
  }
  return races;
}

// --- Connector 6: Ladakh Marathon (organiser race pages) ---
async function fetchLadakhMarathon() {
  const defs = [
    { url: 'https://ladakhmarathon.com/races/marathon/', name: 'Ladakh Marathon', dist: 'Full' },
    { url: 'https://ladakhmarathon.com/races/half-marathon/', name: 'Ladakh Marathon', dist: 'Half' },
    { url: 'https://ladakhmarathon.com/races/11-2km-run/', name: 'Ladakh Marathon', dist: '11.2K' },
    { url: 'https://ladakhmarathon.com/races/run-ladakh-for-fun-05km/', name: 'Ladakh Marathon', dist: '5K' },
    { url: 'https://ladakhmarathon.com/races/khardung-la-challenge/', name: 'Khardung La Challenge', dist: 'Ultra' },
    { url: 'https://ladakhmarathon.com/races/silk-route-ultra/', name: 'Silk Route Ultra', dist: 'Ultra' },
  ];
  const byName = new Map();
  for (const d of defs) {
    try {
      const page = strip(await getText(d.url));
      const dt = extractDate(page);
      let r = byName.get(d.name);
      if (!r) {
        r = { id: 'ladakh-' + slug(d.name), name: d.name, city: 'Leh', state: 'Ladakh', zone: S2Z['Ladakh'],
          dateText: dt ? dt.label + pastMark(dt) : 'Date to be confirmed', month: dt ? monthKey(dt.y, dt.m) : '',
          scope: 'india ultra', distances: [], url: d.url, certification: '',
          note: 'Ladakh Marathon organiser site listing; distances per the race pages.',
          lastChecked: `Checked ${TODAY} on ladakhmarathon.com`, source: 'ladakhmarathon.com' };
        byName.set(d.name, r);
      }
      if (!r.distances.includes(d.dist)) r.distances.push(d.dist);
      if (dt && (!r.month || dt.label < r.dateText)) { /* keep first found date */ }
    } catch (e) { /* skip single page failures */ }
  }
  for (const r of byName.values()) {
    const order = ['5K', '11.2K', '10K', 'Half', 'Full', 'Ultra'];
    r.distances.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!r.distances.includes('Ultra') && (r.name === 'Ladakh Marathon')) r.scope = 'india';
  }
  return [...byName.values()];
}

// --- Connector 7: Pangong Frozen Lake Marathon (organiser site) ---
async function fetchPangong() {
  const defs = [
    { url: 'https://pangongfrozenlakemarathon.com/pangong-frozen-lake-marathon/', name: 'Pangong Frozen Lake Marathon', dists: ['Half', 'Full'] },
    { url: 'https://pangongfrozenlakemarathon.com/pangong-ice-ultra/', name: 'Pangong Ice Ultra', dists: ['Ultra'] },
  ];
  const races = [];
  for (const d of defs) {
    try {
      const page = strip(await getText(d.url));
      const dt = extractDate(page);
      races.push({
        id: 'pangong-' + slug(d.name), name: d.name, city: 'Pangong Tso', state: 'Ladakh', zone: S2Z['Ladakh'],
        dateText: dt ? dt.label + pastMark(dt) : 'Date to be confirmed', month: dt ? monthKey(dt.y, dt.m) : '',
        scope: scopeFor('Pangong Tso', d.dists), distances: d.dists, url: d.url, certification: '',
        note: 'Organiser site listing; distances per the race pages.',
        lastChecked: `Checked ${TODAY} on pangongfrozenlakemarathon.com`, source: 'pangongfrozenlakemarathon.com',
      });
    } catch (e) { /* skip single page failures */ }
  }
  return races;
}

// --- Connector 8: Procam International flagship events ---
async function fetchProcam() {
  const defs = [
    { url: 'https://tatamumbaimarathon.procam.in/', name: 'Tata Mumbai Marathon', city: 'Mumbai', state: 'Maharashtra', dists: ['10K', 'Half', 'Full'] },
    { url: 'https://tatasteelworld25k.procam.in/', name: 'Tata Steel World 25K Kolkata', city: 'Kolkata', state: 'West Bengal', dists: ['10K', '25K'] },
    { url: 'https://tcsworld10k.procam.in/', name: 'TCS World 10K Bengaluru', city: 'Bengaluru', state: 'Karnataka', dists: ['10K'] },
    { url: 'https://vedantadelhihalfmarathon.procam.in/', name: 'Vedanta Delhi Half Marathon', city: 'New Delhi', state: 'Delhi', dists: ['Half'] },
  ];
  const races = [];
  for (const d of defs) {
    try {
      const page = strip(await getText(d.url));
      const dt = extractDate(page);
      races.push({
        id: 'procam-' + slug(d.name), name: d.name, city: d.city, state: d.state, zone: S2Z[d.state],
        dateText: dt ? dt.label + pastMark(dt) : 'Date to be confirmed', month: dt ? monthKey(dt.y, dt.m) : '',
        scope: scopeFor(d.city, d.dists), distances: d.dists, url: d.url, certification: '',
        note: 'Procam International event site; date per the event homepage.',
        lastChecked: `Checked ${TODAY} on procam.in event site`, source: 'procam.in',
      });
    } catch (e) { /* skip single page failures */ }
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
      // Never restamp: the existing checked date reflects when the underlying
      // fields (esp. certification) were actually verified at the source.
      if (!cur.lastChecked) cur.lastChecked = `Calendar entry seen ${TODAY} on punerunners.com/races`;
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

// Merge races from the wider Indian calendars and organiser sites.
// Match on normalised name (year-stripped, containment) so the same event
// found on several calendars merges into one card; provenance is tracked in
// r.sources. Manual fields (fees, gstNote, requirements, certification) are
// never overwritten.
function mergeExternal(races, found, label) {
  let added = 0, matched = 0;
  const clean = (s) => norm(s).replace(/(19|20)\d{2}/g, '');
  for (const f of found) {
    if (!f.name || f.name.length < 4) continue;
    const key = clean(f.name);
    const cur = races.find(r => {
      const rk = clean(r.name || '');
      if (rk.length < 8 || key.length < 8) return false;
      // Same-name merges allow containment; different-state races must match
      // exactly (e.g. Ladakh's Silk Route Ultra != Himachal's SRUT).
      const stateClash = r.state && f.state && r.state !== f.state;
      return stateClash ? rk === key : (rk.includes(key) || key.includes(rk));
    });
    if (cur) {
      matched++;
      for (const k of ['city', 'state', 'zone', 'month']) { if (!cur[k] && f[k]) cur[k] = f[k]; }
      if (cur.city && cur.city === cur.state && f.city && f.city !== f.state) cur.city = f.city;
      if ((!cur.dateText || /to be confirmed/i.test(cur.dateText)) && f.dateText && !/to be confirmed/i.test(f.dateText)) cur.dateText = f.dateText;
      if (!cur.url && f.url) cur.url = f.url;
      if ((f.distances || []).length) {
        const both = [...new Set([...(cur.distances || []), ...f.distances])];
        if (both.length !== (cur.distances || []).length) cur.distances = both;
      }
      cur.sources = [...new Set([...(cur.sources || [cur.source]), f.source].filter(Boolean))];
    } else {
      f.sources = [f.source];
      races.push(f); added++;
    }
  }
  console.log(`${label}: ${found.length} listings, ${matched} merged, ${added} added`);
}

const CONNECTORS = [
  ['indiarunning', fetchIndiaRunning],
  ['geeksonfeet', fetchGeeksOnFeet],
  ['hellrace', fetchHellRace],
  ['ladakhmarathon', fetchLadakhMarathon],
  ['pangongfrozenlake', fetchPangong],
  ['procam', fetchProcam],
];
for (const [label, fn] of CONNECTORS) {
  try { mergeExternal(races, await fn(), label); }
  catch (e) { errors.push(label + ': ' + e.message); }
}

try { await fetchFees(races); } catch (e) { errors.push('fees: ' + e.message); }
if (errors.length) { console.error('CONNECTOR ERRORS:', errors); }
writeFileSync('races.json', JSON.stringify(races, null, 1) + '\n');
const runUrl = (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
writeFileSync('meta.json', JSON.stringify({
  fetchedAt: new Date().toISOString(),
  races: races.length,
  sources: ['punerunners.com/races', 'aims-worldrunning.org India directory', 'indiarunning.com listings', 'geeksonfeet.com race calendar', 'thehellrace.com calendar', 'ladakhmarathon.com', 'pangongfrozenlakemarathon.com', 'procam.in event sites', 'Eventforce / Fitistan registration pages (fees & categories)'],
  runUrl,
  connectorErrors: errors,
}, null, 1) + '\n');
console.log('total races:', races.length);
