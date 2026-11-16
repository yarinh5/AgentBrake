package agentbrake_test
import rego.v1

valid := {
  "decision_id": "00000000-0000-4000-8000-000000000001", "now_ms": 1000,
  "identity": {"agent_id": "agent-a", "tenant": "tenant-a", "audience": "agentbrake-gateway", "expires_at_ms": 2000},
  "grant": {"id": "task-a", "agent_id": "agent-a", "tenant": "tenant-a", "human_owner": "admin", "expires_at_ms": 2000, "revoked": false, "actions": ["database_read", "database_update", "github_read_file", "github_create_issue"], "resources": ["customers", "agentbrake/sandbox"], "environments": ["sandbox"], "policy_version": "stage2.v1", "max_calls": 10, "used_calls": 0, "max_rows": 10},
  "action": {"tool": "database_read", "rows": 5},
  "target": {"id": "customers", "environment": "sandbox"},
  "controls": {"paused": false, "agent_active": true, "tainted": false, "reads": "allow", "databaseWrites": "approval", "githubWrites": "approval"}
}

test_allowed_read if { data.agentbrake.decision.effect == "ALLOW" with input as valid }
test_write_requires_review if { data.agentbrake.decision.effect == "REQUIRE_APPROVAL" with input as object.union(valid, {"action": {"tool":"database_update", "rows":1}}) }
test_expired_grant if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"now_ms":2000}) }
test_outside_resource if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"target":{"id":"outside/repo", "environment":"sandbox"}}) }
test_unknown_tool if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"action":{"tool":"database_drop", "rows":0}}) }
test_wrong_identity if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"identity":{"agent_id":"agent-b", "tenant":"tenant-a", "audience":"agentbrake-gateway", "expires_at_ms":2000}}) }
test_wrong_tenant if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"identity":{"agent_id":"agent-a", "tenant":"tenant-b", "audience":"agentbrake-gateway", "expires_at_ms":2000}}) }
test_wrong_audience if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"identity":{"agent_id":"agent-a", "tenant":"tenant-a", "audience":"github", "expires_at_ms":2000}}) }
test_revoked if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"grant":object.union(valid.grant, {"revoked":true})}) }
test_quota if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"grant":object.union(valid.grant, {"used_calls":10})}) }
test_row_budget if { data.agentbrake.decision.effect == "DENY" with input as object.union(valid, {"action":{"tool":"database_read", "rows":11}}) }
test_missing_context if { data.agentbrake.decision.effect == "DENY" with input as {} }
