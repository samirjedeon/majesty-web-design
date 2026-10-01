// Checks candidate free data sources against all seven assets BEFORE we commit
// to one. Run on the machine that will host the dashboard:
//   node scripts/probe-providers.js
// Reports, per symbol: price, previous close, age of the newest data point
// (≈ delay while the market is open), and intraday point count.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const now = Date.now();
const age = (ms) => `${Math.round((now - ms) / 1000)}s old`;

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function yahoo(sym) {
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`);
  const m = j.chart.result[0].meta;
  const n = j.chart.result[0].timestamp?.length ?? 0;
  return `${m.regularMarketPrice}  prev ${m.chartPreviousClose ?? m.previousClose}  newest ${age(m.regularMarketTime * 1000)}  ${n} pts  (${m.exchangeName})`;
}

async function coinbase(sym) {
  const [t, c] = await Promise.all([
    get(`https://api.exchange.coinbase.com/products/${sym}/ticker`),
    get(`https://api.exchange.coinbase.com/products/${sym}/candles?granularity=300`),
  ]);
  return `${t.price}  newest ${age(Date.parse(t.time))}  ${c.length} x 5-min candles`;
}

const checks = [
  ['Yahoo', '^IXIC', yahoo], ['Yahoo', '^GSPC', yahoo], ['Yahoo', 'MSTR', yahoo], ['Yahoo', 'BMNR', yahoo],
  ['Coinbase', 'BTC-USD', coinbase], ['Coinbase', 'ETH-USD', coinbase], ['Coinbase', 'SOL-USD', coinbase],
];

console.log(`Probe at ${new Date(now).toISOString()}\n`);
for (const [src, sym, fn] of checks) {
  try { console.log(`OK    ${src.padEnd(9)} ${sym.padEnd(8)} ${await fn(sym)}`); }
  catch (e) { console.log(`FAIL  ${src.padEnd(9)} ${sym.padEnd(8)} ${e.message}`); }
}
console.log('\nDuring US market hours, "newest" for ^IXIC/^GSPC/MSTR/BMNR shows the real delay.');
