# המשך תנועה – מערכת ניהול מפגשים ולוחמים (CRM)

מערכת לעמותת "המשך תנועה": הרשמה למפגשי שישי ולערבי מדורה, צ׳ק־אין ב-QR בכניסה, כרטיס לוחם עם היסטוריה,
מעקב מקורות הגעה ("מי הביא את מי"), משימות מעקב, מרצים ומדריכים, הודעות וואטסאפ מוכנות, פוסט וסטורי אוטומטיים,
ודשבורד מול היעדים לשנה.

| מסמך | למי |
|------|-----|
| [docs/06-user-guide.md](docs/06-user-guide.md) | **מדריך קצר לצוות** (להתחיל כאן) |
| [docs/01-spec.md](docs/01-spec.md) | אפיון: דרישות, הנחות לאישור, תפקידים, הגדרות המדדים |
| [docs/03-architecture.md](docs/03-architecture.md) | ארכיטקטורה והחלטות טכנולוגיות |
| [docs/04-security-privacy.md](docs/04-security-privacy.md) | אבטחה ופרטיות, מודל איומים, פערים ידועים |
| [docs/05-operations.md](docs/05-operations.md) | הקמה, פריסה, משתמשים, גיבוי ושחזור, עלויות |
| [docs/07-qa-report.md](docs/07-qa-report.md) | דו״ח בדיקות ותקלות |
| [docs/02-developer-guide.md](docs/02-developer-guide.md) | מדריך מפתחים ו-API |

## הרצה מקומית

```bash
npm ci
npx supabase start        # Postgres + Auth + API + Edge Functions מקומיים (Docker)
npm run db:demo           # רשות: נתוני דמו בדויים (70 לוחמים, 10 שבועות)
npm run dev               # http://127.0.0.1:3100
```
כניסה מקומית: `admin@example.test` / `coord@example.test` / `door@example.test`, סיסמה `Local-Test-2026` (רק בסביבה המקומית).

## בדיקות

```bash
npm run typecheck && npm run lint
npm test                  # יחידה + API מול Supabase המקומי (הרשאות, RLS, תהליכים, מדדים)
npm run test:e2e          # Playwright על build אמיתי: 8 תרחישי הקבלה, דסקטופ וטלפון
```

## מבנה
`supabase/migrations` (סכמה, RLS, API, דוחות) · `supabase/functions/staff-admin` · `src/features/*` (מסכים) · `src/ui` (מערכת העיצוב) · `src/lib` · `tests/api` · `tests/e2e` · `scripts/` (גיבוי, שחזור, מנהל ראשון)
