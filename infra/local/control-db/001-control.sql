\set ON_ERROR_STOP on
BEGIN;

-- The bootstrap owner is never an application credential. Runtime cannot
-- create temporary/schema objects or mutate existing audit records.
REVOKE ALL ON DATABASE agentbrake_control_fixture FROM PUBLIC;
GRANT CONNECT ON DATABASE agentbrake_control_fixture TO control_runtime;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO control_runtime;

CREATE TABLE policy_revisions (
  version BIGSERIAL PRIMARY KEY,
  policies TEXT NOT NULL
);
INSERT INTO policy_revisions(policies)
VALUES ('{"reads":"allow","databaseWrites":"approval","githubWrites":"approval"}');

CREATE TABLE settings (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  paused BOOLEAN NOT NULL,
  policies TEXT NOT NULL,
  revision BIGINT NOT NULL REFERENCES policy_revisions(version)
);
INSERT INTO settings(id,paused,policies,revision)
SELECT 1,false,policies,version FROM policy_revisions;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  created_order BIGSERIAL NOT NULL UNIQUE
);
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','pending','executing','allowed','blocked','failed','unknown')),
  data TEXT NOT NULL,
  created_order BIGSERIAL NOT NULL UNIQUE,
  UNIQUE(agent_id,request_id)
);
CREATE TABLE audit (
  seq BIGSERIAL PRIMARY KEY,
  -- TEXT is intentional: the chain hashes the exact serialized bytes.
  data TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT SELECT, UPDATE ON settings TO control_runtime;
GRANT SELECT, INSERT ON policy_revisions TO control_runtime;
GRANT SELECT, INSERT, UPDATE ON agents, actions TO control_runtime;
GRANT SELECT, INSERT ON audit TO control_runtime;
GRANT USAGE ON SEQUENCE policy_revisions_version_seq, agents_created_order_seq,
  actions_created_order_seq, audit_seq_seq TO control_runtime;

COMMIT;
