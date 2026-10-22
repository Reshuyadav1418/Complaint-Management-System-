#!/usr/bin/env bash
# Restore a backup made by backup.sh into a database and storage directory.
#
#   ./restore.sh <backup-prefix> <target-mongodb-uri> <target-storage-dir> [--replace]
#
#   <backup-prefix>   e.g. /srv/backups/sfa-cms-20261022T020000Z
#
# Checksums are verified first. The target database must be empty unless
# --replace is given, so a restore can never silently overwrite live data.
# Practise restores into a separate database (e.g. sfa_cms_restoretest).
set -euo pipefail

prefix="${1:?Usage: restore.sh <backup-prefix> <target-uri> <target-storage-dir> [--replace]}"
target_uri="${2:?target MongoDB URI required}"
target_storage="${3:?target storage directory required}"
replace="${4:-}"

dir="$(dirname "$prefix")"; name="$(basename "$prefix")"
echo "verifying checksums"
( cd "$dir" && sha256sum --check --quiet "${name}.sha256" )

# Source database name is read from the archive; target from the URI.
target_db="$(node -e 'const u=new URL(process.argv[1]);console.log(u.pathname.replace(/^\//,""))' "$target_uri")"
[ -n "$target_db" ] || { echo "target URI must include a database name"; exit 1; }
source_db="$(mongorestore --gzip --archive="${prefix}.db.archive.gz" --dryRun -v 2>&1 | sed -n 's/.*archive prelude \([^.]*\)\..*/\1/p' | head -1)"
[ -n "$source_db" ] || { echo "could not read the database name from the archive"; exit 1; }

# Uses the MongoDB driver installed with the API.
server_modules="$(cd "$(dirname "$0")/../server" && pwd)/node_modules"
export NODE_PATH="${server_modules}${NODE_PATH:+:$NODE_PATH}"
existing="$(node -e '
const { MongoClient } = require("mongodb");
MongoClient.connect(process.argv[1]).then(async (c) => { const n = (await c.db().listCollections().toArray()).length; console.log(n); await c.close(); });
' "$target_uri")"
if [ "$existing" != "0" ] && [ "$replace" != "--replace" ]; then
  echo "target database '${target_db}' is not empty (${existing} collections). Use --replace to overwrite it."
  exit 1
fi

echo "restoring database ${source_db} -> ${target_db}"
# Connect without a database in the URI: with one, mongorestore treats it as a
# filter and the renamed collections silently restore nothing.
server_uri="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/";console.log(u.toString())' "$target_uri")"
log="$(mongorestore --uri="$server_uri" --gzip --archive="${prefix}.db.archive.gz" \
  --nsInclude="${source_db}.*" --nsFrom="${source_db}.*" --nsTo="${target_db}.*" ${replace:+--drop} 2>&1)" || { echo "$log"; exit 1; }
summary="$(echo "$log" | grep -E 'document\(s\) restored' | tail -1 | sed 's/^[^\t]*\t//')"
echo "  ${summary}"
restored="$(echo "$summary" | sed -n 's/^\([0-9]*\) document.*/\1/p')"
failed="$(echo "$summary" | sed -n 's/.* \([0-9]*\) document(s) failed.*/\1/p')"
if [ -z "$restored" ] || [ "$restored" = "0" ] || [ "${failed:-0}" != "0" ]; then
  echo "RESTORE FAILED: ${summary:-no summary from mongorestore}"
  exit 1
fi

echo "restoring attachments -> ${target_storage}"
mkdir -p "$target_storage"
tar -C "$target_storage" -xzf "${prefix}.storage.tar.gz"
echo "Restore complete."
