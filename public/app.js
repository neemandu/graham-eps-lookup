// app.js — minimal EPS lookup
const form = document.getElementById('form');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const $ = (id) => document.getElementById(id);

function showStatus(message, kind = 'loading') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticker = $('ticker').value.trim();
  if (!ticker) return;

  submitBtn.disabled = true;
  resultEl.hidden = true;
  showStatus(`Fetching ${ticker.toUpperCase()}…`, 'loading');

  try {
    const res = await fetch(`/api/eps?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    $('r-name').textContent = `${data.name} (${data.symbol})`;
    $('r-meta').textContent = data.exchange || '';
    $('r-eps').textContent = data.epsTTM === null ? '—' : data.epsTTM;

    statusEl.hidden = true;
    resultEl.hidden = false;
  } catch (err) {
    showStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});
