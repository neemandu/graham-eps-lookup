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
  const pe = stock.trailingPE;
  const peg = stock.pegRatio;
  const peStr = Number.isFinite(pe) ? pe.toFixed(1) : '—';
  const pegStr = Number.isFinite(peg) ? peg.toFixed(2) : '—';

  // 1. P/E ÷ PEG (≈ 5-yr expected). Only when both are positive.
  if (Number.isFinite(pe) && pe > 0 && Number.isFinite(peg) && peg > 0) {
    const g = Number((pe / peg).toFixed(2));
    if (Number.isFinite(g) && g > 0) {
      return { value: g, source: `Yahoo P/E ÷ PEG = ${peStr} ÷ ${pegStr} (~5-yr)` };
    }
  }

  // 2. Finviz EPS next 5Y (best-effort) — used when Yahoo has no usable PEG.
  const fv = await getFinvizGrowth(ticker);
  if (fv !== null && Number.isFinite(fv)) {
    return { value: Number(fv.toFixed(2)), source: `Finviz "EPS next 5Y" · Yahoo PEG ${pegStr}` };
  }

  // 3. Conservative default.
  return {
    value: DEFAULT_GROWTH,
    source: `conservative default (${DEFAULT_GROWTH}%) · Yahoo P/E ${peStr}, PEG ${pegStr}`,
  };
}
