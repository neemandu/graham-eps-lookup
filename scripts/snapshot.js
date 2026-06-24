// scripts/snapshot.js — entrypoint for the scheduled quarterly snapshot job.
//
// Run by the "Quarterly snapshot" GitHub Action (and runnable by hand):
//   node scripts/snapshot.js
//
// For every watchlist ticker, runSnapshots() analyzes it and appends a snapshot
// ONLY when a newly-reported quarter appears, so this is safe to run daily.
// SEC filing links are best-effort: we wrap sec.js's getFilings() into the
// { form, date, url } shape runSnapshots wants, and fall back to null on any
// failure so snapshots still record without a filing link.
//
// Exit code: 0 normally. Exits 1 only on TOTAL failure (every ticker errored),
// so the Action surfaces a broken run while a single bad ticker doesn't fail it.

import { runSnapshots } from '../lib/snapshot.js';
import { getFilings } from '../sec.js';

// Adapt sec.js -> the { form, date, url } | null shape runSnapshots expects.
// Any failure (missing module at runtime, network error, bad shape) -> null,
// so the snapshot still proceeds without a filing link.
async function getFilingsWrapper(ticker) {
  try {
    const r = await getFilings(ticker);
    const f = r?.filings?.[0];
    return f ? { form: f.form, date: f.filingDate, url: f.url } : null;
  } catch {
    return null;
  }
}

async function main() {
  const results = await runSnapshots({ getFilings: getFilingsWrapper });

  // One concise line per ticker, e.g. "ONDS  2026-Q1  added".
  for (const r of results) {
    const quarter = r.quarter || '—';
    const detail = r.error ? `  (${r.error})` : '';
    console.log(`${r.ticker.padEnd(6)}${String(quarter).padEnd(9)}${r.status}${detail}`);
  }

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(', ');
  console.log(`\nDone: ${results.length} ticker(s) — ${summary || 'nothing to do'}.`);

  // Total failure (every ticker errored) -> non-zero exit so the Action fails.
  const errored = counts.error || 0;
  if (results.length > 0 && errored === results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Snapshot run crashed:', err);
  process.exitCode = 1;
});
