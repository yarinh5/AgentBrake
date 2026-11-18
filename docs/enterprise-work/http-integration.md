# HTTPS enterprise identity integration evidence

`tests/enterprise/full-http.test.ts` exercises the production `createHttpsIngress` TLS server, a real HTTP dashboard adapter invoking the production `controlProxy`, and the production `createApp` control surface with its own managed-account policy and session registry. All destinations are fresh loopback fixtures. The adapter only converts Node request/response objects to the Fetch API contract used by the dashboard framework; it does not implement identity, authorization, routing, signature verification, or token exchange.

The local IdP uses a newly generated RSA key, serves its real JWKS over HTTP, validates authorization-code single use, client credentials, exact redirect URI and PKCE verifier, then signs an RS256 ID token. The control application performs the actual token/JWKS requests and verification. TLS uses a temporary OpenSSL certificate trusted explicitly by the test client, with `brake.example.test` as both SNI and HTTP Host. Callback URLs retain the configured external HTTPS origin; the test client connects to its local fixture port using that certificate and Host. Certificate validation is enabled. No browser, IdP, Gateway, Docker installation, live target or existing product is modified.

Three independent control installations have distinct service credentials and session registries. Their provisioning credentials have lengths 64, 300 and 512, covering the actual configuration contract. The control applications use a real `RemoteGateway` pointed at unused loopback port 9; the tested identity routes never invoke it. Existing managed accounts are bootstrapped before enterprise mode is enabled.

## Reproduced failures before parent fixes

Initial complete test run: **0/5 passed**, with these demonstrated production causes:

| Real path | Expected | Observed before fix |
| --- | --- | --- |
| TLS ingress → proxy → SCIM GET, valid 64-character credential | 200 | 401 `Service credential required`, because ingress removed Authorization |
| Dashboard HTTP → proxy → SCIM POST, valid 512-character credential | 201 | 403 `Dashboard origin verification failed`, because machine-request validation capped credentials at 256 |
| Dashboard HTTP → proxy → SCIM DELETE without a body, after successful creation | 204 | 415 `JSON body required`, because all non-GET requests required JSON |
| Complete TLS provisioning with 300-character credential | 201 | 403 before provisioning |
| Complete TLS provisioning with 512-character credential followed by SSO lifecycle | 201 then successful lifecycle | 403 before provisioning |

The diagnostic dashboard HTTP requests deliberately isolate proxy behavior while still executing the real application. Full lifecycle assertions independently require the TLS ingress fixes. A first draft used built-in fetch to override the diagnostic Host header; that client did not preserve the required wire Host in this environment. The fixture was corrected to Node HTTP request before recording the three production failures above. The production host check was unchanged.

## Acceptance assertions

The final full-path test requires SCIM creation and read through HTTPS, configured group role mapping, OIDC start JSON plus Secure/Lax transaction cookie, actual IdP authorization/code exchange, missing-cookie rejection, successful HTTPS callback with fixed 303 `/`, Secure session cookie, actual `/api/session` role, callback replay rejection, cross-install session/token denial, bodyless SCIM DELETE with ETag, session revocation and deleted-user 404. It verifies the application audit chain and a positive token-exchange count.

After the parent corrected ingress Authorization forwarding for exact SCIM routes, aligned printable bearer length with the 32–512 configuration contract, and accepted empty SCIM DELETE requests, `node --import tsx --test tests/enterprise/full-http.test.ts` passed **5/5** in 3.31 seconds. No test assertions or harness code changed between the precise red run and this green run. All full-path acceptance assertions above executed successfully. The only runtime warning was Node's existing experimental SQLite warning. `node node_modules/typescript/bin/tsc --noEmit` also passed after adding this test file.

This is synthetic local HTTP/TLS evidence. Real IdP configuration, customer assurance semantics, a physical MFA challenge, actual browser cookie navigation and deployment-specific ingress/DNS remain separate acceptance work.
