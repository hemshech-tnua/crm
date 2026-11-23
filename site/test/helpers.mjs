// Shared helpers for the site tests: build into a temp folder and read the output.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(SITE, '..');

/** Run site/build.mjs into a fresh temp folder; returns { out, status, stdout, stderr }. */
export function build({ preview = false, env = {} } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'site-test-'));
  const r = spawnSync(process.execPath, [join(SITE, 'build.mjs'), ...(preview ? ['--preview'] : [])], {
    env: { ...process.env, SITE_PREVIEW: '', SITE_OUT: out, SITE_OUT_ANYWHERE: '1', ...env },
    encoding: 'utf8',
  });
  return { out, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function walk(dir, ext) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f, ext));
    else if (!ext || f.endsWith(ext)) out.push(f);
  }
  return out;
}

export const read = (f) => readFileSync(f, 'utf8');
