// Asset panels: DOM construction and per-update rendering.

import { PriceChart } from './charts.js';
import { fmtPrice, fmtChange, fmtPct, fmtTime, fmtDay, fmtAgo } from './format.js';

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

// Only touch the DOM when something actually changed.
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function setAttr(node, k, v) { if (node.getAttribute(k) !== v) node.setAttribute(k, v); }

export class AssetPanel {
  constructor(asset, { featured, tz, gridArea }) {
    this.asset = asset;
    this.featured = featured;
    this.tz = tz;
    this.seriesRev = -1;

    const root = this.root = el('section', `panel${featured ? ' panel--featured' : ''}`);
    root.style.gridArea = gridArea;
    root.dataset.state = 'loading';
    root.dataset.tone = 'flat';

    const head = el('header', 'panel-head', root);
    const ident = el('div', 'ident', head);
    el('span', 'name', ident, asset.name);
    el('span', 'ticker', ident, asset.ticker);
    this.mockTag = el('span', 'mock-tag', ident, 'MOCK');
    this.badge = el('span', 'badge', head, '');

    const quote = el('div', 'quote', root);
    this.price = el('div', 'price', quote, '—');
    const chg = el('div', 'change', quote);
    this.chgAbs = el('span', 'chg-abs', chg, '');
    this.chgPct = el('span', 'chg-pct', chg, '');

    this.chartEl = el('div', 'chart', root);

    const foot = el('footer', 'panel-foot', root);
    this.footLeft = el('span', 'foot-left', foot, '');
    this.footRight = el('span', 'foot-right', foot, '');

    this.chart = new PriceChart(this.chartEl, { featured, decimals: asset.decimals, tz, fixedSession: asset.type !== 'crypto' });
  }

  /**
   * q      quote from /api/quotes (may have price:null before first data)
   * view   { state: 'live'|'closed'|'stale'|'loading', badge, ageSec, delayed }
   */
  render(q, view) {
    const a = this.asset;
    const { root } = this;
    setAttr(root, 'data-state', view.state);
    this.mockTag.hidden = !q?.mock;
    setText(this.badge, view.badge);

    if (!q || q.price == null) {
      setText(this.price, '—');
      setText(this.chgAbs, '');
      setText(this.chgPct, '');
      setText(this.footLeft, view.state === 'error' ? `Can't reach ${q.provider} · retrying` : 'Waiting for data…');
      setText(this.footRight, '');
      this.chart.setTone('stale');
      return;
    }

    const tone = q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat';
    setAttr(root, 'data-tone', tone);
    this.chart.setTone(view.state === 'stale' ? 'stale' : tone);

    setText(this.price, fmtPrice(q.price, a.decimals, a.prefix));
    const arrow = q.change > 0 ? '▲ ' : q.change < 0 ? '▼ ' : '';
    setText(this.chgAbs, arrow + fmtChange(q.change, a.decimals).replace(/^[+−]/, ''));
    setText(this.chgPct, fmtPct(q.changePct));

    // Footer: reference levels on the left, freshness on the right.
    const crypto = a.type === 'crypto';
    const p = (v) => fmtPrice(v, a.decimals, a.prefix);
    const parts = [];
    if (crypto) {
      if (this.featured) parts.push(`24h open ${p(q.prevClose)}`);
      if (q.high != null) parts.push(`H ${p(q.high)}`, `L ${p(q.low)}`);
    } else {
      parts.push(`Prev ${p(q.prevClose)}`);
      if (this.featured && q.high != null) parts.push(`H ${p(q.high)}`, `L ${p(q.low)}`);
    }
    // When stale, say why instead of showing reference levels.
    setText(this.footLeft, view.state === 'stale' && q.error ? q.error : parts.join('   ·   '));

    let right;
    if (view.state === 'stale') right = `Last update ${fmtAgo(view.ageSec)} ago`;
    else if (view.state === 'closed') right = `At close · ${fmtDay(q.asOf, this.tz)}`;
    else right = `${view.delayed ? `${view.delayed}-min delayed · ` : ''}${fmtTime(q.asOf, this.tz)}`;
    setText(this.footRight, right);

    this.chart.setPrevClose(q.prevClose);
    if (view.state !== 'stale') this.chart.tick(q.price, q.asOf);
  }

  setSeries(s) {
    this.seriesRev = s.rev;
    this.chart.setSeries(s);
  }
}
