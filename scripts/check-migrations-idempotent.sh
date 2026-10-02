#!/usr/bin/env bash
# TC-P1-DB-02: re-applies every migration on top of an already migrated local
# database. Any error (duplicate object, etc.) fails the check.
set -euo pipefail
cd "$(dirname "$0")/.."
container="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
for f in supabase/migrations/*.sql; do
  echo "re-applying $f"
  if ! out=$(docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q --single-transaction < "$f" 2>&1); then
    echo "$out" | grep -v NOTICE
    echo "DB-02: FAILED on $f"
    exit 1
  fi
done
echo "DB-02: all migrations re-applied cleanly"
