// finviz.js
// Best-effort fetch of Finviz's "EPS next 5Y" analyst growth estimate, used as a
// fallback for the Graham growth input when Yahoo has no PEG (typically newer or
// unprofitable companies).
//
// Caveat: Finviz blocks datacenter IPs fairly aggressively, so this often 403s
// from serverless hosts (e.g. Vercel). It's wrapped to fail quietly — callers
// fall through to the next source.

const TIMEOUT_MS = 6000;

export async function getFinvizGrowth(ticker) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker.toUpperCase())}`,
      {
        signal: ctrl.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (!res.ok) return null;
    const html = await res.text();

    // The value lives in the cell's "snapshot-td-content" div, e.g.
    //   EPS next 5Y</div></td><td class="… w-[8%] "><div class="snapshot-td-content"><b>12.63%</b>
    // Anchor on snapshot-td-content first so we don't match the "w-[8%]" CSS
    // width class. "-" means unavailable.
    const idx = html.indexOf('EPS next 5Y');
    if (idx === -1) return null;
    const seg = html.slice(idx, idx + 400);
    const c = seg.indexOf('snapshot-td-content');
    const m = (c === -1 ? seg : seg.slice(c)).match(/(-?\d+(?:\.\d+)?)%/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
