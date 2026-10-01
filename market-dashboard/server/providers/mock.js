// MOCK provider — realistic-looking simulated prices for design review.
// Everything it returns is flagged mock:true and shown as MOCK DATA on screen.
//
// Prices follow a deterministic mean-reverting random walk indexed by absolute
// minute, so the server can restart without the charts jumping, charts and
// quotes always agree, and US assets freeze outside market hours like the real
// thing.

const MIN = 60_000;
const PHI = 0.998;      // mean reversion per minute
const WARMUP = 1500;    // minutes of history to converge the process

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function uniform(seed, i, salt) {
  let x = (seed ^ Math.imul(i, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return ((x >>> 0) + 0.5) / 4294967296;
}

function gaussian(seed, i) {
  const u1 = uniform(seed, i, 1), u2 = uniform(seed, i, 2);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-deviation process values for minutes [fromMin, toMin]. */
function walk(asset, fromMin, toMin) {
  const seed = hashStr(asset.id);
  const sigma = asset.mock.dailyVol / Math.sqrt(asset.type === 'crypto' ? 1440 : 390);
  let x = 0;
  for (let m = fromMin - WARMUP; m < fromMin; m++) x = PHI * x + sigma * gaussian(seed, m);
  const out = new Float64Array(toMin - fromMin + 1);
  for (let m = fromMin; m <= toMin; m++) {
    x = PHI * x + sigma * gaussian(seed, m);
    out[m - fromMin] = x;
  }
  return out;
}

const priceAt = (asset, x) => asset.mock.base * Math.exp(x);

/** Price at an arbitrary instant, interpolated within the minute. */
function livePrice(asset, ms) {
  const m = Math.floor(ms / MIN);
  const w = walk(asset, m, m + 1);
  const f = (ms - m * MIN) / MIN;
  return priceAt(asset, w[0] + (w[1] - w[0]) * f);
}

function usSession(asset, market, now) {
  const from = Math.floor(market.sessionOpen / MIN);
  const end = Math.min(now, market.sessionClose);
  const to = Math.max(from, Math.floor(end / MIN));
  const w = walk(asset, from - 1, to);
  // Previous close = process value at the prior session's close. Approximated
  // by the minute before this session's open (overnight drift folded in).
  const prevClose = priceAt(asset, w[0]) * (1 + 0.004 * (gaussian(hashStr(asset.id), from) * 0.5));
  const points = [];
  for (let i = 1; i < w.length; i++) points.push([(from + i - 1) * 60, priceAt(asset, w[i])]);
  return { points, prevClose };
}

export default {
  name: 'mock',
  label: 'Mock data',
  mock: true,
  realtime: false,
  delayMinutes: 0,

  async getQuotes(assets, { now, market }) {
    const out = {};
    for (const a of assets) {
      if (a.type === 'crypto') {
        const { points } = this._cryptoSeries(a, now);
        const price = livePrice(a, now);
        const vals = points.map((p) => p[1]).concat(price);
        out[a.id] = {
          price, prevClose: points[0][1], asOf: now,
          high: Math.max(...vals), low: Math.min(...vals),
        };
      } else {
        const { points, prevClose } = usSession(a, market, now);
        const vals = points.map((p) => p[1]);
        const price = market.isOpen ? livePrice(a, now) : vals[vals.length - 1];
        const asOf = market.isOpen ? now : market.sessionClose;
        out[a.id] = {
          price, prevClose, asOf,
          high: Math.max(...vals, price), low: Math.min(...vals, price),
        };
      }
    }
    return out;
  },

  async getSeries(asset, { now, market, config }) {
    if (asset.type === 'crypto') return this._cryptoSeries(asset, now, config);
    const { points, prevClose } = usSession(asset, market, now);
    return {
      points, prevClose, intervalSec: 60,
      start: market.sessionOpen, end: market.sessionClose,
      asOf: market.isOpen ? now : market.sessionClose,
    };
  },

  _cryptoSeries(asset, now, config) {
    const hours = config?.charts.cryptoWindowHours ?? 24;
    const step = (config?.charts.cryptoIntervalSec ?? 300) / 60;
    const to = Math.floor(now / MIN);
    const from = Math.floor((to - hours * 60) / step) * step;
    const w = walk(asset, from, to);
    const points = [];
    for (let i = 0; i < w.length; i += step) {
      const m = from + i;
      points.push([m * 60, priceAt(asset, w[i])]);
    }
    return {
      points, prevClose: points[0][1], intervalSec: step * 60,
      start: from * MIN, end: now, asOf: now,
    };
  },
};
