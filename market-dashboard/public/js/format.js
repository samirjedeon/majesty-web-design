// Number / time formatting helpers.

const numFmt = new Map();
function nf(decimals) {
  if (!numFmt.has(decimals)) {
    numFmt.set(decimals, new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }
  return numFmt.get(decimals);
}

export const MINUS = '−'; // typographic minus, same width as +

export function fmtPrice(v, decimals, prefix = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  return prefix + nf(decimals).format(v);
}

export function fmtChange(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? MINUS : '';
  return sign + nf(decimals).format(Math.abs(v));
}

export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? MINUS : '';
  return `${sign}${nf(2).format(Math.abs(v))}%`;
}

const dtf = new Map();
function df(key, opts) {
  if (!dtf.has(key)) dtf.set(key, new Intl.DateTimeFormat('en-US', opts));
  return dtf.get(key);
}

export const fmtTime = (ms, tz) => df(`t|${tz}`, { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(ms);
export const fmtTimeShort = (ms, tz) => df(`ts|${tz}`, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms);
export const fmtDate = (ms, tz) => df(`d|${tz}`, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(ms);
export const fmtDay = (ms, tz) => df(`dd|${tz}`, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);

export function fmtAgo(sec) {
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
