# Fresh-context review and final fix pass

2026-11-16. Single read-only review required by executing-plans; no external-system testing. The reviewer used disposable memory fixtures and real OPA. Three Important findings, one Minor gap. No second review was requested; verification is by reproducing tests and the final whole suite.

| Finding | Demonstration | Resolution / test |
|---|---|---|
| Important: cached results ignored current policy | Allowed read, then reads=deny; GET status still200/rows while POST replay403 | Bind cached access to policy revision/hash. `cached results are withdrawn from REST and MCP status after policy changes` fails before, passes after; quota-recovery test preserves valid retrieval. |
| Important: approval expired during PDP wait | Real OPA response delayed within normal deadline; expired approval still dispatched once | Recheck pending TTL immediately before execution claim; `approval expiry during awaited real PDP evaluation blocks before dispatch` changes allowed→blocked, counter0, unchanged target. |
| Important: credential-shaped tool name persisted | Unknown tool blocked but raw synthetic credential appears in actions/audit; MCP also echoed it | Store only trusted catalog or fixed unregistered label. Generic MCP rejection before SDK echo. Separate REST/export and MCP tests fail before and pass after. |
| Minor: early REST rejection audit missing | Malformed authenticated REST envelope400, no audit increment, zero dispatch | Deferred: add bounded correlation/identity/status rejection audit, no raw payload. T26 remains PARTIAL. |

`red.log`: five tests, four failures plus quota recovery pass. `green.log`: five pass. `tests/enforcement/review-regressions.test.ts` is the permanent regression suite. Final aggregate evidence is selected by `../latest.json`; earlier runs do not prove the fixes. No remaining known Important finding from this review. This review is not an independent external security assessment.
