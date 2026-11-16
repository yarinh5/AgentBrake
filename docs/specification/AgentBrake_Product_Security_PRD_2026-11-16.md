# AgentBrake — Product, Security & Go-to-Market Specification
**Version:** 1.0 — Strategy / implementation baseline  
**Date:** 2026-11-16  
**Status:** החלטות מוצעות לביצוע MVP. לא טענה שהמוצר כבר נבנה, נבדק או מאובטח.  
**Document owner:** Founder / Product & Security Lead  
**Language:** עברית, עם מונחים ו-API באנגלית.

> **החלטת יסוד:** לא לבנות עוד MCP Gateway גנרי. לבנות שכבת *Task-Bound Change Control* לפעולות של סוכני פיתוח ב-GitHub וב-PostgreSQL: מה המשתמש אישר, איזו הרשאה זמנית ניתנה, מה עומד להשתנות, מי אישר, האם אכן בוצע, ואיך מוכיחים שהפעולה האסורה **לא** הגיעה למערכת היעד.

---

## 1. תקציר מנהלים

**משפט המוצר:** AgentBrake מאפשר לצוותי פיתוח לתת לסוכני AI גישה מוגבלת לקוד ולנתונים, בלי להעניק להם הרשאות חופשיות: כל פעולה בעלת השפעה עוברת בדיקת מדיניות מחוץ למודל, ואפשר להוכיח מה אושר, מה נחסם ומה בוצע.

**Beachhead (נישה ראשונה):** צוותי SaaS קטנים-בינוניים המפתחים עם Codex / Claude Code / Cursor, עובדים עם GitHub ו-PostgreSQL, ורוצים להגדיל אוטומציה בלי לתת לסוכנים הרשאות בלתי מוגבלות. תחילה מפתח / Tech Lead, אחר כך Platform Engineering, ואחריהם צוותי Security.

**בעיה שכדאי לבדוק מול לקוחות:** סוכנים מסוגלים להפעיל כלים ואישורים שאינם תואמים למשימה; אישור כללי לגישה למערכת אינו אישור לכל פעולה; טעויות מכוונות או מקריות עלולות להוביל למחיקת נתונים, שינויי הרשאות, פרסום מידע או שינויי ייצור לא מאושרים.

**USP שהוא השערה לבדיקה, לא עובדה מוכחת:** הרשאות תחומות למשימה וניתנות לביטול + הרשאות משאב אמיתיות + אימות שינוי/השפעה לפני ביצוע + אישור אדם המקושר בדיוק לפעולה + ראיות ביקורת אוטומטיות. תחרות קיימת גם ברוב היכולות הללו, לכן הבידול נבחן *על תרחישי פיתוח חוצי-מערכות*, לא על רשימת פיצ'רים גנרית.

**קו אדום:** התקנת MCP Gateway אינה מגינה מפני סוכן עם גישה ישירה ל-shell, לאינטרנט, לאישורי GitHub או ל-DB. הגנה אמיתית קיימת רק על מסלולי גישה ויכולות שנכפים בפועל. יש לשייך לכל טענת אבטחה את גבול הכיסוי המפורש שלה.

---

## 2. ממצאי שוק מאומתים והמשמעות העסקית

| ממצא ציבורי | מקור | משמעות |
|---|---|---|
| Gartner העריכה את שוק Securing AI בכ-$2.835B ב-2026, $4.783B ב-2027 וכמעט $7.7B ב-2028; קטגוריית AI Gateway לבדה נאמדה בכ-$429M ב-2027. | Gartner, 2026-08-26 | שוק מתפתח אך אין לגזור ממנו את גודל ה-TAM הנגיש של AgentBrake. |
| Permit MCP Gateway מציע OAuth/זהויות, מדיניות פר-קריאה, consent, audit ו-HITL ברמות מסוימות; מחיר Pro מוצג החל מ-$25 לחודש. | Permit.io docs/pricing, נבדק 2026-11-16 | אסור למצב שער הרשאות כחדשנות; תמחור Gateway גנרי נמצא תחת לחץ. |
| Runlayer מפרסם שער MCP, ניטור סוכנים ומניעת איומים בזמן ריצה. | Runlayer website | חסימה בזמן אמת ורצף פעולות אינם בידול כשלעצמם. |
| Zenity מציעה ניטור רצפי פעילות, prompt injection, data exfiltration ופעולות חריגות. | Zenity AI Detection & Response | גילוי מבוסס התנהגות הוא שוק תחרותי צפוף. |
| ToolHive הוא פתרון MCP בקוד פתוח עם בידוד, הרשאות ו-audit. | Stacklok ToolHive | ליבת Gateway יכולה להיות קומודיטי. |
| InterLock בקוד פתוח מתאר Proxy עבור PostgreSQL/HTTP/MCP עם אישורים ו-redaction. | ContextData/interlock | גם החיבור ל-DB ואישור כתיבה אינם ייחודיים. |
| Cisco השלימה רכישת Astrix ב-2026-06-29. | Cisco blog | איתות לעניין אסטרטגי, לא ראיה שיש ביקוש למוצר שלנו. |
| OWASP Top 10 Agentic Applications 2026 ו-Agent Control Standard מגדירים סיכוני agent ודרישות control. | OWASP | בסיס threat modeling ואוצר מילים למכירות. |
| פרוטוקול MCP מעודכן לגרסת 2026-07-28 עם stateless core; SDK TS v2 תומך בה וגם בגרסאות ישנות. | MCP official blog / SDK | קיבוע גרסה 2025-11-25 בלבד יהיה שגיאה טכנית. |
| תחקירי OWASP מ-2026 מסקרים פגיעויות בנתיבי קוד, GitHub, MCP ותוכן לא מהימן. | OWASP Q2/Q3 exploit roundups | לבנות בדיקות של רצפים, לא רק דוגמאות DROP TABLE. |

**אין עדיין אימות:** לא נערכו כאן ראיונות לקוחות, מדידת כוונת תשלום, ניסויי רכישה או השוואת benchmark ישירה מול מתחרים. אין להציג TAM, תמחור או יתרון עסקי כעובדה מוכחת.

### מפת מתחרים

| מתחרה | יכולות שכבר קיימות/מוצהרות | כיצד נבדוק התאמה ויתרון |
|---|---|---|
| Permit.io | Identity, RBAC/ABAC/ReBAC, MCP per-call authorization, audit, approvals | לבדוק הצמדת הרשאה למשימה מאושרת וראיית שינוי בין GitHub/DB, עלות והטמעה |
| Runlayer | MCP Control Plane, runtime inspection, agent visibility | להשוות זמן התקנה, נראות של preview before commit ודיוק מדיניות |
| Zenity / Pillar | Runtime agent threat protection, governance, sequence analysis | לא להתחרות ישירות ב-ML detection; להשוות סיכונים על workflow developer |
| Stacklok ToolHive | Open-source MCP isolation, gateway, authz | לשקול שילוב במקום להמציא מחדש רכיבי תשתית; לוודא תאימות רישוי |
| InterLock | PostgreSQL/HTTP/MCP write approval, redaction, roles | לבצע השוואת תרחישים אמיתיים כדי להפריך/לאמת בידול |
| Cisco/Astrix | Agent identities, nonhuman identities, privileged access | לא לתקוף חזיתית את שוק IAM Enterprise בשלב ראשון |

### ההשערות העסקיות שיש להפריך/לאשש

H1. לפחות 7 מתוך 15 מובילי פיתוח שירואיינו חוו או ראו פערי הרשאות/בטיחות אצל סוכן קוד משמעותי מספיק כדי לשנות workflow.  
H2. לפחות 5 מוכנים להפעיל ניסוי מבודד בלי גישת production.  
H3. לפחות 3 מוכנים לפיילוט בתשלום אם נראה מניעת נזק מוכחת.  
H4. התקנה וחיבור ראשון אמיתיים ניתנים להשלמה בלא יותר מ-15 דקות בידי בודק חיצוני, ללא סיוע ידני של המייסד.  
H5. יש רווח שימושיות מול מנגנוני הרשאות ברירת המחדל של Codex/Claude/ToolHive/Permit, הנמדד על אותו סט משימות.  
אם H3/H5 נכשלים, לבצע pivot או לעצור השקעה, לא להמשיך לבנות פיצ'רים על תקווה.

---

## 3. יומן החלטות מחייב — ADR/PD

| ID | החלטה | נימוק / גבול |
|---|---|---|
| PD-01 | מוצר B2B לצוותי פיתוח, לא מוצר אנטי-וירוס לצרכן | כאב מסוים ורוכש ברור |
| PD-02 | Target: SaaS teams 10–200 engineers כנקודת התחלה, גלובלי ובאנגלית | היפותזה ל-ICP; המחקר לא הוכיח PMF |
| PD-03 | Buyer: CTO / Head of Platform / AppSec; User: engineer / Tech Lead | התאמה לבעיה ולתקציב; לא מאומת |
| PD-04 | Hero use case: prevent unapproved cross-resource developer-agent changes | צמצום מכוון לעומת Gateway גנרי |
| PD-05 | MVP פועל מקומית וב-Docker Compose בלבד | למנוע פריצה ל-Production |
| PD-06 | Codex כ-host ראשון + MCP test client ניטרלי | אפשר בדיקות end-to-end; לא תלוי במודל אחד |
| PD-07 | MCP latest `2026-07-28` כיעד, interoperability עם `2025-11-25` לפי הצורך | עדכון פרוטוקול; לשאת תאימות באופן מפורש |
| PD-08 | Gateway/PEP כיישום TypeScript/Node.js נפרד | מהירות פיתוח ואקו-סיסטם SDK |
| PD-09 | OPA/Rego כ-PDP דטרמיניסטי, sidecar בתצורת MVP | כללי מדיניות שקופים ובדוקים; לא LLM שמחליט |
| PD-10 | אפליקציית Dashboard ב-Next.js/React; לא להריץ את האכיפה ב-Vercel serverless | זמן חיים, חיבורים, בידוד ורציפות שונים |
| PD-11 | PostgreSQL מקומי למטא-דאטה וליומן ביקורת; DB target מקומי **נפרד** | מניעת ערבוב נתוני בקרה ונתוני יעד |
| PD-12 | GitHub מתחיל ב-mock/live sandbox repo; GitHub App בעת חיבור אמיתי | פחות הרשאות; ללא PAT אישי רחב |
| PD-13 | PostgreSQL: פעולות קריאה מוגבלות; כתיבה רק ב-fixture ייעודי ובאישור; **אין raw privileged SQL** | מניעת שבירת isolation |
| PD-14 | Default deny לכל פעולה/כלי/יעד לא מאופיינים | fail closed |
| PD-15 | שינוי מדיניות מחייב versioning + history + test | עקיבות ושחזור |
| PD-16 | Approval קשור ל-hash של הפעולה, זהות, target, task, גרסת policy, TTL ו-nonce | למנוע החלפת פעולה אחרי אישור |
| PD-17 | Gateway מחזיק סודות, סוכן לא; לא להדפיס secrets ל-logs | least privilege |
| PD-18 | אין טענה ל-bypass prevention עד שמסלולים ישירים נחסמו בבדיקה | הנדסה ישרה ולא סיסמאות |
| PD-19 | Audit events מובנים; payloads ונתונים אישיים מצומצמים ומושחרים | Security/privacy by design |
| PD-20 | ללא חיבור Production, GitHub ארגוני, service_role או DB admin עד אישור נפרד מפורש | מגבלת MVP |
| PD-21 | ההרשאות נקבעות מתוך Task Grant מאושר ופרטי identity מהימנים, לא מטקסט הסוכן | העברת authority מחוץ למודל |
| PD-22 | MVP אינו מאשר אוטומטית העברת כספים, פריסה ל-Production, מחיקות, privilege changes | אין מערכת safety מוכחת לכך |
| PD-23 | אין פיצ'ר AI classifier במסלול הקריטי ל-MVP | למנוע חוסר דטרמיניזם והסברים בדיעבד |
| PD-24 | Go/no-go מבוסס סיכום ניסויים, 15 ראיונות, 3 פיילוטים בתשלום | תוקף עסקי לפני סקייל |
| PD-25 | שם AgentBrake זמני, בדיקת סימן מסחר ודומיין לפני מיתוג רשמי | אין כאן בדיקת זכויות משפטית |
| PD-26 | ספריית local community חינמית/קוד פתוח אפשרית רק אחרי סקירת רישוי ואסטרטגיה | יתרון הפצה מול ToolHive; לא החלטה לשחרר IP כעת |
| PD-27 | אנגלית כ-UI ראשי; תמיכה עתידית בעברית | שוק פוטנציאלי רחב יותר |
| PD-28 | שינויים ב-Production רק לאחר Threat Model מעודכן, review חיצוני ופיילוט מבודד | מוצר סייבר חייב ראיות |

---

## 4. תכולת ה-MVP (MUST)

### FR-01 — התקנה ועבודה ראשונית
- `docker compose up --build` מפעיל Dashboard, Gateway, Policy Engine ו-DBs מבודדים בעזרת קונפיגורציה דוגמתית בלבד.
- סקריפט setup מפיק configuration חיבור ל-Codex MCP ולקליינט בדיקה, בלי לשנות config קיים אוטומטית.
- health checks לכל רכיב, startup dependency order, reset fixtures בטוח וברור.
- הפעלה בלי API key חיצוני באמצעות simulated agent client; חיבור Codex אופציונלי.

### FR-02 — MCP Gateway ותחום הכיסוי
- תיווך `tools/list` ו-`tools/call` לתוך adapters מאושרים. כלל כלי לא ידוע = deny.
- לתמוך בגרסת הפרוטוקול שנבחרה **באופן שנבדק**, כולל שינוי `2026-07-28` stateless routing/header consistency. סכמה/גרסה לא נתמכות = שגיאה ברורה, לא pass through.
- ניקוי וסכמות קשיחות ל-args; גבולות גודל, זמן, recursion, concurrency ו-rate limits.
- אין העברת Authorization token של לקוח לשרת יעד אחר: outbound משתמש באישור מתאים ליעד בלבד.
- אין להסתמך על שם כלי, metadata, `_meta`, `Mcp-Method` או `Mcp-Name` בלבד: להצליב עם body והזהות המוכחת.

### FR-03 — Trusted Task Grant
- אישור task מפורש: `task_id`, `human_owner`, `agent_id`, `tenant`, `resources`, `actions`, `environments`, `expires_at`, `quota`, `policy_version`.
- לא ניתן להעניק יותר מסמכות המשתמש או מסמכות חשבון השירות שהוקצתה ל-Gateway.
- לכל run grants נפרדים; no cross-tenant delegation.
- task name/description free text הוא *הקשר בלבד*, לא אישור. רק allowlist מובנית ונתוני מסגרת מאושרים מחייבים.
- revoke מיידי של grant למשימות חדשות; cancel/race מול פעולות in-flight בהתאם להגבלות מתועדות.

### FR-04 — Policy Engine
- תוצאות `ALLOW | DENY | REQUIRE_APPROVAL` עם `reason_code`, `policy_version`, `decision_id` ונתוני evaluation למעקב.
- מצבי `unknown`, parse error, missing identity, failed PDP, timeout => DENY`.
- הרשאות scope לפי tenant/user/agent/task/environment/repo/branch/database/schema/table/action/row budget.
- אדמין יכול ליצור/לשנות כללים בסביבת הדגמה; כל שינוי עובר אימות schema, unit test ו-audit.
- מדיניות default מוגדרת כ-Code ונטענת דרך migrations/versioning; אין fallback ל-allow.

### FR-05 — Human approval
- Queue: פרטי action, actor, scope, target, סיכון מזוהה וההבדל המשוער (כאשר ניתן).
- approve/reject; הרשאת approver עצמאית; creator לא יכול לאשר פעולה בעלת סיכון גבוה שביצע בשם עצמו במצב צוות, אלא לפי policy מפורש.
- approval one-time + bound to hash of canonicalized exact action + grant + target + policy revision + expiry.
- אחרי approval, לבנות מחדש/לבדוק תוכן הפעולה מול hash, לבדוק מחדש את המדיניות וההרשאות לפני execute.
- no race/replay: consumption אטומי, idempotency key, single upstream effect; על חוסר ודאות אחרי timeout לא לבצע retry אוטומטי של mutation.

### FR-06 — GitHub adapter
- בהדגמה: ריפו sandbox **בבעלות המשתמש בלבד** או mock, **ללא** גישה לריפו פעיל.
- פעולות: `list_repo`, `get_file`, `list_branches`, `propose_change` (diff), `create_branch`, `open_pull_request` בהיקף מאושר.
- מניעה: force push, delete repo, change permissions, edit workflows/secrets, direct protected/main push, merge, publish release — חסומים במפורש ב-MVP.
- GitHub App with minimum permissions for adapter; repo allowlist, short-lived installation token and no credentials passed to model.
- validate repository ID, owner and branch from API, not just free text; use branch protection as an additional defense.

### FR-07 — PostgreSQL adapter
- target fixture Postgres נפרד; משתמש read-only נפרד; אין superuser, owner, BYPASSRLS, `service_role` או elevated admin.
- Supported: schema discovery ברמת allowlist, `SELECT` מוגבל/parameterized, templates approved מראש; `LIMIT`, statement timeout, row limit ו-transaction read-only.
- כל mutation ב-MVP ב-fixture בלבד, מאחורי operation מתועד עם explicit approval וכמות שורות מוגבלת; לפני פרודקשן אין `execute arbitrary SQL`.
- פעולות `DROP`, `TRUNCATE`, `ALTER ROLE`, `GRANT`, `COPY ... PROGRAM`, extensions, untrusted function execution ו-DDL כברירת מחדל DENY; אין לנסות לאבטח SQL מורכב עם regex בלבד.
- שימוש ב-AST parser בדוק אם תומכים בעתיד ב-SQL חופשי; גם אז הרשאות DB הן קו ההגנה הסופי.
- `EXPLAIN`/dry-run אינן הבטחה להיעדר side-effects או rollback. יש להציג preview רק כאשר האדפטר יודע להבטיח את המודל שלו.

### FR-08 — Events, Audit, Dashboard
- Dashboard מינימלי: Overview, Runs/Tasks, Action Decisions, Approvals, Policies, Connections, Evidence.
- סינון לפי agent, task, target, action, decision, time; לוג שמבדיל `attempted / denied / approved / executed / failed / unknown`.
- כל אירוע כולל `correlation_id`, `action_id`, `actor`, `grant_id`, `policy_hash`, `target_ref`, `result_code`, timestamp, no secret data.
- Evidence view מציג החלטת policy + request fingerprint + upstream observation + לפני/אחרי כאשר אפשר; מציין “התרחשות לא ניתנת לאימות” כשאין מקור מידע.
- Export JSON/CSV ללא credentials, ובקרה על נפח/retention. hash chain אפשרי כ-tamper-evidence, אך אין לטעון שזה בלתי ניתן לזיוף מול admin השולט ב-DB ובמפתחות.

### FR-09 — Stop / Revoke
- כפתור Stop: מונע החלטות allow עתידיות, מבטל grants והנפקת credentials; משבית כלי יעד שה-Gateway שולט בהם.
- אין הבטחה לביטול פעולה שכבר יצאה ל-API או rollback של משאב יעד. האפקט המובטח מוגדר בתיעוד ובבדיקות.

---

## 5. רכיבים שלא נכנסים ל-MVP (OUT)

- הגנה אוניברסלית על כלל פעולות ה-shell והקבצים בכל סביבת host.
- הבטחת מניעת כל prompt injection, כל גניבת secrets וכל data exfiltration.
- התקנת AgentBrake כתחליף EDR / CASB / SIEM / PAM / IAM.
- LLM classifier שקובע סמכות, AI-based intrusion prevention, autonomous retaliation.
- Kubernetes multi-tenant cluster, mobile app, SOC2 certification, enterprise SSO, HIPAA product, billing מלא, connectors רבים.
- חיבור אמיתי ל-Production, מחיקת DB אמיתית, הרשאות admin, השלמה אוטומטית של destructive tasks.
- Release/merge/prod deployment execution; רק סימולציה של החלטות האישור והמניעה במקרה הזה.
- תמיכה ב-`codex mcp-server` הישן: בוטל בספטמבר 2026. Codex **כלקוח MCP** נתמך ונבדק בנפרד.

---

## 6. Threat Model מחייב

**נכסים:** GitHub repo, data tables, secrets, grants/approvals, action logs, policy definitions, identity claims, agent sessions.  
**תוקף:** agent שעשוי להיות מוסת, קובץ/issue/PR לא מהימן, MCP upstream זדוני, משתמש עם הרשאות חלקיות, תוקף עם access token גנוב, process מקומי שמנסה לגשת ישירות למערכת יעד.

**גבולות אמון:**
1. User/admin authenticated -> control plane.
2. Agent (untrusted) -> Gateway PEP; agent tool arguments are untrusted.
3. Gateway -> policy evaluator PDP (authenticated private transport).
4. Gateway -> capability/token broker (privileged; not available to agent).
5. Adapter -> GitHub API / Postgres (enforced resource scopes).
6. Audit sink (separate access policy; append-only logical writes).

**איומים והגנות:**
- Prompt injection מתוך issue/README/DB result -> untrusted as instructions; no elevation beyond approved grant.
- Tool schema poisoning/renaming or response injection -> pin trusted adapters/schemas; metadata cannot grant access.
- Confused deputy/token passthrough -> validate token audience; outbound target credential separate.
- Permission escalation -> service credentials scoped; policy enforcement outside model; role/RLS controls.
- SQL destructive action -> unsupported operation => deny; least-privilege DB role still blocks.
- Exfil through allowed tool -> destinations allowlist; no credentials in results, redaction in logs; *not* full DLP in MVP.
- Agent bypass via `git`, `psql`, `curl` or cloud CLI -> place agent in isolated environment without target credentials/direct target egress; test. If bypass path exists, product only covers MCP-mediated calls and must say so.
- TOCTOU (approval then arguments change) -> canonical fingerprint+TTL+re-check+atomic consumption.
- Replay/duplicate effects -> action ID/idempotency; mutation result unknown => manual reconciliation, not auto retry.
- Policy poisoning through repository config -> policy source separately controlled; signed/versioned; not loaded from untrusted repo.
- Cross-tenant data leak -> object-level authorization tests, RLS for dashboard DB where applicable, no cross-tenant keys.
- Audit tamper -> separate audit writer permissions, hash chain, eventual external sink; clearly documented limitations.
- Local unsafe demo -> no host secrets, no sensitive env mounts, no unbounded egress.

**Known unavoidable limits:** Gateway cannot prevent a side effect already executed before blocking it; cannot inspect unobserved paths; cannot guarantee semantic correctness of arbitrary SQL or programs; cannot ensure approval truly reflects human understanding; network-level and credential-level controls are prerequisites.

**Security references:** OWASP Agentic Top 10 2026, OWASP ACS 2026, MCP 2026-07-28 Security Best Practices, NIST and common Zero Trust principles, official PostgreSQL/GitHub docs.

---

## 7. ארכיטקטורה וזרימת החלטה

```
             Human / Platform Admin
                      |
             Next.js Dashboard (Control Plane)
                      | policies, task grants, approvals
                      v
                 Control API
                      |                         [PostgreSQL: control+audit]
                      +------------------------------->
                      |
  Codex MCP Client --+---> AgentBrake MCP Gateway / PEP
                               |           |
                               |           +--> Tool adapter registry
                               v                        |
                        OPA/Rego PDP                     +--> GitHub sandbox
                               |                         +--> PostgreSQL fixture
                               v
                       Decision + reason
                               |
                  DENY / ALLOW / APPROVAL
                               |
                      Credentials broker
                               |
                   scoped upstream invocation
                               |
                     evidence + audit event
```

**Control plane אינו Data plane.** Dashboard לא יכול לבצע upstream action ישירות בשם ה-agent; רק Approval API מייצר grant חד-פעמי וה-Gateway מפעיל.

### PE-01 — Pre-execution algorithm
1. Authenticate request context; bind trusted identity and tenant. Reject mismatched/unknown agent.
2. Parse/validate MCP request and supported tool; normalize exact resource IDs and arguments.
3. Verify Task Grant validity (expiry, identity, scope, quota, nonce, revocation).
4. Lookup authoritative target attributes (repo ID, table/schema/branch) if needed.
5. Evaluate OPA/Rego with trusted, typed input, assign `decision_id`.
6. `DENY`: log and never call upstream.
7. `REQUIRE_APPROVAL`: persist immutable action fingerprint and await approval. On receipt, revalidate actor, approver, request, grant, policy, expiry, target, privileges, quotas.
8. `ALLOW`: acquire scoped credential via broker, execute once through typed adapter.
9. Log initiation, exact upstream request ID/status and result. If outcome uncertain, `UNKNOWN` + reconciliation required.
10. Return limited result to agent; strip secrets and unnecessary fields.

### PE-02 — Example policy contract (illustrative, not actual syntax of Rego)

```yaml
policy_version: 1
rules:
  - id: reject_unknown_tool
    when: tool_not_registered
    effect: DENY
  - id: readonly_github
    when: action in [github.read_file, github.list_repos]
    require: [valid_grant, allowed_repo]
    effect: ALLOW
  - id: propose_change
    when: action == github.open_pull_request
    require: [valid_grant, allowed_repo, feature_branch]
    effect: REQUIRE_APPROVAL
  - id: readonly_pg
    when: action == postgres.query_template
    require: [valid_grant, allowed_database, approved_template]
    effect: ALLOW
  - id: reject_destructive
    when: action in [github.force_push, github.delete_repo, postgres.drop_table, postgres.grant_role]
    effect: DENY
  - id: deny_everything_else
    effect: DENY
```

**הבהרה:** גם כאשר policy אומר ALLOW, ל-adapter ולחשבון השירות חייבות להיות הרשאות מוגבלות. policy אינו תחליף להרשאות ברמת היעד.

### PE-03 — API contract (תחילת תכנון)

| Endpoint / event | Purpose | Security requirement |
|---|---|---|
| `POST /tasks` | human grants task | authenticate + resource ownership + scope validation |
| `POST /approvals/:id/decision` | approve/reject action | approver role, exact bound fingerprint, one-time atomic |
| `POST /tasks/:id/revoke` | revoke | authorization + audit + in-flight limitations |
| `GET /actions` | search traces | tenant authorization, redaction, bounded pagination |
| `GET /evidence/:actionId` | decision and effects | auditable, no secrets, stable IDs |
| internal policy decision | PEP -> PDP | authenticated private access, timeout => DENY |
| internal adapter invoke | PEP -> broker/adapter | server-side identity, least privilege, no client-selected endpoint |

### PE-04 — Suggested monorepo

```
agentbrake/
  apps/dashboard/         # Next.js control plane UI
  apps/control-api/       # identity, tasks, approvals, admin
  services/gateway/       # MCP client/server, PEP, adapters
  services/policy/        # OPA rules, bundles, unit tests
  packages/contracts/     # JSON Schema / Zod types
  packages/security/      # authorization helpers, request fingerprints
  packages/telemetry/     # trace, audit, redaction
  adapters/github/
  adapters/postgres/
  test/e2e/
  test/adversarial/
  fixtures/
  infra/local/
  docs/ADR/
  docs/threat-model/
  docs/evidence/
```

### PE-05 — Technical quality choices
- TypeScript strict, runtime schema validation (Zod/JSON Schema), pinned dependencies/lockfile, SAST and secret scanning.
- OPA/Rego tested; PDP API authenticated and unexposed externally. Never run unrestricted OPA admin endpoint on public network.
- Next.js Dashboard on a separate port from MCP enforcement; never an admin bypass.
- PostgreSQL migrations versioned and reversible when possible; fixtures reproducible; unique database instances for control and targets.
- Docker containers least privilege, no host sockets, no unnecessary mounts, drop capabilities, read-only FS when practical, outbound allowlist.
- Correlation IDs, OpenTelemetry traces without secrets, PII minimization; retention defaults explicitly documented and configurable.

---

## 8. בדיקות קבלה — Definition of Done

**חוק קבלה קריטי:** לא מספיק ש-UI מציג “Blocked”. לכל חסימה נדרשת הוכחה שאין upstream effect, ובנתוני fixture נבדקת זהות לפני/אחרי. אין להצהיר על zero bypass ללא בדיקה של paths רלוונטיים.

### TC — Security and functional

| ID | Case | Expected |
|---|---|---|
| T01 | Codex/MCP test client קורא GitHub file מאושר | ALLOW + תוצאה + audit + target scope נכון |
| T02 | ניסיון קריאה מריפו מחוץ ל-grant | DENY + 0 upstream calls |
| T03 | שינוי feature branch מוצע | Require Approval + Preview בדוק |
| T04 | ניסיון push ל-main/force push | DENY גם כאשר agent מבקש לעקוף |
| T05 | ניסיון למחוק repo/modify secrets/workflows | DENY + no target change |
| T06 | PostgreSQL SELECT דרך template מאושר | ALLOW, bounded rows, read-only role |
| T07 | `DROP TABLE`, `TRUNCATE`, `ALTER ROLE`, `GRANT` | DENY ו-schema hash זהה |
| T08 | multi-statement/SQL comments/obfuscation/unsafe function | unsupported => DENY, no execution |
| T09 | synthetic prompt injection בתוך GitHub issue/README | לא מרחיב grant; mutation לא מורשה נחסמת |
| T10 | invalid/missing/expired grant | DENY |
| T11 | expired/wrong-audience/stolen token | DENY בהתאם למודל auth |
| T12 | forged agent_id / tenant_id / resource attributes | DENY; trusted identity wins |
| T13 | rename tool/schema mismatch/Mcp-Name mismatch | DENY + trace |
| T14 | PDP down/timeout/error | DENY + no upstream mutation |
| T15 | gateway restarts while approval pending | no implicit allow; reconciliation |
| T16 | approval changed args/target/branch after review | DENY due fingerprint mismatch |
| T17 | duplicate approval consumption/racing clients | at most one execution attempt |
| T18 | request timeout after potentially successful mutation | UNKNOWN + no blind auto retry |
| T19 | privilege/role escalation attempt through tool | DENY + underlying role rejects |
| T20 | direct curl/psql/git from isolated agent container | target unreachable / unauthorized |
| T21 | kill switch activated mid-run | future calls denied; existing in-flight limits documented |
| T22 | attacker tries to read audit/log from other tenant | DENY |
| T23 | secrets accidentally in args/results/error | redacted, not logged in plain text |
| T24 | policy updated while action awaits approval | recheck and deny/request renewed review if relevant |
| T25 | unknown tools / malformed payloads / resource traversal | DENY, no crash |
| T26 | high-concurrency legitimate reads | no deadlocks, rate limits, correct audit |
| T27 | legitimate workflow completion comparison with and without AgentBrake | success rate and false blocks reported |
| T28 | MCP spec `2026-07-28` and documented legacy support matrix | executable interoperability tests |
| T29 | fresh install on clean machine | documented setup works without leaked secrets |
| T30 | git diff + SQL fixture state inspection after denied action | bit-for-bit / row-state unchanged where applicable |

**לא להמציא תוצאות.** כל תרחיש חייב `run_id`, timestamp, build SHA, environment hash, exact test command, expected/observed, pass/fail, logs (redacted), fixture snapshots and limitations. אם בדיקה לא הורצה — NOT TESTED.

### NFR — targets (יעדי תכנון, לא מדידות קיימות)
- Policy decision p95 <= 50 ms **ללא זמן upstream**, על פרופיל בדיקה שתועד (לא SLA מסחרי).
- Accepted action success >= 99% על סט פעולות fixture מוגדר, ללא שגיאות upstream.
- Zero observed unapproved mutations in defined test suite; no claim of absolute safety.
- 100% policy decisions with logged decision_id and outcome, excluding explicitly documented sink failure behavior; on audit-write failure for sensitive mutations, default deny.
- At least 90% normal-workflow task completion vs baseline on benchmark curated, while counting false blocks separately; ambition, not verified.
- Secrets never appear in standard logs/snapshots; scan test artifacts.
- Resource limits: size/time/concurrency bounded; OOM/timeout => fail closed.
- Reproducible build: pinned versions, SBOM and basic vulnerability scan.

---

## 9. Proof Pack — מה היזם צריך לקבל מקודקס בכל milestone

- `ADR-*.md`: החלטה, חלופות, סיכונים ודחייה מנומקת של חלופות.
- `THREAT_MODEL.md`: trust boundaries, assets, attacker goals, out-of-scope routes.
- `TEST_MATRIX.md`: traceability מ-requirement ל-test ID לראיה.
- `SECURITY_EVIDENCE.md`: אין טענה שלא מגובה ב-command+result; screenshots **נוספים** אך אינם מחליפים תוצאות בדיקה.
- `KNOWN_LIMITATIONS.md`: כל bypass אפשרי, חוסר כיסוי, failure mode, tradeoff.
- `OPERATIONS.md`: recovery, revocation, incident response, secret rotation.
- `DEPLOYMENT_MODES.md`: Local Docker, future self-hosted, Cloud restrictions.
- `README.md`: setup, quickstart, 5-minute demo, troubleshooting, architecture.
- `MARKET_VALIDATION.md`: ראיונות ולקחים באופן אנונימי, ללא המצאת לקוחות.
- Logs+fixture snapshots+CI runs; report failed tests prominently, not only green badges.

**ביקורת עצמאית:** אדם/צוות שלא כתב את הנתיב הקריטי צריך לבדוק threat model, least privilege, policy decision API, approval binding, replay, SQL adapter, bypass via shell, credential handling. Codex-generated reviews useful, אך אינם תחליף לביקורת חיצונית.

---

## 10. UX / מסכים ממוקדים

1. **Home:** מספר agents פעילים, blocked risky actions, pending approvals, top risk sources, observed outcome (no invented dashboard data).
2. **Connections:** רק demo/repo allowlist / DB fixture; status, credential scope, no secret display.
3. **Tasks:** הגדרת task scope בשפה מובנית, selected resources, actions, expiry, max writes. כפתור Grant/Stop.
4. **Activity:** timeline action attempts עם ALLOW/DENY/APPROVAL/EXECUTED/UNKNOWN וסיבת החלטה.
5. **Approval detail:** canonical action preview, target, diff or query template, scope, expiry, reviewer, one-time status.
6. **Policies:** policy templates + read-only diff/revisions, no unsafe save/preview flow.
7. **Evidence:** exact request hash, decision, upstream trace, state checks, uncertainty labels.
8. **Demo Lab:** 3 תרחישים: safe read, blocked destructive SQL, PR approval + race/replay demonstration.

עיצוב: טכני, נקי, ללא gamification, מצבי אבטחה נגישים גם עם טקסט ולא צבע בלבד. אין פעולת approve שנפתחת בלי הצגת יעד וההשפעה.

---

## 11. תמחור / ערוצי הפצה — השערות בלבד

**אין לפרסם כחוזה מסחרי לפני שיחות מכירה.** Permit מפרסמת תוכנית Gateway בתשלום החל מכ-$25 לחודש, ופתרונות open source מתחרים; לכן מחיר גבוה חייב להיתמך בערך מדיד.

| Tier ניסיוני | הצעה | תמחור היפותטי |
|---|---|---|
| Community / local | single developer + fixture + report בסיסי | $0 |
| Team | 5–20 סוכנים, GitHub + DB, policies+approval+audit | $149–$399 / חודש לפי שימוש |
| Business | multiple repos/teams, external SIEM, review controls | $599–$1,499 / חודש |
| Enterprise | self-host, SSO, SLA, custom integration, security review | שיחה והצעה מותאמת |

**Metric לבחון:** Active agents, protected environments, tool calls, workflows; לבחור מדד פשוט ומנבא ערך, לשקול base fee + volume cap. **לא** לגבות לפי אירועים שנחסמו (תמריץ מסוכן) ולא לבנות billing לפני הוכחת ערך.

**Acquisition:** developer demo open, GitHub template, technical writeups with reproducible proof, founders' network, product-led proof before sales enterprise. אין להבטיח אישור SOC2/ISO 27001 שלא הושג.

**ROI story:** "לעבור מפחד לאוטומציה מבוקרת": מדדים — actions safely delegated, malicious attempts prevented, approval load, false blocks, time to first protected run, cost per protected workflow. לא להסתפק ב-count של alerts.

---

## 12. מסלול ביצוע והחלטות Go/No-Go

### Milestone A — Core trust boundaries
- Implement MCP bridge + typed tool adapter + OPA policies + deny by default.
- Prove T02, T07, T10, T14, T20.
- Gate: forbidden tool never reaches upstream and no direct credentials or egress.

### Milestone B — Controlled workflow
- Task grants, GitHub read/PR sandbox, PG read-only fixture, scoped credentials.
- Prove T01–T09 and T19; report false positives.
- Gate: 1 real Codex workflow through gateway, replayable in test client.

### Milestone C — Human approvals + evidence
- Signed/fingerprinted approval, expiry, consume-once, audit + evidence UI.
- Prove T13–T18, T21–T24, T30.
- Gate: reject/change/replay do not produce effect.

### Milestone D — Pilot-ready local
- Documentation, Docker compose fresh install, logs/export, security baseline, benchmark comparison.
- Gate: T01–T30 tracked, no critical unknowns on supported paths, external reviewer signs off on test evidence.

### Milestone E — Market validation
- 15 targeted interviews; 5 design partners; 3 paid pilots as go/no-go **targets**, not claims.
- Must interview actual users of Codex/Claude/Cursor with sensitive connected resources; ask for concrete failed/blocked task, current workaround, severity, budget owner.
- Gate: evidence customers will deploy/pay **despite** Permit/ToolHive and existing agent sandboxing.

### Pivot conditions
- No distinct gain vs existing gateways + native agent permissions after apples-to-apples comparison.
- More than 10% legitimate actions unnecessarily blocked without material safety uplift.
- Cannot enforce control over network and credentials in normal installation.
- Users unwilling to install gateway or move permissions through broker.
- Support burden exceeds plausible gross margin.

---

## 13. מה אסור לטעון במוצר

- "מונע 100% מתקיפות AI" — לא נכון ולא ניתן לאימות.
- "מגן על כל פעולת Codex" — לא אם shell/API paths לא עוברים במנגנון.
- "אין אפשרות לעקוף" — רק אם גבול ההרשאה/הרשת מוכח והיקף הטענה מוגדר.
- "מחזיר אחורה כל פעולה" — APIs/SQL עלולים להיות בלתי הפיכים.
- "כל שינוי Production בטוח" — Production out-of-scope בשלב MVP.
- "100% compliance" — נדרשים תהליכים, ביקורת וראיות חיצוניות.
- "זיהוי intent מושלם" — שפה טבעית אינה חוזה הרשאות.
- "אנחנו הראשונים" — מתחרים כבר מציעים רעיונות קרובים מאוד.

---

## 14. משימות מייסד/החלטות שדורשות קלט אנושי

- לבחור כתובת sandbox repo נפרד וחשבון GitHub App לאחר שה-MVP המקומי עובד. אין לשתף credentials בשיחה.
- להגדיר משתמש/agent roles ל-POC; לצמצם scope למינימום.
- להסכים לפורמט approval UI ולסיכונים שחייבים אישור לעומת חסימה מלאה.
- לנהל 15 שיחות ולאמת buyer/problem willingness to pay.
- להציג את הפתרון לעורך דין לבדיקת שם/סימן מסחר, תנאי שימוש, אחריות, פרטיות ו-risks לפני מסחור.
- להזמין Security review חיצוני טרם Production.

---

## 15. מקורות ראשוניים — תאריך סקירה 2026-11-16

1. Gartner market forecast (2026-08-26): https://www.gartner.com/en/newsroom/press-releases/2026-08-26-gartner-forecasts-the-market-for-securing-ai-will-reach-almost-5-billion-in-2027
2. MCP release 2026-07-28: https://blog.modelcontextprotocol.io/posts/2026-07-28/
3. MCP TS SDK v2 protocol compatibility: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
4. MCP security best practices: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx
5. OWASP Top 10 Agentic Applications 2026: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
6. OWASP Agent Control Standard (2026-09-01): https://genai.owasp.org/resource/agent-control-standard-acs/
7. OWASP Q2 2026 exploit review: https://genai.owasp.org/2026/07/08/genai-and-agentic-ai-exploit-roundup-q2-2026/
8. OWASP Q3 2026 exploit review: https://genai.owasp.org/2026/10/08/genai-and-agentic-ai-exploit-roundup-q3-2026/
9. Permit MCP gateway docs: https://docs.permit.io/permit-mcp-gateway/
10. Permit MCP pricing: https://www.permit.io/mcp-gateway/pricing
11. Runlayer platform: https://www.runlayer.com/platform
12. Zenity runtime: https://zenity.io/platform/ai-detection-and-response
13. Stacklok ToolHive: https://github.com/stacklok/toolhive
14. InterLock: https://github.com/ContextData/interlock
15. Cisco/Astrix acquisition: https://blogs.cisco.com/news/cisco-announces-intent-to-acquire-astrix-security
16. Codex MCP current config: https://learn.chatgpt.com/docs/extend/mcp?surface=cli
17. Codex MCP server removal: https://learn.chatgpt.com/docs/mcp-server
18. GitHub App minimum permissions: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
19. GitHub App installation credentials: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
20. PostgreSQL RLS documentation: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
21. Supabase role caveat: https://supabase.com/docs/guides/database/postgres/roles
22. OPA/Rego integration: https://www.openpolicyagent.org/docs/integration
23. Research on adversarial benchmark limits (2025): https://arxiv.org/abs/2510.05244
24. Research on dynamic agent injection benchmark (2026): https://arxiv.org/abs/2602.03117

---

## 16. Implementation sign-off checklist

- [ ] Project running under Docker with separate control DB and target DB.
- [ ] Strict policy denies unknown/unparseable/expired/unauthenticated actions.
- [ ] Codex connected as MCP **client** and executes positive and negative use-cases.
- [ ] Live-ish upstream sandbox and mock both covered; no production credential exposure.
- [ ] GitHub App permission scope and target allowlist verified.
- [ ] Postgres user role proven incapable of DROP/privilege changes even if PEP bypassed.
- [ ] Approval action hash and consume-once proven race-safe.
- [ ] Agent isolated from direct target network and credentials in *test environment*.
- [ ] Stop action demonstrably prevents new actions; in-flight limitation documented.
- [ ] Test matrix report includes failed, unrun and flaky cases — not hidden.
- [ ] Security reviewer has checked architecture and run results.
- [ ] User study demonstrates willingness to pay and differentiation.

**Decision rule:** בונים את ה-MVP, אבל לא משווקים אותו כ-production security product לפני ראיות ולא מגדילים הוצאות לפני אימות לקוחות.
