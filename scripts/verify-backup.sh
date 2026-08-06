#!/usr/bin/env bash
# Verifies a PostgreSQL custom-format (-Fc) dump file is structurally valid,
# without needing a live database connection — pg_restore --list only reads
# the archive's own table of contents.
#
# Production Readiness Audit V1, finding H7. Usage:
#   scripts/verify-backup.sh <path-to-dump-file>
#
# Runs pg_restore inside a throwaway `postgres:16` container (the same image
# docker-compose.yml's db service already uses, so no new image needs to be
# pulled on a host that's already running this stack) rather than requiring
# postgres client tools to be installed on the host itself.
set -euo pipefail

DUMP_FILE="${1:-}"
# Overridable only for testing against a non-default Postgres image tag;
# production should leave this at its default so verification always uses
# the exact same major version the real database runs.
PG_IMAGE="${PG_IMAGE:-postgres:16}"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: $(basename "$0") <path-to-dump-file>" >&2
  exit 2
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: file not found: $DUMP_FILE" >&2
  exit 1
fi

if [[ ! -s "$DUMP_FILE" ]]; then
  echo "ERROR: file is empty: $DUMP_FILE" >&2
  exit 1
fi

DUMP_DIR="$(cd "$(dirname "$DUMP_FILE")" && pwd)"
DUMP_BASENAME="$(basename "$DUMP_FILE")"

echo "Verifying backup: $DUMP_FILE"

# --list performs no restore and opens no database connection — it only
# parses the archive header/TOC, so this is safe to run against a
# production dump on any machine with Docker, including one that has never
# connected to the real database at all.
TOC_OUTPUT="$(docker run --rm -v "${DUMP_DIR}:/verify:ro" "$PG_IMAGE" pg_restore --list "/verify/${DUMP_BASENAME}" 2>&1)" || {
  echo "ERROR: pg_restore --list failed — this dump file is not a valid PostgreSQL custom-format archive:" >&2
  echo "$TOC_OUTPUT" >&2
  exit 1
}

ENTRY_COUNT="$(echo "$TOC_OUTPUT" | grep -c '^[0-9]' || true)"
if [[ "$ENTRY_COUNT" -eq 0 ]]; then
  echo "ERROR: dump archive has no table-of-contents entries — treating as invalid." >&2
  exit 1
fi

echo "OK: valid PostgreSQL custom-format dump, ${ENTRY_COUNT} archive entries."
exit 0
