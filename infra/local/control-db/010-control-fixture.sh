#!/bin/sh
set -eu

if [ "$POSTGRES_DB" != 'agentbrake_control_fixture' ] || [ "$POSTGRES_USER" != 'control_owner' ]; then
  echo 'Control bootstrap requires the isolated fixture database and owner role.' >&2
  exit 1
fi
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
DO $bootstrap$
DECLARE
  fixture_password text := rtrim(pg_read_file('/run/secrets/control-password'), E'\r\n');
BEGIN
  IF length(fixture_password) = 0 THEN
    RAISE EXCEPTION 'The isolated control runtime password file is empty';
  END IF;
  EXECUTE format('CREATE ROLE control_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', fixture_password);
END
$bootstrap$;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --file=/opt/agentbrake-control/001-control.sql
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --file=/opt/agentbrake-control/002-accounts.sql
