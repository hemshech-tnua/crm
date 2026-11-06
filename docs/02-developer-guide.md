# מדריך מפתחים – המשך תנועה CRM

## מבנה

```
supabase/migrations/   סכמה, RLS, API ציבורי (0400), API צוות (0500), דוחות (0600), נתוני ייחוס (0700)
supabase/functions/    staff-admin: יצירת משתמשים, איפוס סיסמה, תפקידים, החלפת סיסמה
supabase/seed.sql      רק לפיתוח מקומי: 3 משתמשי בדיקה (סיסמה Local-Test-2026)
src/lib/               supabase, auth, data (שאילתות משותפות), errors, phone, dates, templates, csv, metrics, labels, links, types
src/ui/                מערכת העיצוב: kit.tsx, feedback.tsx (Toast/Dialog/Confirm/Copy), Icon.tsx, MessageComposer.tsx, charts
src/layout/            StaffLayout (סרגל ימני בדסקטופ, טאבים בתחתית בטלפון), PublicLayout
src/features/<area>/   מסכים; כל דף מייצא פונקציה בשם הדף (ראו src/app/router.tsx)
tests/api/             בדיקות אינטגרציה מול Supabase מקומי (Vitest)
tests/e2e/             בדיקות דפדפן (Playwright)
```

הרצה מקומית: `npx supabase start` ← `npm run dev` (פורט 3100). כניסה: `admin@example.test` / `coord@example.test` / `door@example.test`, סיסמה `Local-Test-2026`.

## עקרונות שאסור לשבור

- **השרת הוא מקור האמת.** כל בדיקת הרשאה ותקינות קיימת בבסיס הנתונים (RLS + פונקציות). בדיקות בצד הלקוח הן לנוחות בלבד.
- **אין נתוני דמה במסכים.** כשאין נתונים: EmptyState עם פעולה. מספר בלי נתונים מוצג "—" (`pct`/`num` ב-lib/metrics), לא 0%.
- **כל כפתור עושה משהו**, כל שינוי נשמר בשרת, ואחרי שמירה מבטלים את ה-cache הרלוונטי (`queryClient.invalidateQueries`).
- **פעולה הרסנית** (ביטול מפגש, ביטול הרשמה, מיזוג, התממה, חסימת משתמש) עוברת דרך `useConfirm()`.
- **שגיאות:** `errorMessage(err)` מ-lib/errors (קודי השרת ← עברית). לעולם לא מציגים הודעת שגיאה גולמית.
- **פרטיות:** לא מציגים טלפון לצוות כניסה. מזהים בכתובת הם UUID/קודים אקראיים בלבד, לעולם לא טלפון או שם. אין `console.log` של נתונים אישיים.
- **XSS:** אין `dangerouslySetInnerHTML`. CSP קשוח (`script-src 'self'`), לכן אין סקריפטים או גופנים חיצוניים.

## עיצוב

- צבעים (Tailwind): `mist` רקע, `paper` משטחים, `ink` טקסט, `tide` פעולות וקישורים, `light` (זעפרן) **רק** להדגשת "היום"/"המפגש הבא"/קו השישי, `good/bad/warn` לסטטוסים.
- גופנים: IBM Plex Sans Hebrew לכל הממשק; `font-display` (Secular One) לכותרות דפים ולמספרים גדולים בלבד.
- מספרים, טלפונים ותאריכים מספריים: מחלקה `num` (LTR, ספרות טבלאיות). טלפון מוצג עם `formatPhone`.
- רכיבים: `Button`, `ButtonLink`, `ExternalButton`, `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `ChoiceGroup`, `Rating`, `Badge`, `Panel`, `PageHeader`, `EmptyState`, `Skeleton`, `ErrorBox`, `Notice`, `Tabs`, `KeyValue`, `SearchInput` (src/ui/kit.tsx); `Dialog`, `useConfirm`, `useToast`, `useCopy` (src/ui/feedback.tsx).
- מובייל: יעד מגע לפחות 44px, טפסים בעמודה אחת, טבלאות הופכות לרשימת שורות בטלפון.
- טקסטים: עברית פשוטה, פעלים ברורים ("שמירה", "סגירת המפגש"), פנייה כוללת (נרשם/ה). בלי סימני חץ בכפתורים ובלי כותרות-על מיותרות.
- זמנים תמיד בשעון ישראל: `fmtDayLong`, `fmtTime`, `fmtDate`, `fromIl(date, time)` (lib/dates).

## API (Supabase)

גישה ישירה לטבלאות (מנהל + רכז, לפי RLS): `events`, `participants`, `registrations`, `speakers`, `follow_ups`, `contact_log`, `referral_links`, `message_templates`, `acquisition_sources`, `sites`, `settings`, `staff` (קריאה), `feedback` (קריאה), `consents` (קריאה), `audit_log` (מנהל). תצוגות: `participant_stats`, `event_stats`.

### פונקציות ציבוריות (גם בלי התחברות)

| פונקציה | קלט | פלט |
|---------|-----|-----|
| `public_list_events()` | – | מערך PublicEvent של מפגשים פתוחים |
| `public_get_event(p_code, p_ref?)` | קוד מפגש, קוד הפניה | PublicEvent (+ `invited_by` אם קישור אישי) |
| `public_sources()` | – | `[{key,label,is_friend,asks_detail}]` |
| `public_register(p)` | `{event, full_name, phone, city, age, source, source_detail?, referrer?, ref?, utm?, consent_updates, photo_opt_out, website(מלכודת)}` | `{status: registered/waitlisted/already_registered/already_waitlisted, first_name, token?, invite_code, waitlist_position?, event}` |
| `public_registration(p_token)` | טוקן אישי | `{status, attendance, first_name, invite_code, can_cancel, feedback_open, feedback_given, waitlist_position, event}` |
| `public_cancel(p_token, p_reason?)` | | `{status:'cancelled'}` |
| `public_checkin_info(p_code)` | קוד צ׳ק־אין | `{window: open/not_open/closed/unavailable, opens_at, event}` |
| `public_checkin(p)` | `{code, token? , phone?}` | `{result: checked_in/already_checked_in/not_registered/token_invalid/window_*, first_name, token, friday_count, attended_count, photo_opt_out, invite_code, event}` |
| `public_walkin(p)` | כמו הרשמה + `code` | כמו checkin |
| `public_feedback_context(p)` | `{token?}` או `{event}` | `{state: open/not_yet/closed, first_name, personal, has_activity, has_lecture, existing, event}` |
| `public_submit_feedback(p)` | `{token? \| event + phone?, overall, activity?, lecture?, comment?, website}` | `{ok}` |
| `public_propose(p)` | `{kind: speaker/instructor, full_name, phone, topic, bio_line?, social_url?, message?, website}` | `{ok}` |
| `public_checkin_undo(p_token)` | טוקן מהצ׳ק־אין | `{ok}` ("זה לא אני", עד 10 דקות) |
| `public_org_info()` | – | `{org_name, contact_phone}` |

### פונקציות צוות

| פונקציה | מי | מה |
|---------|-----|-----|
| `staff_me()` | כל משתמש | פרופיל + תפקיד + `must_change_password` |
| `staff_checkin_list(p_event_id)` | כולם (צוות כניסה רק סביב זמן המפגש) | רשימת נוכחות: `registration_id, participant_id*, display_name, phone_last4, phone*, status, attendance, is_walk_in, checked_in_at, checkin_method, photo_opt_out, prior_attended, prior_fridays, first_time, waitlist_position` (*רק למנהל/רכז) |
| `staff_set_attendance(p_registration_id, p_attendance)` | כולם | `attended` / `no_show` / `unknown` |
| `staff_cancel_registration(p_registration_id, p_reason?)` | כולם | ביטול |
| `staff_add_walkin(p_event_id, p)` | כולם | `p = {full_name, phone, city?, age?, source?, referrer?}` |
| `staff_register(p_event_id, p_participant_id, p_over_capacity?)` | מנהל, רכז | רישום ידני (מלא ← המתנה) |
| `staff_promote(p_registration_id)` | מנהל, רכז | מהמתנה לרשום |
| `staff_complete_event(p_event_id)` | מנהל, רכז | סגירה: לא הגיעו + משימות מעקב. מחזיר `{no_shows, tasks_no_show, tasks_first_time, tasks_lapsed}` |
| `staff_duplicate_event(p_event_id, p_starts_at)` | מנהל, רכז | מחזיר id של טיוטה חדשה |
| `staff_check_duplicate(p_full_name, p_phone)` | מנהל, רכז | `{phone_valid, by_phone, similar[]}` |
| `staff_find_duplicates()` | מנהל, רכז | זוגות `{a, b, similarity}` |
| `staff_merge_participants(p_keep, p_merge)` | מנהל, רכז | מיזוג |
| `staff_dismiss_duplicate(p_a, p_b)` | מנהל, רכז | "אלה שני אנשים שונים" |
| `staff_walkin_suggest(p_event_id, p_query)` / `staff_checkin_existing(p_event_id, p_participant_id)` | כולם (סביב זמן המפגש) | הצעת אדם מוכר בכניסה (שם + 4 ספרות) וסימון הגעה שלו |
| `admin_anonymize_participant(p_id)` | מנהל | התממה |
| `admin_retention_candidates()` | מנהל | לוחמים בלי פעילות מעבר לתקופת השמירה |
| `log_export(p_kind, p_rows)` | מנהל, רכז (רשימות אישיות: מנהל) | רישום ייצוא ביומן |
| `report_kpis(p_from?, p_to?, p_type?, p_site?)` | מנהל, רכז | ספירות ליעדים (ראו lib/metrics `derived`) |
| `report_events(...)`, `report_monthly(...)`, `report_sources(p_from,p_to)`, `report_links(...)`, `report_referrers(...)`, `report_presenters(...)`, `report_distribution(p_type,p_site)`, `report_drilldown(p_kind,...)`, `attention_items()` | מנהל, רכז | ראו supabase/migrations/…0600_reporting.sql |

Edge Function `staff-admin` (דרך `staffAdmin()` ב-lib/auth): `change_password`, `create`, `reset_password`, `update`.

**מיגרציות:** מיגרציה חדשה מקבלת מספר **לפני** `…9000_privilege_hardening.sql`, שנשארת אחרונה. פונקציה ציבורית חדשה צריכה `grant … to anon` שם, ועדכון ברשימה שב-tests/api/security.test.ts.

### קישורים ציבוריים (lib/links)
`registerUrl(code, ref?)` ← `#/r/code`, `checkinUrl(checkinCode)` ← `#/c/…`, `feedbackUrl(code)` ← `#/f/…`, `manageUrl(token)` ← `#/m/…`, `proposeUrl()`.
