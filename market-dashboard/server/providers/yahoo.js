// Yahoo Finance chart API — US indexes and stocks, no API key.
// Unofficial and undocumented: it can rate-limit or change without notice.
// The rest of the app doesn't depend on it; swap in a paid provider by adding
// a file next to this one and pointing config.providers.us at it.
//
//   quote  = chart meta (regularMarketPrice / regularMarketTime), regular session only
//   series = 1-minute bars over 5 days, cut down to the session on screen; the
//            previous close is the last bar before that session opened, so the
//            change is right in pre-market, after hours and on weekends too.

import { settle, UA } from './http.js';
import { RateLimitError } from './errors.js';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const prevCloseCache = new Map(); // symbol → { sessionDate, value }

const sym = (asset) => {
  const s = asset.symbols.yahoo;
  if (!s) throw new Error(`No yahoo symbol configured for ${asset.id}`);
  return s;
};

// Yahoo turns away many cloud servers unless the request carries a session
// cookie and "crumb" token, the way a browser's does. Try a plain request
// first; if that's refused, open a session and retry with it.
let session = null; // { cookie, crumb, at }
const SESSION_TTL_MS = 6 * 3600_000;

async function getSession(force = false) {
  if (!force && session && Date.now() - session.at < SESSION_TTL_MS) return session;
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const cookie = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Yahoo: no session cookie');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie }, signal: AbortSignal.timeout(10_000) });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<') || crumb.length > 64) throw new Error(`Yahoo: crumb refused (HTTP ${r2.status})`);
  session = { cookie, crumb, at: Date.now() };
  return session;
}

async function request(url, headers) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  const body = await r.json().catch(() => null);
  return { status: r.status, body, retryAfter: Number(r.headers.get('retry-after')) };
}

function parse(symbol, { status, body }) {
  const res = body?.chart?.result?.[0];
  if (status === 200 && res?.meta) return res;
  return null;
}

async function chart(symbol, params) {
  const qs = new URLSearchParams({ includePrePost: 'false', ...params });
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}`;

  const plain = await request(`${HOSTS[0]}${path}?${qs}`);
  const ok = parse(symbol, plain);
  if (ok) return ok;
  if (plain.status === 404) throw new Error(`Yahoo ${symbol}: ${plain.body?.chart?.error?.description || 'symbol not found'}`);

  // Refused (401/403/429/other): retry once with a browser-style session.
  let s = await getSession();
  let withCrumb = await request(`${HOSTS[1]}${path}?${qs}&crumb=${encodeURIComponent(s.crumb)}`, { cookie: s.cookie });
  if (withCrumb.status === 401) {
    s = await getSession(true); // crumb expired
    withCrumb = await request(`${HOSTS[1]}${path}?${qs}&crumb=${encodeURIComponent(s.crumb)}`, { cookie: s.cookie });
  }
  const res = parse(symbol, withCrumb);
  if (res) return res;
  if (withCrumb.status === 429) {
    throw new RateLimitError(`Yahoo ${symbol}: rate limited (HTTP 429)`, (withCrumb.retryAfter > 0 ? withCrumb.retryAfter : 120) * 1000);
  }
  throw new Error(`Yahoo ${symbol}: HTTP ${plain.status}, then ${withCrumb.status} with session`);
}

export default {
  name: 'yahoo',
  label: 'Yahoo Finance',
  mock: false,
  realtime: true, // stocks ~real-time; the footer shows each value's actual timestamp
  delayMinutes: 0,

  async getQuotes(assets, { market }) {
    const results = await Promise.allSettled(assets.map(async (a) => {
      const symbol = sym(a);
      const { meta } = await chart(symbol, { interval: '1d', range: '1d' });
      const price = meta.regularMarketPrice;
      if (!Number.isFinite(price)) throw new Error(`Yahoo ${symbol}: no price`);
      const cached = prevCloseCache.get(symbol);
      const prevClose = cached?.sessionDate === market.sessionDate
        ? cached.value
        : meta.chartPreviousClose ?? meta.previousClose ?? null;
      return [a.id, {
        price,
        prevClose,
        high: meta.regularMarketDayHigh ?? null,
        low: meta.regularMarketDayLow ?? null,
        asOf: (meta.regularMarketTime ?? Date.now() / 1000) * 1000,
      }];
    }));
    return settle(results);
  },

  async getSeries(asset, { market }) {
    const symbol = sym(asset);
    const res = await chart(symbol, { interval: '1m', range: '5d' });
    const ts = res.timestamp || [];
    const closes = res.indicators?.quote?.[0]?.close || [];
    const open = market.sessionOpen / 1000;
    const close = market.sessionClose / 1000;

    const points = [];
    let prevClose = null;
    for (let i = 0; i < ts.length; i++) {
      const v = closes[i];
      if (v == null || !Number.isFinite(v)) continue; // Yahoo pads gaps with null
      if (ts[i] < open) prevClose = v;
      else if (ts[i] <= close) points.push([ts[i], v]);
    }
    prevClose ??= res.meta.chartPreviousClose ?? null;
    if (prevClose != null) prevCloseCache.set(symbol, { sessionDate: market.sessionDate, value: prevClose });

    // Right after the open there may be no bars yet: start the line at the previous close.
    if (!points.length && market.isOpen && prevClose != null) points.push([Math.floor(open), prevClose]);

    return {
      points,
      prevClose,
      intervalSec: 60,
      start: market.sessionOpen,
      end: market.sessionClose,
      asOf: points.length ? points[points.length - 1][0] * 1000 : null,
    };
  },
};
