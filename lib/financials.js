// lib/financials.js
// Per-quarter fundamentals distilled from SEC EDGAR XBRL, for the report-summary
// feature. Six metrics with the user's status rules:
//   1. EPS (diluted, TTM-quarter, split-adjusted) — income statement, trend
//   2. Revenue (single quarter) + YoY% (vs same quarter prior year) — income stmt
//   3. Book value per share (split-adjusted) — balance sheet, trend
//   4. Current ratio = current assets / current liabilities — balance sheet
//        >2 green · 1–2 yellow · <1 red
//   5. Debt/Equity = long-term debt / stockholders' equity — balance sheet
//        <1 green · 1–1.2 yellow · >1.2 red
//   6. Operating cash flow (single quarter) — cash-flow statement
//        positive green · negative red
//
// Flow metrics (EPS, revenue, OCF) are reported year-to-date in 10-Qs, so we
// derive single quarters the same way as the backfill (90-day periods; Q4 = FY −
// 9-month YTD). Instant metrics (assets, liabilities, debt, equity, shares) are
// period-end values. Per-share figures are split-adjusted to match.

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
    tickerMap = (await getJson('https://www.sec.gov/files/company_tickers.json', SEC_UA)) || {};
  }
  const up = ticker.toUpperCase();
  for (const k of Object.keys(tickerMap)) {
    if (String(tickerMap[k].ticker).toUpperCase() === up) {
      return String(tickerMap[k].cik_str).padStart(10, '0');
    }
  }
  return null;
}

async function concept(cik, tag) {
  const data = await getJson(
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`,
    SEC_UA
  );
  if (!data || !data.units) return [];
  return Object.values(data.units)[0] || [];
}
async function firstConcept(cik, tags) {
  for (const tag of tags) {
    const u = await concept(cik, tag);
    if (u.length) return u;
  }
  return [];
}

const days = (s, e) => Math.round((new Date(e) - new Date(s)) / 86400000);
const quarterLabel = (end) => {
  const [y, m] = end.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
};
const accnIndexUrl = (cik, accn) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;

// Single-quarter values for a flow concept, keyed by quarter-end. Handles both
// shapes: income statements expose standalone ~90-day quarters; cash-flow
// statements only report cumulative year-to-date (3/6/9/12-month). We take
// standalone quarters directly, then fill gaps by differencing each fiscal
// year's YTD chain (Q2 = 6mo − 3mo, Q3 = 9mo − 6mo, Q4 = FY − 9mo).
function quarterlyFlow(entries) {
  const valid = entries.filter((e) => e.val != null && e.start && e.end);
  const single = {};
  const keepEarliest = (slot, rec) => (!slot || rec.filed < slot.filed ? rec : slot);

  // 1) Standalone single quarters (most accurate; no rounding from a subtraction).
  for (const e of valid) {
    const d = days(e.start, e.end);
    if (d >= 80 && d <= 100) single[e.end] = keepEarliest(single[e.end], { ...e });
  }

  // 2) Cumulative YTD chains, grouped by fiscal-year start; difference consecutive.
  const byStart = {};
  for (const e of valid) {
    if (days(e.start, e.end) >= 80) (byStart[e.start] ||= []).push(e);
  }
  for (const start of Object.keys(byStart)) {
    const byEnd = {};
    for (const e of byStart[start]) {
      if (!byEnd[e.end] || e.filed < byEnd[e.end].filed) byEnd[e.end] = e;
    }
    const ends = Object.keys(byEnd).sort();
    let prev = null;
    for (const end of ends) {
      const cur = byEnd[end];
      if (prev) {
        if (!single[end]) {
          single[end] = {
            end,
            val: Number((cur.val - prev.val).toFixed(2)),
            form: cur.form,
            accn: cur.accn,
            filed: cur.filed,
          };
        }
      } else if (days(start, end) >= 80 && days(start, end) <= 100 && !single[end]) {
        single[end] = { ...cur };
      }
      prev = cur;
    }
  }
  return single;
}

// Merge several candidate concepts (priority order) into one quarterly map —
// companies rename tags over time, so we take whichever has a value per quarter.
function mergedQuarterly(arrays) {
  const out = {};
  for (const arr of arrays) {
    const map = quarterlyFlow(arr);
    for (const end of Object.keys(map)) if (!(end in out)) out[end] = map[end];
  }
  return out;
}

// Period-end (instant) values, earliest-filed preferred.
function instantByEnd(entries) {
  const map = {};
  for (const e of entries) {
    if (e.val === null || e.val === undefined) continue;
    if (!map[e.end] || e.filed < map[e.end].filed) map[e.end] = { end: e.end, val: e.val, filed: e.filed };
  }
  return map;
}

async function getSplits(ticker) {
  const data = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=max&interval=1mo&events=split`,
    { 'User-Agent': 'Mozilla/5.0' }
  );
  const ev = data?.chart?.result?.[0]?.events?.splits || {};
  return Object.values(ev).map((s) => ({ t: s.date * 1000, ratio: s.numerator / s.denominator }));
}
function splitFactorAfter(splits, dateStr) {
  const t = new Date(dateStr).getTime();
  let f = 1;
  for (const s of splits) if (s.t > t && s.ratio > 0) f *= s.ratio;
  return f;
}

const trend = (cur, prev) => {
  if (typeof cur !== 'number' || typeof prev !== 'number') return null;
  const d = cur - prev;
  if (Math.abs(d) < Math.abs(prev) * 0.005) return 'flat';
  return d > 0 ? 'up' : 'down';
};
const currentStatus = (r) => (r == null ? null : r >= 2 ? 'green' : r >= 1 ? 'yellow' : 'red');
const deStatus = (r) => (r == null ? null : r < 1 ? 'green' : r <= 1.2 ? 'yellow' : 'red');
const ocfStatus = (v) => (v == null ? null : v >= 0 ? 'green' : 'red');

/**
 * Returns { ticker, cik, quarters: [...] } oldest → newest, or cik:null if the
 * ticker has no SEC filings (non-US).
 */
export async function getFinancials(ticker) {
  const sym = ticker.toUpperCase();
  const cik = await getCik(sym);
  if (!cik) return { ticker: sym, cik: null, quarters: [] };

  const C = (t) => concept(cik, t);
  const [
    epsDil, epsBnD, epsBasic,
    revContract, revGeneral, revSales,
    ocfMain, ocfCont,
    equity, shares, curAssets, curLiab,
    ltdNon, ltdTotal, ltdLease, splits,
  ] = await Promise.all([
    C('EarningsPerShareDiluted'), C('EarningsPerShareBasicAndDiluted'), C('EarningsPerShareBasic'),
    C('RevenueFromContractWithCustomerExcludingAssessedTax'), C('Revenues'), C('SalesRevenueNet'),
    C('NetCashProvidedByUsedInOperatingActivities'),
    C('NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'),
    firstConcept(cik, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']),
    firstConcept(cik, ['CommonStockSharesOutstanding', 'CommonStockSharesIssued']),
    C('AssetsCurrent'), C('LiabilitiesCurrent'),
    C('LongTermDebtNoncurrent'), C('LongTermDebt'), C('LongTermDebtAndCapitalLeaseObligations'),
    getSplits(sym),
  ]);

  const epsQ = mergedQuarterly([epsDil, epsBnD, epsBasic]);
  const revQ = mergedQuarterly([revContract, revGeneral, revSales]);
  const ocfQ = mergedQuarterly([ocfMain, ocfCont]);
  const equityE = instantByEnd(equity);
  const sharesE = instantByEnd(shares);
  const caE = instantByEnd(curAssets);
  const clE = instantByEnd(curLiab);
  // Long-term debt: companies change tags over time, so take whichever has a
  // value for the period (most precise first).
  const ltdNonE = instantByEnd(ltdNon);
  const ltdTotalE = instantByEnd(ltdTotal);
  const ltdLeaseE = instantByEnd(ltdLease);
  const ltdAt = (end) => ltdNonE[end]?.val ?? ltdTotalE[end]?.val ?? ltdLeaseE[end]?.val ?? null;

  // Quarter spine: union of EPS and revenue quarter-ends.
  const ends = [...new Set([...Object.keys(epsQ), ...Object.keys(revQ)])].sort();

  const rows = ends.map((end) => {
    const factor = splitFactorAfter(splits, end);
    const epsVal = epsQ[end] ? Number((epsQ[end].val / factor).toFixed(4)) : null;
    const equityVal = equityE[end]?.val ?? null;
    const sharesVal = sharesE[end]?.val ?? null;
    const bvps = equityVal && sharesVal ? Number((equityVal / sharesVal / factor).toFixed(4)) : null;
    const revenue = revQ[end] ? revQ[end].val : null;
    const ocfVal = ocfQ[end] ? ocfQ[end].val : null;
    const ca = caE[end]?.val ?? null;
    const cl = clE[end]?.val ?? null;
    const currentRatio = ca && cl ? Number((ca / cl).toFixed(2)) : null;
    const ltd = ltdAt(end);
    const debtToEquity =
      ltd != null && equityVal && equityVal > 0 ? Number((ltd / equityVal).toFixed(2)) : null;
    const src = epsQ[end] || revQ[end];
    return {
      quarter: quarterLabel(end),
      quarterEnd: end,
      eps: epsVal,
      revenue,
      bvps,
      currentRatio,
      currentStatus: currentStatus(currentRatio),
      debtToEquity,
      deStatus: deStatus(debtToEquity),
      operatingCashFlow: ocfVal,
      ocfStatus: ocfStatus(ocfVal),
      filing: src ? { form: src.form, url: accnIndexUrl(cik, src.accn) } : null,
    };
  });

  // Trends + revenue YoY (same quarter prior year = 4 rows back).
  for (let i = 0; i < rows.length; i++) {
    rows[i].epsTrend = i > 0 ? trend(rows[i].eps, rows[i - 1].eps) : null;
    rows[i].bvpsTrend = i > 0 ? trend(rows[i].bvps, rows[i - 1].bvps) : null;
    const yoyBase = rows[i - 4];
    rows[i].revenueYoY =
      yoyBase && typeof rows[i].revenue === 'number' && typeof yoyBase.revenue === 'number' && yoyBase.revenue !== 0
        ? Number(((rows[i].revenue - yoyBase.revenue) / Math.abs(yoyBase.revenue)).toFixed(4))
        : null;
  }

  return { ticker: sym, cik, quarters: rows };
}
