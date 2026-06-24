# Graham Value

A web app that runs a **Benjamin Graham analysis** on any stock ticker using
live Yahoo Finance data: intrinsic value, margin of safety, and a
defensive-investor checklist.

**Live:** https://graham-eps-lookup.vercel.app

## The formula

```
V = EPS × (8.5 + 2g) × 4.4 / Y
```

| Symbol | Meaning | Source |
| ------ | ------- | ------ |
| `EPS`  | Trailing-twelve-month earnings per share | Yahoo (auto) |
| `8.5`  | Graham's base P/E for a no-growth company | constant |
| `g`    | Expected annual earnings growth (%) | Yahoo analyst estimate (auto, editable) |
| `4.4`  | Average AAA corporate bond yield in 1962 | constant |
| `Y`    | Current AAA corporate bond yield (%) | FRED → Treasury proxy (auto, editable) |

Both `g` and `Y` are filled in automatically but can be overridden in the UI;
changing them recomputes the value instantly (client-side).

## Defensive-investor checklist

Alongside the value, the app scores Graham's qualitative criteria (P/E ≤ 15,
P/B ≤ 1.5, P/E × P/B ≤ 22.5, current ratio ≥ 2, conservative debt, positive
earnings, pays a dividend, adequate size) and shows a pass count.

## Running it

```bash
npm install
npm start          # then open http://localhost:3000
```

Enter a ticker (e.g. `ONDS`) and click **Analyze**.

## How it talks to Yahoo

Yahoo's quote page is rendered in the browser, so the EPS value isn't in the
raw HTML. Instead the app reproduces the same session the browser establishes:

1. Request a session **cookie** from Yahoo.
2. Exchange it for a **crumb** token (what Yahoo's own JavaScript does).
3. Call the quote API with the cookie + crumb and realistic browser headers.

The session is cached (~25 min), requests are paced with small randomized
delays, and there's a per-IP rate limit — so traffic stays close to a human
browsing the site rather than a scraper.

The bond yield `Y` is sourced in order: FRED (Moody's Aaa) → Yahoo 10-yr
Treasury + ~1% → a static default. FRED is reachable locally but tends to time
out from Vercel's network, so production usually shows the Treasury proxy — the
UI labels whichever source was used.

## Files

| File              | Purpose |
| ----------------- | ------- |
| `api/analyze.js`  | Production endpoint `/api/analyze` (Vercel) |
| `api/eps.js`      | Original simple EPS-only endpoint |
| `server.js`       | Express server (local dev) exposing the same routes |
| `analyze.js`      | Shared orchestration (Yahoo + FRED + value + checklist) |
| `yahoo.js`        | Yahoo session handshake + quote / summary fetch |
| `fred.js`         | AAA bond yield with fallback chain |
| `graham.js`       | Value, margin of safety, defensive checklist |
| `public/`         | Web UI (HTML / CSS / JS) |

## Notes

- Educational use only — **not investment advice**. The formula is extremely
  sensitive to the growth assumption `g` (e.g. a high analyst estimate can make
  a richly-valued stock look cheap — override it with your own number).
- The valuation is not meaningful for companies with zero/negative EPS; the app
  flags this with a warning.
- Yahoo's and FRED's endpoints are unofficial / unkeyed and can change.

## Roadmap ideas

- Use a true long-term (7–10 yr) growth input instead of next-year analyst data.
- Add the Graham Number (√(22.5 × EPS × BVPS)) as a separate valuation.
- Show historical EPS to sanity-check the growth assumption.
- Cache quotes briefly to reduce repeat calls.
