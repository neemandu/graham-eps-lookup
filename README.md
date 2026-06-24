# Graham Value

A small web app that fetches a stock's **EPS (TTM)** from Yahoo Finance and
applies **Benjamin Graham's intrinsic value formula**.

## The formula

```
V = EPS × (8.5 + 2g) × 4.4 / Y
```

| Symbol | Meaning |
| ------ | ------- |
| `EPS`  | Trailing-twelve-month earnings per share (fetched live from Yahoo) |
| `8.5`  | Graham's base P/E for a no-growth company |
| `g`    | Expected annual earnings growth (%), 7–10 yr — **you set this** |
| `4.4`  | Average AAA corporate bond yield in 1962 |
| `Y`    | Current AAA corporate bond yield (%) — **you set this** |

Leaving `Y = 4.4` reduces it to Graham's original `V = EPS × (8.5 + 2g)`.

## Running it

```bash
npm install
npm start          # then open http://localhost:3000
```

Enter a ticker (e.g. `ONDS`), optionally adjust the growth rate and bond yield,
and click **Calculate**. You'll see EPS (TTM), the current price, the Graham
intrinsic value, and the margin of safety vs. the current price.

## How it talks to Yahoo

Yahoo's quote page is rendered in the browser, so the EPS value isn't in the
raw HTML. Instead the app reproduces the same session the browser establishes:

1. Request a session **cookie** from Yahoo.
2. Exchange it for a **crumb** token (what Yahoo's own JavaScript does).
3. Call the quote API with the cookie + crumb and realistic browser headers.

The session is cached (~25 min), requests are paced with small randomized
delays, and there's a per-IP rate limit — so traffic stays close to a human
browsing the site rather than a scraper.

## Files

| File              | Purpose |
| ----------------- | ------- |
| `server.js`       | Express server + `/api/value` endpoint |
| `yahoo.js`        | Yahoo session handshake + quote fetch |
| `graham.js`       | The Graham value + margin-of-safety math |
| `public/`         | Web UI (HTML / CSS / JS) |

## Notes

- Educational use only — **not investment advice**. The formula is extremely
  sensitive to the growth assumption `g`.
- The valuation is not meaningful for companies with zero/negative EPS; the app
  flags this with a warning.
- Yahoo's endpoints are unofficial and can change without notice.

## Roadmap ideas

- Pull the AAA bond yield (`Y`) automatically instead of typing it.
- Add more Graham criteria (current ratio, debt, dividend record, P/B).
- Show historical EPS growth to inform the `g` input.
- Cache quotes briefly to reduce repeat calls.
