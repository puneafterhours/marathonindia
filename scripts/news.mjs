/* MarathonIndia news connector.
   Fetches public RSS feeds (published for syndication) and publication
   listing pages for running / triathlon news.
   India section: Indian running and triathlon publications, kept FRESH -
   only items published within the last 7 days (publisher dates, never
   fetch time) appear. Older articles fall out automatically.
   Global section: World Athletics, Athletics Weekly, Runner's World,
   filtered to marathon / road-running items.
   Every item keeps its source name, link and publication date. */
import { writeFileSync } from 'node:fs';

const INDIA_MAX_AGE_DAYS = 7;

const INDIA_FEEDS = [
  { name: 'Sportstar (The Hindu)', url: 'https://sportstar.thehindu.com/athletics/feeder/default.rss', filterRoad: true },
  // General Indian sports desks, filtered down to running / triathlon items.
  { name: 'Times of India Sports', url: 'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms', filterRoad: true },
  { name: 'Indian Express Sports', url: 'https://indianexpress.com/section/sports/feed/', filterRoad: true },
  { name: 'Hindustan Times Sports', url: 'https://www.hindustantimes.com/feeds/rss/sports/rssfeed.xml', filterRoad: true },
  { name: 'Khel Now', url: 'https://khelnow.com/feed', filterRoad: true },
];
const INDIA_HTML_SOURCES = [
  // Geeks on Feet has no RSS; its /posts page is parsed instead.
  // Whole publication is running-focused, so no topic filter.
  { name: 'Geeks on Feet', url: 'https://www.geeksonfeet.com/posts', base: 'https://www.geeksonfeet.com', linkRe: /href="(\/posts\/[a-z0-9-]+\/)"/g, max: 8 },
  // The Bridge marathon desk (cross-tagged running stories included).
  { name: 'The Bridge', url: 'https://thebridge.in/marathon', base: 'https://thebridge.in', linkRe: /href="(\/(?:marathon|sports-market|others|national-games)\/[a-z0-9-]+-\d{5})"/g, max: 12, filterRoad: true },
];
const GLOBAL_FEEDS = [
  { name: 'World Athletics', url: 'https://worldathletics.org/news/rss' },
  { name: 'Athletics Weekly', url: 'https://athleticsweekly.com/feed/' },
  { name: "Runner's World", url: 'https://www.runnersworld.com/rss/all.xml/' },
];
// India feed is running + triathlon focused (user-confirmed scope): marathon,
// ultra, road/trail running, triathlon terms - not generic sports coverage.
const ROAD_RE = /marathon|ultra(running|marathon)?|road race|road running|trail running|triathl|duathl|ironman|half marathon|long[- ]distance|\b(5|10|21|25|42|50|100)\s?k\s(run|race|marathon)?/i;
const MAX_PER_FEED = 12;

const strip = (s) => (s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim();

function pick(item, tag) {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? strip(m[1]) : '';
}

async function readFeed(feed, { filterRoad }) {
  const res = await fetch(feed.url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const title = pick(body, 'title');
    const link = pick(body, 'link');
    const rawDate = pick(body, 'pubDate') || pick(body, 'dc:date') || pick(body, 'published');
    const d = new Date(rawDate);
    if (!title || !link || isNaN(d)) continue;
    if (filterRoad && !ROAD_RE.test(title + ' ' + pick(body, 'description'))) continue;
    items.push({ title, url: link, date: d.toISOString().slice(0, 10), source: feed.name });
    if (items.length >= MAX_PER_FEED) break;
  }
  return items;
}

// HTML source reader (Geeks on Feet /posts, The Bridge /marathon): takes
// latest article links and reads each article page for its title and date.
// Dates come from the publisher's own markup (datePublished / datetime /
// visible date), never from fetch time.
async function readHtmlSource(src) {
  const res = await fetch(src.url, { headers: { 'user-agent': 'MarathonIndiaFetcher/1.0 (+https://marathonindia.vercel.app)' } });
  if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
  const html = await res.text();
  const seen = new Set();
  const paths = [];
  for (const m of html.matchAll(src.linkRe)) {
    if (!seen.has(m[1])) { seen.add(m[1]); paths.push(m[1]); }
    if (paths.length >= src.max) break;
  }
  const items = [];
  for (const path of paths) {
    try {
      const pr = await fetch(src.base + path, { headers: { 'user-agent': 'MarathonIndiaFetcher/1.0 (+https://marathonindia.vercel.app)' } });
      if (!pr.ok) continue;
      const page = await pr.text();
      const title = strip((page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || (page.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
      const rawDate = (page.match(/datePublished"\s*:\s*"([^"]+)"/) || [])[1]
        || (page.match(/datetime="([^"]+)"/) || [])[1]
        || (page.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*,?\s*20\d{2})/i) || [])[1] || '';
      const d = new Date(rawDate);
      if (!title || isNaN(d)) continue;
      if (src.filterRoad && !ROAD_RE.test(title)) continue;
      items.push({ title, url: src.base + path, date: d.toISOString().slice(0, 10), source: src.name });
    } catch (e) { /* skip single article */ }
  }
  return items;
}

const errors = [];
const india = [], global = [];
for (const f of INDIA_FEEDS) {
  try { india.push(...await readFeed(f, { filterRoad: !!f.filterRoad })); }
  catch (e) { errors.push(e.message); }
}
for (const s of INDIA_HTML_SOURCES) {
  try { india.push(...await readHtmlSource(s)); }
  catch (e) { errors.push(e.message); }
}
for (const f of GLOBAL_FEEDS) {
  try { global.push(...await readFeed(f, { filterRoad: true })); }
  catch (e) { errors.push(e.message); }
}

// Freshness rule (user-set): India items only if published within the last
// INDIA_MAX_AGE_DAYS days. Missing dates never reach this list (dropped above).
const cutoff = new Date(Date.now() - INDIA_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
const indiaFresh = india.filter((i) => i.date >= cutoff);

const byDate = (a, b) => (a.date < b.date ? 1 : -1);
indiaFresh.sort(byDate); global.sort(byDate);

writeFileSync('news.json', JSON.stringify({
  fetchedAt: new Date().toISOString(),
  note: `India items are running and triathlon coverage from Indian media, published within the last ${INDIA_MAX_AGE_DAYS} days; global items are filtered to marathon and road-running news. Titles, links and dates are the publishers own.`,
  india: indiaFresh.slice(0, 20),
  global: global.slice(0, 20),
}, null, 1) + '\n');

console.log(`news: india_fresh=${indiaFresh.length} (of ${india.length} matched, cutoff ${cutoff}) global=${global.length} errors=${errors.length}`);
if (errors.length) console.error('NEWS CONNECTOR ERRORS:', errors);
