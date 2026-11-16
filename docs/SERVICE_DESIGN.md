# AgentBrake service operation design

2026-11-16. User asks for a finished usable service and has delegated routine decisions. Existing source a37811a7 has verified enforcement, independent approvals, persistent isolated deployment and UI. This continuation addresses demonstrated usability/operations gaps: file-based daily login, immutable team roster, no credential recovery, no verified backup/restore, no upgrade lifecycle, and connection/setup guidance spread across engineering files.

## Decision and scope

Choose a private installation for each team, extending the existing Next.js/Control API/Gateway/OPA/PostgreSQL architecture. A hosted multi-tenant SaaS would change the binding PD-05/PD-20 boundaries and require external infrastructure. A cosmetic marketing site would not address the identified gaps. No real accounts, paid service, public deployment, real GitHub/DB credentials or existing unrelated environment/configuration will be used. Single tenant, English UI and existing enforced tool catalog remain binding. This is an engineering choice under the user's delegation, not a claim that public commercial operation was authorized.

## Deliverables and observable acceptance

1. Managed team accounts: one-time bootstrap with the generated administrator key, then email/password sign-in; admin-issued single-use expiring invitations and recovery tokens; profile/password change; role change/disable with last-admin protection. Local email is an identifier; there is no claim of verified email ownership or sent email. Invitation links are copied by the admin. Persist hashes only; existing task ownership IDs and human audit survive. Existing fixture key mode remains explicit compatibility, and product key login stops after managed bootstrap. Revoked users/sessions lose access on the next request.
2. Operator experience: first-run account creation, invitation acceptance, normal login, Team and Settings pages, role-aware controls, usable onboarding and connection instructions, service version/build scope and local status. No fake connected badges or fabricated billing/support activity. Keep existing action/approval/evidence UI and all security invariants.
3. Operations: versioned forward control-schema migrations; installation preflight/doctor; encrypted consistent backups of control/target/Git and required generated configuration; restore only to a new installation, with original evidence preserved and all restored grants paused/revoked before serving traffic. Wrong key, tampering, foreign/outside-workspace paths and existing destination reject without damage. Actual restore followed by verified login/audit/target comparison is mandatory. Restart alone is not restore evidence.
4. Release: local source package/manifest, deployment and incident/recovery runbook, support diagnostics without secrets, focused security/browser/PG tests then complete matching-source release. Fresh generated team-installation demo must work through the actual installed UI.

## Security choices

- Node's built-in asynchronous scrypt at N=131072, r=8, p=1, random salt, bounded password size and bounded concurrent KDF work avoids new native dependencies. Source: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Session cookies remain HttpOnly/SameSite=Strict with CSRF; loopback remains the only published interface.
- Identity changes and audit are one transaction in PostgreSQL/SQLite. Audits contain authenticated actor and safe target/action fields, never password/hash/invite token/session. Last-admin checks serialize with identity changes. Password/role/disable/reset changes invalidate relevant sessions.
- Consistent database dumps alone do not establish a cross-resource snapshot ([PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)). For the bounded pinned-image installation, choose a cold snapshot: stop all installation writers and databases, then archive the three dedicated volumes in that same maintenance window. Preserve exact PostgreSQL image compatibility and original Git installation marker. Resume prior services in finally; failure leaves explicit recovery instructions and never claims a backup exists. This trades a brief local maintenance window for a simple verifiable cross-resource restore; it is not online backup or cross-version PostgreSQL migration.
- Backup encryption is authenticated AES-256-GCM with a separate randomly generated recovery-key file. Backups are bounded and validated before any destination creation. Restores cannot silently reinstate old execution authority. No automatic retry of an uncertain mutation.
- Existing local installation is preserved until migration/restore acceptance passes on disposable installations. No reset of user-visible data.

## Remaining external gates

External human security review, independent clean-machine validation and actual live integration remain explicit separate gates. No certification, uptime SLA, legal identity, billing contract or production-readiness claim is invented. The delivered engineering work must still be concrete, installed and usable locally.
