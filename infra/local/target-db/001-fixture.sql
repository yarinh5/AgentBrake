\set ON_ERROR_STOP on
\set ECHO none
\set VERBOSITY terse
\set read_password `cat /run/secrets/target-read-password`
\set write_password `cat /run/secrets/target-write-password`

BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'agentbrake_target_fixture' OR current_user <> 'fixture_owner' THEN
    RAISE EXCEPTION 'Target fixture initialization requires the dedicated database and bootstrap owner';
  END IF;
END
$guard$;

CREATE ROLE fixture_data_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE fixture_reader LOGIN PASSWORD :'read_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE fixture_writer LOGIN PASSWORD :'write_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
\unset read_password
\unset write_password

REVOKE ALL ON DATABASE agentbrake_target_fixture FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE agentbrake_target_fixture TO fixture_reader, fixture_writer;
GRANT USAGE ON SCHEMA public TO fixture_reader, fixture_writer, fixture_data_owner;

ALTER ROLE fixture_reader SET default_transaction_read_only = on;
ALTER ROLE fixture_reader SET statement_timeout = '1500ms';
ALTER ROLE fixture_writer SET statement_timeout = '1500ms';
ALTER ROLE fixture_reader SET lock_timeout = '1000ms';
ALTER ROLE fixture_writer SET lock_timeout = '1000ms';
ALTER ROLE fixture_reader SET idle_in_transaction_session_timeout = '5000ms';
ALTER ROLE fixture_writer SET idle_in_transaction_session_timeout = '5000ms';
ALTER ROLE fixture_reader SET search_path = pg_catalog;
ALTER ROLE fixture_writer SET search_path = pg_catalog;

CREATE TABLE public.agentbrake_fixture_migrations (
  version integer PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.agentbrake_customers (
  id integer PRIMARY KEY CHECK (id > 0),
  name text NOT NULL,
  plan text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);
INSERT INTO public.agentbrake_customers (id,name,plan,status,version) VALUES
  (1,'Acme Studio','Enterprise','active',0),
  (2,'Orbit Labs','Growth','active',0),
  (3,'Northstar','Enterprise','active',0),
  (4,'Forma Design','Starter','active',0);

-- Only this preapproved template may write. A primary-key predicate bounds each
-- call to one row, and the function owner is a non-login, non-admin fixture role.
CREATE FUNCTION public.agentbrake_update_customer(requested_id integer, requested_status text)
RETURNS TABLE (id integer, status text, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $template$
BEGIN
  IF requested_id IS NULL OR requested_id < 1 OR requested_status IS NULL
     OR requested_status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid fixture update arguments';
  END IF;
  RETURN QUERY
    UPDATE public.agentbrake_customers AS customer
    SET status = requested_status, version = customer.version + 1
    WHERE customer.id = requested_id
    RETURNING customer.id, customer.status, customer.version;
END
$template$;

-- Temporary CREATE allows ownership transfer, then is revoked in this transaction.
GRANT CREATE ON SCHEMA public TO fixture_data_owner;
ALTER TABLE public.agentbrake_customers OWNER TO fixture_data_owner;
ALTER TABLE public.agentbrake_fixture_migrations OWNER TO fixture_data_owner;
ALTER FUNCTION public.agentbrake_update_customer(integer,text) OWNER TO fixture_data_owner;
REVOKE CREATE ON SCHEMA public FROM fixture_data_owner;
REVOKE ALL ON FUNCTION public.agentbrake_update_customer(integer,text) FROM PUBLIC;
REVOKE ALL ON public.agentbrake_customers FROM PUBLIC;
GRANT SELECT ON public.agentbrake_customers TO fixture_reader;
GRANT EXECUTE ON FUNCTION public.agentbrake_update_customer(integer,text) TO fixture_writer;
INSERT INTO public.agentbrake_fixture_migrations(version) VALUES (1);
COMMIT;
