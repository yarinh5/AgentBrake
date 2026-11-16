# ADR 0005: private production candidate, explicit external gates

Status: accepted for implementation, external deployment NOT authorized for a named target yet.

The user now requests progression beyond the local MVP and delegates engineering decisions. PD-05/PD-20/PD-28 remain safety gates on actual deployment and real targets, rather than a prohibition on writing and testing the required software locally.

Retain one tenant and one Gateway per installation. Add an opt-in GitHub App for one disposable repository with immutable repository and owner IDs. Local fixtures remain distinct. All writes require the existing independent human review; bounded feature branches and draft pull requests only. Token minting requests one repository and minimum permissions; no PAT or client-selected URL. Private keys remain server side.

GitHub APIs do not provide the local Git fixture's multi-reference transaction. A request can create Git objects or advance a feature ref before PR creation fails. Such an action is UNKNOWN and must be reconciled manually. The base commit is pinned and rechecked; subsequent changes by another authorized GitHub actor cannot be prevented by AgentBrake. No merge or main mutation is supported.

HTTPS mode pins one configured browser origin and uses Secure cookies. The existing private control API and agent isolation remain required. TLS termination is a separate fixed-destination service, with externally supplied certificate/key; no automated certificate purchase, DNS mutation or port exposure is implied.

Alternatives rejected: broad PAT (excess authority), dynamic endpoints (SSRF/credential leakage), live behavior substituted for fixture mode (surprising side effects), Kubernetes/hosted multi-tenant rewrite (unsupported scope and evidence).

External gates: actual selected-repository App permission verification and sandbox workflow; independent clean Linux host install/restore; OS-image vulnerability disposition; human security review; named deployment, DNS/TLS, backup location and incident owner. Commercial legal/customer validation remains founder work, never fabricated engineering evidence.

Primary contracts consulted 2026-11-16: [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [Git refs](https://docs.github.com/en/rest/git/refs), [trees](https://docs.github.com/en/rest/git/trees), [PRs](https://docs.github.com/en/rest/pulls/pulls). GitHub REST is version-pinned in the client; local HTTP contract tests are not live GitHub verification.
