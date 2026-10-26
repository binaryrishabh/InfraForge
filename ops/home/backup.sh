#!/usr/bin/env bash
# Daily InfraForge database backup on the home server (run as root by infraforge-backup.timer).
# Dumps the database, proves the dump restores into a scratch database, uploads it to R2 and
# keeps 14 days there and the newest 3 locally. Credentials never reach argv or the log.
set -euo pipefail
creds=/etc/infraforge/ops/r2.credentials
endpoint=https://e36dd88ab5795d604bc5b98a802123ae.r2.cloudflarestorage.com
bucket=infraforge-backups
local_dir=/var/lib/infraforge/backups
container=infraforge-postgres-1
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$local_dir/infraforge-$stamp.dump"

install -d -m 0700 "$local_dir"
# The [default] profile file holds exactly the two keys; export them only to rclone.
read_key() { sed -n "s/^$1[[:space:]]*=[[:space:]]*//p" "$creds"; }
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ENDPOINT="$endpoint"
# The R2 key is limited to this bucket: never try to check or create buckets.
export RCLONE_S3_NO_CHECK_BUCKET=true RCLONE_S3_DISABLE_CHECKSUM=true RCLONE_CONFIG=/dev/null
RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(read_key aws_access_key_id)
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(read_key aws_secret_access_key)
export RCLONE_CONFIG_R2_ACCESS_KEY_ID RCLONE_CONFIG_R2_SECRET_ACCESS_KEY

docker exec "$container" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.part"
mv "$file.part" "$file"

# A backup only counts if it restores: load it into a scratch database and count its tables.
check=restore_check_$$
docker exec "$container" sh -c "createdb -U \"\$POSTGRES_USER\" $check"
trap 'docker exec "$container" sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $check" >/dev/null 2>&1 || true' EXIT
docker exec -i "$container" sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $check --no-owner" < "$file"
tables=$(docker exec "$container" sh -c "psql -U \"\$POSTGRES_USER\" -d $check -At -c \"select count(*) from information_schema.tables where table_schema='public'\"")
[ "$tables" -gt 10 ] || { echo "Restore check failed: only $tables tables" >&2; exit 1; }

rclone copyto "$file" "r2:$bucket/home/daily/$(basename "$file")"
rclone delete --min-age 14d "r2:$bucket/home/daily/"
ls -1t "$local_dir"/infraforge-*.dump | tail -n +4 | xargs -r rm -f
echo "Backup $(basename "$file") ($(stat -c %s "$file") bytes, $tables tables restored) uploaded to $bucket/home/daily/"
