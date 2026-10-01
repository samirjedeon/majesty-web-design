// Coinbase Exchange public market data — crypto, real-time, no API key.
// Docs: https://docs.cdp.coinbase.com/exchange/reference
// Limits: ~10 public requests/second per IP. We use well under 2/second.
//
//   quote  = /ticker (last trade price + time) and /stats (24h open/high/low,
//            cached for a minute). "Change" is measured against the price 24h ago.
//   series = /candles, 5-minute bars covering the last 24 hours.

import { getJSON, settle } from './http.js';

const BASE = 'https://api.exchange.coinbase.com';
const STATS_TTL_MS = 60_000;
const statsCache = new Map(); // symbol → { at, open, high, low }

const sym = (asset) => {
  const s = asset.symbols.coinbase;
  if (!s) throw new Error(`No coinbase symbol configured for ${asset.id}`);
  return s;
};

async function stats(symbol) {
  const c = statsCache.get(symbol);
  if (c && Date.now() - c.at < STATS_TTL_MS) return c;
  const d = await getJSON(`${BASE}/products/${symbol}/stats`, { name: `Coinbase ${symbol} stats` });
  const s = { at: Date.now(), open: +d.open, high: +d.high, low: +d.low };
  if (!Number.isFinite(s.open)) throw new Error(`Coinbase ${symbol}: bad stats response`);
  statsCache.set(symbol, s);
  return s;
}

export default {
  name: 'coinbase',
  label: 'Coinbase',
  mock: false,
  realtime: true,
  delayMinutes: 0,

  async getQuotes(assets) {
    const results = await Promise.allSettled(assets.map(async (a) => {
      const symbol = sym(a);
      const [t, s] = await Promise.all([
        getJSON(`${BASE}/products/${symbol}/ticker`, { name: `Coinbase ${symbol}` }),
        stats(symbol),
      ]);
      const price = +t.price;
      if (!Number.isFinite(price)) throw new Error(`Coinbase ${symbol}: bad ticker response`);
      return [a.id, {
        price,
        prevClose: s.open,
        high: Math.max(s.high, price),
        low: Math.min(s.low, price),
        asOf: Date.parse(t.time) || Date.now(),
      }];
    }));
    return settle(results);
  },

  async getSeries(asset, { now, config }) {
    const symbol = sym(asset);
    const hours = config.charts.cryptoWindowHours;
    const granularity = config.charts.cryptoIntervalSec; // must be 60, 300, 900, 3600, 21600 or 86400
    const start = now - hours * 3600_000;
    const qs = new URLSearchParams({
      granularity: String(granularity),
      start: new Date(start).toISOString(),
      end: new Date(now).toISOString(),
    });
    // Rows: [time, low, high, open, close, volume], newest first.
    const rows = await getJSON(`${BASE}/products/${symbol}/candles?${qs}`, { name: `Coinbase ${symbol} candles` });
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Coinbase ${symbol}: no candles`);
    rows.sort((x, y) => x[0] - y[0]);
    const points = rows.map((r) => [r[0], +r[4]]);
    const cached = statsCache.get(symbol);
    return {
      points,
      prevClose: cached?.open ?? +rows[0][3],
      intervalSec: granularity,
      start, end: now,
      asOf: Math.min(now, (rows[rows.length - 1][0] + granularity) * 1000),
    };
  },
};
