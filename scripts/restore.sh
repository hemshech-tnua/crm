#!/usr/bin/env bash
# Restore an encrypted backup made by scripts/backup.sh into a database that already has the schema
# (a fresh Supabase project after `supabase db push`, or the local stack after `supabase db reset`).
# REPLACES ALL CRM DATA AND STAFF ACCOUNTS IN THE TARGET.
#
#   DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
#   BACKUP_PASSPHRASE_FILE=~/.hemshech-backup-pass \
#   scripts/restore.sh backups/hemshech-2026-11-06-0300.sql.enc --replace-all-data
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: restore.sh <backup.sql.enc> --replace-all-data}"
[ "${2:-}" = "--replace-all-data" ] || { echo "refusing: pass --replace-all-data to confirm that the target's data will be replaced" >&2; exit 1; }
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PLAIN="$(mktemp)"
trap 'rm -f "$PLAIN"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$FILE" -out "$PLAIN"

{
  echo 'begin;'
  echo 'set session_replication_role = replica;'
  # empty the target first (reference rows from the migrations, test users from a local seed)
  echo 'truncate public.audit_log, public.consents, public.contact_log, public.feedback, public.follow_ups, public.registrations,
        public.referral_links, public.participants, public.events, public.speakers, public.message_templates,
        public.settings, public.acquisition_sources, public.sites, public.staff restart identity cascade;'
  echo 'truncate private.rate_limits;'
  echo 'delete from auth.identities; delete from auth.users;'
  grep -v -E '^SET transaction_timeout' "$PLAIN"
  echo 'commit;'
} | psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null

echo "restored from $FILE"
psql "$DB_URL" -Atc "select 'participants: ' || count(*) from public.participants union all
                     select 'events: ' || count(*) from public.events union all
                     select 'registrations: ' || count(*) from public.registrations union all
                     select 'staff accounts: ' || count(*) from public.staff"
