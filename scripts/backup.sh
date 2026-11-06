#!/usr/bin/env bash
# Encrypted backup of all CRM data (public schema + staff login accounts).
# The schema itself is in supabase/migrations, so a backup is data only.
#
#   DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
#   BACKUP_PASSPHRASE_FILE=~/.hemshech-backup-pass \
#   scripts/backup.sh [output-dir]
#
# Output: hemshech-YYYY-MM-DD-HHMM.sql.enc (AES-256, key derived from the passphrase with PBKDF2).
# Keep the passphrase somewhere other than the backup (a password manager). Without it the file cannot be read.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE to a file containing the encryption passphrase}"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "passphrase file is empty or missing" >&2; exit 1; }
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
PLAIN="$(mktemp)"
trap 'rm -f "$PLAIN"' EXIT

TARGET=()
if [ -n "${DB_URL:-}" ]; then TARGET=(--remote="$DB_URL"); fi

# login sessions, tokens and auth logs are not backed up (they are temporary by nature)
npx supabase db dump "${TARGET[@]}" --data-only --use-copy -s public,auth \
  -x auth.sessions,auth.refresh_tokens,auth.audit_log_entries,auth.flow_state,auth.one_time_tokens,auth.mfa_amr_claims,auth.mfa_challenges,auth.schema_migrations \
  -f "$PLAIN" >/dev/null 2>&1

grep -q 'COPY "public"."participants"' "$PLAIN" || { echo "dump looks incomplete, aborting" >&2; exit 1; }

FILE="$OUT_DIR/hemshech-$STAMP.sql.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$PLAIN" -out "$FILE"
chmod 600 "$FILE"
echo "backup written: $FILE ($(wc -c < "$FILE") bytes)"
