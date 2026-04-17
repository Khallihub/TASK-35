#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HarborStone backup script (PRD §Phase-5 exit checkpoint).
#
# Produces a timestamped, point-in-time backup of:
#   • MySQL database (mysqldump --single-transaction --routines --triggers)
#   • Attachment storage volume (tar+gzip of the local filesystem repository)
#   • A small manifest with versions + sha256 checksums for verification.
#
# Output goes to ${BACKUP_DIR:-/var/backups/harborstone}/<timestamp>/.
#
# Designed to run from the host that owns the docker compose stack:
#   ./scripts/backup.sh                       # uses defaults
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# Restore companion: scripts/restore.sh <backup-dir>.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/harborstone}"
TARGET="${BACKUP_DIR}/${TIMESTAMP}"

DB_SERVICE="${DB_SERVICE:-db}"
API_SERVICE="${API_SERVICE:-api}"
DB_NAME="${DB_NAME:-harborstone}"
DB_USER="${DB_USER:-harborstone}"
DB_PASSWORD="${DB_PASSWORD:-harborstone_pass}"
STORAGE_VOLUME="${STORAGE_VOLUME:-/data/attachments}"

log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

mkdir -p "${TARGET}"
log "Writing backup to ${TARGET}"

# ── MySQL ────────────────────────────────────────────────────────────────────
log "Dumping MySQL database '${DB_NAME}' from compose service '${DB_SERVICE}'"
(
  cd "${ROOT_DIR}"
  docker compose exec -T "${DB_SERVICE}" \
    mysqldump \
      --single-transaction \
      --quick \
      --routines \
      --triggers \
      --hex-blob \
      --default-character-set=utf8mb4 \
      -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}"
) | gzip -9 > "${TARGET}/db.sql.gz"

# ── Attachment storage ──────────────────────────────────────────────────────
log "Archiving attachment storage at ${STORAGE_VOLUME} from compose service '${API_SERVICE}'"
(
  cd "${ROOT_DIR}"
  docker compose exec -T "${API_SERVICE}" \
    tar -C "${STORAGE_VOLUME}" -czf - .
) > "${TARGET}/attachments.tar.gz"

# ── Manifest ────────────────────────────────────────────────────────────────
log "Writing manifest"
{
  echo "timestamp_utc=${TIMESTAMP}"
  echo "db_name=${DB_NAME}"
  echo "storage_volume=${STORAGE_VOLUME}"
  echo "db_sha256=$(sha256sum "${TARGET}/db.sql.gz" | awk '{print $1}')"
  echo "attachments_sha256=$(sha256sum "${TARGET}/attachments.tar.gz" | awk '{print $1}')"
  echo "tool_versions:"
  echo "  mysqldump=$(docker compose exec -T "${DB_SERVICE}" mysqldump --version 2>/dev/null || echo unknown)"
  echo "  docker=$(docker --version)"
} > "${TARGET}/manifest.txt"

log "Done. Backup at ${TARGET}"
