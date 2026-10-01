// Dashboard bootstrap: loads config, builds panels, polls the local server,
// and decides what's live / closed / stale. No user interaction required.

import { AssetPanel } from './panels.js';
import { usMarketStatus, MARKET_STATE_LABEL } from './market-hours.js';
import { fmtTime, fmtTimeShort, fmtDate, fmtDuration, fmtAgo } from './format.js';

const $ = (sel) => document.querySelector(sel);

async function getJSON(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── State ──────────────────────────────────────────────────────────────────
let config;
const panels = new Map();
let snapshot = null;        // last /api/quotes response
let skewMs = 0;             // server clock − browser clock
let lastOkAt = 0;           // browser time of last successful poll
let failures = 0;
const bootAt = Date.now();

const serverNow = () => Date.now() + skewMs;

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  for (let attempt = 0; !config; attempt++) {
    try {
      config = await getJSON('api/config');
    } catch {
      $('#boot-msg').textContent = `Connecting to data server… (attempt ${attempt + 1})`;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
  if (config.display.hideCursor) document.documentElement.classList.add('hide-cursor');
  $('.tz').textContent = config.display.timezoneLabel || '';

  const grid = $('#grid');
  const { featured, left, right } = config.layout;
  const byId = Object.fromEntries(config.assets.map((a) => [a.id, a]));
  const place = (id, gridArea, isFeatured) => {
    const asset = byId[id];
    if (!asset) return console.warn(`layout references unknown asset "${id}"`);
    const p = new AssetPanel(asset, { featured: isFeatured, tz: config.display.timezone, gridArea });
    grid.appendChild(p.root);
    panels.set(id, p);
  };
  place(featured, '1 / 2 / 4 / 3', true);
  left.forEach((id, i) => place(id, `${i + 1} / 1 / ${i + 2} / 2`, false));
  right.forEach((id, i) => place(id, `${i + 1} / 3 / ${i + 2} / 4`, false));

  $('#boot').remove();
  applyScale();
  window.addEventListener('resize', applyScale);
  document.fonts?.ready.then(() => panels.forEach((p) => p.chart.refreshFonts()));

  keepScreenAwake();
  tickClock();
  poll();
}

function applyScale() {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  panels.forEach((p) => p.chart.setScale(rem));
}

// ── Polling ────────────────────────────────────────────────────────────────
async function poll() {
  let delay = config.refresh.browserPoll * 1000;
  try {
    const q = await getJSON('api/quotes');
    if (q.buildId !== config.buildId) return location.reload(); // server updated → pick up new UI
    skewMs = q.serverTime - Date.now();
    snapshot = q;
    lastOkAt = Date.now();
    failures = 0;

    const need = [...panels].filter(([id, p]) => q.assets[id] && q.assets[id].seriesRev > 0 && q.assets[id].seriesRev !== p.seriesRev).map(([id]) => id);
    if (need.length) {
      const series = await getJSON(`api/series?ids=${need.join(',')}`);
      for (const [id, s] of Object.entries(series)) panels.get(id)?.setSeries(s);
    }
    render();
  } catch {
    failures++;
    delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    render();
  }
  setTimeout(poll, delay);
}

// ── Freshness rules ────────────────────────────────────────────────────────
function viewFor(asset, q, market) {
  const crypto = asset.type === 'crypto';
  const r = crypto ? config.refresh.crypto : config.refresh.us;
  const now = serverNow();
  if (!q || q.price == null) {
    // Give the first fetch a moment, then say plainly that there's no data.
    return Date.now() - bootAt > 20_000 && q?.error ? { state: 'error', badge: 'NO DATA' } : { state: 'loading', badge: '' };
  }

  const ageSec = (now - q.fetchedAt) / 1000;
  const dataAgeSec = (now - q.asOf) / 1000;
  const delayed = q.delayMinutes || 0;

  if (!crypto && !market.isOpen) {
    // Closed: last session's numbers are correct, as long as the server is still reachable.
    const limit = (r.closedQuote || 300) * 3;
    if (ageSec > limit) return { state: 'stale', badge: 'STALE', ageSec };
    return { state: 'closed', badge: MARKET_STATE_LABEL[market.state] };
  }
  const justOpened = !crypto && now - market.sessionOpen < r.staleAfter * 1000 * 2;
  if (ageSec > r.staleAfter || (!justOpened && dataAgeSec > r.maxDataAge)) {
    return { state: 'stale', badge: 'STALE', ageSec: Math.max(ageSec, dataAgeSec) };
  }
  return { state: 'live', badge: delayed ? 'DELAYED' : 'LIVE', delayed };
}

function render() {
  if (!snapshot) return;
  const market = usMarketStatus(serverNow(), config.usMarket);
  let anyMock = false, anyStale = false;
  for (const [id, p] of panels) {
    const q = snapshot.assets[id];
    const view = viewFor(p.asset, q, market);
    if (q?.mock) anyMock = true;
    if (view.state === 'stale') anyStale = true;
    p.render(q, view);
  }
  document.body.classList.toggle('is-mock', anyMock);

  // Header: last refresh + connection banner.
  const refresh = $('#refresh-time');
  const lost = Date.now() - lastOkAt > config.refresh.browserPoll * 1000 * 4;
  // Time of the newest market data the server actually received (not just our last poll of it).
  const lastData = Math.max(0, ...Object.values(snapshot.assets).map((a) => a.fetchedAt || 0));
  refresh.textContent = lastData ? fmtTime(lastData, config.display.timezone) : '—';
  refresh.parentElement.dataset.state = lost || anyStale || !lastData ? 'stale' : 'ok';

  const banner = $('#conn');
  if (lost) {
    banner.hidden = false;
    banner.querySelector('.conn-detail').textContent =
      `No response for ${fmtAgo((Date.now() - lastOkAt) / 1000)} · retrying automatically · prices shown are NOT live`;
  } else {
    banner.hidden = true;
  }
}

// ── Clock & header ─────────────────────────────────────────────────────────
function tickClock() {
  const tz = config.display.timezone;
  const now = serverNow();
  $('#date').textContent = fmtDate(now, tz);
  $('#clock').textContent = fmtTime(now, tz);

  const m = usMarketStatus(now, config.usMarket);
  const st = $('#us-state');
  st.textContent = MARKET_STATE_LABEL[m.state];
  st.dataset.state = m.isOpen ? 'open' : 'closed';
  $('#us-sub').textContent = m.isOpen
    ? `Closes ${fmtTimeShort(m.sessionClose, tz)} · ${fmtDuration(m.sessionClose - now)}`
    : `${m.reason ? `${m.reason} · ` : ''}Opens ${fmtDuration(m.nextOpen - now) === '0m' ? 'now' : `in ${fmtDuration(m.nextOpen - now)}`}`;

  render(); // freshness changes with time even when no new data arrives
  maybeDailyReload(now, tz);
  setTimeout(tickClock, 1000 - (Date.now() % 1000) + 5);
}

function maybeDailyReload(now, tz) {
  const at = config.display.dailyReloadAt;
  if (!at || Date.now() - bootAt < 3600_000) return;
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);
  if (hhmm === at) location.reload();
}

// Keep the display on (supported in Chrome; harmless elsewhere).
async function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;
  const acquire = async () => { try { await navigator.wakeLock.request('screen'); } catch { /* not allowed yet */ } };
  await acquire();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
}

window.addEventListener('online', () => { failures = 0; });
boot();
