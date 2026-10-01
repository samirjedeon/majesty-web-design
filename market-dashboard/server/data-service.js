// Polls providers on a schedule, caches the latest good data, and serves
// snapshots to the browser. The browser never talks to a provider directly,
// so API keys stay on the server and every screen shares one upstream quota.

import { usMarketStatus } from '../public/js/market-hours.js';
import { getProvider } from './providers/index.js';

const MAX_BACKOFF_MS = 5 * 60_000;

export class DataService {
  constructor(config, env = globalThis.process?.env ?? {}) {
    this.config = config;
    this.env = env;
    this.entries = new Map(); // assetId → cached state
    this.groups = [];
    this.timers = new Set();
    // Dev only: shift the server clock to preview e.g. weekend/closed states.
    // The screen follows the server clock, so it shifts too.
    this.clockOffsetMs = (Number(env.DEV_CLOCK_OFFSET_HOURS) || 0) * 3600_000;

    const providerFor = {
      crypto: env.PROVIDER_CRYPTO || config.providers.crypto,
      us: env.PROVIDER_US || config.providers.us,
    };
    for (const kind of ['crypto', 'us']) {
      const assets = config.assets.filter((a) => (a.type === 'crypto') === (kind === 'crypto'));
      if (!assets.length) continue;
      const provider = getProvider(providerFor[kind]);
      for (const a of assets) {
        this.entries.set(a.id, {
          asset: a, provider, quote: null, series: null, seriesRev: 0,
          fetchedAt: 0, seriesFetchedAt: 0, error: null,
        });
      }
      this.groups.push({ kind, provider, assets, quoteFailures: 0, seriesFailures: 0 });
    }
  }

  now() { return Date.now() + this.clockOffsetMs; }

  market(now = this.now()) {
    return usMarketStatus(now, this.config.usMarket);
  }

  ctx() {
    const now = this.now();
    return { now, market: this.market(now), config: this.config, env: this.env };
  }

  interval(group, what) {
    const r = this.config.refresh[group.kind];
    const m = this.market();
    if (group.kind === 'us' && !m.isOpen) {
      const slow = (what === 'quote' ? r.closedQuote : r.closedSeries) * 1000;
      return Math.min(slow, Math.max(1000, m.nextOpen - this.now() + 2000)); // don't sleep through the open
    }
    return r[what] * 1000;
  }

  start() {
    for (const g of this.groups) {
      this.loop(g, 'quote', () => this.pollQuotes(g));
      this.loop(g, 'series', () => this.pollSeries(g));
    }
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // setTimeout chain (not setInterval) so a slow upstream never stacks requests.
  loop(group, what, fn) {
    const failKey = what === 'quote' ? 'quoteFailures' : 'seriesFailures';
    const tick = async () => {
      let delay;
      try {
        await fn();
        group[failKey] = 0;
        delay = this.interval(group, what);
      } catch (err) {
        group[failKey]++;
        const backoff = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (group[failKey] - 1));
        delay = Math.max(backoff, err.retryAfterMs || 0, this.interval(group, what));
        console.warn(`[${group.provider.name}/${group.kind}] ${what} failed (${group[failKey]}x): ${err.message} — retry in ${Math.round(delay / 1000)}s`);
        for (const a of group.assets) this.entries.get(a.id).error = err.message;
      }
      const jitter = delay * 0.1 * Math.random();
      const t = setTimeout(() => { this.timers.delete(t); tick(); }, delay + jitter);
      this.timers.add(t);
    };
    tick();
  }

  // Wrap a provider call so a hung request can't freeze the loop.
  async withTimeout(promise, ms = 15_000) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
  }

  async pollQuotes(group) {
    const quotes = await this.withTimeout(group.provider.getQuotes(group.assets, this.ctx()));
    const now = this.now();
    for (const a of group.assets) {
      const q = quotes[a.id];
      const e = this.entries.get(a.id);
      if (q && Number.isFinite(q.price)) {
        e.quote = q;
        e.fetchedAt = now;
        e.error = null;
      } else {
        e.error = 'No quote returned';
      }
    }
  }

  async pollSeries(group) {
    const errors = [];
    for (const a of group.assets) {
      const e = this.entries.get(a.id);
      try {
        const s = await this.withTimeout(group.provider.getSeries(a, this.ctx()));
        if (!s?.points?.length) throw new Error('Empty series');
        e.series = s;
        e.seriesRev++;
        e.seriesFetchedAt = this.now();
      } catch (err) {
        errors.push(`${a.id}: ${err.message}`);
        if (err.retryAfterMs) throw err; // rate limited — stop hammering, back off the group
      }
    }
    if (errors.length === group.assets.length) throw new Error(errors.join('; '));
  }

  // ── Snapshots for the browser ────────────────────────────────────────────

  quotesSnapshot() {
    const now = this.now();
    const assets = {};
    for (const [id, e] of this.entries) {
      const q = e.quote;
      const prevClose = q?.prevClose ?? e.series?.prevClose ?? null;
      assets[id] = q ? {
        price: q.price,
        prevClose,
        change: prevClose != null ? q.price - prevClose : null,
        changePct: prevClose ? ((q.price - prevClose) / prevClose) * 100 : null,
        high: q.high ?? null,
        low: q.low ?? null,
        asOf: q.asOf ?? e.fetchedAt,
        fetchedAt: e.fetchedAt,
        seriesRev: e.seriesRev,
        error: e.error,
        provider: e.provider.labelFor?.(id) ?? e.provider.label,
        mock: !!e.provider.mock,
        delayMinutes: e.provider.realtime ? 0 : e.provider.delayMinutes,
      } : {
        price: null, fetchedAt: 0, seriesRev: e.seriesRev, error: e.error || 'Waiting for first update',
        provider: e.provider.label, mock: !!e.provider.mock,
      };
    }
    return { serverTime: now, market: this.market(now), assets };
  }

  seriesSnapshot(ids) {
    const out = {};
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e?.series) continue;
      const { points, prevClose, intervalSec, start, end } = e.series;
      out[id] = { rev: e.seriesRev, points, prevClose, intervalSec, start, end };
    }
    return out;
  }

  health() {
    const now = this.now();
    return Object.fromEntries([...this.entries].map(([id, e]) => [id, {
      provider: e.provider.name,
      quoteAgeSec: e.fetchedAt ? Math.round((now - e.fetchedAt) / 1000) : null,
      seriesAgeSec: e.seriesFetchedAt ? Math.round((now - e.seriesFetchedAt) / 1000) : null,
      error: e.error,
    }]));
  }
}
