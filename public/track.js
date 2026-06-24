// track.js — Tracking dashboard front-end.
// Manages a watchlist (add/remove) and renders, per tracked stock, the current
// live Graham analysis plus a table of recorded quarterly snapshots.

const addForm = document.getElementById('add-form');
const addBtn = document.getElementById('add-btn');
const tickerInput = document.getElementById('track-ticker');
const statusEl = document.getElementById('track-status');
const stocksEl = document.getElementById('stocks');
const emptyWatchlistEl = document.getElementById('empty-watchlist');

// Live Chart.js instances, so we can resize them when the tab becomes visible
// and destroy them before re-rendering the watchlist.
const charts = [];
function destroyCharts() {
  while (charts.length) {
    try {
      charts.pop().destroy();
    } catch {
      /* ignore */
    }
  }
}
window.resizeTrackingCharts = () => charts.forEach((c) => c.resize());

// ── Formatting helpers (same style as app.js) ───────────────────────────────

function showStatus(message, kind = 'loading') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}
function hideStatus() {
  statusEl.hidden = true;
}

function fmtMoney(n, currency = 'USD') {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${Number(n).toFixed(2)} ${currency}`;
  }
}
function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}

// Escape user/remote text before inserting it as HTML.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Watchlist API ───────────────────────────────────────────────────────────

async function getWatchlist() {
  const res = await fetch('/api/watchlist');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data.watchlist || [];
}

async function addTicker(ticker) {
  const res = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data.watchlist || [];
}

async function removeTicker(ticker) {
  const res = await fetch(
    `/api/watchlist?ticker=${encodeURIComponent(ticker)}`,
    { method: 'DELETE' }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data.watchlist || [];
}

// ── Rendering ───────────────────────────────────────────────────────────────

// Build the whole list of stock cards from a watchlist array, then load each
// stock's live + history data independently so one failure can't blank the page.
function renderWatchlist(watchlist) {
  destroyCharts();
  stocksEl.innerHTML = '';
  emptyWatchlistEl.hidden = watchlist.length > 0;

  for (const ticker of watchlist) {
    const card = document.createElement('div');
    card.className = 'card stock-card';
    card.id = `stock-${ticker}`;
    card.innerHTML = `
      <div class="stock-head">
        <div class="stock-title">
          <h2>${esc(ticker)}</h2>
          <span class="muted small" data-role="name">Loading…</span>
        </div>
        <div class="stock-head-right">
          <span class="verdict" data-role="verdict" hidden></span>
          <button class="remove-btn" type="button" title="Stop tracking ${esc(
            ticker
          )}" aria-label="Stop tracking ${esc(ticker)}">&times;</button>
        </div>
      </div>

      <div class="grid" data-role="stats" hidden>
        <div class="stat">
          <span class="stat-label">Current price</span>
          <span class="stat-value" data-role="price">—</span>
        </div>
        <div class="stat highlight">
          <span class="stat-label">Graham intrinsic value</span>
          <span class="stat-value" data-role="value">—</span>
        </div>
        <div class="stat">
          <span class="stat-label">Margin of safety</span>
          <span class="stat-value" data-role="margin">—</span>
        </div>
        <div class="stat">
          <span class="stat-label">Checklist</span>
          <span class="stat-value" data-role="criteria">—</span>
        </div>
      </div>

      <p class="stock-status" data-role="status">Loading live data…</p>

      <h3 class="history-head">Quarterly history</h3>
      <div data-role="history"></div>
    `;

    // Wire up the remove ("×") control.
    card
      .querySelector('.remove-btn')
      .addEventListener('click', () => onRemove(ticker));

    stocksEl.appendChild(card);

    // Kick off the per-ticker loads (don't await — let them resolve in parallel).
    loadAnalysis(ticker, card);
    loadHistory(ticker, card);
  }
}

// Fetch live /api/analyze for one ticker and paint its current-value section.
async function loadAnalysis(ticker, card) {
  const set = (role) => card.querySelector(`[data-role="${role}"]`);
  try {
    const res = await fetch(
      `/api/analyze?ticker=${encodeURIComponent(ticker)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    const { stock, graham, criteria } = data;
    const cur = (stock && stock.currency) || 'USD';

    // Company name + exchange.
    const nameBits = [stock.name, stock.exchange].filter(Boolean);
    set('name').textContent = nameBits.join(' · ') || ticker;

    // Stat values.
    set('price').textContent = fmtMoney(stock.price, cur);
    set('value').textContent = fmtMoney(graham.intrinsicValue, cur);
    set('margin').textContent = fmtPct(graham.marginOfSafety);
    set('criteria').textContent =
      criteria && criteria.total != null
        ? `${criteria.passed} / ${criteria.total}`
        : '—';

    // Verdict badge — reuse the shared .verdict styles.
    const verdictEl = set('verdict');
    const margin = graham.marginOfSafety;
    if (margin === null || margin === undefined || Number.isNaN(margin)) {
      verdictEl.hidden = true;
    } else {
      const under = margin > 0;
      verdictEl.hidden = false;
      verdictEl.textContent = under
        ? 'Undervalued vs Graham'
        : 'Overvalued vs Graham';
      verdictEl.className = `verdict ${under ? 'under' : 'over'}`;
    }

    // "Next report" pill, if we know the date.
    if (stock.nextEarningsDate) {
      const pill = document.createElement('span');
      pill.className = 'next-report';
      pill.textContent = `Next report: ${stock.nextEarningsDate}`;
      // Place it before the verdict in the header-right group.
      card.querySelector('.stock-head-right').prepend(pill);
    }

    set('stats').hidden = false;
    set('status').hidden = true; // analysis loaded fine; hide the loading line
  } catch (err) {
    const statusLine = set('status');
    statusLine.hidden = false;
    statusLine.className = 'stock-status error';
    statusLine.textContent = `Couldn't load live data: ${
      err.message || 'request failed.'
    }`;
  }
}

// Fetch /api/history?ticker=… for one ticker and render its snapshot table.
async function loadHistory(ticker, card) {
  const container = card.querySelector('[data-role="history"]');
  container.innerHTML = '<p class="stock-status">Loading history…</p>';
  try {
    const res = await fetch(
      `/api/history?ticker=${encodeURIComponent(ticker)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    const history = Array.isArray(data.history) ? data.history : [];
    container.innerHTML = renderHistory(history);

    // Build the price-vs-Graham-value chart, if there's anything to plot.
    const canvas = container.querySelector('canvas');
    if (canvas && window.Chart) buildChart(canvas, history);
  } catch (err) {
    container.innerHTML = `<p class="stock-status error">Couldn't load history: ${esc(
      err.message || 'request failed.'
    )}</p>`;
  }
}

// Line chart: price vs Graham value across quarters (oldest → newest).
function buildChart(canvas, history) {
  const labels = history.map((s) => s.quarter || s.quarterEnd || '');
  const price = history.map((s) => (typeof s.price === 'number' ? s.price : null));
  const value = history.map((s) =>
    typeof s.intrinsicValue === 'number' ? s.intrinsicValue : null
  );

  const TEXT = '#9aa0ab';
  const GRID = 'rgba(255,255,255,0.06)';

  const chart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Price',
          data: price,
          borderColor: '#5aa9ff',
          backgroundColor: 'rgba(90,169,255,0.12)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.25,
          spanGaps: true,
          fill: true,
        },
        {
          label: 'Graham value',
          data: value,
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46,204,113,0.10)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.25,
          spanGaps: false, // leave gaps where the value is N/A
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: TEXT, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.parsed.y == null
                ? `${ctx.dataset.label}: N/A`
                : `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: TEXT, maxRotation: 0, autoSkip: true }, grid: { color: GRID } },
        y: {
          ticks: { color: TEXT, callback: (v) => '$' + v },
          grid: { color: GRID },
        },
      },
    },
  });
  charts.push(chart);
}

// Return HTML for the history section: either a friendly empty state or a table.
// Two valuation bases coexist: the current quarter uses the live Graham *formula*
// (with analyst growth); backfilled historical quarters use the Graham *Number*
// √(22.5·EPS·BVPS), which needs no growth. Shown newest → oldest.
function renderHistory(history) {
  if (!history.length) {
    return (
      '<p class="no-snapshots">No snapshots recorded yet — the first one ' +
      'will appear after the next quarterly report.</p>'
    );
  }

  const isGN = (s) => s.method === 'Graham Number';

  // Value cell: distinguish "not meaningful" (Graham Number needs EPS & book
  // value > 0) from genuinely missing data.
  const valueCell = (s, cur) => {
    if (s.intrinsicValue === null || s.intrinsicValue === undefined) {
      return isGN(s)
        ? '<span class="muted" title="Graham Number needs positive EPS and book value">N/A</span>'
        : '—';
    }
    return fmtMoney(s.intrinsicValue, cur);
  };

  // Chart canvas (built after insertion in loadHistory). Shown when we have at
  // least one plottable price or value point.
  const plottable = history.some(
    (s) => typeof s.price === 'number' || typeof s.intrinsicValue === 'number'
  );
  const chart = plottable
    ? '<div class="chart-wrap"><canvas></canvas></div>'
    : '';

  const ordered = history.slice().reverse(); // newest first

  const rows = ordered
    .map((s) => {
      const cur = s.currency || 'USD';
      const filing =
        s.filing && s.filing.url
          ? `<a href="${esc(s.filing.url)}" target="_blank" rel="noopener">${esc(
              s.filing.form || 'Filing'
            )}</a>`
          : '—';
      const checklist =
        s.criteriaPassed != null && s.criteriaTotal != null
          ? `${s.criteriaPassed} / ${s.criteriaTotal}`
          : '—';
      const basis = isGN(s)
        ? '<span class="basis gn">Graham Nº</span>'
        : '<span class="basis gf">Formula</span>';
      return `
        <tr>
          <td>${esc(s.quarter || s.quarterEnd || '—')}</td>
          <td>${fmtMoney(s.eps, cur)}</td>
          <td>${valueCell(s, cur)}</td>
          <td>${basis}</td>
          <td>${fmtMoney(s.price, cur)}</td>
          <td>${fmtPct(s.marginOfSafety)}</td>
          <td>${fmtNum(s.growth, 1)}</td>
          <td>${fmtNum(s.bondYield, 2)}</td>
          <td>${checklist}</td>
          <td>${filing}</td>
        </tr>`;
    })
    .join('');

  return `
    ${chart}
    <div class="history-wrap">
      <table class="history">
        <thead>
          <tr>
            <th>Quarter</th>
            <th>EPS (TTM)</th>
            <th>Value</th>
            <th>Basis</th>
            <th>Price</th>
            <th>Margin</th>
            <th>g (%)</th>
            <th>Y (%)</th>
            <th>Checklist</th>
            <th>Filing</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="history-note muted small">
      <strong>Basis:</strong> the current quarter uses the live Graham formula
      V = EPS×(8.5+2g)×4.4/Y; historical quarters use the Graham Number
      √(22.5×EPS×BVPS), which needs no growth estimate (N/A when EPS or book
      value isn't positive). Historical EPS &amp; filings from SEC EDGAR, prices
      from Yahoo.
    </p>`;
}

// ── Event handlers ──────────────────────────────────────────────────────────

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticker = tickerInput.value.trim().toUpperCase();
  if (!ticker) return;

  addBtn.disabled = true;
  showStatus(`Adding ${ticker}…`, 'loading');
  try {
    const watchlist = await addTicker(ticker);
    tickerInput.value = '';
    hideStatus();
    renderWatchlist(watchlist);
  } catch (err) {
    showStatus(err.message || 'Could not add ticker.', 'error');
  } finally {
    addBtn.disabled = false;
  }
});

async function onRemove(ticker) {
  showStatus(`Removing ${ticker}…`, 'loading');
  try {
    const watchlist = await removeTicker(ticker);
    hideStatus();
    renderWatchlist(watchlist);
  } catch (err) {
    showStatus(err.message || 'Could not remove ticker.', 'error');
  }
}

// ── Initial load ────────────────────────────────────────────────────────────
// Exposed so the tab controller can lazily initialise the Tracking tab the first
// time it's opened (avoids fetching data / sizing charts while hidden).

let started = false;
window.initTracking = async function initTracking() {
  if (started) return;
  started = true;
  showStatus('Loading watchlist…', 'loading');
  try {
    const watchlist = await getWatchlist();
    hideStatus();
    renderWatchlist(watchlist);
  } catch (err) {
    showStatus(err.message || 'Could not load watchlist.', 'error');
  }
};
