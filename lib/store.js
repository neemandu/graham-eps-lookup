// lib/store.js
// JSON-in-the-repo persistence with two modes:
//
//   * GitHub mode (GITHUB_TOKEN set) — reads/writes via the GitHub Contents API.
//     Used by the live Vercel app so watchlist edits persist (each write is a
//     commit, which also triggers a redeploy). Reads use the API (not the raw
//     CDN) so they're immediately consistent after a write.
//
//   * Local mode (no token) — reads/writes plain files under the repo. Used in
//     local dev and inside the GitHub Action (which commits the files itself).
//
// Data layout:
//   data/watchlist.json        -> ["ONDS", "AAPL", ...]
//   data/history/<TICKER>.json -> [ { quarter, capturedAt, ... }, ... ]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const REPO = process.env.GITHUB_REPO || 'neemandu/graham-eps-lookup';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN || '';
const useGitHub = Boolean(TOKEN);

const WATCHLIST_PATH = 'data/watchlist.json';
const historyPath = (ticker) => `data/history/${ticker.toUpperCase()}.json`;

// ---- GitHub Contents API helpers -------------------------------------------

async function ghRead(repoPath) {
  const url = `https://api.github.com/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'graham-value-app',
    },
  });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub read ${repoPath} failed: HTTP ${res.status}`);
  const json = await res.json();
  const text = Buffer.from(json.content, 'base64').toString('utf8');
  return { data: JSON.parse(text), sha: json.sha };
}

async function ghWrite(repoPath, value, message) {
  const { sha } = await ghRead(repoPath); // current sha (null if new)
  const url = `https://api.github.com/repos/${REPO}/contents/${repoPath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'graham-value-app',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub write ${repoPath} failed: HTTP ${res.status} ${body}`);
  }
}

// ---- Local file helpers ----------------------------------------------------

async function localRead(repoPath) {
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, repoPath), 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function localWrite(repoPath, value) {
  const full = path.join(REPO_ROOT, repoPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(value, null, 2) + '\n');
}

// ---- Public API ------------------------------------------------------------

async function read(repoPath, fallback) {
  const data = useGitHub ? (await ghRead(repoPath)).data : await localRead(repoPath);
  return data === null ? fallback : data;
}

async function write(repoPath, value, message) {
  if (useGitHub) return ghWrite(repoPath, value, message);
  return localWrite(repoPath, value);
}

export const storeMode = useGitHub ? 'github' : 'local';

export async function getWatchlist() {
  const list = await read(WATCHLIST_PATH, []);
  return Array.isArray(list) ? list.map((t) => String(t).toUpperCase()) : [];
}

export async function saveWatchlist(list) {
  const clean = [...new Set(list.map((t) => String(t).trim().toUpperCase()))].filter(Boolean);
  await write(WATCHLIST_PATH, clean, `chore: update watchlist (${clean.length} tickers)`);
  return clean;
}

export async function getHistory(ticker) {
  const arr = await read(historyPath(ticker), []);
  return Array.isArray(arr) ? arr : [];
}

export async function saveHistory(ticker, arr) {
  await write(historyPath(ticker), arr, `data: update ${ticker.toUpperCase()} history`);
}

// Append a snapshot only if that quarter isn't already recorded. Returns the
// snapshot if added, or null if the quarter was already present.
export async function appendSnapshot(ticker, snapshot) {
  const history = await getHistory(ticker);
  if (snapshot.quarter && history.some((s) => s.quarter === snapshot.quarter)) {
    return null;
  }
  history.push(snapshot);
  history.sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)));
  await write(
    historyPath(ticker),
    history,
    `data: snapshot ${ticker.toUpperCase()} ${snapshot.quarter || ''}`.trim()
  );
  return snapshot;
}
