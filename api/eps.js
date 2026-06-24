// api/eps.js — Vercel serverless function: GET /api/eps?ticker=ONDS
// Returns the stock's EPS (TTM) from Yahoo Finance.
//
// On Vercel this file is the production endpoint. Locally, `server.js` exposes
// the same route for `npm run dev`. Both share the Yahoo logic in `yahoo.js`.

import { getStockData } from '../yahoo.js';

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim();
  if (!ticker || !/^[A-Za-z.\-]{1,12}$/.test(ticker)) {
    res.status(400).json({ error: 'Please provide a valid ticker symbol.' });
    return;
  }

  try {
    const stock = await getStockData(ticker);
    res.status(200).json({
      symbol: stock.symbol,
      name: stock.name,
      exchange: stock.exchange,
      epsTTM: stock.epsTTM,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to fetch stock data.' });
  }
}
