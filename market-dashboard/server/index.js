// Market Wall Dashboard — server.
// Serves the static UI and a small JSON API backed by DataService.
// No dependencies beyond Node ≥ 20.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { DataService } from './data-service.js';
import { publicConfig } from './public-config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(ROOT, '../public');
const BUILD_ID = String(Date.now()); // the screen reloads itself when this changes

await loadDotEnv(path.resolve(ROOT, '../.env'));

const service = new DataService(config);
service.start();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return sendJSON(res, 403, { error: 'forbidden' });
  try {
    const body = await fs.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // Fonts/vendor are immutable; app code revalidates so updates land on reload.
      'cache-control': /\/(vendor|fonts)\//.test(pathname) ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(body);
  } catch {
    sendJSON(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    switch (url.pathname) {
      case '/api/config': return sendJSON(res, 200, publicConfig(config, BUILD_ID));
      case '/api/quotes': return sendJSON(res, 200, { buildId: BUILD_ID, ...service.quotesSnapshot() });
      case '/api/series': {
        const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
        return sendJSON(res, 200, service.seriesSnapshot(ids));
      }
      case '/api/health': return sendJSON(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()), assets: service.health() });
      default:
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'method not allowed' });
        return serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'internal error' });
  }
});

const port = Number(process.env.PORT) || config.server.port;
const host = process.env.HOST || config.server.host;
server.listen(port, host, () => {
  console.log(`Market dashboard on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Providers: crypto=${process.env.PROVIDER_CRYPTO || config.providers.crypto}, us=${process.env.PROVIDER_US || config.providers.us}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { service.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
// Keep running through unexpected errors; systemd restarts us if we do die.
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

async function loadDotEnv(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
