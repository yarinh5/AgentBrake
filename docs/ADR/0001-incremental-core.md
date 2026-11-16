# ADR-0001 — Extend the existing PEP, preserve working components

Date: 2026-11-16. Status: accepted engineering decision within the user's staged authorization.

The adopted PRD requires OPA, task-bound authority, Next.js and separate PostgreSQL stores. The checkout already has useful schemas, a gateway state machine, atomic SQLite claims, adapters, a React UI and 20 passing server tests. Rebuilding those would discard demonstrated behavior without addressing the immediate authority gap.

Decision: retain the current files and add typed OPA and MCP transport modules. Local checks are a restrictive preflight; OPA is mandatory for every otherwise admissible dispatch. There is no legacy fallback to built-in ALLOW. Existing identities lacking current grants fail closed. Stage 1 grants are local single-owner fixture grants; full task CRUD/tenant administration remains Stage 2.

Alternatives: (1) Rewrite as a monorepo immediately: more changes and poor regression isolation. (2) Parallel new gateway leaving the old allow path operational: creates a bypass. (3) Extend one PEP: selected, testable through old HTTP, stdio and new HTTP MCP paths.

Known deviations by stage: SQLite and Vite remain temporary, explicitly not satisfaction of PD-10/11. Next.js and separated PostgreSQL have scheduled implementation stages. Optional real PAT/Postgres execution must be disabled until a separately authorized sandbox integration is supplied; code can remain for later replacement/review, but not be silently active.

Evidence scope: counted local upstream fixtures prove mediated non-dispatch; they do not prove host/shell isolation or production prevention.
