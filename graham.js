// graham.js
// Benjamin Graham's intrinsic value formula.
//
// Original (1962), from "The Intelligent Investor":
//     V = EPS * (8.5 + 2g)
//
// Revised version that adjusts for prevailing interest rates:
//     V = EPS * (8.5 + 2g) * 4.4 / Y
//
//   EPS = trailing-twelve-month earnings per share
//   8.5 = the P/E base Graham assigned to a no-growth company
//   g   = expected annual earnings growth rate over 7-10 years (as a percent)
//   4.4 = the average yield on AAA corporate bonds in 1962
//   Y   = the current yield on AAA corporate bonds (as a percent)
//
// Notes / caveats:
//  - The formula is famously sensitive to the growth assumption g.
//  - It is meaningless for companies with negative (or near-zero) EPS; Graham
//    intended it for stable, profitable businesses. We surface that as a warning
//    rather than returning a misleading number.

const GRAHAM_BASE_PE = 8.5; // no-growth P/E
const AAA_YIELD_1962 = 4.4; // the historical reference yield

export function calculateGrahamValue({ eps, growthRate, bondYield }) {
  const warnings = [];

  if (eps === null || eps === undefined || Number.isNaN(eps)) {
    return { value: null, warnings: ['EPS (TTM) is unavailable for this stock.'] };
  }

  const g = Number(growthRate);
  const y = Number(bondYield);

  let value = eps * (GRAHAM_BASE_PE + 2 * g);

  // Apply the interest-rate adjustment only when a sensible yield is provided.
  let usedBondAdjustment = false;
  if (Number.isFinite(y) && y > 0) {
    value = (value * AAA_YIELD_1962) / y;
    usedBondAdjustment = true;
  }

  if (eps <= 0) {
    warnings.push(
      'EPS is zero or negative, so Graham’s formula does not produce a ' +
        'meaningful valuation for this company.'
    );
  }

  return {
    value: Number.isFinite(value) ? value : null,
    usedBondAdjustment,
    inputs: { eps, growthRate: g, bondYield: usedBondAdjustment ? y : null },
    warnings,
  };
}

/**
 * Compare intrinsic value to current price and express the margin of safety.
 * Positive margin => trading below Graham value (potentially undervalued).
 */
export function marginOfSafety(intrinsicValue, price) {
  if (!Number.isFinite(intrinsicValue) || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return (intrinsicValue - price) / price; // e.g. 0.25 => 25% below intrinsic value
}

// Graham's "defensive investor" qualitative checklist (from The Intelligent
// Investor, adapted to the data Yahoo exposes). Each item is pass / fail /
// unknown(null). `value` is the raw number for display; `pass` is the verdict.
export function defensiveCriteria(s) {
  const list = [];
  const add = (key, label, threshold, value, pass) =>
    list.push({ key, label, threshold, value, pass });

  const has = (v) => v !== null && v !== undefined && Number.isFinite(v);

  // Adequate size — Graham wanted large, established firms. Modern proxy: >$2B.
  add(
    'size',
    'Adequate size (market cap)',
    '≥ $2B',
    s.marketCap,
    has(s.marketCap) ? s.marketCap >= 2e9 : null
  );

  // Strong financial condition — current ratio at least 2.
  add(
    'currentRatio',
    'Current ratio',
    '≥ 2',
    s.currentRatio,
    has(s.currentRatio) ? s.currentRatio >= 2 : null
  );

  // Conservative leverage — debt/equity (Yahoo gives this as a percent).
  add(
    'debt',
    'Debt / equity',
    '≤ 100%',
    s.debtToEquity,
    has(s.debtToEquity) ? s.debtToEquity <= 100 : null
  );

  // Earnings stability — positive trailing earnings.
  add(
    'earnings',
    'Positive earnings (EPS TTM)',
    '> 0',
    s.epsTTM,
    has(s.epsTTM) ? s.epsTTM > 0 : null
  );

  // Dividend record — Graham wanted uninterrupted dividends.
  add(
    'dividend',
    'Pays a dividend',
    'yes',
    s.dividendRate,
    has(s.dividendRate) ? s.dividendRate > 0 : false
  );

  // Moderate P/E.
  add(
    'pe',
    'P/E ratio',
    '≤ 15',
    s.trailingPE,
    has(s.trailingPE) ? s.trailingPE <= 15 : null
  );

  // Moderate price-to-book.
  add(
    'pb',
    'Price / book',
    '≤ 1.5',
    s.priceToBook,
    has(s.priceToBook) ? s.priceToBook <= 1.5 : null
  );

  // Combined "Graham number" guard: P/E x P/B should not exceed 22.5.
  const pepb =
    has(s.trailingPE) && has(s.priceToBook) ? s.trailingPE * s.priceToBook : null;
  add('pepb', 'P/E × P/B', '≤ 22.5', pepb, has(pepb) ? pepb <= 22.5 : null);

  const scored = list.filter((c) => c.pass !== null);
  const passed = scored.filter((c) => c.pass === true).length;

  return { list, passed, total: scored.length };
}
