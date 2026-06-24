# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

A small web app: enter a stock ticker, see its **EPS (TTM)** pulled live from
Yahoo Finance. This is the first step toward a fuller **Benjamin Graham
intrinsic value** calculator (the formula math already lives in `graham.js`,
unused for now).

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
- **`api/eps.js`** — the production endpoint on Vercel (serverless function).
- **`server.js`** — an Express server exposing the same `/api/eps` route for
  local development (`npm run dev` / `npm start`). Not used in production.
- **`yahoo.js`** — the single source of truth for talking to Yahoo. Both the
  serverless function and the local server import `getStockData()` from here.
- **`graham.js`** — Benjamin Graham value math. Currently unused; kept for the
  next milestone.

Keep `api/eps.js` and the `server.js` route thin — put any shared logic in
`yahoo.js` so both stay in sync.

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
