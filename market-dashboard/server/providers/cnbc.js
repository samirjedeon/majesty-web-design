// CNBC public quote service — US indexes and stocks, no API key.
// Undocumented (it's what cnbc.com's own pages use), so it can change without
// notice. Used as a backup when Yahoo refuses this server.
//
//   quote  = quote.cnbc.com restQuote (last, previous close, day high/low, time)
//   series = ts-api.cnbc.com 1-day intraday bars, cut down to the session on screen

import { getJSON, settle } from './http.js';

const QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
const CHART_URL = 'https://ts-api.cnbc.com/harmony/app/charts/1D.json';
const prevCloseCache = new Map(); // symbol → previous close from the latest quote

const sym = (asset) => {
  const s = asset.symbols.cnbc;
  if (!s) throw new Error(`No cnbc symbol configured for ${asset.id}`);
  return s;
};

/** "6,705.12" / "+0.45%" / 6705.12 → number */
export const num = (v) => (v == null || v === '' ? NaN : typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%+\s]/g, '')));

/** "2026-10-01T13:28:12.000-0400" → epoch ms (adds the colon some parsers need). */
export function parseTime(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

export default {
  name: 'cnbc',
  label: 'CNBC',
  mock: false,
  realtime: true,
  delayMinutes: 0,

  async getQuotes(assets) {
    const qs = new URLSearchParams({
      symbols: assets.map(sym).join('|'),
      requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json', events: '1',
    });
    const j = await getJSON(`${QUOTE_URL}?${qs}`, { name: 'CNBC quotes' });
    let list = j?.FormattedQuoteResult?.FormattedQuote ?? [];
    if (!Array.isArray(list)) list = [list];
    const bySymbol = new Map(list.map((q) => [String(q.symbol).toUpperCase(), q]));

    return settle(assets.map((a) => {
      const q = bySymbol.get(sym(a).toUpperCase());
      const price = num(q?.last);
      if (!q || !Number.isFinite(price)) return { status: 'rejected', reason: new Error(`CNBC ${sym(a)}: no price`) };
      const prevClose = num(q.previous_day_closing);
      if (Number.isFinite(prevClose)) prevCloseCache.set(sym(a), prevClose);
      const asOf = parseTime(q.last_time);
      return {
        status: 'fulfilled',
        value: [a.id, {
          price,
          prevClose: Number.isFinite(prevClose) ? prevClose : null,
          high: Number.isFinite(num(q.high)) ? num(q.high) : null,
          low: Number.isFinite(num(q.low)) ? num(q.low) : null,
          asOf: Number.isFinite(asOf) ? asOf : Date.now(),
        }],
      };
    }));
  },

  async getSeries(asset, { market }) {
    const symbol = sym(asset);
    const j = await getJSON(`${CHART_URL}?symbol=${encodeURIComponent(symbol)}`, { name: `CNBC ${symbol} chart` });
    const bars = j?.barData?.priceBars;
    if (!Array.isArray(bars)) throw new Error(`CNBC ${symbol}: no chart data`);

    const open = market.sessionOpen, close = market.sessionClose;
    const points = [];
    for (const b of bars) {
      const t = num(b.tradeTimeinMills);
      const v = num(b.close);
      if (Number.isFinite(t) && Number.isFinite(v) && t >= open && t <= close) points.push([Math.floor(t / 1000), v]);
    }
    points.sort((x, y) => x[0] - y[0]);
    const prevClose = prevCloseCache.get(symbol) ?? null;
    if (!points.length && market.isOpen && prevClose != null) points.push([Math.floor(open / 1000), prevClose]);

    return {
      points, prevClose, intervalSec: 60,
      start: open, end: close,
      asOf: points.length ? points[points.length - 1][0] * 1000 : null,
    };
  },
};
