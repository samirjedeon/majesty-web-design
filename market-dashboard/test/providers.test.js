// Parser tests for the live providers, using recorded-shape responses
// (no network). Run: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import config from '../config.js';
import { usMarketStatus } from '../public/js/market-hours.js';
import coinbase from '../server/providers/coinbase.js';
import yahoo from '../server/providers/yahoo.js';

const asset = (id) => config.assets.find((a) => a.id === id);
let routes;
beforeEach(() => { routes = []; });
globalThis.fetch = async (url) => {
  const hit = routes.find(([re]) => re.test(String(url)));
  if (!hit) return new Response('not found', { status: 404 });
  const [, body, status = 200, headers = {}] = hit;
  return new Response(JSON.stringify(body), { status, headers });
};

// Thursday 2026-10-01, 11:00 ET (15:00Z) — market open.
const NOW = Date.UTC(2026, 9, 1, 15, 0);
const market = usMarketStatus(NOW, config.usMarket);
const ctx = { now: NOW, market, config };

test('market status for the fixture time', () => {
  assert.equal(market.state, 'open');
  assert.equal(market.sessionDate, '2026-10-01');
  assert.equal(market.sessionOpen, Date.UTC(2026, 9, 1, 13, 30));
});

test('coinbase quote: price, 24h open as reference, trade time', async () => {
  routes.push(
    [/BTC-USD\/ticker/, { price: '112403.51', time: '2026-10-01T14:59:58.123Z' }],
    [/BTC-USD\/stats/, { open: '110000.00', high: '113000.00', low: '109500.00', last: '112403.51' }],
  );
  const q = await coinbase.getQuotes([asset('btc')], ctx);
  assert.equal(q.btc.price, 112403.51);
  assert.equal(q.btc.prevClose, 110000);
  assert.equal(q.btc.asOf, Date.parse('2026-10-01T14:59:58.123Z'));
});

test('coinbase quote: one failing symbol does not sink the others', async () => {
  routes.push(
    [/ETH-USD\/ticker/, { price: '4185.20', time: '2026-10-01T14:59:58Z' }],
    [/ETH-USD\/stats/, { open: '4100', high: '4200', low: '4050' }],
    [/SOL-USD/, { message: 'boom' }, 500],
  );
  const q = await coinbase.getQuotes([asset('eth'), asset('sol')], ctx);
  assert.equal(q.eth.price, 4185.2);
  assert.equal(q.sol, undefined);
});

test('coinbase candles are sorted oldest-first and use the close', async () => {
  const t0 = NOW / 1000 - 3 * 300;
  routes.push([/BTC-USD\/candles\?granularity=300/, [
    [t0 + 600, 1, 2, 3, 103, 9], [t0, 1, 2, 3, 101, 9], [t0 + 300, 1, 2, 3, 102, 9],
  ]]);
  const s = await coinbase.getSeries(asset('btc'), ctx);
  assert.deepEqual(s.points, [[t0, 101], [t0 + 300, 102], [t0 + 600, 103]]);
  assert.equal(s.intervalSec, 300);
});

test('coinbase 429 becomes a rate-limit error with retry-after', async () => {
  routes.push([/SOL-USD/, { message: 'slow down' }, 429, { 'retry-after': '30' }]);
  await assert.rejects(coinbase.getQuotes([asset('sol')], ctx), (e) => e.retryAfterMs === 30_000);
});

function yahooChart({ price, time, prevMeta, ts, closes }) {
  return { chart: { result: [{
    meta: { regularMarketPrice: price, regularMarketTime: time, chartPreviousClose: prevMeta, regularMarketDayHigh: 22900, regularMarketDayLow: 22700 },
    timestamp: ts, indicators: { quote: [{ close: closes }] },
  }], error: null } };
}

test('yahoo series: keeps only the current session, prev close from prior bar, skips nulls', async () => {
  const open = market.sessionOpen / 1000;
  const yClose = open - 17.5 * 3600 - 60; // yesterday 15:59 ET
  routes.push([/v8\/finance\/chart\/%5EIXIC\?.*range=5d/, yahooChart({
    price: 22850, time: NOW / 1000, prevMeta: 22000,
    ts: [yClose - 60, yClose, open, open + 60, open + 120],
    closes: [22790, 22800, 22810, null, 22830],
  })]);
  const s = await yahoo.getSeries(asset('ndx'), ctx);
  assert.equal(s.prevClose, 22800);
  assert.deepEqual(s.points, [[open, 22810], [open + 120, 22830]]);
  assert.equal(s.start, market.sessionOpen);
  assert.equal(s.end, market.sessionClose);
});

test('yahoo quote: uses the session prev close learned from the series', async () => {
  routes.push([/v8\/finance\/chart\/%5EIXIC\?.*range=1d/, yahooChart({
    price: 22850.12, time: NOW / 1000 - 5, prevMeta: 99999, ts: [], closes: [],
  })]);
  const q = await yahoo.getQuotes([asset('ndx')], ctx);
  assert.equal(q.ndx.price, 22850.12);
  assert.equal(q.ndx.prevClose, 22800); // from previous test's series, not meta
  assert.equal(q.ndx.asOf, NOW - 5000);
});

test('yahoo falls back to query2 when query1 fails', async () => {
  routes.push(
    [/query1.*MSTR/, { error: 'down' }, 502],
    [/query2.*MSTR\?.*range=1d/, yahooChart({ price: 342.1, time: NOW / 1000, prevMeta: 340, ts: [], closes: [] })],
  );
  const q = await yahoo.getQuotes([asset('mstr')], ctx);
  assert.equal(q.mstr.price, 342.1);
  assert.equal(q.mstr.prevClose, 340);
});

test('yahoo series right at the open with no bars yet starts at prev close', async () => {
  const open = market.sessionOpen / 1000;
  routes.push([/BMNR\?.*range=5d/, yahooChart({ price: 48, time: open, prevMeta: 47, ts: [open - 66000], closes: [47.5] })]);
  const s = await yahoo.getSeries(asset('bmnr'), ctx);
  assert.deepEqual(s.points, [[open, 47.5]]);
});
