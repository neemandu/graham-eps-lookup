// app.js — Graham analyzer front-end
const form = document.getElementById('form');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const $ = (id) => document.getElementById(id);

// Held between requests so we can recompute the value client-side when the user
// tweaks g or Y (mirrors the math in graham.js).
let current = null; // { eps, price, currency }

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
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticker = $('ticker').value.trim();
  if (!ticker) return;

  submitBtn.disabled = true;
  resultEl.hidden = true;
  showStatus(`Analyzing ${ticker.toUpperCase()}…`, 'loading');

  try {
    const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    render(data);
    statusEl.hidden = true;
  } catch (err) {
    showStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// Recompute intrinsic value & margin locally when g or Y change (no extra fetch).
$('recalc').addEventListener('click', () => {
  if (!current) return;
  const g = parseFloat($('growth').value);
  const y = parseFloat($('bondYield').value);
  const { eps, price, currency } = current;

  let value = eps * (8.5 + 2 * (Number.isFinite(g) ? g : 0));
  if (Number.isFinite(y) && y > 0) value = (value * 4.4) / y;

  const margin =
    Number.isFinite(value) && Number.isFinite(price) && price > 0
      ? (value - price) / price
      : null;

  $('growth-src').textContent = 'manual input';
  $('bond-src').textContent = 'manual input';
  paintValue(value, margin, currency);
});

function paintValue(value, margin, currency) {
  $('r-value').textContent = value === null ? '—' : fmtMoney(value, currency);
  $('r-margin').textContent = fmtPct(margin);

  const v = $('r-verdict');
  if (margin === null) {
    v.hidden = true;
  } else {
    v.hidden = false;
    const under = margin > 0;
    v.textContent = under ? 'Undervalued vs Graham' : 'Overvalued vs Graham';
    v.className = `verdict ${under ? 'under' : 'over'}`;
  }
}

function render(data) {
  const { stock, graham, growth, bondYield, criteria } = data;
  const cur = stock.currency || 'USD';
  current = { eps: stock.epsTTM, price: stock.price, currency: cur };

  $('r-name').textContent = `${stock.name} (${stock.symbol})`;
  $('r-meta').textContent = [stock.exchange, stock.marketState].filter(Boolean).join(' · ');

  $('r-eps').textContent = stock.epsTTM === null ? '—' : fmtMoney(stock.epsTTM, cur);
  $('r-price').textContent = fmtMoney(stock.price, cur);

  paintValue(graham.intrinsicValue, graham.marginOfSafety, cur);

  // Assumptions
  $('growth').value = growth.value;
  $('bondYield').value = bondYield.value;
  $('growth-src').textContent = growth.source || '';
  $('bond-src').textContent = bondYield.source || '';

  // Warnings
  const warnEl = $('r-warnings');
  if (graham.warnings && graham.warnings.length) {
    warnEl.textContent = graham.warnings.join(' ');
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }

  // Checklist
  renderChecklist(criteria, cur);

  resultEl.hidden = false;
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
      `<span class="check-label">${c.label}</span>` +
      `<span class="check-value">${formatCriterion(c, currency)}</span>` +
      `<span class="check-threshold muted">${c.threshold}</span>`;
    ul.appendChild(li);
  }

  $('r-score').textContent = `${criteria.passed} / ${criteria.total} passed`;
}

function formatCriterion(c, currency) {
  if (c.value === null || c.value === undefined) return '—';
  switch (c.key) {
    case 'size':
      return `$${fmtNum(c.value / 1e9, 2)}B`;
    case 'debt':
      return `${fmtNum(c.value, 1)}%`;
    case 'earnings':
      return fmtMoney(c.value, currency);
    case 'dividend':
      return c.value > 0 ? fmtMoney(c.value, currency) : 'none';
    default:
      return fmtNum(c.value, 2);
  }
}
