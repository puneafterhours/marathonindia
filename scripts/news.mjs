/* MarathonIndia news connector.
   Fetches public RSS feeds (published for syndication) for marathon news.
   India section: Sportstar athletics (The Hindu group, India-focused).
   Global section: World Athletics, Athletics Weekly, Runner's World,
   filtered to marathon / road-running items.
   Every item keeps its source name, link and publication date. */
import { writeFileSync } from 'node:fs';

const INDIA_FEEDS = [
  { name: 'Sportstar (The Hindu)', url: 'https://sportstar.thehindu.com/athletics/feeder/default.rss', filterRoad: true },
  // General Indian sports desk, filtered down to marathon / road-running items.
  { name: 'Times of India Sports', url: 'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms', filterRoad: true },
];
const GLOBAL_FEEDS = [
  { name: 'World Athletics', url: 'https://worldathletics.org/news/rss' },
  { name: 'Athletics Weekly', url: 'https://athleticsweekly.com/feed/' },
  { name: "Runner's World", url: 'https://www.runnersworld.com/rss/all.xml/' },
];
const ROAD_RE = /marathon|half marathon|road race|road running|10k|25k|ultra/i;
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
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MarathonIndiaBot/1.0; +https://marathonindia.vercel.app)' },
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

const errors = [];
const india = [], global = [];
for (const f of INDIA_FEEDS) {
  try { india.push(...await readFeed(f, { filterRoad: !!f.filterRoad })); }
  catch (e) { errors.push(e.message); }
}
for (const f of GLOBAL_FEEDS) {
  try { global.push(...await readFeed(f, { filterRoad: true })); }
  catch (e) { errors.push(e.message); }
}

const byDate = (a, b) => (a.date < b.date ? 1 : -1);
india.sort(byDate); global.sort(byDate);

writeFileSync('news.json', JSON.stringify({
  fetchedAt: new Date().toISOString(),
  note: 'India items are marathon and road-running coverage from Indian media; global items are filtered to marathon and road-running news. Titles, links and dates are the publishers own.',
  india: india.slice(0, 20),
  global: global.slice(0, 20),
}, null, 1) + '\n');

console.log(`news: india=${india.length} global=${global.length} errors=${errors.length}`);
if (errors.length) console.error('NEWS CONNECTOR ERRORS:', errors);
