\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'agentbrake_target_fixture' OR current_user<>'fixture_owner' THEN
  RAISE EXCEPTION 'Dedicated target fixture owner required';
 END IF;
END
$guard$;
CREATE FUNCTION public.agentbrake_update_customer_checked(requested_id integer,requested_status text,expected_version integer)
RETURNS TABLE(id integer,status text,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $template$
BEGIN
 IF requested_id IS NULL OR requested_id<1 OR requested_status IS NULL OR requested_status NOT IN ('active','paused') OR expected_version IS NULL OR expected_version<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid reviewed update arguments';
 END IF;
 RETURN QUERY UPDATE public.agentbrake_customers AS customer
 SET status=requested_status,version=customer.version+1
 WHERE customer.id=requested_id AND customer.version=expected_version
 RETURNING customer.id,customer.status,customer.version;
END
$template$;
GRANT CREATE ON SCHEMA public TO fixture_data_owner;
ALTER FUNCTION public.agentbrake_update_customer_checked(integer,text,integer) OWNER TO fixture_data_owner;
REVOKE CREATE ON SCHEMA public FROM fixture_data_owner;
REVOKE ALL ON FUNCTION public.agentbrake_update_customer_checked(integer,text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agentbrake_update_customer(integer,text) FROM fixture_writer;
GRANT EXECUTE ON FUNCTION public.agentbrake_update_customer_checked(integer,text,integer) TO fixture_writer;
INSERT INTO public.agentbrake_fixture_migrations(version) VALUES(2);
COMMIT;
