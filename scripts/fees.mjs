// Fee/GST/requirements connector for JS-rendered registration pages.
// Runs only when PLAYWRIGHT=1 (the workflow installs Chromium). Rule-based
// extraction per platform; fees are copied exactly as published, never derived.
import { readFileSync, writeFileSync } from 'node:fs';
const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const TARGETS = [
  { id: 'lokmat-maha-marathon-pune', url: 'https://registration.eventforce.ai/event/45/lokmat-mahamarathon-season-10-pune', platform: 'eventforce' },
  { id: 'cme-soldierathon-pune', url: 'https://www.fitistan.com/events/e/cme-soldierathon-pune-4th-edition-2026', platform: 'fitistan' },
];

export async function fetchFees(races) {
  if (process.env.PLAYWRIGHT !== '1') { console.log('fees: skipped (PLAYWRIGHT!=1)'); return; }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const t of TARGETS) {
      const r = races.find(x => x.id === t.id);
      if (!r) continue;
      try {
        const page = await browser.newPage();
        await page.goto(t.url, { waitUntil: 'networkidle', timeout: 45000 });
        const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
        // Eventforce pattern: "21 KM Half Marathon - ₹1,800/-" and ticket list "3KM ₹501.00"
        const fees = [...text.matchAll(/(\d+)\s?KM(?:\s+Run|\s+Half Marathon|\s+Walk)?[^\n₹]{0,60}?₹\s?([\d,]+)/gi)]
          .map(m => `${m[1]}K ₹${m[2].replace(/,/g, '')}`);
        const uniq = [...new Set(fees)];
        if (uniq.length && JSON.stringify(r.fees || []) !== JSON.stringify(uniq)) {
          r.fees = uniq;
          r.lastChecked = `Fees re-checked ${TODAY} on the registration page`;
          console.log(`fees: ${t.id} -> ${uniq.join(', ')}`);
        } else if (uniq.length) {
          r.lastChecked = `Fees re-checked ${TODAY} on the registration page`;
          console.log(`fees: ${t.id} unchanged (${uniq.length} categories)`);
        } else {
          console.log(`fees: ${t.id} no fees published on page`);
        }
        await page.close();
      } catch (e) { console.log(`fees: ${t.id} error ${e.message}`); }
    }
  } finally { await browser.close(); }
}
