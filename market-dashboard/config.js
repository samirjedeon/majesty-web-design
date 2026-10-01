// ─────────────────────────────────────────────────────────────────────────────
// Market Wall Dashboard — configuration
//
// Everything you'd normally want to change lives here: which assets are shown,
// what they're called, which API symbol each provider uses, refresh cadence,
// chart timeframes, and where each panel sits on screen.
//
// API keys do NOT go in this file. Put them in a `.env` file next to it
// (see .env.example) — the server reads them; the browser never sees them.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  // Which data provider feeds each asset type (files in server/providers/).
  //   'coinbase' → crypto, real-time, free, no key
  //   'yahoo'    → US indexes + stocks, free, no key (unofficial API)
  //   'mock'     → simulated data, clearly labelled MOCK on screen
  // Override without editing this file: PROVIDER_CRYPTO=mock PROVIDER_US=mock npm start
  providers: {
    crypto: 'coinbase',
    us: 'yahoo', // indexes + US equities
  },

  // ── Assets ────────────────────────────────────────────────────────────────
  // id        internal key (used by layout below)
  // name      display name
  // ticker    short symbol shown on screen
  // type      'index' | 'equity' | 'crypto'   (index/equity follow US market hours)
  // symbols   per-provider API symbol — change a ticker here, nothing else
  // decimals  price decimals on screen
  // prefix    shown before the price ('$' for USD-priced assets, '' for index points)
  // mock      starting level + daily volatility for the simulator only
  assets: [
    {
      id: 'ndx', name: 'NASDAQ Composite', ticker: 'IXIC', type: 'index',
      symbols: { mock: 'IXIC', yahoo: '^IXIC', twelvedata: 'IXIC', fmp: '^IXIC' },
      decimals: 2, prefix: '',
      mock: { base: 22840, dailyVol: 0.011 },
    },
    {
      id: 'spx', name: 'S&P 500', ticker: 'SPX', type: 'index',
      symbols: { mock: 'SPX', yahoo: '^GSPC', twelvedata: 'SPX', fmp: '^GSPC' },
      decimals: 2, prefix: '',
      mock: { base: 6705, dailyVol: 0.009 },
    },
    {
      id: 'btc', name: 'Bitcoin', ticker: 'BTC', type: 'crypto',
      symbols: { mock: 'BTC-USD', coinbase: 'BTC-USD', kraken: 'XBTUSD' },
      decimals: 0, prefix: '$',
      mock: { base: 112400, dailyVol: 0.024 },
    },
    {
      id: 'eth', name: 'Ethereum', ticker: 'ETH', type: 'crypto',
      symbols: { mock: 'ETH-USD', coinbase: 'ETH-USD', kraken: 'ETHUSD' },
      decimals: 2, prefix: '$',
      mock: { base: 4185, dailyVol: 0.034 },
    },
    {
      id: 'sol', name: 'Solana', ticker: 'SOL', type: 'crypto',
      symbols: { mock: 'SOL-USD', coinbase: 'SOL-USD', kraken: 'SOLUSD' },
      decimals: 2, prefix: '$',
      mock: { base: 212.4, dailyVol: 0.045 },
    },
    {
      id: 'mstr', name: 'Strategy', ticker: 'MSTR', type: 'equity',
      symbols: { mock: 'MSTR', yahoo: 'MSTR', twelvedata: 'MSTR', fmp: 'MSTR' },
      decimals: 2, prefix: '$',
      mock: { base: 342.1, dailyVol: 0.042 },
    },
    {
      id: 'bmnr', name: 'BitMine Immersion', ticker: 'BMNR', type: 'equity',
      symbols: { mock: 'BMNR', yahoo: 'BMNR', twelvedata: 'BMNR', fmp: 'BMNR' },
      decimals: 2, prefix: '$',
      mock: { base: 48.6, dailyVol: 0.06 },
    },
  ],

  // ── Layout (16:9) ─────────────────────────────────────────────────────────
  // featured = the large centre chart; left/right = three panels each, top→bottom.
  layout: {
    featured: 'btc',
    left: ['ndx', 'spx', 'mstr'],
    right: ['eth', 'sol', 'bmnr'],
  },

  // ── Refresh cadence (seconds) ─────────────────────────────────────────────
  // quote  = latest price; series = intraday chart data.
  // US assets poll slowly while the market is closed to save API quota.
  // staleAfter = no successful update for this long → panel is marked STALE.
  // maxDataAge = provider answered, but its newest data point is older than
  //              this while the market is open → also STALE (catches frozen feeds).
  refresh: {
    crypto: { quote: 5, series: 60, staleAfter: 45, maxDataAge: 180 },
    us: {
      quote: 15, series: 60, staleAfter: 90, maxDataAge: 1200,
      closedQuote: 300, closedSeries: 900,
    },
    browserPoll: 2, // how often the screen asks the local server for quotes
  },

  // ── Charts ────────────────────────────────────────────────────────────────
  charts: {
    cryptoWindowHours: 24,   // crypto: rolling previous 24 hours
    cryptoIntervalSec: 300,  // 5-minute points
    usIntervalSec: 60,       // US: 1 trading day of 1-minute points
  },

  // ── Display ───────────────────────────────────────────────────────────────
  display: {
    timezone: 'America/New_York', // clock + chart axis
    timezoneLabel: 'ET',
    dailyReloadAt: '04:00',       // full page reload once a day (kiosk hygiene); '' to disable
    hideCursor: true,
  },

  // ── US market calendar (NYSE / Nasdaq) ────────────────────────────────────
  // Verify against https://www.nyse.com/markets/hours-calendars once a year.
  usMarket: {
    timezone: 'America/New_York',
    preOpen: '04:00', open: '09:30', close: '16:00', afterClose: '20:00',
    holidays: {
      '2026-01-01': "New Year's Day", '2026-01-19': 'MLK Day', '2026-02-16': "Presidents' Day",
      '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
      '2026-07-03': 'Independence Day', '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving',
      '2026-12-25': 'Christmas',
      '2027-01-01': "New Year's Day", '2027-01-18': 'MLK Day', '2027-02-15': "Presidents' Day",
      '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth',
      '2027-07-05': 'Independence Day', '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving',
      '2027-12-24': 'Christmas',
    },
    earlyCloses: { // 1:00 PM ET close
      '2026-11-27': '13:00', '2026-12-24': '13:00',
      '2027-11-26': '13:00',
    },
  },

  server: {
    port: 8080,
    host: '127.0.0.1', // localhost only; set '0.0.0.0' to view from other machines on the LAN
  },
};
