// lib/snapshot.js
// Builds and records quarterly snapshots. A "snapshot" captures the Graham
// inputs/outputs for a stock at the moment a newly-reported quarter appears.
//
// `runSnapshots` is called by both the scheduled GitHub Action
// (scripts/snapshot.js) and the optional manual trigger (api/snapshot.js).
// SEC filing lookup is injected via `getFilings` so this module stays decoupled
// from sec.js.

import { analyzeTicker } from '../analyze.js';
import { getWatchlist, appendSnapshot } from './store.js';

// "2026-03-31" -> "2026-Q1"
export function quarterLabel(dateStr) {
  if (!dateStr) return null;
  const [y, m] = String(dateStr).split('-').map(Number);
  if (!y || !m) return null;
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

export function buildSnapshot(analysis, filing) {
  const s = analysis.stock;
  return {
    quarter: quarterLabel(s.mostRecentQuarter),
    quarterEnd: s.mostRecentQuarter || null,
    capturedAt: new Date().toISOString(),
    price: s.price,
    eps: s.epsTTM,
    growth: analysis.growth.value,
    growthSource: analysis.growth.source,
    bondYield: analysis.bondYield.value,
    bondYieldSource: analysis.bondYield.source,
    intrinsicValue: analysis.graham.intrinsicValue,
    marginOfSafety: analysis.graham.marginOfSafety,
    criteriaPassed: analysis.criteria.passed,
    criteriaTotal: analysis.criteria.total,
    filing: filing || null, // { form, date, url }
  };
}

/**
 * For every watchlist ticker: analyze it, and if its most-recent reported
 * quarter isn't recorded yet, append a snapshot. Returns a per-ticker report.
 * @param {object} [opts]
 * @param {(ticker:string)=>Promise<{form,date,url}|null>} [opts.getFilings]
 */
export async function runSnapshots({ getFilings } = {}) {
  const watchlist = await getWatchlist();
  const results = [];

  for (const ticker of watchlist) {
    try {
      const analysis = await analyzeTicker(ticker);

      let filing = null;
      if (getFilings) {
        try {
          filing = await getFilings(ticker);
        } catch {
          /* filing links are best-effort */
        }
      }

      const snap = buildSnapshot(analysis, filing);
      if (!snap.quarter) {
        results.push({ ticker, status: 'no-quarter' });
        continue;
      }

      const added = await appendSnapshot(ticker, snap);
      results.push({
        ticker,
        quarter: snap.quarter,
        status: added ? 'added' : 'exists',
      });
    } catch (err) {
      results.push({ ticker, status: 'error', error: err.message });
    }
  }

  return results;
}
