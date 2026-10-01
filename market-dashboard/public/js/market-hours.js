// US market session logic. Shared by the server (Node) and the browser.
// Pure functions, no dependencies. The calendar comes from config.usMarket.

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** Wall-clock parts of `ms` in time zone `tz`. */
export function zonedParts(ms, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(ms)) p[type] = value;
  const year = +p.year, month = +p.month, day = +p.day;
  return {
    year, month, day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Offset (ms) of `tz` from UTC at instant `ms`. ET in summer → -4h. */
export function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms for wall-clock `HH:MM` on `dateKey` in `tz`. */
export function zonedToEpoch(dateKey, hhmm, tz) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(t, tz);
  if (guess - off2 !== t) t = guess - off2; // DST edge
  return t;
}

export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isTradingDay(dateKey, cal) {
  const wd = weekday(dateKey);
  return wd !== 0 && wd !== 6 && !cal.holidays?.[dateKey];
}

function prevTradingDay(dateKey, cal) {
  let k = addDays(dateKey, -1);
  for (let i = 0; i < 15 && !isTradingDay(k, cal); i++) k = addDays(k, -1);
  return k;
}

function nextTradingDay(dateKey, cal) {
  let k = addDays(dateKey, 1);
  for (let i = 0; i < 15 && !isTradingDay(k, cal); i++) k = addDays(k, 1);
  return k;
}

function sessionBounds(dateKey, cal) {
  return {
    open: zonedToEpoch(dateKey, cal.open, cal.timezone),
    close: zonedToEpoch(dateKey, cal.earlyCloses?.[dateKey] || cal.close, cal.timezone),
  };
}

/**
 * Status of the US cash market at `now`.
 *   state       'open' | 'pre' | 'after' | 'closed'
 *   sessionDate the session whose data should be on screen (today if it has
 *               opened, otherwise the previous trading day)
 *   sessionOpen / sessionClose  epoch ms bounds of that session
 *   nextOpen    epoch ms of the next regular open
 *   reason      holiday name / 'Weekend' when closed all day
 */
export function usMarketStatus(now, cal) {
  const tz = cal.timezone;
  const today = zonedParts(now, tz).dateKey;
  const tradingToday = isTradingDay(today, cal);
  let state = 'closed', sessionDate, reason = '';

  if (tradingToday) {
    const { open, close } = sessionBounds(today, cal);
    const pre = zonedToEpoch(today, cal.preOpen, tz);
    const after = zonedToEpoch(today, cal.afterClose, tz);
    if (now < open) {
      state = now >= pre ? 'pre' : 'closed';
      sessionDate = prevTradingDay(today, cal);
    } else if (now < close) {
      state = 'open';
      sessionDate = today;
    } else {
      state = now < after ? 'after' : 'closed';
      sessionDate = today;
    }
  } else {
    sessionDate = prevTradingDay(today, cal);
    reason = cal.holidays?.[today] || 'Weekend';
  }

  const { open: sessionOpen, close: sessionClose } = sessionBounds(sessionDate, cal);
  const nextOpenDay = tradingToday && now < sessionBounds(today, cal).open ? today : nextTradingDay(today, cal);
  const nextOpen = sessionBounds(nextOpenDay, cal).open;

  return { state, isOpen: state === 'open', sessionDate, sessionOpen, sessionClose, nextOpen, reason };
}

export const MARKET_STATE_LABEL = {
  open: 'OPEN', pre: 'PRE-MARKET', after: 'AFTER HOURS', closed: 'CLOSED',
};
