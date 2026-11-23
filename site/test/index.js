// Entry for `node --test site/test` (Node 22 resolves the folder to this file): loads every *.test.mjs here.
// A single file also runs on its own: node --test site/test/build.test.mjs
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((x) => x.endsWith('.test.mjs')).sort()) await import(`./${f}`);
