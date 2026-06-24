// api/history.js — read recorded quarterly snapshots.
//   GET /api/history?ticker=ONDS  -> { ticker, history }
//   GET /api/history              -> { mode, items: [ { ticker, history } ] }
//                                     (overview for every watchlist ticker)

import { getWatchlist, getHistory, storeMode } from '../lib/store.js';
import { TICKER_RE } from '../analyze.js';

export default async function handler(req, res) {
  try {
    const ticker = String(req.query.ticker || '').trim().toUpperCase();

    if (ticker) {
      if (!TICKER_RE.test(ticker)) {
        return res.status(400).json({ error: 'Invalid ticker symbol.' });
      }
      return res.status(200).json({ ticker, history: await getHistory(ticker) });
    }

    const watchlist = await getWatchlist();
    const items = await Promise.all(
      watchlist.map(async (t) => ({ ticker: t, history: await getHistory(t) }))
    );
    return res.status(200).json({ mode: storeMode, items });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to read history.' });
  }
}
