// api/summary.js — AI summary of a company's quarterly reports.
//   GET /api/summary?ticker=ONDS -> { ticker, model, summary }
//
// Sends the deterministic per-quarter metrics (from lib/financials.js) to Claude
// and asks for a trend narrative across the six focus areas. Needs an
// ANTHROPIC_API_KEY env var; without it the table still works, this returns 503.

import Anthropic from '@anthropic-ai/sdk';
import { getFinancials } from '../lib/financials.js';
import { TICKER_RE } from '../analyze.js';

const MODEL = 'claude-haiku-4-5';
const cache = new Map();
const TTL_MS = 30 * 60 * 1000;

const SYSTEM =
  'You are a value-investing analyst in the Benjamin Graham tradition, summarizing ' +
  "a company's quarterly reports for an investor. Be concise, concrete, and honest — " +
  'call out both strengths and red flags. Ground every claim in the numbers given; do ' +
  'not invent figures. Respond ONLY with the summary in GitHub-flavored markdown — no ' +
  "preamble (no 'Here is'), no closing remarks, and no reasoning or meta-commentary.";

function buildPrompt(ticker, quarters) {
  const fmt = (n, money) =>
    n == null
      ? 'n/a'
      : money
      ? Math.abs(n) >= 1e9
        ? `$${(n / 1e9).toFixed(2)}B`
        : `$${(n / 1e6).toFixed(1)}M`
      : n;
  const rows = quarters
    .map(
      (q) =>
        `${q.quarter}: EPS ${fmt(q.eps)}, Revenue ${fmt(q.revenue, true)}` +
        `${q.revenueYoY != null ? ` (YoY ${(q.revenueYoY * 100).toFixed(0)}%)` : ''}, ` +
        `BVPS ${fmt(q.bvps)}, CurrentRatio ${q.currentRatio ?? 'n/a'}, ` +
        `Debt/Equity ${q.debtToEquity ?? 'n/a'}, OperatingCashFlow ${fmt(q.operatingCashFlow, true)}`
    )
    .join('\n');

  return `Summarize the quarterly reports for ${ticker}. Per-quarter figures (oldest to newest), all from SEC filings:

${rows}

Write a short summary (about 180-260 words) covering each of these, emphasizing the trend ACROSS the quarters, not just the latest value:

1. **EPS** — is it volatile, steadily rising, or declining? (income statement)
2. **Revenue** — focus on year-over-year growth (same quarter vs a year earlier). (income statement)
3. **Book value per share (BVPS)** — what is the trend? (balance sheet)
4. **Current ratio** — health: ≥2 is strong, 1–2 is adequate, <1 is a concern. (balance sheet)
5. **Debt/Equity** — <1 is conservative, 1–1.2 is moderate, >1.2 is high. (balance sheet)
6. **Operating cash flow** — must be positive and ideally growing; positive cash flow corroborates reported profits (not an accounting illusion), negative is a warning. (cash-flow statement)

Use a short bolded label per point. End with a one-line overall takeaway. If a metric is "n/a", say it isn't available rather than guessing.`;
}

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:
        'AI summary is not configured. Set an ANTHROPIC_API_KEY on the server to enable it (the metrics table works without it).',
    });
  }
  try {
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < TTL_MS) return res.status(200).json(hit.data);

    const fin = await getFinancials(ticker);
    if (!fin.cik || !fin.quarters.length) {
      return res.status(404).json({ error: 'No SEC financial data for this ticker (non-US?).' });
    }
    const recent = fin.quarters.slice(-12);

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(ticker, recent) }],
    });
    const summary = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const data = { ticker, model: MODEL, summary };
    cache.set(ticker, { at: Date.now(), data });
    res.status(200).json(data);
  } catch (err) {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err?.message || 'AI summary failed.' });
  }
}
