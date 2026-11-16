# Deployment modes

| Mode | Boundary / evidence |
|---|---|
| Persistent local product | Separate Next.js, Control API, Gateway/PEP, OPA, PostgreSQL control/target and durable Git/mock PR. Loopback-only fixed ingress. product.mjs and latest-product/local-release evidence. |
| Native developer compatibility | React/Vite + SQLite memory + real OPA on loopback4312. Not network isolation or team product deployment. |
| Native browser verification | Actual standalone Next + team API/OPA/HTTP synthetic target/local Git. Own ports44214/44215, explicit cleanup. |
| Isolated baseline/Codex verification | Internal-only disposable networks, actual PG/Git, official Codex CLI/local Qwen; no host published ports. Separate from persistent product browser. |
| Real sandbox GitHub App/DB | Disabled; not verified. Requires explicitly authorized disposable targets and further connector work. |
| Hosted production/multi-tenant | Unsupported and not deployed. External review/clean-machine/operational gates remain. |

No published OPA/DB/Gateway port in the product. Only credential-free ingress publishes127.0.0.1. Existing user .env/data/global client configuration is untouched. See LOCAL_PRODUCT_OPERATIONS.md.

