// api/series.js — historical quarterly series for ANY ticker, computed live.
//   GET /api/series?ticker=ONDS -> { ticker, cik, series: [ snapshot... ] }
//
// Reuses the backfill engine (SEC EDGAR + Yahoo) so the calculator page can draw
// a price / EPS / margin / Graham-value chart for whatever you search — no need
// for the ticker to be on the watchlist. Cached briefly to spare the upstream
// APIs on repeat searches.

import { backfillTicker } from '../lib/backfill.js';
import { TICKER_RE } from '../analyze.js';

const cache = new Map(); // ticker -> { at, data }
const TTL_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol.' });
  }
  try {
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return res.status(200).json(hit.data);
    }
    const { cik, snapshots } = await backfillTicker(ticker);
    const data = { ticker, cik, series: snapshots };
    cache.set(ticker, { at: Date.now(), data });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to build history.' });
  }
}
