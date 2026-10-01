// Shared HTTP helper for providers: timeout, JSON parsing, rate-limit detection.

import { RateLimitError } from './errors.js';

export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export async function getJSON(url, { name, timeoutMs = 10_000, headers = {} } = {}) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 429) {
    const ra = Number(r.headers.get('retry-after'));
    throw new RateLimitError(`${name}: rate limited (HTTP 429)`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
  }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

/** Keep the assets that succeeded; fail the whole call only if all failed. */
export function settle(results) {
  const out = {};
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value[0]] = r.value[1];
    else errors.push(r.reason);
  }
  if (!Object.keys(out).length && errors.length) {
    throw errors.find((e) => e.retryAfterMs) || new Error(errors.map((e) => e.message).join('; '));
  }
  return out;
}
