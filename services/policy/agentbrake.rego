package agentbrake
import rego.v1
version := "stage2.v1"
supported := {"database_read", "database_update", "database_schema", "github_read_file", "github_create_issue", "github_list_repo", "github_list_branches", "github_propose_change", "github_create_branch", "github_open_pull_request"}
reads := {"database_read", "database_schema", "github_read_file", "github_list_repo", "github_list_branches", "github_propose_change"}
github_writes := {"github_create_issue", "github_create_branch", "github_open_pull_request"}

valid_context if {
  is_object(input.identity)
  is_object(input.grant)
  is_object(input.target)
  is_object(input.action)
  is_object(input.controls)
  is_number(input.now_ms)
  is_string(input.decision_id)
  input.identity.audience == "agentbrake-gateway"
  input.identity.agent_id == input.grant.agent_id
  input.identity.tenant == input.grant.tenant
  input.grant.human_owner != ""
  input.grant.id != ""
  input.grant.policy_version == version
  input.identity.expires_at_ms > input.now_ms
  input.grant.expires_at_ms > input.now_ms
  input.grant.revoked == false
  input.grant.used_calls < input.grant.max_calls
  input.grant.max_calls > 0
  input.action.rows >= 0
  input.action.rows <= input.grant.max_rows
  input.action.tool in supported
  input.action.tool in input.grant.actions
  input.target.id in input.grant.resources
  input.target.environment in input.grant.environments
  input.target.environment == "sandbox"
  input.controls.paused == false
  input.controls.agent_active == true
}

default egress_blocked := false
egress_blocked if { input.action.tool in github_writes; input.controls.tainted == true }

default effect := "DENY"
effect := "ALLOW" if { valid_context; not egress_blocked; input.action.tool in reads; input.controls.reads == "allow" }
effect := "REQUIRE_APPROVAL" if { valid_context; not egress_blocked; input.action.tool in reads; input.controls.reads == "approval" }
effect := "REQUIRE_APPROVAL" if { valid_context; not egress_blocked; input.action.tool == "database_update"; input.controls.databaseWrites == "approval" }
effect := "REQUIRE_APPROVAL" if { valid_context; not egress_blocked; input.action.tool in github_writes; input.controls.githubWrites == "approval" }

reason := "grant-expired" if { input.grant.expires_at_ms <= input.now_ms }
else := "token-expired" if { input.identity.expires_at_ms <= input.now_ms }
else := "grant-revoked" if { input.grant.revoked == true }
else := "quota-exhausted" if { input.grant.used_calls >= input.grant.max_calls }
else := "row-budget" if { input.action.rows > input.grant.max_rows }
else := "data-boundary" if { egress_blocked }
else := "scoped-read" if { effect == "ALLOW" }
else := "human-approval" if { effect == "REQUIRE_APPROVAL" }
else := "policy-deny"

default policy_hash := "unconfigured"
policy_hash := data.agentbrake_meta.policy_hash
decision := {
  "effect": effect,
  "reason_code": reason,
  "decision_id": object.get(input, "decision_id", "invalid"),
  "policy_version": version,
  "policy_hash": policy_hash
}
