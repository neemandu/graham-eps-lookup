// sec.js
// Resolves a US stock ticker to its recent SEC EDGAR filings (10-Q and 10-K).
// These are the "quarterly publication" links shown by the Graham tracker so a
// user can jump straight to the source documents behind the numbers.
//
// Two EDGAR endpoints are used:
//   1. company_tickers.json  -> maps a ticker to its CIK (company id). It's ~1MB,
//      so we download it once and keep it in a module-level cache.
//   2. submissions/CIK#.json -> the company's filing history, as parallel arrays
//      (form[i], filingDate[i], ... all describe the same filing).
//
// SEC requires a descriptive User-Agent with a contact email on every request,
// otherwise it answers 403. Each request also gets a 6s AbortController timeout.

const USER_AGENT = 'Graham Value App neemandu@gmail.com';
const REQUEST_TIMEOUT_MS = 6000;
const SUBMISSIONS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — filings change infrequently
const MAX_FILINGS = 8;
const WANTED_FORMS = new Set(['10-Q', '10-K']);

let tickerMap = null;            // { ONDS: "0001646188", ... } once loaded
let tickerMapPromise = null;     // in-flight load, so concurrent calls share it
const submissionsCache = new Map(); // cik -> { data, at }

// fetch + JSON with the required UA header and a hard timeout.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Load (once) the full ticker->CIK map. Keys are upper-cased tickers, values are
// the 10-digit zero-padded CIK strings used by the submissions endpoint.
async function loadTickerMap() {
  if (tickerMap) return tickerMap;
  if (tickerMapPromise) return tickerMapPromise;

  tickerMapPromise = (async () => {
    const raw = await fetchJson('https://www.sec.gov/files/company_tickers.json');
    const map = {};
    for (const key of Object.keys(raw)) {
      const entry = raw[key];
      if (entry?.ticker && entry?.cik_str != null) {
        map[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, '0');
      }
    }
    tickerMap = map;
    return map;
  })();

  try {
    return await tickerMapPromise;
  } finally {
    tickerMapPromise = null; // allow a retry if the load failed
  }
}

// Get a company's submissions JSON, cached per-CIK for SUBMISSIONS_TTL_MS.
async function loadSubmissions(cik) {
  const cached = submissionsCache.get(cik);
  if (cached && Date.now() - cached.at < SUBMISSIONS_TTL_MS) return cached.data;

  const data = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  submissionsCache.set(cik, { data, at: Date.now() });
  return data;
}

/**
 * Return recent 10-Q and 10-K filing links for a US stock ticker.
 *
 * @param {string} ticker e.g. "ONDS"
 * @returns {Promise<{cik: string|null, filings: Array<{
 *   form: string, filingDate: string, reportDate: string,
 *   url: string, indexUrl: string }>}>}
 *
 * cik is the 10-digit zero-padded CIK, or null if the ticker isn't in EDGAR
 * (e.g. a non-US listing). Never throws for "not found" — returns empty filings.
 */
export async function getFilings(ticker) {
  const symbol = String(ticker || '').trim().toUpperCase();
  if (!symbol) return { cik: null, filings: [] };

  // Ticker -> CIK. If the map fails to load we can't resolve anything.
  let map;
  try {
    map = await loadTickerMap();
  } catch {
    return { cik: null, filings: [] };
  }

  const cik = map[symbol];
  if (!cik) return { cik: null, filings: [] }; // not a US-listed EDGAR filer

  // CIK -> filings. A network error or 404 here still yields a valid (empty) shape.
  let submissions;
  try {
    submissions = await loadSubmissions(cik);
  } catch {
    return { cik, filings: [] };
  }

  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return { cik, filings: [] };

  const cikNoPad = String(parseInt(cik, 10)); // Archives path uses CIK without zeros
  const filings = [];

  // The recent.* arrays are parallel and already ordered newest-first.
  for (let i = 0; i < recent.form.length && filings.length < MAX_FILINGS; i++) {
    const form = recent.form[i];
    if (!WANTED_FORMS.has(form)) continue;

    const accession = recent.accessionNumber[i];      // "0001213900-24-012345"
    const primaryDoc = recent.primaryDocument[i] || '';
    if (!accession) continue;

    const accNoDashes = accession.replace(/-/g, '');
    const base = `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accNoDashes}`;

    filings.push({
      form,
      filingDate: recent.filingDate[i] || '',
      reportDate: recent.reportDate[i] || '',
      url: primaryDoc ? `${base}/${primaryDoc}` : `${base}/${accession}-index.htm`,
      indexUrl: `${base}/${accession}-index.htm`,
    });
  }

  return { cik, filings };
}
