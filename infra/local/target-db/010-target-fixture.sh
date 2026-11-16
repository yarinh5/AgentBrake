#!/bin/sh
set -eu

if [ "${POSTGRES_USER:-}" != fixture_owner ] || [ "${POSTGRES_DB:-}" != agentbrake_target_fixture ]; then
  echo 'Target fixture initialization requires its dedicated database and bootstrap owner.' >&2
  exit 1
fi
for secret in /run/secrets/target-read-password /run/secrets/target-write-password; do
  if [ ! -r "$secret" ] || [ "$(wc -c < "$secret")" -lt 24 ]; then
    echo 'Target fixture initialization requires generated role secret files.' >&2
    exit 1
  fi
done

# psql reads role passwords from files inside the SQL script; no passwords in argv.
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --file=/opt/agentbrake-target/001-fixture.sql
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --file=/opt/agentbrake-target/002-reviewed-update.sql
