// yahoo.js
// Minimal Yahoo Finance client that behaves like a real browser session:
//   1. Grab a session cookie (consent)         -> like loading the site
//   2. Exchange the cookie for a "crumb" token  -> what Yahoo's own JS does
//   3. Call the quote API with cookie + crumb    -> returns EPS (TTM) etc.
//
// We cache the cookie/crumb so we don't re-handshake on every request, send
// realistic browser headers, and add small randomized delays. This keeps the
// traffic pattern close to a human using the website.

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
};

// Session is cached for this long, then refreshed (Yahoo crumbs are short-lived
// but comfortably last well beyond this window).
const SESSION_TTL_MS = 25 * 60 * 1000; // 25 minutes

let session = null; // { cookie, crumb, createdAt }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(min + Math.random() * (max - min));

function joinCookies(setCookieArray) {
  // Turn ["A=1; Path=/", "B=2; Secure"] into "A=1; B=2"
  return (setCookieArray || [])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function establishSession() {
  // Step 1: hit Yahoo to receive a session cookie. fc.yahoo.com returns 404 but
  // still sets the cookie we need; if it ever fails we fall back to the homepage.
  let cookie = '';
  try {
    const res = await fetch('https://fc.yahoo.com', {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    cookie = joinCookies(res.headers.getSetCookie?.());
  } catch {
    /* ignore, try fallback below */
  }

  if (!cookie) {
    const res = await fetch('https://finance.yahoo.com', { headers: BROWSER_HEADERS });
    cookie = joinCookies(res.headers.getSetCookie?.());
  }

  await sleep(jitter(150, 500)); // small human-like pause

  // Step 2: exchange cookie for a crumb token.
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      ...BROWSER_HEADERS,
      Accept: '*/*',
      Referer: 'https://finance.yahoo.com/',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const crumb = (await crumbRes.text()).trim();

  if (!crumb || crumb.length > 40 || crumb.includes('<')) {
    throw new Error('Could not obtain a Yahoo session crumb.');
  }

  session = { cookie, crumb, createdAt: Date.now() };
  return session;
}

async function getSession(forceRefresh = false) {
  const fresh =
    session && !forceRefresh && Date.now() - session.createdAt < SESSION_TTL_MS;
  if (fresh) return session;
  return establishSession();
}

/**
 * Fetch a quote for a single ticker. Returns the raw Yahoo quote object.
 * Retries once with a fresh session if the crumb was rejected.
 */
async function fetchQuote(symbol, attempt = 0) {
  const { cookie, crumb } = await getSession(attempt > 0);

  await sleep(jitter(100, 400)); // gentle pacing

  const url =
    `https://query2.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: 'application/json',
      Referer: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
      Origin: 'https://finance.yahoo.com',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  // Crumb expired / unauthorized -> refresh once and retry.
  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    return fetchQuote(symbol, 1);
  }

  if (!res.ok) {
    throw new Error(`Yahoo returned HTTP ${res.status} for ${symbol}.`);
  }

  const data = await res.json();
  const result = data?.quoteResponse?.result;
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(`No data found for "${symbol}". Check the ticker symbol.`);
  }
  return result[0];
}

/**
 * Fetch one or more quoteSummary modules (deeper data: key stats, financials,
 * analyst earnings trend, etc.). Same session/retry handling as fetchQuote.
 */
async function fetchSummary(symbol, modules, attempt = 0) {
  const { cookie, crumb } = await getSession(attempt > 0);

  await sleep(jitter(100, 400));

  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${modules.join(',')}&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: 'application/json',
      Referer: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
      Origin: 'https://finance.yahoo.com',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    return fetchSummary(symbol, modules, 1);
  }
  if (!res.ok) {
    throw new Error(`Yahoo returned HTTP ${res.status} for ${symbol}.`);
  }

  const data = await res.json();
  const result = data?.quoteSummary?.result;
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(`No summary data found for "${symbol}".`);
  }
  return result[0];
}

// Pull a usable annual growth estimate (as a percent) from the earningsTrend
// module. Yahoo dropped the long-term "+5y" figure, so we prefer next-year,
// then current-year, then next-quarter as fallbacks.
function extractGrowth(earningsTrend) {
  const trend = earningsTrend?.trend || [];
  const byPeriod = {};
  for (const t of trend) byPeriod[t.period] = t?.growth?.raw;

  const order = [
    ['+5y', '5-year analyst estimate'],
    ['+1y', 'next-year analyst estimate'],
    ['0y', 'current-year analyst estimate'],
    ['+1q', 'next-quarter analyst estimate'],
  ];
  for (const [period, label] of order) {
    const v = byPeriod[period];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { rate: Number((v * 100).toFixed(2)), source: `Yahoo ${label}` };
    }
  }
  return { rate: null, source: null };
}

const num = (o) => (o && typeof o.raw === 'number' ? o.raw : null);

/**
 * Simple lookup (used by /api/eps): just the headline fields.
 */
export async function getStockData(symbol) {
  const q = await fetchQuote(symbol.trim().toUpperCase());
  return {
    symbol: q.symbol,
    name: q.longName || q.shortName || q.symbol,
    currency: q.currency || 'USD',
    price: q.regularMarketPrice ?? null,
    epsTTM: q.epsTrailingTwelveMonths ?? null,
    peTTM: q.trailingPE ?? null,
    marketState: q.marketState || null,
    exchange: q.fullExchangeName || q.exchange || null,
  };
}

/**
 * Raw quote result for a symbol (used e.g. for ^TNX treasury yield).
 */
export async function getQuoteRaw(symbol) {
  return fetchQuote(symbol.trim().toUpperCase());
}

/**
 * Rich data set for the Graham analysis: headline numbers + the inputs for the
 * defensive-investor checklist + an auto growth estimate.
 */
export async function getFullStockData(symbol) {
  const sym = symbol.trim().toUpperCase();
  const q = await fetchQuote(sym);
  const s = await fetchSummary(sym, [
    'defaultKeyStatistics',
    'financialData',
    'summaryDetail',
    'earningsTrend',
    'calendarEvents',
  ]);

  const ks = s.defaultKeyStatistics || {};
  const fd = s.financialData || {};
  const sd = s.summaryDetail || {};
  const fdate = (o) => (o && typeof o.fmt === 'string' ? o.fmt : null);

  return {
    symbol: q.symbol,
    name: q.longName || q.shortName || q.symbol,
    currency: q.currency || 'USD',
    exchange: q.fullExchangeName || q.exchange || null,
    marketState: q.marketState || null,
    price: q.regularMarketPrice ?? null,
    marketCap: q.marketCap ?? null,

    epsTTM: q.epsTrailingTwelveMonths ?? num(ks.trailingEps),
    forwardEps: num(ks.forwardEps),
    bookValue: num(ks.bookValue),
    priceToBook: num(ks.priceToBook),
    trailingPE: q.trailingPE ?? num(sd.trailingPE),

    currentRatio: num(fd.currentRatio),
    debtToEquity: num(fd.debtToEquity), // Yahoo expresses this as a percent
    totalDebt: num(fd.totalDebt),
    totalCash: num(fd.totalCash),

    dividendRate: num(sd.dividendRate),
    dividendYield: num(sd.dividendYield),

    // Reporting calendar — used to detect when a new quarter is published.
    mostRecentQuarter: fdate(ks.mostRecentQuarter), // e.g. "2026-03-31"
    lastFiscalYearEnd: fdate(ks.lastFiscalYearEnd),
    nextEarningsDate: fdate(s.calendarEvents?.earnings?.earningsDate?.[0]),

    growthEstimate: extractGrowth(s.earningsTrend), // { rate, source }
  };
}
