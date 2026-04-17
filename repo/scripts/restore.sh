#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HarborStone restore script (PRD §Phase-5 exit checkpoint).
#
# Restores a backup produced by scripts/backup.sh into the running compose
# stack:
#   ./scripts/restore.sh /var/backups/harborstone/<timestamp>
#
# Steps:
#   1. Verify manifest sha256 checksums.
#   2. Drop + recreate the target database.
#   3. Stream the gzipped SQL dump into the db service.
#   4. Wipe the storage volume and restore attachments tarball into it.
#
# This is destructive — it overwrites both the database and the attachment
# volume with the contents of the backup. Always confirm before running on
# production.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backup-dir>" >&2
  exit 64
fi
SRC="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_SERVICE="${DB_SERVICE:-db}"
API_SERVICE="${API_SERVICE:-api}"
DB_NAME="${DB_NAME:-harborstone}"
DB_USER="${DB_USER:-harborstone}"
DB_PASSWORD="${DB_PASSWORD:-harborstone_pass}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-harborstone_root}}"
STORAGE_VOLUME="${STORAGE_VOLUME:-/data/attachments}"

log() { printf '[restore %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

[[ -d "${SRC}" ]] || { echo "backup dir not found: ${SRC}" >&2; exit 1; }
[[ -f "${SRC}/db.sql.gz" ]] || { echo "missing db.sql.gz" >&2; exit 1; }
[[ -f "${SRC}/attachments.tar.gz" ]] || { echo "missing attachments.tar.gz" >&2; exit 1; }
[[ -f "${SRC}/manifest.txt" ]] || { echo "missing manifest.txt" >&2; exit 1; }

# ── Verify checksums ────────────────────────────────────────────────────────
log "Verifying manifest checksums"
expected_db="$(grep '^db_sha256=' "${SRC}/manifest.txt" | cut -d= -f2)"
expected_att="$(grep '^attachments_sha256=' "${SRC}/manifest.txt" | cut -d= -f2)"
actual_db="$(sha256sum "${SRC}/db.sql.gz" | awk '{print $1}')"
actual_att="$(sha256sum "${SRC}/attachments.tar.gz" | awk '{print $1}')"
[[ "${expected_db}" == "${actual_db}" ]] \
  || { echo "db.sql.gz checksum mismatch (expected ${expected_db}, got ${actual_db})" >&2; exit 2; }
[[ "${expected_att}" == "${actual_att}" ]] \
  || { echo "attachments.tar.gz checksum mismatch" >&2; exit 2; }

# ── Database ────────────────────────────────────────────────────────────────
log "Recreating database '${DB_NAME}'"
(
  cd "${ROOT_DIR}"
  docker compose exec -T "${DB_SERVICE}" \
    mysql -uroot -p"${DB_ROOT_PASSWORD}" -e "
      DROP DATABASE IF EXISTS \`${DB_NAME}\`;
      CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
      GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
      FLUSH PRIVILEGES;"
)

log "Restoring database from ${SRC}/db.sql.gz"
gunzip -c "${SRC}/db.sql.gz" \
  | (cd "${ROOT_DIR}" && docker compose exec -T "${DB_SERVICE}" \
       mysql -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}")

# ── Attachment storage ─────────────────────────────────────────────────────
log "Wiping ${STORAGE_VOLUME} and restoring attachments"
(
  cd "${ROOT_DIR}"
  docker compose exec -T "${API_SERVICE}" sh -c \
    "rm -rf '${STORAGE_VOLUME}'/* '${STORAGE_VOLUME}'/.[!.]* 2>/dev/null || true"
)

(
  cd "${ROOT_DIR}"
  docker compose exec -T "${API_SERVICE}" \
    tar -C "${STORAGE_VOLUME}" -xzf -
) < "${SRC}/attachments.tar.gz"

log "Restore complete from ${SRC}"
