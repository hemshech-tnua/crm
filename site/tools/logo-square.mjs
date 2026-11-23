// One-off helper (NOT part of the build): renders site/assets/img/logo-square.png, the square logo of the JSON-LD
// Organization (512×512, the beige mark on navy) from the official symbol paths. Run: node site/tools/logo-square.mjs
import { logo } from '../lib/brand.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');
const svg = String(logo({ variant: 'symbol' }));
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent(`<html><body style="margin:0;background:#142837;display:grid;place-items:center;width:512px;height:512px;color:#ebdcb9">
<div style="height:300px;width:${Math.round(300*0.8151)}px">${svg.replace('<svg', '<svg style="height:100%;width:100%"')}</div></body></html>`);
await p.screenshot({ path: fileURLToPath(new URL('../assets/img/logo-square.png', import.meta.url)) });
await b.close();
