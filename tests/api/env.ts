// Local Supabase stack (npx supabase start). Values are the public local-development defaults.
import { execSync } from 'node:child_process';

function readStatus(): Record<string, string> {
  const out = execSync('npx supabase status -o env', { cwd: new URL('../..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const status = readStatus();
export const API_URL = status.API_URL;
export const ANON_KEY = status.ANON_KEY;
export const SERVICE_KEY = status.SERVICE_ROLE_KEY;
export const DB_URL = status.DB_URL;
