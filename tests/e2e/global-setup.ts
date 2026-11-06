// Local test environment only: all browser traffic here comes from one address, so the per-IP rate limits
// (registration 20/hour, check-in 40/10 min) would trip after a few runs. Production limits are unchanged.
import { execSync } from 'node:child_process';
import { DB_URL } from '../api/env';

export default function globalSetup() {
  if (!/127\.0\.0\.1|localhost/.test(DB_URL)) throw new Error('E2E global setup refuses to touch a non-local database');
  execSync(`psql "${DB_URL}" -q -c "truncate private.rate_limits"`);
}
