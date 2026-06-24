// analyze.js
// Shared analysis used by both the Vercel function (api/analyze.js) and the
// local Express server (server.js). Pulls Yahoo data, resolves the growth (g)
// and bond-yield (Y) inputs (auto unless the caller overrides them), runs the
// Graham value + defensive checklist, and returns one payload.

import { getFullStockData } from './yahoo.js';
import { getAaaYield } from './fred.js';
import { resolveGrowth } from './growth.js';
import { calculateGrahamValue, marginOfSafety, defensiveCriteria } from './graham.js';

export const TICKER_RE = /^[A-Za-z.\-]{1,12}$/;

const provided = (v) => v !== undefined && v !== '' && Number.isFinite(Number(v));

export async function analyzeTicker(ticker, opts = {}) {
  const stock = await getFullStockData(ticker);

  // Bond yield Y — manual override, else FRED fallback chain.
  let bondYield;
  if (provided(opts.bondYield)) {
    bondYield = { value: Number(opts.bondYield), source: 'manual input', auto: false };
  } else {
    const f = await getAaaYield();
    bondYield = { value: f.value, source: f.source, auto: true };
  }

  // Growth g — manual override, else the resolver chain (P/E÷PEG → Finviz → 15%).
  let growth;
  if (provided(opts.growth)) {
    growth = { value: Number(opts.growth), source: 'manual input', auto: false };
  } else {
    const g = await resolveGrowth(stock, stock.symbol);
    growth = { value: g.value, source: g.source, auto: true };
  }

  const result = calculateGrahamValue({
    eps: stock.epsTTM,
    growthRate: growth.value,
    bondYield: bondYield.value,
  });
  const margin = marginOfSafety(result.value, stock.price);

  return {
    stock,
    growth,
    bondYield,
    graham: {
      intrinsicValue: result.value,
      usedBondAdjustment: result.usedBondAdjustment,
      warnings: result.warnings,
      marginOfSafety: margin,
      verdict:
        margin === null
          ? null
          : margin > 0
          ? 'Undervalued vs Graham'
          : 'Overvalued vs Graham',
    },
    criteria: defensiveCriteria(stock),
  };
}
