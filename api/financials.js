// api/financials.js — per-quarter fundamentals (6 metrics + status colors).
//   GET /api/financials?ticker=ONDS -> { ticker, cik, quarters: [...] }
// Deterministic (no AI / no key). Cached briefly to spare SEC on repeat opens.

import { getFinancials } from '../lib/financials.js';
import { TICKER_RE } from '../analyze.js';

const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol.' });
  }
  try {
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < TTL_MS) return res.status(200).json(hit.data);
    const data = await getFinancials(ticker);
    cache.set(ticker, { at: Date.now(), data });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to load financials.' });
  }
}
