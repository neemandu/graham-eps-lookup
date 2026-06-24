# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

A web app: enter a stock ticker and get a **Benjamin Graham analysis** —
intrinsic value `V = EPS × (8.5 + 2g) × 4.4 / Y`, margin of safety vs. the
current price, and a defensive-investor checklist. EPS, growth (`g`), and the
checklist metrics come from Yahoo Finance; the AAA bond yield (`Y`) comes from
FRED (with fallbacks). `g` and `Y` are auto-derived but user-overridable.

## Architecture

```
index.html / app.js / style.css  ->  public/   (static front-end)
                                       |
              fetch('/api/eps?ticker=ONDS')
                                       |
                                       v
   api/eps.js (Vercel)  ==  /api/eps route in server.js (local)
                                       |
                                       v
                              yahoo.js  ->  Yahoo Finance
```

- **`public/`** — static front-end (vanilla HTML/CSS/JS, no framework). Vercel
  serves this at the site root.
- **`api/analyze.js`** — main production endpoint (`/api/analyze`). `api/eps.js`
  is the original simple EPS-only endpoint, still present.
- **`server.js`** — Express server exposing the same routes for local
  development (`npm run dev` / `npm start`). Not used in production.
- **`analyze.js`** — shared orchestration: fetch Yahoo + FRED, resolve `g`/`Y`,
  run the value + checklist. Imported by both `api/analyze.js` and `server.js`.
- **`yahoo.js`** — all Yahoo access: `getStockData` (simple), `getFullStockData`
  (rich, incl. the analyst growth estimate), `getQuoteRaw` (e.g. `^TNX`).
- **`fred.js`** — AAA bond yield (`Y`) with a fallback chain (see below).
- **`graham.js`** — the value formula, margin of safety, and `defensiveCriteria`
  (the checklist thresholds).

Keep the endpoints thin — shared logic lives in `analyze.js` / `yahoo.js` /
`graham.js` so the Vercel function and local server never drift.

## Resolving g and Y

- **g (growth):** `getFullStockData` reads Yahoo's `earningsTrend`. Yahoo dropped
  the long-term `+5y` figure, so we prefer `+1y`, then `0y`, then `+1q`. The
  formula is very sensitive to `g`, so the UI always lets the user override it.
- **Y (AAA bond yield):** `fred.js` tries, in order: (1) FRED `DAAA` Moody's Aaa
  CSV, (2) Yahoo `^TNX` 10-yr Treasury + ~1.0%, (3) a static default. Note FRED
  is reachable from local Node but **times out from Vercel's AWS network**, so in
  production the Treasury proxy is normally what's used — the response labels the
  source so this is visible.

## How Yahoo is accessed (important)

Yahoo's quote page renders EPS client-side, so it is **not** in the raw HTML.
`yahoo.js` instead reproduces the browser's own session:

1. Get a session **cookie** from Yahoo.
2. Exchange it for a **crumb** token (what Yahoo's JS does).
3. Call the quote API (`/v7/finance/quote`) with cookie + crumb + realistic
   browser headers (User-Agent, Accept-Language, Referer, sec-ch-ua).

The session is cached (~25 min) and requests are paced with small randomized
delays to stay close to human browsing. If Yahoo starts returning 401/403, the
client refreshes the session once and retries. These endpoints are unofficial
and can change — if EPS stops resolving, re-check the cookie/crumb handshake
first.

## Commands

```bash
npm install        # install deps (express, for local dev)
npm start          # run locally at http://localhost:3000
npm run dev        # same, with --watch auto-reload
vercel             # deploy a preview
vercel --prod      # deploy to production
```

## Conventions

- ES modules throughout (`"type": "module"` in package.json), Node 18+.
- No build step and no front-end framework — keep it that way unless there's a
  real reason. Plain `fetch` from `public/app.js`.
- Validate the ticker against `/^[A-Za-z.\-]{1,12}$/` before hitting Yahoo.

## Deployment

Hosted on Vercel. Zero-config: `public/` is served statically, `api/*.js`
become serverless functions. `npm`-installed `express` is only for local dev;
the production endpoint is `api/eps.js`.

Note: Yahoo may rate-limit or block requests from datacenter IPs more
aggressively than from a home connection. If production EPS lookups fail while
local ones work, that's the likely cause.

## Not investment advice

Educational project. Data is from Yahoo's unofficial endpoints.
