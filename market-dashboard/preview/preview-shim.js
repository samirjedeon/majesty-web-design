// Browser-only preview: runs the mock data service inside the page and answers
// the screen's api/* requests locally, so the dashboard can be viewed without
// the Node server. Used for design review only; the kiosk runs the real server.

import config from '../config.js';
import { DataService } from '../server/data-service.js';
import { publicConfig } from '../server/public-config.js';

const BUILD_ID = 'preview';
const pub = publicConfig({ ...config, display: { ...config.display, hideCursor: false, dailyReloadAt: '' } }, BUILD_ID);
const service = new DataService(config, {});
service.start();

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const m = url.pathname.match(/api\/(config|quotes|series|health)$/);
  if (!m) return realFetch(input, init);
  const body =
    m[1] === 'config' ? pub
    : m[1] === 'quotes' ? { buildId: BUILD_ID, ...service.quotesSnapshot() }
    : m[1] === 'series' ? service.seriesSnapshot((url.searchParams.get('ids') || '').split(',').filter(Boolean))
    : { ok: true, assets: service.health() };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};

await import('../public/js/main.js');
