#!/usr/bin/env bash
# One command for the local demo with fictitious data: local Supabase, demo data, production build, preview on :4173.
# Nothing here touches a hosted project.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then
  (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
npx supabase start >/dev/null
npx supabase db reset >/dev/null
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/demo-data.sql
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/demo-live.sql
# local only: a sample team WhatsApp number for the footer (the hosted demo leaves it empty)
psql "$DB" -q -c "update public.settings set contact_phone = '+972527110055'"
# the Edge runtime sometimes starts before the network is ready after a machine restart
for _ in 1 2 3; do
  curl -s -m 30 -X POST http://127.0.0.1:54321/functions/v1/staff-admin -d '{}' | grep -q unauthenticated && break
  docker restart supabase_edge_runtime_hemshech-tnua >/dev/null; sleep 6
done
ANON=$(npx supabase status -o env | grep ^ANON_KEY= | cut -d'"' -f2)
printf "VITE_SUPABASE_URL=/sb\nVITE_SUPABASE_ANON_KEY=%s\n" "$ANON" > .env.local
npm run build >/dev/null
pkill -f "vite preview" 2>/dev/null || true
(nohup npx vite preview --port 4173 >/tmp/hemshech-preview.log 2>&1 &)
for _ in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
echo "demo ready: http://127.0.0.1:4173/  (admin@example.test / coord@example.test / door@example.test, password Local-Test-2026)"
psql "$DB" -Atc "select 'check-in link: #/c/' || checkin_code from events where title like 'מפגש הדגמה%'"
