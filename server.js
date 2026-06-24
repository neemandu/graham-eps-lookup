// server.js
// Serves the web UI and a small JSON API:
//   GET /api/value?ticker=ONDS&growth=7&bondYield=4.4
// Fetches EPS (TTM) from Yahoo and returns the Graham intrinsic value.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStockData } from './yahoo.js';
import { analyzeTicker, TICKER_RE } from './analyze.js';
import watchlistHandler from './api/watchlist.js';
import historyHandler from './api/history.js';
import snapshotHandler from './api/snapshot.js';
import seriesHandler from './api/series.js';
import financialsHandler from './api/financials.js';
import summaryHandler from './api/summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple per-IP rate limit so the app itself doesn't get hammered (and in turn
// hammer Yahoo). 20 requests / minute is plenty for interactive use.
const hits = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const ip = req.ip;
  const windowStart = now - 60_000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= 20) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  list.push(now);
  hits.set(ip, list);
  next();
});

app.get('/api/eps', async (req, res) => {
  const ticker = String(req.query.ticker || '').trim();
  if (!ticker || !/^[A-Za-z.\-]{1,12}$/.test(ticker)) {
    return res.status(400).json({ error: 'Please provide a valid ticker symbol.' });
  }

  try {
    const stock = await getStockData(ticker);
    res.json({
      symbol: stock.symbol,
      name: stock.name,
      exchange: stock.exchange,
      epsTTM: stock.epsTTM,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to fetch stock data.' });
  }
});

app.get('/api/analyze', async (req, res) => {
  const ticker = String(req.query.ticker || '').trim();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return res.status(400).json({ error: 'Please provide a valid ticker symbol.' });
  }
  try {
    const data = await analyzeTicker(ticker, {
      growth: req.query.growth,
      bondYield: req.query.bondYield,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to analyze stock.' });
  }
});

// Watchlist + history reuse the exact Vercel handlers so local == production.
app.all('/api/watchlist', (req, res) => watchlistHandler(req, res));
app.get('/api/history', (req, res) => historyHandler(req, res));
app.all('/api/snapshot', (req, res) => snapshotHandler(req, res));
app.get('/api/series', (req, res) => seriesHandler(req, res));
app.get('/api/financials', (req, res) => financialsHandler(req, res));
app.get('/api/summary', (req, res) => summaryHandler(req, res));

app.listen(PORT, () => {
  console.log(`Graham Value app running at http://localhost:${PORT}`);
});
