// fred.js
// Supplies the AAA corporate bond yield (Y) for Graham's formula.
//
// Graham's revised formula multiplies by 4.4 / Y, where Y is the *current* yield
// on AAA corporate bonds. That's a macro rate Yahoo doesn't carry, so we source
// it with a fallback chain (each step is best-effort, the next covers failures):
//
//   1. FRED "DAAA" — Moody's Seasoned Aaa Corporate Bond Yield (the real thing).
//   2. Yahoo "^TNX" — 10-year Treasury yield + ~1.0% (a close, reliable proxy).
//   3. A static default, so the app always returns *something*.
//
// The result is cached for 12h since this rate barely moves intraday.

import { getQuoteRaw } from './yahoo.js';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FRED_TIMEOUT_MS = 6000;
const TREASURY_SPREAD = 1.0; // typical Aaa-over-10yr-Treasury spread, in %
const STATIC_DEFAULT = 5.5; // sensible fallback if everything else fails

let cache = null; // { data, at }

async function fromFred() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FRED_TIMEOUT_MS);
  try {
    const res = await fetch(
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DAAA',
      {
        signal: ctrl.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/csv,*/*',
        },
      }
    );
    if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
    const text = await res.text();

    // CSV is "DATE,DAAA" with a header row; "." marks missing values. Walk from
    // the bottom to find the most recent numeric observation.
    const rows = text.trim().split('\n').slice(1);
    for (let i = rows.length - 1; i >= 0; i--) {
      const [date, value] = rows[i].split(',');
      const v = parseFloat(value);
      if (Number.isFinite(v)) {
        return { value: Number(v.toFixed(2)), source: `FRED Moody's Aaa (${date})` };
      }
    }
    throw new Error('FRED returned no numeric observations');
  } finally {
    clearTimeout(timer);
  }
}

async function fromTreasuryProxy() {
  const q = await getQuoteRaw('^TNX'); // 10-year Treasury yield, in percent
  const y = q?.regularMarketPrice;
  if (typeof y === 'number' && Number.isFinite(y)) {
    return {
      value: Number((y + TREASURY_SPREAD).toFixed(2)),
      source: `approx: 10-yr Treasury ${y.toFixed(2)}% + ${TREASURY_SPREAD}%`,
    };
  }
  throw new Error('No treasury yield available');
}

export async function getAaaYield() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  let data;
  try {
    data = await fromFred();
  } catch {
    try {
      data = await fromTreasuryProxy();
    } catch {
      data = { value: STATIC_DEFAULT, source: `default fallback (${STATIC_DEFAULT}%)` };
    }
  }

  cache = { data, at: Date.now() };
  return data;
}
