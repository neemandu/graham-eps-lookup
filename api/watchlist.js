// api/watchlist.js — manage the list of tracked tickers.
//   GET    /api/watchlist            -> { mode, watchlist }
//   POST   /api/watchlist {ticker}   -> add    -> { watchlist }
//   DELETE /api/watchlist?ticker=X   -> remove -> { watchlist }

import { getWatchlist, saveWatchlist, storeMode } from '../lib/store.js';
import { TICKER_RE } from '../analyze.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ mode: storeMode, watchlist: await getWatchlist() });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ticker = String(body.ticker || '').trim().toUpperCase();
      if (!TICKER_RE.test(ticker)) {
        return res.status(400).json({ error: 'Invalid ticker symbol.' });
      }
      const list = await getWatchlist();
      if (!list.includes(ticker)) list.push(ticker);
      const saved = await saveWatchlist(list);
      return res.status(200).json({ watchlist: saved });
    }

    if (req.method === 'DELETE') {
      const ticker = String(req.query.ticker || '').trim().toUpperCase();
      if (!ticker) return res.status(400).json({ error: 'Missing ticker.' });
      const list = (await getWatchlist()).filter((t) => t !== ticker);
      const saved = await saveWatchlist(list);
      return res.status(200).json({ watchlist: saved });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Watchlist operation failed.' });
  }
}
