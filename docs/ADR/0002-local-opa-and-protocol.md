# ADR-0002 — OPA verification and explicit MCP eras

Date: 2026-11-16. Status: accepted local verification choice; Docker acceptance outstanding.

OPA 1.22.4 is fetched only from official release assets and verified against pinned SHA-256. Development/tests launch a separate OPA process with bearer authentication and Rego authorization allowing only the exact decision endpoint and health endpoint. No unauthenticated management port; no policy mutation capability is granted to the gateway token. Temporary auth material is excluded from logs, source manifests and Git. The target deployment remains an internal Docker sidecar without host port publication.

Docker client/Compose exist but both local contexts return daemon HTTP 500. Native loopback OPA enables genuine PDP testing without resetting Docker Desktop, modifying WSL or disrupting unrelated containers. It is **not** evidence of container network separation. T20 stays NOT RUN and Milestone A stays open until an isolated agent container cannot reach the target.

MCP target: 2026-07-28 stateless request routing with official SDK 2.4.0; explicit tested compatibility for 2025-11-25. Only supported discovery/ping/tools methods and required legacy handshake are accepted. Header/body/envelope consistency is checked, and identity originates solely from server-authenticated credentials. Installed SDK types/source and executable tests, rather than assumed v1 behavior, determine integration APIs.

References: https://www.openpolicyagent.org/docs/security ; https://ts.sdk.modelcontextprotocol.io/v2/ . Package versions and binary digests will be in the proof pack.
