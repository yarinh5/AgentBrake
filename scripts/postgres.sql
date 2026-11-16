-- Run manually as a database administrator in a dedicated pilot database.
-- The gateway never runs migrations or DDL against your PostgreSQL server.
CREATE TABLE public.agentbrake_customers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  version integer NOT NULL DEFAULT 0
);

INSERT INTO public.agentbrake_customers (name,plan)
VALUES ('Pilot customer','Starter');

-- Create a dedicated login/role using your secret-management process first.
-- Replace agentbrake_gateway with that role's name. It must not own the table.
GRANT USAGE ON SCHEMA public TO agentbrake_gateway;
GRANT SELECT (id,name,plan,status,version), UPDATE (status,version)
ON public.agentbrake_customers TO agentbrake_gateway;
-- No DELETE, TRUNCATE, CREATE, schema ownership or superuser privileges are needed.
