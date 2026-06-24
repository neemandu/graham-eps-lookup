// scripts/backfill.js
// One-off / occasional historical backfill. For each ticker (args or the whole
// watchlist), reconstruct its quarterly Graham-Number history from SEC EDGAR +
// Yahoo and merge it into data/history/<TICKER>.json.
//
// Existing snapshots win for quarters they already cover (e.g. the live
// current-quarter snapshot keeps its richer Graham-formula valuation); only
// missing quarters are added.
//
//   node scripts/backfill.js            # backfill every watchlist ticker
//   node scripts/backfill.js ONDS AAPL  # backfill specific tickers

import { getWatchlist, getHistory, saveHistory } from '../lib/store.js';
import { backfillTicker } from '../lib/backfill.js';

const args = process.argv.slice(2);
const tickers = args.length ? args.map((t) => t.toUpperCase()) : await getWatchlist();

let failures = 0;
for (const ticker of tickers) {
  try {
    const { cik, snapshots } = await backfillTicker(ticker);
    if (!cik) {
      console.log(`${ticker}: not found in SEC EDGAR (non-US?) — skipped`);
      continue;
    }

    const existing = await getHistory(ticker);
    const have = new Set(existing.map((s) => s.quarter));
    const additions = snapshots.filter((s) => s.quarter && !have.has(s.quarter));
    const merged = [...existing, ...additions].sort((a, b) =>
      String(a.quarter).localeCompare(String(b.quarter))
    );
    await saveHistory(ticker, merged);

    const valued = additions.filter((s) => s.intrinsicValue !== null).length;
    const span = merged.length ? `${merged[0].quarter}…${merged[merged.length - 1].quarter}` : '—';
    console.log(
      `${ticker}: +${additions.length} historical quarters (${valued} with Graham Number); ` +
        `${merged.length} total [${span}]`
    );
  } catch (err) {
    failures++;
    console.error(`${ticker}: ERROR ${err.message}`);
  }
}

console.log('Backfill done.');
if (failures && failures === tickers.length) process.exit(1);
