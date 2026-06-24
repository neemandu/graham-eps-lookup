// lib/backfill.js
// Reconstruct a stock's quarterly history from primary sources, valued with the
// GRAHAM NUMBER = sqrt(22.5 * EPS_ttm * BVPS). This needs no growth assumption,
// so it's an honest backward-looking valuation.
//
// Sources (all free, no key):
//   * SEC EDGAR XBRL companyconcept  -> diluted EPS, stockholders' equity, shares
//     (each value tagged with the 10-Q/10-K that reported it -> publication link)
//   * Yahoo chart API                -> historical price at each quarter-end
//
// Caveats baked into the output:
//   * TTM EPS sums four quarters of diluted EPS (an approximation; share counts
//     drift). Q4 is derived as FY annual minus the 9-month year-to-date figure.
//   * Graham Number is only defined when EPS_ttm > 0 and BVPS > 0; otherwise the
//     value is null (flagged, never faked). Price + filing link are still kept.

const SEC_UA = { 'User-Agent': 'Graham Value App neemandu@gmail.com' };
const TIMEOUT_MS = 8000;

async function getJson(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let tickerMap = null;
async function getCik(ticker) {
  if (!tickerMap) {
    const data = await getJson('https://www.sec.gov/files/company_tickers.json', SEC_UA);
    tickerMap = data || {};
  }
  const up = ticker.toUpperCase();
  for (const key of Object.keys(tickerMap)) {
    if (String(tickerMap[key].ticker).toUpperCase() === up) {
      return String(tickerMap[key].cik_str).padStart(10, '0');
    }
  }
  return null;
}

async function concept(cik, tag) {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
  const data = await getJson(url, SEC_UA);
  if (!data || !data.units) return [];
  return Object.values(data.units)[0] || [];
}

// First non-empty concept among candidate tags (companies tag things differently).
async function firstConcept(cik, tags) {
  for (const tag of tags) {
    const u = await concept(cik, tag);
    if (u.length) return u;
  }
  return [];
}

const days = (start, end) => Math.round((new Date(end) - new Date(start)) / 86400000);
const quarterLabel = (end) => {
  const [y, m] = end.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
};
const accnIndexUrl = (cik, accn) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;

// Build a map of fiscal-quarter-end -> { eps, form, accn } single-quarter EPS.
//
// Keyed by END/START dates, never by the `fy` tag: a later 10-K repeats the
// prior year as a comparative but tags it with the *new* filing's fiscal year
// (e.g. FY2023 data carried in the FY2024 10-K is tagged fy=2024 while keeping
// end=2023-12-31). Keying by date avoids that collision. Among entries for the
// same period we keep the ORIGINAL filing (earliest filed) — that gives both the
// as-originally-published value and the correct publication link.
function buildQuarterlyEps(epsEntries) {
  const single = {}; // end       -> rec  (80-100 day, one quarter)
  const ytd9ByStart = {}; // start -> rec  (255-285 day, 9-month YTD)
  const annualByEnd = {}; // end    -> rec  (350-380 day, full year)

  const keepEarliest = (slot, rec) => (!slot || rec.filed < slot.filed ? rec : slot);

  for (const e of epsEntries) {
    if (e.val === null || e.val === undefined) continue;
    const d = days(e.start, e.end);
    const rec = { start: e.start, end: e.end, val: e.val, form: e.form, accn: e.accn, filed: e.filed };
    if (d >= 80 && d <= 100) {
      single[e.end] = keepEarliest(single[e.end], rec);
    } else if (d >= 255 && d <= 285) {
      ytd9ByStart[e.start] = keepEarliest(ytd9ByStart[e.start], rec);
    } else if (d >= 350 && d <= 380) {
      annualByEnd[e.end] = keepEarliest(annualByEnd[e.end], rec);
    }
  }

  // Derive Q4 (= FY annual - the 9-month YTD with the SAME fiscal-year start)
  // unless a standalone Q4 was reported directly.
  for (const end of Object.keys(annualByEnd)) {
    const a = annualByEnd[end];
    const y = ytd9ByStart[a.start];
    if (y && !single[end]) {
      single[end] = {
        end,
        val: Number((a.val - y.val).toFixed(4)),
        form: a.form, // the 10-K reported the full year
        accn: a.accn,
        filed: a.filed,
      };
    }
  }

  return single; // keyed by quarter-end date
}

// Pick the price at (or just before) a given date from a sorted price series.
function priceAt(series, dateStr) {
  const target = new Date(dateStr).getTime();
  let chosen = null;
  for (const p of series) {
    if (p.t <= target) chosen = p.c;
    else break;
  }
  return chosen;
}

async function getPriceSeries(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=max&interval=1d&events=split`;
  const data = await getJson(url, { 'User-Agent': 'Mozilla/5.0' });
  const r = data?.chart?.result?.[0];
  if (!r?.timestamp) return { series: [], splits: [] };
  const closes = r.indicators?.quote?.[0]?.close || [];
  const series = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (typeof closes[i] === 'number') series.push({ t: r.timestamp[i] * 1000, c: closes[i] });
  }
  // Yahoo's `close` is split-adjusted; EPS/BVPS from filings are not. Collect the
  // split events so we can put per-share fundamentals on the same basis.
  const splits = Object.values(r.events?.splits || {}).map((s) => ({
    t: s.date * 1000,
    ratio: s.numerator / s.denominator,
  }));
  return { series, splits }; // series ascending by time
}

// Cumulative split factor applied AFTER a date: divide as-reported per-share
// figures by this to bring them onto today's split-adjusted basis.
function splitFactorAfter(splits, dateStr) {
  const t = new Date(dateStr).getTime();
  let f = 1;
  for (const s of splits) if (s.t > t && s.ratio > 0) f *= s.ratio;
  return f;
}

/**
 * Build historical Graham-Number snapshots for one ticker.
 * Returns { cik, snapshots: [...] } (snapshots ascending by quarter).
 */
export async function backfillTicker(ticker) {
  const sym = ticker.toUpperCase();
  const cik = await getCik(sym);
  if (!cik) return { cik: null, snapshots: [] };

  const [epsEntries, equityEntries, shareEntries, priceData] = await Promise.all([
    concept(cik, 'EarningsPerShareDiluted'),
    firstConcept(cik, [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ]),
    firstConcept(cik, ['CommonStockSharesOutstanding', 'CommonStockSharesIssued']),
    getPriceSeries(sym),
  ]);
  const priceSeries = priceData.series;
  const splits = priceData.splits;

  const quarterly = buildQuarterlyEps(epsEntries);
  const quarterEnds = Object.keys(quarterly).sort();

  // Original (earliest-filed) equity / shares value per period-end (instant facts).
  const originalByEnd = (entries) => {
    const map = {};
    for (const e of entries) {
      if (e.val === null) continue;
      if (!map[e.end] || e.filed < map[e.end].filed) map[e.end] = e;
    }
    return map;
  };
  const equityByEnd = originalByEnd(equityEntries);
  const sharesByEnd = originalByEnd(shareEntries);

  const snapshots = [];
  for (let i = 0; i < quarterEnds.length; i++) {
    const end = quarterEnds[i];

    // TTM EPS = this quarter + previous three (need all four).
    let ttmEps = null;
    if (i >= 3) {
      const window = quarterEnds.slice(i - 3, i + 1).map((d) => quarterly[d]?.val);
      if (window.every((v) => typeof v === 'number')) {
        ttmEps = Number(window.reduce((a, b) => a + b, 0).toFixed(4));
      }
    }

    // Put per-share fundamentals on today's split-adjusted basis (to match the
    // adjusted price), then compute the Graham Number.
    const factor = splitFactorAfter(splits, end);
    const epsAdj = ttmEps === null ? null : Number((ttmEps / factor).toFixed(4));

    const equity = equityByEnd[end]?.val ?? null;
    const shares = sharesByEnd[end]?.val ?? null;
    const bvps =
      equity && shares ? Number((equity / shares / factor).toFixed(4)) : null;

    const price = priceAt(priceSeries, end);

    let grahamNumber =
      epsAdj !== null && epsAdj > 0 && bvps && bvps > 0
        ? Number(Math.sqrt(22.5 * epsAdj * bvps).toFixed(4))
        : null;
    // Anomaly guard: as-reported XBRL occasionally yields a bad share count for a
    // single period. A Graham Number more than 5× the price is far outside any
    // reliable range from this reconstruction, so treat it as a data error.
    if (grahamNumber !== null && typeof price === 'number' && price > 0 && grahamNumber > 5 * price) {
      grahamNumber = null;
    }

    const margin =
      grahamNumber !== null && typeof price === 'number' && price > 0
        ? Number(((grahamNumber - price) / price).toFixed(4))
        : null;

    const src = quarterly[end];
    snapshots.push({
      quarter: quarterLabel(end),
      quarterEnd: end,
      method: 'Graham Number',
      historical: true,
      eps: epsAdj, // TTM, split-adjusted
      bvps,
      intrinsicValue: grahamNumber, // headline value (Graham Number)
      price: typeof price === 'number' ? Number(price.toFixed(2)) : null,
      marginOfSafety: margin,
      growth: null,
      bondYield: null,
      criteriaPassed: null,
      criteriaTotal: null,
      filing: src
        ? { form: src.form, date: src.end, url: accnIndexUrl(cik, src.accn) }
        : null,
      source: 'SEC EDGAR XBRL + Yahoo',
    });
  }

  return { cik, snapshots };
}
