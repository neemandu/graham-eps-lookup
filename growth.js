// growth.js
// Resolve the expected annual EPS growth (g) for Graham's formula, which wants a
// long-term (~7–10 yr) rate. Chain of sources, best first:
//
//   1. Yahoo P/E ÷ PEG — recovers Yahoo's ~5-year expected growth (PEG = P/E ÷ g,
//      so g = P/E ÷ PEG). Smooth and appropriate for the formula.
//   2. Finviz "EPS next 5Y" — analyst 5-yr estimate, for names without a PEG
//      (newer / unprofitable). Best-effort; may be unreachable from serverless.
//   3. Conservative default of 15%.
//
// The result is always editable by the user in the UI.

import { getFinvizGrowth } from './finviz.js';

const DEFAULT_GROWTH = 15;

export async function resolveGrowth(stock, ticker) {
  // 1. P/E ÷ PEG (≈ 5-yr expected). Only when both are positive.
  if (
    Number.isFinite(stock.trailingPE) &&
    stock.trailingPE > 0 &&
    Number.isFinite(stock.pegRatio) &&
    stock.pegRatio > 0
  ) {
    const g = Number((stock.trailingPE / stock.pegRatio).toFixed(2));
    if (Number.isFinite(g) && g > 0) {
      return { value: g, source: 'Yahoo P/E ÷ PEG (~5-yr expected)' };
    }
  }

  // 2. Finviz EPS next 5Y (best-effort).
  const fv = await getFinvizGrowth(ticker);
  if (fv !== null && Number.isFinite(fv)) {
    return { value: Number(fv.toFixed(2)), source: 'Finviz EPS next 5Y' };
  }

  // 3. Conservative default.
  return { value: DEFAULT_GROWTH, source: `conservative default (${DEFAULT_GROWTH}%)` };
}
