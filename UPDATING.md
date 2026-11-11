# How MarathonIndia stays fresh (the agentic part)

Status: DESIGNED, NOT LIVE. Nothing here runs on a schedule yet. The user asked for automatic fetching; how updates get published (fully automatic vs drafted for review, and how often) is his open decision. This file is the working agreement for whichever mode he picks.

## What an update cycle does

1. Check the agreed sources for new races, date changes, category changes, and certification changes.
2. For each race, capture from its official registration page: categories, fees exactly as published (including whether GST is included or added), and entry requirements. Never infer a GST rate; record "including GST" / "excluding GST" / "not stated" as published, with the capture date.
3. Write the result as a new `races.json` with per-race `lastChecked` stamps and per-field source notes.
4. Publish path depends on the mode he picks:
   - Automatic: commit to the repo, Vercel redeploys.
   - Reviewed: the cycle produces a human-readable diff; only approved changes get committed.

## Sources

Certification evidence (each kept as a distinct claim, never merged):
- AIMS member directory: https://aims-worldrunning.org/directory.html (fetchable HTML; listed 37 India member races on 11 Nov 2026)
- AIMS race calendar: https://aims-worldrunning.org/calendar.html
- World Athletics certified road events: https://worldathletics.org/records/certified-roadevents (JS-heavy; needs browser rendering)
- World Athletics Label competitions list
- ITRA race calendar (trail races)

Race discovery and fees:
- punerunners.com/races (existing maintained calendar, Pune-first)
- Organiser official sites and their registration pages (Townscript, BookMyShow, KonfHub, MeraEvents and similar), fetched respectfully: low frequency, identified fetches, each site's terms honored
- The Daud India Android dataset (67-race historical snapshot) once re-verified; its former update feed (daudindia-data.kamdis.workers.dev/races.json) is currently down (HTTP 404, Cloudflare error 1042, observed 11 Nov 2026)

## Rules carried from the PuneRunners calendar

- 2026 certifications are never carried forward as 2027 status; each race shows its last verified edition and status.
- Conflicts between sources (e.g. organiser date vs AIMS date) are flagged, not smoothed over.
- Trail races use ITRA listing as their evidence.
- Coverage is a goal, not a guarantee: a race appears when a checked source lists it.
