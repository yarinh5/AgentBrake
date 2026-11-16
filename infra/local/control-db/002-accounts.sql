\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS identity_state (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  data TEXT NOT NULL
);
INSERT INTO identity_state(id,data)
VALUES (1,'{"initialized":false,"accounts":[],"invitations":[],"recoveries":[]}')
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON identity_state FROM PUBLIC;
GRANT SELECT, UPDATE ON identity_state TO control_runtime;
COMMIT;
