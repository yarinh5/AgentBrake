# AgentBrake

מערכת מקומית לאכיפת פעולות סוכני פיתוח לפני ביצוע: MCP Gateway, מנוע OPA/Rego נפרד, אישור של משתמש אחר, PostgreSQL נפרד לבקרה וליעד, Git מקומי וממשק Next.js.

כוללת משימות והרשאות מוגבלות, preview אמיתי, חסימת שינוי לאחר בדיקה, אישור חד־פעמי, audit ויצוא ראיות. כתיבה שתוצאתה אינה ידועה מסומנת **UNKNOWN** ואינה מורצת שוב אוטומטית. הנתונים סינתטיים; GitHub App חי ו־Production אינם מופעלים.

המוכנות נקבעת לפי אימות של אותה גרסת מקור: [ראיות](docs/SECURITY_EVIDENCE.md), [מטריצת דרישות](docs/TEST_MATRIX.md), [מגבלות](docs/KNOWN_LIMITATIONS.md). `docs/evidence/local-release.json` נוצר רק אחרי מעבר האימות המלא. Milestone D דורש גם חתימת בודק אבטחה אנושי חיצוני.

גרסת המקור **0.3.0-rc.1** מוסיפה מועמדת לפריסה פרטית לארגון אחד: חיבור GitHub App תחום לריפו בדיקות ייעודי, HTTPS, cookies מאובטחים ותמונות ריצה מצומצמות עם סריקת חולשות. [הוראות המועמדת](docs/PRODUCTION_OPERATIONS.md) ו[הגישות הנדרשות לאישור Production](docs/PRODUCTION_READINESS.md). הצלחה מקומית אינה אישור Production; חיבור GitHub אמיתי, מכונה עצמאית וביקורת אנושית דורשים ראיות נפרדות. ההתקנה המקומית שודרגה במפורש ל־0.3.0-rc.1 עם גיבוי ושמירת הנתונים; החיבורים החיצוניים נשארו כבויים.

## פתיחת המוצר

גרסה **0.3.0-rc.1** הותקנה ואומתה מקומית בפרופיל minimal-v1. נתוני ההתקנה הקודמת נשמרו; מסך ההקמה ממתין לבחירת חשבון הבעלים שלך. [דוח השדרוג](docs/evidence/local-v03-upgrade/installation.json), [בדיקת הדפדפן](docs/evidence/local-v03-upgrade/browser-smoke.json).

הכתובת של ההתקנה המקומית היא [http://127.0.0.1:4318](http://127.0.0.1:4318). בהפעלה הראשונה בחרו שם, כתובת דוא״ל וסיסמה במסך **Set up workspace**. נדרש פעם אחת ערך `key` של `administrator` מתוך `.agentbrake-local/product-local/operators.json`. אחרי ההקמה כל מפתחות הכניסה הישנים מבוטלים; הכניסה היומיומית היא בדוא״ל ובסיסמה.

ב־**Team** מזמינים משתמשים ומקצים תפקידים, משנים הרשאות ומנפיקים קישורי שחזור חד־פעמיים. משתפים את הקישור ידנית בערוץ מהימן; המערכת אינה שולחת דוא״ל. ב־**Settings** מעדכנים שם וסיסמה. **Get started** מסביר את חיבור הסוכן, יצירת משימה מוגבלת ובדיקת פעולה מאושרת.

[מדריך השירות, גיבוי ושחזור](docs/SERVICE_OPERATIONS.md) מפרט התקנה, תחזוקה ושחזור. [דוח הגרסה](docs/evidence/local-release.json) הוא מקור האמת לתוצאת האימות ול־hash שנבדק; מסירה ושדרוג ההתקנה מתועדים בנפרד ב־docs/evidence/service-delivery.

## התקנה מקומית קבועה

דרישות: Docker עם Linux containers, Node.js22.13 ומעלה ו־npm. בהכנה מורידים חבילות ותמונות ציבוריות; אין שירות בתשלום.

```powershell
cd 'F:\project love\AgentBrake'
npm ci
npm ci --prefix apps/dashboard
node scripts/product.mjs init local 4318
node scripts/product.mjs start local
```

פתחו `http://127.0.0.1:4318` והשלימו את חשבון הבעלים באמצעות מפתח ההקמה המתואר למעלה. אין לשתף את תיקיית `.agentbrake-local/product-local`. לא נטענים .env או נתונים קיימים ולא משתנה תצורת Codex גלובלית.

- **Tasks:** יצירת זהות מוגבלת ו־grant; ה־bearer מוצג פעם אחת.
- **Demo Lab:** קריאה מותרת, SQL אסור או ענף ו־PR מקומיים — דרך ה־Gateway.
- **Approvals:** יעד, ארגומנטים, preview/diff, fingerprint ותוקף; נדרש approver אחר. אישור הענף קודם לבקשת PR.
- **Activity / Evidence:** החלטה ותצפית בפועל. הצלחת adapter אינה אימות עצמאי של היעד; UNKNOWN מחייב בדיקה.

```powershell
node scripts/product.mjs doctor local
node scripts/product.mjs diagnostics local
node scripts/product.mjs backup local
node scripts/product.mjs stop local
node scripts/product.mjs start local
```

עצירה שומרת volumes. איפוס מוחק רק את ההתקנה הנקובה ודורש `reset local --confirm=<installation-id>`; המזהה ב־installation.json. [מדריך תפעול](docs/LOCAL_PRODUCT_OPERATIONS.md).

## חיבור סוכן

ה־Gateway זמין **מתוך רשת agent המבודדת** ב־`http://gateway:4313/mcp`, ואינו מפורסם למארח. Connections מציג תבנית HTTP עם `AGENTBRAKE_TOKEN` לטוקן המשימה בלבד. אין לתת לסוכן מפתח אנושי, DB, OPA או Docker. דוגמת העברת טוקן דרך stdin ללא הופעה בארגומנטים נמצאת במדריך התפעול וב־scripts/verify-product.mjs.

הכלים כוללים schema/קריאת DB מוגבלת, עדכון סטטוס שורה אחת, רשימת ריפו/ענפים, קריאת קובץ, הצעת שינוי, יצירת ענף ו־PR מדומה עם commit אמיתי. אין SQL חופשי, merge, push ל־main או שינוי workflows/secrets.

## אימות

```powershell
npm run setup:policy
npm test
npm run build
npm run build:dashboard
npm run test:ui
npm run verify:product
npm run verify:service
npm run verify:security
npm run setup:codex-local
npm run verify:release
npm run verify:images
npm run verify:production
npm run package:release
```

Chromium נדרש לבדיקות הדפדפן (`npx playwright install chromium` אם חסר). תהליך Codex משתמש ב־CLI רשמי ו־Qwen3:4b מקומי, מטמון מודל מאומת ופרופיל NVIDIA GPU; אינו פונה למודל ענן. מדידת חסימות השווא היא מדגם נפרד של26משימות דרך לקוח בדיקה.

`verify:release` מריץ native/OPA/דפדפן, PG/Git ובידוד, Codex אמיתי, benchmark, התקנה חדשה ואתחול, חשבונות משתמשים וגיבוי/שחזור מוצפן, Semgrep מקומי, SBOM וסריקת תלויות. נדרש hash מקור זהה בכל הדוחות וניקוי משאבי הבדיקה. אין Git repository ולכן אין commit SHA מומצא. חבילת המקור נוצרת רק לאחר האימות, עם manifest ו־SHA-256; היא אינה כוללת מפתחות, נתוני ריצה, מודלים או node_modules. פריסה חיצונית, שירות ציבורי ומערכות אמיתיות אינם מופעלים בחבילה זו.

המועמדת מוסיפה לאימות התקנת HTTPS ממשית עם מפתחות בדיקה, תהליך יצירת זהות והרשאה בדפדפן ובדיקת OPA מתוך התמונה שנבנתה. `verify:images` סורק את מזהי התמונות המדויקים שנבדקו, לאחר הכנת מסד חולשות ציבורי; אינו מעלה קוד או תמונות לספק חיצוני. `verify:production` מחזיר בכוונה exit 2 כל עוד חסרים אישורים או ראיות חיצוניות; אין לעקוף זאת או להציג את חבילת המקור כאישור פריסה.

`npm run dev` נשמר כסביבת תאימות עם SQLite בזיכרון ב־4312. זו אינה ההתקנה הקבועה. מסמכי המקור נשמרו ב־docs/specification.


