// app.js — single-page Graham analyzer.
// Search a ticker → show its quarterly history (chart / table, right under the
// search) plus the live Graham analysis, assumptions, and defensive checklist.
// A small watchlist of quick-access chips persists tracked tickers.

const form = document.getElementById('form');
const submitBtn = document.getElementById('submit');
const tickerInput = document.getElementById('ticker');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const $ = (id) => document.getElementById(id);

// Held so we can recompute the headline value when g / Y change, and so the
// track toggle knows what's on screen.
let current = null; // { eps, price, currency, ticker }
let chart = null; // active Chart.js instance

// ── Formatting ──────────────────────────────────────────────────────────────
function showStatus(message, kind = 'loading') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
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
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Search / analyze ─────────────────────────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  analyze(tickerInput.value.trim());
});

async function analyze(ticker) {
  if (!ticker) return;
  ticker = ticker.toUpperCase();
  tickerInput.value = ticker;

  submitBtn.disabled = true;
  resultEl.hidden = true;
  showStatus(`Analyzing ${ticker}…`, 'loading');

  // Live analysis and the historical series load in parallel.
  const analysisP = fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`).then((r) =>
    r.json().then((d) => ({ ok: r.ok, status: r.status, d }))
  );
  const seriesP = fetch(`/api/series?ticker=${encodeURIComponent(ticker)}`)
    .then((r) => (r.ok ? r.json() : { series: [] }))
    .catch(() => ({ series: [] }));

  try {
    const { ok, status, d } = await analysisP;
    if (!ok) throw new Error(d.error || `Request failed (${status}).`);

    renderAnalysis(d);
    statusEl.hidden = true;
    resultEl.hidden = false;

    const series = (await seriesP).series || [];
    renderHistory(series, d.stock.currency || 'USD');
    refreshTrackToggle(ticker);
  } catch (err) {
    showStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

function renderAnalysis(data) {
  const { stock, graham, growth, bondYield, criteria } = data;
  const cur = stock.currency || 'USD';
  current = { eps: stock.epsTTM, price: stock.price, currency: cur, ticker: stock.symbol };

  $('hist-title').textContent = `${stock.symbol} — quarterly history`;
  $('r-name').textContent = `${stock.name} (${stock.symbol})`;
  $('r-meta').textContent = [stock.exchange, stock.nextEarningsDate ? `next report ${stock.nextEarningsDate}` : null]
    .filter(Boolean)
    .join(' · ');

  $('r-eps').textContent = stock.epsTTM === null ? '—' : fmtMoney(stock.epsTTM, cur);
  $('r-price').textContent = fmtMoney(stock.price, cur);
  paintValue(graham.intrinsicValue, graham.marginOfSafety, cur);

  $('growth').value = growth.value;
  $('bondYield').value = bondYield.value;
  $('growth-src').textContent = growth.source || '';
  $('bond-src').textContent = bondYield.source || '';

  const warnEl = $('r-warnings');
  if (graham.warnings && graham.warnings.length) {
    warnEl.textContent = graham.warnings.join(' ');
    warnEl.hidden = false;
  } else warnEl.hidden = true;

  renderChecklist(criteria, cur);
}

function paintValue(value, margin, currency) {
  $('r-value').textContent = value === null ? '—' : fmtMoney(value, currency);
  $('r-margin').textContent = fmtPct(margin);
  const v = $('r-verdict');
  if (margin === null || margin === undefined || Number.isNaN(margin)) {
    v.hidden = true;
  } else {
    const under = margin > 0;
    v.hidden = false;
    v.textContent = under ? 'Undervalued vs Graham' : 'Overvalued vs Graham';
    v.className = `verdict ${under ? 'under' : 'over'}`;
  }
}

function renderChecklist(criteria, currency) {
  const ul = $('r-checklist');
  ul.innerHTML = '';
  for (const c of criteria.list) {
    const li = document.createElement('li');
    const state = c.pass === null ? 'unknown' : c.pass ? 'pass' : 'fail';
    const icon = state === 'pass' ? '✓' : state === 'fail' ? '✕' : '–';
    li.className = `check ${state}`;
    li.innerHTML =
      `<span class="check-icon">${icon}</span>` +
      `<span class="check-label">${esc(c.label)}</span>` +
      `<span class="check-value">${formatCriterion(c, currency)}</span>` +
      `<span class="check-threshold muted">${esc(c.threshold)}</span>`;
    ul.appendChild(li);
  }
  $('r-score').textContent = `${criteria.passed} / ${criteria.total} passed`;
}
function formatCriterion(c, currency) {
  if (c.value === null || c.value === undefined) return '—';
  switch (c.key) {
    case 'size': return `$${fmtNum(c.value / 1e9, 2)}B`;
    case 'debt': return `${fmtNum(c.value, 1)}%`;
    case 'earnings': return fmtMoney(c.value, currency);
    case 'dividend': return c.value > 0 ? fmtMoney(c.value, currency) : 'none';
    default: return fmtNum(c.value, 2);
  }
}

// Recompute headline value locally when the user edits g or Y.
$('recalc').addEventListener('click', () => {
  if (!current) return;
  const g = parseFloat($('growth').value);
  const y = parseFloat($('bondYield').value);
  let value = current.eps * (8.5 + 2 * (Number.isFinite(g) ? g : 0));
  if (Number.isFinite(y) && y > 0) value = (value * 4.4) / y;
  const margin =
    Number.isFinite(value) && Number.isFinite(current.price) && current.price > 0
      ? (value - current.price) / current.price
      : null;
  $('growth-src').textContent = 'manual input';
  $('bond-src').textContent = 'manual input';
  paintValue(value, margin, current.currency);
});

// ── History: chart + table ───────────────────────────────────────────────────
function renderHistory(series, currency) {
  if (chart) {
    chart.destroy();
    chart = null;
  }
  const hasData = Array.isArray(series) && series.length > 0;
  $('hist-empty').hidden = hasData;
  $('hist-chart').hidden = !hasData;
  $('hist-table').hidden = true;
  setView('chart');

  if (!hasData) {
    $('hist-empty').textContent =
      'No SEC filing history available for this ticker (non-US listings have none).';
    $('hist-table').innerHTML = '';
    return;
  }

  buildChart(series, currency);
  $('hist-table').innerHTML = renderTable(series, currency);
}

function buildChart(series, currency) {
  const labels = series.map((s) => s.quarter || s.quarterEnd || '');
  const num = (v) => (typeof v === 'number' ? v : null);
  const price = series.map((s) => num(s.price));
  const value = series.map((s) => num(s.intrinsicValue));
  const eps = series.map((s) => num(s.eps));
  const margin = series.map((s) => (typeof s.marginOfSafety === 'number' ? s.marginOfSafety * 100 : null));

  const TEXT = '#9aa0ab';
  const GRID = 'rgba(255,255,255,0.06)';
  const mk = (label, data, color, axis, fill = false, spanGaps = false) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? 'rgba(90,169,255,0.10)' : color,
    borderWidth: 2,
    pointRadius: 2,
    tension: 0.25,
    spanGaps,
    fill,
    yAxisID: axis,
  });

  chart = new window.Chart($('series-canvas').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        mk('Price', price, '#5aa9ff', 'y', true, true),
        mk('Graham value', value, '#2ecc71', 'y'),
        mk('EPS (TTM)', eps, '#f5a623', 'y'),
        mk('Margin %', margin, '#b07cff', 'y1'),
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
            label: (ctx) => {
              if (ctx.parsed.y == null) return `${ctx.dataset.label}: N/A`;
              return ctx.dataset.yAxisID === 'y1'
                ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                : `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: TEXT, maxRotation: 0, autoSkip: true }, grid: { color: GRID } },
        y: {
          position: 'left',
          ticks: { color: TEXT, callback: (v) => '$' + v },
          grid: { color: GRID },
          title: { display: true, text: '$ / share', color: TEXT },
        },
        y1: {
          position: 'right',
          ticks: { color: TEXT, callback: (v) => v + '%' },
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Margin of safety', color: TEXT },
        },
      },
    },
  });
}

function renderTable(series, currency) {
  const rows = series
    .slice()
    .reverse() // newest first
    .map((s) => {
      const filing =
        s.filing && s.filing.url
          ? `<a href="${esc(s.filing.url)}" target="_blank" rel="noopener">${esc(s.filing.form || 'Filing')}</a>`
          : '—';
      const value =
        s.intrinsicValue == null
          ? '<span class="muted" title="Graham Number needs positive EPS and book value">N/A</span>'
          : fmtMoney(s.intrinsicValue, currency);
      return `
        <tr>
          <td>${esc(s.quarter || s.quarterEnd || '—')}</td>
          <td>${fmtMoney(s.eps, currency)}</td>
          <td>${value}</td>
          <td>${fmtPct(s.marginOfSafety)}</td>
          <td>${fmtMoney(s.price, currency)}</td>
          <td>${filing}</td>
        </tr>`;
    })
    .join('');
  return `
    <div class="history-wrap">
      <table class="history">
        <thead>
          <tr>
            <th>Quarter</th><th>EPS (TTM)</th><th>Graham value</th>
            <th>Margin</th><th>Price</th><th>Filing</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Chart / table view toggle.
function setView(view) {
  const chartOn = view === 'chart';
  $('view-chart').classList.toggle('active', chartOn);
  $('view-table').classList.toggle('active', !chartOn);
  if (!$('hist-empty').hidden) return; // nothing to show
  $('hist-chart').hidden = !chartOn;
  $('hist-table').hidden = chartOn;
  if (chartOn && chart) chart.resize();
}
$('view-chart').addEventListener('click', () => setView('chart'));
$('view-table').addEventListener('click', () => setView('table'));

// ── Watchlist chips ──────────────────────────────────────────────────────────
let watchlist = [];

async function loadWatchlist() {
  try {
    const res = await fetch('/api/watchlist');
    const data = await res.json();
    watchlist = data.watchlist || [];
  } catch {
    watchlist = [];
  }
  renderChips();
}

function renderChips() {
  const bar = document.getElementById('watchbar');
  const chips = document.getElementById('chips');
  bar.hidden = watchlist.length === 0;
  chips.innerHTML = watchlist
    .map(
      (t) =>
        `<span class="chip" data-ticker="${esc(t)}"><button class="chip-load" type="button">${esc(t)}</button>` +
        `<button class="chip-x" type="button" title="Stop tracking ${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`
    )
    .join('');
  chips.querySelectorAll('.chip-load').forEach((b) =>
    b.addEventListener('click', () => analyze(b.parentElement.dataset.ticker))
  );
  chips.querySelectorAll('.chip-x').forEach((b) =>
    b.addEventListener('click', () => removeTicker(b.parentElement.dataset.ticker))
  );
  if (current) refreshTrackToggle(current.ticker);
}

function refreshTrackToggle(ticker) {
  const btn = $('track-toggle');
  if (!ticker) {
    btn.hidden = true;
    return;
  }
  const tracked = watchlist.includes(ticker);
  btn.hidden = false;
  btn.textContent = tracked ? '★ Tracked' : '☆ Track';
  btn.classList.toggle('on', tracked);
  btn.onclick = () => (tracked ? removeTicker(ticker) : addTicker(ticker));
}

async function addTicker(ticker) {
  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not track ticker.');
    watchlist = data.watchlist || [];
    renderChips();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function removeTicker(ticker) {
  try {
    const res = await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not remove ticker.');
    watchlist = data.watchlist || [];
    renderChips();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
loadWatchlist();

// Deep link: /?ticker=AAPL analyzes on load (shareable links).
const initial = new URLSearchParams(location.search).get('ticker');
if (initial) analyze(initial);
