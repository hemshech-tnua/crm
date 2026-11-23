#!/usr/bin/env node
// Tiny zero-dependency static server for local preview: http://127.0.0.1:4173/crm/site/
// Serves dist/ under the /crm/ mount (like GitHub Pages serves the repository), so /crm/site/… → dist/site/….
//   node site/serve.mjs            serve what is built
//   node site/serve.mjs --watch    also rebuild (preview build) when anything in site/ changes; reload the page yourself
// Env: PORT (4173), HOST (127.0.0.1), SERVE_MOUNT (/crm/), SITE_BASE (/crm/site/).
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SITE, '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MOUNT = process.env.SERVE_MOUNT || '/crm/';
const BASE = process.env.SITE_BASE || '/crm/site/';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

function resolveFile(urlPath) {
  if (!urlPath.startsWith(MOUNT)) return null;
  const rel = decodeURIComponent(urlPath.slice(MOUNT.length));
  const file = resolve(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + sep)) return null; // no ../ escapes
  if (existsSync(file) && statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    return existsSync(index) ? index : null;
  }
  return existsSync(file) ? file : null;
}

function notFoundFile(urlPath) {
  // the site's own 404 (English under /en/), like a host configured for it
  const siteRel = BASE.slice(MOUNT.length);
  const en = urlPath.startsWith(BASE + 'en/');
  const f = join(DIST, siteRel, en ? 'en/404.html' : '404.html');
  return urlPath.startsWith(BASE) && existsSync(f) ? f : null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  let path = url.pathname;
  if (path === '/' || path === MOUNT.replace(/\/$/, '')) {
    res.writeHead(302, { Location: BASE });
    return res.end();
  }
  // /crm/site/about → /crm/site/about/ (like GitHub Pages)
  const file0 = resolveFile(path);
  if (!path.endsWith('/') && !extname(path) && file0?.endsWith('index.html')) {
    res.writeHead(301, { Location: path + '/' + url.search });
    return res.end();
  }
  let file = file0;
  let status = 200;
  if (!file) {
    file = notFoundFile(path);
    status = 404;
  }
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found (did you run `npm run build:site`?)');
  }
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`site preview: http://${HOST}:${PORT}${BASE}  (English: ${BASE}en/)`);
});

if (process.argv.includes('--watch')) {
  let timer = null;
  let running = false;
  const rebuild = () => {
    if (running) return void (timer = setTimeout(rebuild, 200));
    running = true;
    const p = spawn(process.execPath, [join(SITE, 'build.mjs'), '--preview', '--quiet'], { stdio: 'inherit' });
    p.on('exit', (code) => {
      running = false;
      console.log(code === 0 ? `↻ rebuilt ${new Date().toLocaleTimeString()}` : '✗ build failed (see above)');
    });
  };
  watch(SITE, { recursive: true }, (_, name) => {
    if (!name || name.startsWith('test') || name.includes('node_modules')) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
  console.log('watching site/ for changes');
}
