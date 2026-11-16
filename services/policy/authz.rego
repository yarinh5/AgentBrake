package system.authz
import rego.v1
default allow := false
allow if {
  input.identity == data.agentbrake_auth.token
  input.method == "POST"
  input.path == ["v1", "data", "agentbrake", "decision"]
  count(input.params) == 0
}
allow if {
  input.identity == data.agentbrake_auth.token
  input.method == "GET"
  input.path == ["health"]
  count(input.params) == 0
}
