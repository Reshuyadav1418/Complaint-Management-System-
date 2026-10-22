#!/usr/bin/env bash
# Back up the database and the attachment files together.
#
#   MONGODB_URI=... STORAGE_DIR=/srv/sfa-cms/storage BACKUP_DIR=/srv/backups ./backup.sh
#
# Produces, in BACKUP_DIR:
#   sfa-cms-<timestamp>.db.archive.gz     mongodump of the database
#   sfa-cms-<timestamp>.storage.tar.gz    the attachment files
#   sfa-cms-<timestamp>.sha256            checksums of both
# and deletes backups older than BACKUP_RETENTION_DAYS (default 30).
# Run it daily from cron; copy BACKUP_DIR off the server (see docs/DEPLOYMENT.md).
set -euo pipefail

: "${MONGODB_URI:?Set MONGODB_URI}"
: "${STORAGE_DIR:?Set STORAGE_DIR}"
: "${BACKUP_DIR:?Set BACKUP_DIR}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="${BACKUP_DIR%/}/sfa-cms-${stamp}"
mkdir -p "$BACKUP_DIR"
umask 077   # backups contain personal data: owner-only

echo "[$(date -u +%FT%TZ)] dumping database"
# Single-database dump. It is not a point-in-time snapshot across
# collections, so schedule it at a quiet hour (e.g. 02:00). For point-in-time
# recovery use the hosting provider's continuous backup (docs/DEPLOYMENT.md).
mongodump --uri="$MONGODB_URI" --gzip --archive="${base}.db.archive.gz" 2>&1 | grep -vE 'done dumping|writing ' || true
[ -s "${base}.db.archive.gz" ] || { echo "database dump failed"; exit 1; }

echo "[$(date -u +%FT%TZ)] archiving attachments from ${STORAGE_DIR}"
tar -C "$STORAGE_DIR" -czf "${base}.storage.tar.gz" .

( cd "$BACKUP_DIR" && sha256sum "$(basename "${base}.db.archive.gz")" "$(basename "${base}.storage.tar.gz")" > "$(basename "${base}.sha256")" )

echo "[$(date -u +%FT%TZ)] removing backups older than ${RETENTION} days"
find "$BACKUP_DIR" -maxdepth 1 -name 'sfa-cms-*' -type f -mtime "+${RETENTION}" -print -delete

ls -lh "${base}".* | awk '{print "  " $5 "  " $9}'
echo "Backup complete: ${base}"
