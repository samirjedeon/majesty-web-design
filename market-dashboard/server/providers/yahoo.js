// Yahoo Finance chart API — US indexes and stocks, no API key.
// Unofficial and undocumented: it can rate-limit or change without notice.
// The rest of the app doesn't depend on it; swap in a paid provider by adding
// a file next to this one and pointing config.providers.us at it.
//
//   quote  = chart meta (regularMarketPrice / regularMarketTime), regular session only
//   series = 1-minute bars over 5 days, cut down to the session on screen; the
//            previous close is the last bar before that session opened, so the
//            change is right in pre-market, after hours and on weekends too.

import { getJSON, settle } from './http.js';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const prevCloseCache = new Map(); // symbol → { sessionDate, value }

const sym = (asset) => {
  const s = asset.symbols.yahoo;
  if (!s) throw new Error(`No yahoo symbol configured for ${asset.id}`);
  return s;
};

async function chart(symbol, params) {
  const qs = new URLSearchParams({ includePrePost: 'false', ...params });
  let lastErr;
  for (const host of HOSTS) {
    try {
      const j = await getJSON(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, { name: `Yahoo ${symbol}` });
      const res = j?.chart?.result?.[0];
      if (!res?.meta) throw new Error(`Yahoo ${symbol}: ${j?.chart?.error?.description || 'empty response'}`);
      return res;
    } catch (err) {
      if (err.retryAfterMs) throw err; // rate limited: don't hit the second host too
      lastErr = err;
    }
  }
  throw lastErr;
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
