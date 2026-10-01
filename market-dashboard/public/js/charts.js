// Chart logic. One PriceChart per panel, created once and reused for the life
// of the page: data is replaced with setData() / update(), never by building
// new charts, so memory stays flat when running for weeks.

import {
  createChart, AreaSeries, LineSeries, LineStyle, ColorType, CrosshairMode, LastPriceAnimationMode,
} from '../vendor/lightweight-charts.mjs';
import { tzOffsetMs } from './market-hours.js';

const TONES = {
  up:    { line: '#21c97c', top: 'rgba(33, 201, 124, 0.13)' },
  down:  { line: '#f2495a', top: 'rgba(242, 73, 90, 0.13)' },
  flat:  { line: '#9aa3ad', top: 'rgba(154, 163, 173, 0.08)' },
  stale: { line: '#4d545d', top: 'rgba(77, 84, 93, 0.06)' },
};
const TEXT = '#7b838d';

export class PriceChart {
  constructor(el, { featured, decimals, tz, fixedSession }) {
    this.featured = featured;
    this.fixedSession = fixedSession; // US assets: x-axis spans the whole session
    this.decimals = decimals;
    this.tz = tz;
    this.tone = 'flat';
    this.prevClose = null;
    this.lastTime = 0;
    this.intervalSec = 60;
    this.offsetSec = 0;

    this.chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: TEXT,
        fontFamily: 'Inter, system-ui, sans-serif',
        // TradingView attribution (Lightweight Charts licence) — shown once, on the main chart.
        attributionLogo: featured,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: featured, color: 'rgba(255, 255, 255, 0.045)' },
      },
      rightPriceScale: {
        visible: featured,
        borderVisible: false,
        scaleMargins: featured ? { top: 0.1, bottom: 0.08 } : { top: 0.12, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: featured,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: !fixedSession,
        fixRightEdge: !fixedSession,
        lockVisibleTimeRangeOnResize: true,
      },
      // Explicit locale: the OS default (e.g. "en-US@posix" on a bare Linux kiosk) can be invalid.
      localization: { locale: 'en-US', priceFormatter: (v) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) },
      crosshair: { mode: CrosshairMode.Hidden },
      handleScroll: false,
      handleScale: false,
    });

    // Invisible whitespace series with one slot per interval across the session
    // (9:30–16:00), so the line grows left→right through the day and data gaps
    // keep correct spacing.
    this.axis = this.chart.addSeries(LineSeries, { visible: false, lastValueVisible: false, priceLineVisible: false });

    this.series = this.chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: featured,
      crosshairMarkerVisible: false,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      priceFormat: { type: 'price', precision: decimals, minMove: 1 / 10 ** decimals },
      // Keep the previous-close reference line inside the visible range.
      autoscaleInfoProvider: (original) => {
        const r = original();
        if (!r || this.prevClose == null) return r;
        return {
          ...r,
          priceRange: {
            minValue: Math.min(r.priceRange.minValue, this.prevClose),
            maxValue: Math.max(r.priceRange.maxValue, this.prevClose),
          },
        };
      },
    });

    this.prevLine = this.series.createPriceLine({
      price: 0, color: 'rgba(255, 255, 255, 0.26)', lineWidth: 1, lineStyle: LineStyle.Dotted,
      axisLabelVisible: false, lineVisible: false,
    });

    this.applyTone();
  }

  /** Scale fonts/line weight with the root rem (1080p → 4K). */
  setScale(remPx) {
    this.chart.applyOptions({ layout: { fontSize: Math.round(remPx * 0.8) } });
    this.series.applyOptions({ lineWidth: remPx >= 24 ? 3 : 2 });
  }

  setTone(tone) {
    if (tone === this.tone) return;
    this.tone = tone;
    this.applyTone();
  }

  applyTone() {
    const t = TONES[this.tone] || TONES.flat;
    this.series.applyOptions({ lineColor: t.line, topColor: t.top, bottomColor: 'rgba(0, 0, 0, 0)' });
  }

  /** Replace the whole series. s = { points: [[sec, value]…], prevClose, intervalSec, start, end } */
  setSeries(s) {
    this.intervalSec = s.intervalSec || 60;
    // One constant shift to display-timezone wall time (charts render UTC).
    // Constant, not per-point, so a DST change can never make time go backwards.
    this.offsetSec = Math.round(tzOffsetMs(Date.now(), this.tz) / 1000);
    const off = this.offsetSec;

    const data = s.points.map(([t, v]) => ({ time: t + off, value: v }));
    this.series.setData(data);
    this.lastTime = data.length ? data[data.length - 1].time : 0;

    const ts = this.chart.timeScale();
    if (this.fixedSession && s.start && s.end) {
      const ws = [];
      const step = this.intervalSec;
      const from = Math.floor(s.start / 1000 / step) * step;
      const to = Math.floor(s.end / 1000 / step) * step;
      for (let t = from; t <= to; t += step) ws.push({ time: t + off });
      this.axis.setData(ws);
      this.setPrevClose(s.prevClose);
      // Trailing whitespace is ignored by fitContent(), so set the span explicitly.
      ts.setVisibleLogicalRange({ from: 0, to: ws.length - 1 });
    } else {
      this.axis.setData([]);
      this.setPrevClose(s.prevClose);
      ts.fitContent();
    }
  }

  setPrevClose(v) {
    if (v == null || v === this.prevClose) return;
    this.prevClose = v;
    this.prevLine.applyOptions({ price: v, lineVisible: true });
  }

  /** Apply a live quote to the end of the line. */
  tick(price, asOfMs) {
    if (!this.lastTime || price == null) return;
    const step = this.intervalSec;
    const t = Math.floor(asOfMs / 1000 / step) * step + this.offsetSec;
    if (t < this.lastTime) return;
    this.series.update({ time: t, value: price });
    this.lastTime = t;
  }

  /** Redraw after web fonts load (canvas text doesn't reflow on its own). */
  refreshFonts() {
    this.chart.applyOptions({ layout: { fontFamily: 'Inter, system-ui, sans-serif' } });
  }
}
