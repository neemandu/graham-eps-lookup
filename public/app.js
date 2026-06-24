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

// ── Info tooltips ────────────────────────────────────────────────────────────
// What each thing means + where its value comes from. Keyed by data-info.
const INFO = {
  formula:
    "Benjamin Graham's intrinsic-value formula. 8.5 is the P/E he assigned a no-growth company; 4.4 is the 1962 AAA bond yield he used as a baseline. Source: Graham, The Intelligent Investor.",
  eps:
    'Earnings per share over the trailing twelve months. Source: Yahoo Finance (epsTrailingTwelveMonths).',
  price: 'Latest regular-market share price. Source: Yahoo Finance.',
  value:
    'Graham intrinsic value V = EPS×(8.5+2g)×4.4/Y, computed from the EPS, growth (g) and bond yield (Y) shown under Assumptions.',
  margin:
    '(Graham value − price) ÷ price. Positive means the stock trades below its Graham value. Computed.',
  verdict:
    'Whether the current price is below (undervalued) or above (overvalued) the Graham intrinsic value.',
  growth:
    'Expected annual EPS growth (g), ~5-yr. Derived from Yahoo P/E ÷ PEG; for companies without a PEG it tries Finviz "EPS next 5Y", else a conservative 15% default. Edit it to your own view and Recalculate — the formula is very sensitive to this.',
  bond:
    "Current AAA corporate-bond yield (Y). Source: FRED (Moody's Seasoned Aaa); falls back to the 10-year Treasury yield + ~1% if FRED is unreachable.",
  historyTitle:
    'Each fiscal quarter back to the company\'s earliest SEC filing. Historical valuation uses the Graham Number; the current quarter uses the live formula.',
  chart:
    'Four series over time. Left axis ($): Price, Graham value, EPS. Right axis (%): Margin of safety. Sources: price from Yahoo; EPS & book value from SEC EDGAR. Click a legend item to hide/show a line.',
  reports:
    "Links to each quarter's official report filed with the SEC (10-Q quarterly, 10-K annual). Source: SEC EDGAR.",
  checklist:
    "Graham's qualitative screen for the 'defensive investor'. Source: The Intelligent Investor, adapted to available data.",
  // History table columns
  col_quarter: "The company's fiscal reporting quarter (e.g. 2025-Q4).",
  col_eps:
    'Trailing-12-month EPS, split-adjusted, summed from quarterly diluted EPS. Source: SEC EDGAR XBRL.',
  col_value:
    'Graham Number = √(22.5 × EPS × book value per share). A growth-free fair value. N/A when EPS or book value isn\'t positive. Computed from SEC data.',
  col_margin: '(Graham Number − price) ÷ price for that quarter. Computed.',
  col_price:
    "Split-adjusted closing price near the quarter's end date. Source: Yahoo chart.",
  col_filing:
    'The 10-Q or 10-K that originally reported this quarter. Opens SEC EDGAR.',
  // Checklist criteria (by criterion key)
  size:
    'Market capitalization. Graham wanted large, established firms; we use ≥ $2B as a modern proxy. Source: Yahoo Finance.',
  currentRatio:
    'Current assets ÷ current liabilities. ≥ 2 signals a strong balance sheet. Source: Yahoo Finance (financialData).',
  debt:
    'Total debt ÷ equity (as a %). Lower means more conservative leverage. Source: Yahoo Finance.',
  earnings:
    'Positive trailing-12-month EPS — Graham required a record of stable earnings. Source: Yahoo Finance.',
  dividend:
    'Whether the company currently pays a dividend; Graham wanted a long, uninterrupted record. Source: Yahoo Finance.',
  pe: 'Price ÷ EPS (trailing). Graham capped a defensive buy at ≤ 15. Source: Yahoo Finance.',
  pb:
    'Price ÷ book value per share. Graham wanted ≤ 1.5. Source: Yahoo Finance (defaultKeyStatistics).',
  pepb:
    'P/E × P/B. Graham said the product shouldn\'t exceed 22.5 (e.g. 15 × 1.5). Computed.',
};

// Fill in any <span class="info" data-info="key"> under root: glyph, tip, a11y.
function hydrateInfo(root = document) {
  root.querySelectorAll('.info[data-info]').forEach((el) => {
    el.dataset.tip = INFO[el.dataset.info] || '';
    if (!el.textContent) el.textContent = 'i';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'More information');
  });
}
const info = (key) => `<span class="info" data-info="${key}"></span>`;

// One shared floating tooltip, positioned to stay on-screen.
const tooltip = (() => {
  let el = null;
  const ensure = () => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'tooltip';
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  };
  function show(target) {
    const text = target.dataset.tip;
    if (!text) return;
    const e = ensure();
    e.textContent = text;
    e.hidden = false;
    e.style.visibility = 'hidden';
    const r = target.getBoundingClientRect();
    const box = e.getBoundingClientRect();
    let top = r.top - box.height - 8;
    if (top < 8) top = r.bottom + 8; // flip below if no room above
    let left = r.left + r.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    e.style.top = `${top + window.scrollY}px`;
    e.style.left = `${left + window.scrollX}px`;
    e.style.visibility = 'visible';
  }
  const hide = () => {
    if (el) el.hidden = true;
  };
  return { show, hide };
})();
document.addEventListener('pointerover', (e) => {
  const i = e.target.closest && e.target.closest('.info[data-tip]');
  if (i) tooltip.show(i);
});
document.addEventListener('pointerout', (e) => {
  const i = e.target.closest && e.target.closest('.info');
  if (i) tooltip.hide();
});
document.addEventListener('focusin', (e) => {
  const i = e.target.closest && e.target.closest('.info[data-tip]');
  if (i) tooltip.show(i);
});
document.addEventListener('focusout', () => tooltip.hide());
// Touch: tap an icon to show, tap elsewhere to dismiss.
document.addEventListener('click', (e) => {
  const i = e.target.closest && e.target.closest('.info[data-tip]');
  if (i) {
    e.preventDefault();
    tooltip.show(i);
  } else {
    tooltip.hide();
  }
});

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
      `<span class="check-label">${esc(c.label)} ${INFO[c.key] ? info(c.key) : ''}</span>` +
      `<span class="check-value">${formatCriterion(c, currency)}</span>` +
      `<span class="check-threshold muted">${esc(c.threshold)}</span>`;
    ul.appendChild(li);
  }
  $('r-score').textContent = `${criteria.passed} / ${criteria.total} passed`;
  hydrateInfo(ul);
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
    $('hist-reports').innerHTML = '';
    return;
  }

  buildChart(series, currency);
  $('hist-table').innerHTML = renderTable(series, currency);
  $('hist-reports').innerHTML = renderReports(series);
  hydrateInfo($('hist-table'));
  hydrateInfo($('hist-reports'));
}

// Always-visible quick links to recent quarters' SEC filings (newest first).
// Capped to keep it compact; the full set is in the table view.
function renderReports(series) {
  const MAX = 12;
  const all = series.filter((s) => s.filing && s.filing.url).reverse();
  if (!all.length) return '';
  const shown = all.slice(0, MAX);
  const links = shown
    .map(
      (s) =>
        `<a class="report-link" href="${esc(s.filing.url)}" target="_blank" rel="noopener" ` +
        `title="${esc(s.quarter)} ${esc(s.filing.form)} — opens SEC EDGAR">` +
        `${esc(s.quarter)} <span class="report-form">${esc(s.filing.form)}</span></a>`
    )
    .join('');
  const more =
    all.length > MAX
      ? `<span class="reports-more muted small">+${all.length - MAX} more in the table view</span>`
      : '';
  return `<span class="reports-label">Quarterly reports: ${info('reports')}</span>${links}${more}`;
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
            <th>Quarter ${info('col_quarter')}</th>
            <th>EPS (TTM) ${info('col_eps')}</th>
            <th>Graham value ${info('col_value')}</th>
            <th>Margin ${info('col_margin')}</th>
            <th>Price ${info('col_price')}</th>
            <th>Filing ${info('col_filing')}</th>
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
hydrateInfo(); // static info icons in the page
loadWatchlist();

// Deep link: /?ticker=AAPL analyzes on load (shareable links).
const initial = new URLSearchParams(location.search).get('ticker');
if (initial) analyze(initial);
