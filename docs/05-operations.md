# הפעלה, פריסה, משתמשים וגיבוי

## 1. עלות חודשית (בתוך התקציב של 100–300 ₪)

| רכיב | תוכנית | עלות |
|------|--------|------|
| Supabase | **Pro (מומלץ)**: גיבוי יומי ל-7 ימים, בלי השהיה אחרי שבוע בלי שימוש, תמיכה | 25$ (כ-95 ₪) |
| | Free: מתאים לבדיקות. מושהה אחרי 7 ימים בלי פעילות ואין גיבוי | 0 |
| אחסון האתר | Cloudflare Pages או GitHub Pages | 0 |
| דומיין (רשות) | למשל `crm.hemshech-tnua.org.il` | כ-5–10 ₪ לחודש |
| **סה״כ** | | **כ-100 ₪** |

## 2. הקמת סביבה (פעם אחת)

דרישות: Node 20+, חשבון Supabase של **העמותה** (מומלץ שהמאגר יהיה בבעלות העמותה; פרויקט קיים אפשר להעביר בין ארגונים ב-Supabase).

```bash
cd hemshech-tnua
npm ci
# 1) פרויקט Supabase חדש (Dashboard), אזור Frankfurt (eu-central-1)
npx supabase login
npx supabase link --project-ref <REF>
npx supabase db push                      # מריץ את כל supabase/migrations (סכמה, הרשאות, ברירות מחדל)
npx supabase functions deploy staff-admin --no-verify-jwt
npx supabase secrets set ALLOWED_ORIGINS=https://<כתובת האתר>

# 2) הגדרות Auth ב-Dashboard (Authentication):
#    - Sign In / Providers: לכבות "Allow new users to sign up"
#    - URL Configuration: Site URL = כתובת האתר
#    - Passwords: אורך מינימלי 10, אותיות וספרות
# 3) המנהל/ת הראשון/ה (מפתח service_role מ-Settings → API, רק במחשב מאובטח):
SUPABASE_URL=https://<REF>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<...> \
  node scripts/create-admin.mjs itai@example.org "איתי ארנון"

# 4) בניית האתר עם כתובת הפרויקט והמפתח הציבורי
VITE_SUPABASE_URL=https://<REF>.supabase.co VITE_SUPABASE_ANON_KEY=<anon/publishable key> npm run build
# מעלים את התיקייה dist/ לאחסון סטטי
```

**GitHub Pages (כמו שאר אתרי הריפו):** ה-workflow `.github/workflows/pages.yml` בונה את התיקייה ומפרסם בכתובת `/desktop-tutorial/hemshech-tnua/`. צריך להגדיר ב-GitHub ← Settings ← Secrets and variables ← Actions שני **Variables**: `HEMSHECH_SUPABASE_URL` ו-`HEMSHECH_SUPABASE_ANON_KEY`. בלי שניהם השלב מדלג, והאתר לא מתפרסם.

**Cloudflare Pages (מומלץ לדומיין של העמותה):** Build command `npm run build`, output `dist`, root `hemshech-tnua`, ומשתני הסביבה למעלה. הקובץ `public/_headers` מוסיף כותרות אבטחה.

## 3. משתמשים והרשאות

- **יצירה:** הגדרות ← משתמשים ← "משתמש חדש" (מנהל/ת בלבד). המערכת מציגה סיסמה זמנית **פעם אחת**. מוסרים אותה באופן אישי. בכניסה הראשונה המשתמש חייב לבחור סיסמה, ועד אז לא רואה שום נתון.
- **תפקידים:** מנהל/ת (הכול), רכז/ת (מפגשים, לוחמים, מעקב, מרצים, דוחות), צוות כניסה (רק רשימת הנוכחות של המפגש של היום). מומלץ: איתי, אלעזר ואריאל מנהלים; רכזים רכזים; מתנדבי כניסה צוות כניסה.
- **שכחת סיסמה:** מנהל/ת ← "איפוס סיסמה" (אין צורך במייל). לשחזור עצמאי במייל צריך להגדיר SMTP ב-Supabase (למשל Resend בחינם): Authentication ← Emails ← SMTP Settings.
- **עזיבה:** "חסימה". הגישה לנתונים נעצרת מיד גם במכשירים מחוברים, וההתחברות נחסמת. ההיסטוריה (מי עשה מה) נשמרת.
- המערכת מנתקת אוטומטית אחרי 12 שעות בלי פעילות.

## 4. גיבוי ושחזור

**אוטומטי (Supabase Pro):** גיבוי יומי, 7 ימים אחורה. שחזור: Dashboard ← Database ← Backups ← Restore.

**גיבוי עצמאי מוצפן (מומלץ פעם בשבוע, ולפני כל שינוי גדול):**
```bash
openssl rand -base64 32 > ~/.hemshech-backup-pass && chmod 600 ~/.hemshech-backup-pass   # פעם אחת; לשמור גם במנהל סיסמאות
DB_URL='postgresql://postgres:<DB password>@db.<REF>.supabase.co:5432/postgres' \
BACKUP_PASSPHRASE_FILE=~/.hemshech-backup-pass scripts/backup.sh ~/hemshech-backups
```
הקובץ `hemshech-<תאריך>.sql.enc` מוצפן (AES-256). שומרים אותו בכונן של העמותה. בלי משפט הסיסמה אי אפשר לפתוח אותו.

**שחזור לפרויקט חדש:**
```bash
npx supabase link --project-ref <NEW_REF> && npx supabase db push        # סכמה
DB_URL='postgresql://postgres:<pw>@db.<NEW_REF>.supabase.co:5432/postgres' \
BACKUP_PASSPHRASE_FILE=~/.hemshech-backup-pass \
scripts/restore.sh ~/hemshech-backups/hemshech-<תאריך>.sql.enc --replace-all-data
```
השחזור מחליף את כל הנתונים ואת חשבונות הצוות ביעד, ובסוף מדפיס ספירות לבדיקה. הגיבוי והשחזור נבדקו מקצה לקצה מול הסביבה המקומית (ראו docs/07-qa-report.md).

## 5. שגרת תפעול

| מתי | מה |
|-----|-----|
| כל שבוע | שכפול השישי הבא, פתיחת הרשמה, שיווק (לשונית "שיווק"), תזכורת ביום חמישי, סגירת המפגש אחרי שישי |
| כל חודש | סקירת הדשבורד מול היעדים; גיבוי מוצפן; מעבר על "קבועים שהפסיקו להגיע" |
| כל רבעון | הגדרות ← פרטיות: מועמדים למחיקה לפי תקופת השמירה; מעבר על משתמשים פעילים; יומן פעולות |
| בכל עדכון קוד | `npm run typecheck && npm run lint && npm test && npm run test:e2e` מקומית, ואז `supabase db push` ופריסה |

## 6. ניטור ותקלות

| תקלה | בדיקה |
|------|-------|
| "המערכת עוד לא מחוברת לשרת" | חסרים משתני הבנייה `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` |
| אין חיבור / הכול ריק | Supabase Dashboard ← Project status (בתוכנית Free: האם הפרויקט מושהה?) |
| "פג תוקף ההתחברות" | להתחבר מחדש; אם חוזר: לבדוק Site URL ב-Auth |
| יצירת משתמש נכשלת | Edge Functions ← staff-admin ← Logs; `ALLOWED_ORIGINS` כולל את כתובת האתר |
| ספאם בהרשמות | Database ← `audit_log` (פעולות public); להוסיף CAPTCHA (docs/04 פער P4) |
| בדיקת אבטחה תקופתית | Dashboard ← Advisors (Security + Performance) |
