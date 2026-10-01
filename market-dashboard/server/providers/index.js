// Provider registry.
//
// A provider is a plain object:
//   name          'mock' | 'yahoo' | 'coinbase' | …  (matches keys in asset.symbols)
//   label         human name shown in the footer
//   mock          true only for simulated data
//   realtime      true if prices are real-time, false if delayed
//   delayMinutes  typical delay when not real-time
//   getQuotes(assets, ctx)  → { [assetId]: { price, prevClose, asOf, high?, low? } }
//   getSeries(asset, ctx)   → { points: [[epochSec, value], …], prevClose,
//                               intervalSec, start, end, asOf }
// ctx = { now, market, config, env }. Look up the API symbol with
// asset.symbols[provider.name]. Throw a RateLimitError to get backed off politely.
//
// To add a provider: create a file in this folder, register it below, then
// point config.providers.crypto / .us at its name (or a fallback list of names).

import mock from './mock.js';
import coinbase from './coinbase.js';
import yahoo from './yahoo.js';
import cnbc from './cnbc.js';

export { RateLimitError } from './errors.js';

const registry = { mock, coinbase, yahoo, cnbc };

function single(name) {
  const p = registry[name];
  if (!p) throw new Error(`Unknown data provider "${name}". Known: ${Object.keys(registry).join(', ')}`);
  return p;
}

/**
 * `name` is one provider ('yahoo') or a fallback list (['yahoo', 'cnbc']).
 * With a list, each asset is fetched from the first provider that delivers it.
 */
export function getProvider(name) {
  const names = Array.isArray(name) ? name : String(name).split(',').map((n) => n.trim()).filter(Boolean);
  return names.length === 1 ? single(names[0]) : fallbackChain(names.map(single));
}

const COOLDOWN_MS = 2 * 60_000;

function fallbackChain(providers) {
  const skipUntil = new Map(); // provider → epoch ms; a provider that refused everything rests a while
  const lastSource = new Map(); // assetId → provider that last delivered it
  const usable = () => providers.filter((p) => !(skipUntil.get(p) > Date.now()));
  const rest = (p, err) => skipUntil.set(p, Date.now() + Math.max(COOLDOWN_MS, err?.retryAfterMs || 0));

  return {
    name: providers.map((p) => p.name).join('+'),
    mock: providers.every((p) => p.mock),
    realtime: providers.every((p) => p.realtime),
    delayMinutes: Math.max(...providers.map((p) => p.delayMinutes || 0)),
    labelFor: (assetId) => (lastSource.get(assetId) || providers[0]).label,
    get label() { return providers.map((p) => p.label).join(' / '); },

    async getQuotes(assets, ctx) {
      const out = {};
      let remaining = assets, lastErr;
      for (const p of usable()) {
        if (!remaining.length) break;
        try {
          const got = await p.getQuotes(remaining, ctx);
          for (const [id, q] of Object.entries(got)) { out[id] = q; lastSource.set(id, p); }
          remaining = remaining.filter((a) => !got[a.id]);
        } catch (err) {
          lastErr = err;
          rest(p, err);
          console.warn(`[fallback] ${p.name} quotes failed, trying next: ${err.message}`);
        }
      }
      if (!Object.keys(out).length) throw lastErr || new Error('All providers are cooling down');
      return out;
    },

    async getSeries(asset, ctx) {
      // Prefer the provider that supplied this asset's quote, so price and chart agree.
      const preferred = lastSource.get(asset.id);
      const order = usable().sort((a, b) => (b === preferred) - (a === preferred));
      let lastErr;
      for (const p of order) {
        try {
          const s = await p.getSeries(asset, ctx);
          if (s?.points?.length) return s;
          lastErr = new Error(`${p.name}: empty series`);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('All providers are cooling down');
    },
  };
}
