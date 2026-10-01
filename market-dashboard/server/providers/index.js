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
// point config.providers.crypto / .us at its name.

import mock from './mock.js';

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

const registry = { mock };

export function getProvider(name) {
  const p = registry[name];
  if (!p) throw new Error(`Unknown data provider "${name}". Known: ${Object.keys(registry).join(', ')}`);
  return p;
}
