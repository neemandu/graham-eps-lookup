// api/analyze.js — Vercel serverless function
// GET /api/analyze?ticker=ONDS[&growth=9.7&bondYield=5.5]
// Full Graham analysis: intrinsic value, margin of safety, defensive checklist.
// growth (g) and bondYield (Y) are auto-derived unless provided.

import { analyzeTicker, TICKER_RE } from '../analyze.js';

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim();
  if (!ticker || !TICKER_RE.test(ticker)) {
    res.status(400).json({ error: 'Please provide a valid ticker symbol.' });
    return;
  }

  try {
    const data = await analyzeTicker(ticker, {
      growth: req.query.growth,
      bondYield: req.query.bondYield,
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to analyze stock.' });
  }
}
