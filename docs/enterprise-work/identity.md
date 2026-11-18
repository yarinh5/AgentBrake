# Enterprise identity implementation and local evidence

Status: implemented and locally verified for the supported subset. Parent integration and whole-product evidence are recorded separately. No real IdP, physical authenticator, external SCIM client, native SAML, customer acceptance, or high-availability deployment is claimed.

## Contract and cause

Before this change, managed accounts supported password login/recovery and local sessions, with no federated assurance or provisioning protocol. Enabling an SSO route alone would leave those existing routes as bypasses. The existing `ControlStore.changeIdentity` contract already commits identity JSON and audit records together; SQLite holds `BEGIN IMMEDIATE`, and the PostgreSQL implementation supplies the equivalent identity lock. Existing managed sessions carry account revisions and are checked against current state on every authenticated request. This implementation reuses those contracts rather than adding a second identity database.

Acceptance conditions were: verified signed local authorization-code exchange; rejection of bad binding/claims/replays; no ordinary password, recovery, bootstrap, invitation or existing-session bypass when SSO is required; immutable explicitly provisioned subject; atomic service-only provisioning and offboarding; account revision invalidation including in-flight authentication; local-mode compatibility. The fixture exercises actual HTTP, Node RSA signing, openid-client verification, SQLite transactions and the existing session registry.

## Integration API

`server/security/enterprise-identity.ts` exports `EnterpriseIdentityConfig`, `validateEnterpriseIdentityConfig`, `EnterpriseIdentityMountOptions`, and `mountEnterpriseIdentity(app, options)`.

Required mount options are `{store, accounts, legacy, config, secureCookies, sessionCookie}`. Optional `transport: typeof fetch` is a trusted nonserialized fixed-endpoint transport for the parent's isolated egress service. The mount returns `{close(), validateReady()}`. Close clears pending authentication state; the caller should await readiness before exposing a production listener. Each identity route also validates initialized state. Mount after the common host/origin/body/surface gates; never expose it on the agent Gateway surface. Parent owns app/product/proxy/UI integration.

Construct `ManagedAccounts(store, legacy, {ssoRequired:true, breakGlassAccountId:config.breakGlassAccountId})` in enterprise mode. Omit that third argument for unchanged local mode. `OperatorSession.assurance.method` distinguishes `oidc` and `break-glass`; neither ordinary local account sessions nor key sessions qualify as SSO sessions.

Config fields:

| Field | Contract |
| --- | --- |
| issuer, authorizationEndpoint, tokenEndpoint, jwksUri | Exact configured URLs; same origin; HTTPS; no credentials, query or fragment. No discovery or token-controlled endpoint selection. |
| clientId, clientSecret | Confidential OIDC client, `client_secret_post`; secret remains configuration only. |
| redirectUri | Exact external callback URL, fixed `/api/enterprise/oidc/callback` path. |
| requiredAcr | Nonempty list; signed `acr` must match one exactly. |
| requiredAmr | Nonempty list; signed `amr` must contain every configured value. |
| maxAuthAgeSeconds | Integer 1–3600; signed `auth_time` required, checked at login; future time tolerance at most 30 seconds. |
| scimToken | Dedicated provisioning bearer secret, minimum 32 characters, separate from browser and agent credentials. |
| groupRoleMapping | Group `externalId` to existing local role, at most 128 entries. |
| breakGlassAccountId | Optional explicit existing local active administrator ID. No default. Cannot be federated or SCIM-linked. |
| providerLabel | Optional public display label. |
| testOnlyAllowLoopbackHttp | Explicit fixture escape hatch; only loopback HTTP URLs are allowed. Never enable in production configuration. |

Bootstrap managed accounts in local mode before enabling enterprise identity. There is no enterprise bootstrap password fallback. If a break-glass account is configured, readiness fails unless it is an active unfederated administrator. Keep its password offline with restricted operator access; use only for emergency administrative work. Its password login is audited as `identity.break-glass-login`, retains the explicit break-glass marker, and does not satisfy or claim IdP MFA. Account invitations, recovery issuance/reset and local team authority changes remain disabled in enterprise mode, including for break-glass. Its password can be changed using its current password. Without break-glass, password authentication is completely disabled.

## OIDC behavior

- `GET /api/enterprise/auth` returns public enabled/provider/initialized/break-glass status. `/api/enterprise/auth/status` is an equivalent compatibility alias.
- `POST /api/enterprise/oidc/start` accepts an empty body, returns `{authorizationUrl}`, and sets an HttpOnly, SameSite=Lax transaction cookie under `/api/enterprise/oidc`. Production requires Secure cookies.
- `GET /api/enterprise/oidc/callback` accepts the query response, consumes valid browser-bound state before exchange, verifies token claims and provisioning, sets the normal session cookie, clears the transaction cookie and redirects **303** to the fixed relative `/`.

`openid-client@6.9.0` is pinned by the parent. Authorization code with PKCE S256, random state and nonce, fixed redirect, RS256-only signed ID tokens, issuer/audience validation and required MFA claims are enforced. Signature validation is explicitly enabled with `enableNonRepudiationChecks`, because secure token endpoint transport alone is insufficient for this task's signed-claim requirement. Token/JWKS HTTP calls have a 10-second library timeout and no redirects. No access/refresh tokens are stored or returned. Token errors become the fixed `Federated authentication failed` response, with no upstream description.

Read sessions remain bounded to 8 hours. The application access gate requires the configured signed auth_time freshness again before every human control mutation except logout; stale assurance returns401 before dispatch and prompts organization sign-in. The explicit emergency account is audited separately and never claims IdP MFA. Physical authenticator/customer IdP acceptance remains external.

## SCIM v2 subset

Base path `/api/scim/v2`. Every route requires the dedicated bearer token; cookies, bootstrap credentials and agent tokens are not fallbacks. Responses use `application/scim+json`. Body size is 32 KB. Unsupported operations return explicit SCIM errors.

Supported resources are `Users`, `Groups`, `ServiceProviderConfig`, and `ResourceTypes`. User/Group collection GET and POST, individual GET/PUT/PATCH/DELETE are implemented. `/Schemas`, Bulk, search POST, sorting, attribute projection and unlisted operations return 501 or an explicit 400 for unsupported query/patch inputs. This is a deliberately documented subset, not an interoperability certification.

User create/replace accepts exactly `schemas`, `externalId`, `userName` (an email address), `displayName`, `active`, and this required extension:

```json
{
  "urn:agentbrake:params:scim:schemas:extension:identity:2.0:User": {
    "issuer": "https://idp.example.test",
    "subject": "stable-idp-subject"
  }
}
```

The `schemas` list includes both `urn:ietf:params:scim:schemas:core:2.0:User` and the extension URN. To link an existing local account, the service must additionally supply its exact `accountId` inside the extension. Email never links an account. Linking resets the unusable local password verifier, clears recovery state, increments the revision, and assigns only the group-derived role. Existing active break-glass accounts cannot be linked. Issuer, subject and externalId are immutable; duplicate subjects/external IDs/user names return 409. No login auto-creates users or administrators.

User PATCH supports add/replace with exact paths `active`, `displayName`, `userName`. Group create/replace accepts `schemas`, `externalId`, `displayName`, and `members:[{value:accountId}]`. Group PATCH supports add/replace/remove `members`, remove `members[value eq "account-id"]`, and add/replace `displayName`. Group externalId is immutable. Do not send read-only `id`/`meta` fields back in writable payloads; unsupported fields are rejected rather than silently accepted.

Group role mappings are deployment configuration, never taken from client-supplied role attributes. Unmapped/no groups yield viewer. The existing product has one role per account; precedence for multiple mapped groups is administrator, operator, approver, viewer. This is not a union of permissions. Group changes and affected account revisions commit with one audit event. Deprovisioning takes precedence over retaining the last federated administrator; operators must maintain their emergency plan.

All users (including tombstones) share the existing limit of 256, and groups are limited to 128. Deletes retain immutable binding tombstones, deny future login and remove memberships. Repeated delete is idempotent; re-creating a tombstoned subject/group externalId returns 409. Use `active:false` then `active:true` for reversible suspension. Repeating equivalent replacements/member changes does not increment revisions. ETags are returned and optional `If-Match` is checked atomically; stale matches return 412. POST retries return uniqueness conflict rather than creating duplicates. Listing supports bounded exact `id`, `userName`, `externalId`, `displayName eq "value"` filters (userName only on Users), startIndex 1–1,000,000, count 0–100; no unbounded expression evaluation.

## Tests and fail-first evidence

- First policy run failed two assertions: password bypass was accepted and break-glass assurance was absent. Implemented policy/session markers, then verified behavior.
- The initial OIDC/SCIM suite failed explicitly because the enterprise identity mount did not exist. The later real HTTP run exposed a test expectation of 302 after the parent fixed the integration contract at 303; the assertion was corrected to the actual caller contract, not the implementation changed to satisfy it.
- A targeted test demonstrated that a federated account could still use the explicitly configured break-glass password policy. Added federation exclusion at login, final transaction and session verification; the test then passed.
- A targeted previous-configuration fixture demonstrated an obsolete persisted administrator role surviving removal of its configured group mapping. Current mapping is now derived during the same final login transaction; the test now returns viewer.
- The first combined legacy/policy run had one test mistake reading audit row `.type` instead of JSON-decoding `.data`; corrected the test according to the actual audit store contract. All eight preexisting account tests passed in that run.
- `node --import tsx --test tests/enterprise/identity.test.ts tests/enterprise/identity-policy.test.ts`: **10 passed**, including signed positive/negative protocol exchange, SCIM service auth/ETags/filters, immutable links, revision races, group role removal, audit-trigger rollback, deletion/idempotence, expiry/capacity, and obsolete mappings.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed** after the final identity implementation.
- `node --import tsx --test tests/enforcement/accounts.test.ts`: **8 passed** on the final identity revision (90.98 seconds), including real HTTP credentials/recovery/authority, restart persistence, audit rollback and session-capacity races.

The parent runs the complete project suite and final application/proxy/isolated integration gates after shared integration. This subtask does not claim those checks merely from its standalone mount tests. Fixture output includes Node's existing experimental SQLite warning and existing MCP notification warnings in legacy account tests.

## Sources and remaining acceptance

The [openid-client project](https://github.com/panva/openid-client) documents maintained v6 support. Its [signature-check API](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md) is used explicitly; its [authorization-code checks](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md) provide nonce, state, PKCE and max-age validation. Protocol choices follow [OpenID Connect Core ID Token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) and [SCIM RFC 7644](https://www.rfc-editor.org/rfc/rfc7644.html).

Real customer issuer metadata/client registration, actual MFA assurance semantics, browser deployment redirect/cookie behavior, provisioning client mappings, physical authenticator proof, key rotation under a real IdP and external service availability remain external acceptance work. Native SAML is not implemented; an upstream broker may federate SAML to the configured OIDC provider, subject to its own acceptance. No installed product, customer identity account or external service was changed during this implementation.

Protocol references used during implementation: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0-35.html), [openid-client maintained implementation/API](https://github.com/panva/openid-client), [SCIM protocol RFC7644](https://www.rfc-editor.org/rfc/rfc7644.html). Public npm registry metadata resolved the pinned dependency openid-client6.9.0; tests exercise its signature and protocol checks.
