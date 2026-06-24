// api/snapshot.js — manual trigger for the quarterly snapshot job.
//   GET/POST /api/snapshot[?key=SECRET] -> { results }
//
// Runs the same runSnapshots() used by the scheduled Action. On Vercel a
// GITHUB_TOKEN is configured, so this writes snapshots via the GitHub API
// (GITHUB mode); locally it writes files under data/.
//
// Optional protection: if SNAPSHOT_KEY is set, the request must carry a matching
// ?key=...; otherwise (no env var) the request is allowed for dev convenience.

import { runSnapshots } from '../lib/snapshot.js';
import { getFilings } from '../sec.js';

// Adapt sec.js -> the { form, date, url } | null shape runSnapshots wants;
// any failure yields null so snapshots still record without a filing link.
async function getFilingsWrapper(ticker) {
  try {
    const r = await getFilings(ticker);
    const f = r?.filings?.[0];
    return f ? { form: f.form, date: f.filingDate, url: f.url } : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const key = process.env.SNAPSHOT_KEY;
  if (key && req.query.key !== key) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const results = await runSnapshots({ getFilings: getFilingsWrapper });
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Snapshot run failed.' });
  }
}
