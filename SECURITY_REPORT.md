# Security audit — Hemshech Tnua CRM

_Last updated: 2026-11-10. Auditor: automated senior-appsec pass (OWASP Top 10 2021) plus live red-team testing against a local copy, read-only checks against production, and two independent code reviewers._

> **תקציר בעברית:** נעשתה בדיקת אבטחה מעמיקה בשלוש שכבות: תקיפות חיות על עותק מקומי, בדיקות קריאה־בלבד מול המערכת האמיתית, ושני סוקרים בלתי תלויים (שרת ההרשאות ושכבת מסד הנתונים). לא נמצאה פרצה קריטית: אין דרך לקרוא את המאגר, להשתלט על חשבון צוות או להסלים הרשאות. נמצאו ותוקנו 3 בעיות בינוניות בטפסים הציבוריים (מי שיודע מספר טלפון של מישהו יכול היה לקבל פרטים מהכרטיס שלו או לשנות אותם) ו־5 חיזוקים בכניסת הצוות. התיקונים נבדקו במלואם ועלו למערכת האמיתית ב־11.11.2026 באישורך. נשארו 2 הגדרות שרק את/ה יכול/ה לשנות בלוח הבקרה של Supabase (סעיף 6).

## 1. Scope and stack (recon)

| Layer | What it is | Security implication |
|-------|-----------|----------------------|
| Frontend | **Vite + React SPA**, static files | No server to exploit; no server-side rendering, no server actions, no Node runtime in production. |
| Hosting | **GitHub Pages** (`hemshech-tnua.github.io/crm/`) | Static only. Cannot set HTTP response headers (CSP is a `<meta>` tag; HSTS is provided by the `github.io` preload). |
| Data / Auth | **Supabase** (Postgres + GoTrue + PostgREST + Edge Functions), project `bvoubfasrgumpehyxbcg`, EU (Frankfurt) | All real authorization lives here. The browser holds only the public anon key. |
| Privileged logic | One **Edge Function** `staff-admin` (Deno, service_role, `verify_jwt=false`, authenticates itself) | The only path that writes with elevated rights; must and does check the caller. |
| Third-party | None. No payment provider, no analytics, no external scripts, no file uploads. SMS/email code sign-in is optional and not yet connected. | Minimal supply-chain and SSRF surface. |

**Entry points**
- Public (anonymous) REST RPCs — exactly 17 `public_*` functions: list/get events, sources, register, registration-by-token, cancel, check-in (info / by code / known / undo), walk-in, feedback (context/submit), propose speaker, membership, org info, site check-in. All are `SECURITY DEFINER` and validate every input.
- Edge Function `staff-admin`: `?login=1` (phone+password), `?claim=1` (first-entry invite), and authenticated admin actions (create/update/reset_password/invite) + self password change.
- Public SPA routes: `/`, `/r/:code`, `/m/:token`, `/c/:code`, `/s/:code`, `/f/:code`, `/join`, `/member`, `/welcome/:token`, `/login`, `/privacy`. All are client views over the RPCs above.
- No webhooks, no file uploads, no server-side fetch of user-supplied URLs.

**Where data and secrets live**
- Participant/staff data: Postgres, protected by RLS. Separation of contact details from participation data is by column, not table, with RLS gating the whole row by role.
- Secrets: the `service_role` key and (future) SMTP/SMS credentials live only in Supabase (Edge Function env / Auth config). The browser bundle contains only `VITE_SUPABASE_URL` and the **public** anon key. The `ip_salt` and other app secrets live in `private.app_secrets` (not reachable by anon/authenticated).

## 2. Findings

Status legend: **Fixed (live)** = code + regression tests committed, verified against a local copy, then deployed to production on 11.11.2026 with owner approval (Edge Function `staff-admin` v7; migration `20261106001900` applied from the pinned commit with a SHA-256 check, function grants and the 17-function anon surface unchanged; production smoke tests passed). **You** = a dashboard setting only the project owner can change.

### 2a. Configuration

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| C1 | **High** (config) | Open sign-ups enabled (`disable_signup:false`). A stranger can create an `authenticated` account. RLS gives it **zero** rows (verified), but once email/SMS is connected it is a spam/quota vector. | **You** — §6.1 |
| C2 | Low | Leaked-password (HaveIBeenPwned) protection is off. | **You** — §6.2 |

### 2b. Edge Function `staff-admin` (independent reviewer + red team)

| # | Severity | File | Finding / exploit | Fix | Status |
|---|----------|------|-------------------|-----|--------|
| E1 | **High** | `supabase/functions/staff-admin/index.ts` (`?claim=1`) | The first-entry link is a bearer credential: whoever holds an unused link can set the account's email and sign in. The branch had no rate limit and links lived 7 days. (Production verified intact: exactly the 4 real admins, no foreign emails.) | Per-IP (20/h) and per-link (10/h) throttles; link lifetime 48 h; documented as a credential (send personally, never in a group). The self-entered email is kept because it was requested. | **Fixed (live)** |
| E2 | Medium | same, `?login=1` | Per-IP login limit keyed on the left-most `X-Forwarded-For`, which the client controls: rotating it bypassed the 30/IP cap. | `clientIp()` uses `cf-connecting-ip` (set by Cloudflare, verified in production logs: equals `x-real-ip` on 100% of requests, all public IPs); XFF right-most hop only as a local fallback. Test: 34 spoofed requests → 30 × 400 then 429. No global cap on purpose (it would let a stranger lock out all staff). | **Fixed (live)** |
| E3 | Medium | same, `?login=1` | Timing side channel: an unknown phone answered faster than a known one, so staff phone numbers could be enumerated. | Every answer waits for a constant 350 ms floor. Test asserts both paths ≥ 340 ms with identical bodies. | **Fixed (live)** |
| E4 | Low | same, `?claim=1` | `email_exists` (409) told an unauthenticated caller whether an email has an account. | Generic `claim_failed` (400). | **Fixed (live)** |
| E5 | Low | same, `update` | Self-protection compared UUIDs case-sensitively: an admin could block/demote themselves with an upper-cased id (lock-out risk). | Case-insensitive compare; verified with a letter-bearing UUID. | **Fixed (live)** |

### 2c. Database / public forms (independent reviewer, every exploit confirmed in a rolled-back transaction)

Principle broken: *anyone may know someone's phone number; typing it must not reveal or change their record.* Fix: migration `20261106001900_phone_is_not_identity.sql` — only a **new person**, or someone who typed the **full name on the card**, gets anything belonging to the card.

| # | Severity | Where | Finding / exploit | Fix | Status |
|---|----------|-------|-------------------|-----|--------|
| D1 | Medium | `public_register`, `public_registration`, `private.upsert_participant` | Registering with a victim's phone + any name returned their personal invite code (→ their stored first name via `public_get_event`), opted them in to marketing (`consent_updates` OR), and the returned token led to D2. | Invite code only when proven; consent added only when the typed name is the card's; a re-registration under another name is marked (`submitted_name`). | **Fixed (live)** |
| D2 | Medium | `public_checkin` (phone branch, token branch), `public_walkin`, `private.checkin_result` | With the door code (on the sign) + a registered person's phone, check-in returned their name, membership, attendance counts and a 180-day **remembered-phone token** — usable to check them in later, request membership in their name, and evict their real phone's token. A walk-in with their phone also replaced their registration link. | Phone alone never checks in: the next step asks for the full name (`public_checkin_known`, identical answer for every number). No device token, card details or link replacement unless the name matches. UI: one extra field ("שם מלא, כמו בהרשמה"). | **Fixed (live)** |
| D3 | Medium | `public_submit_feedback` | Open event link + a phone overwrote that person's feedback (`ON CONFLICT DO UPDATE`). | The open link never overwrites; only the person's own link may correct it. | **Fixed (live)** |
| D4 | Low | `public_register` | `phone_in_use` vs `already_registered` confirms whether a guessed first name matches a phone registered for that event (8 tries/phone/h). | Accepted: the alternative hides a useful "you're already registered" message; rate-limited. | Accepted |
| D5 | Low (insider) | `staff_add_walkin` | A door volunteer typing a phone with a different name sees the card's name. | Accepted: intended door feature (prevents duplicates); volunteers are vetted staff and the door list already shows names. | Accepted |
| D6 | Low | rate-limit keys | A stranger can exhaust a victim's 5/day name attempts at the door, or the 150/h per-event registration ceiling (needs many IPs). | Accepted: nuisance only; the door team can always check anyone in manually. | Accepted |
| D7 | Info | `20261106009000_privilege_hardening.sql:11`; `registrations_guard` | `authenticated` holds EXECUTE on `private.*` helpers (unreachable: schema not exposed, PGRST106); coordinators can set some audit-ish columns on INSERT. | Defence in depth only; candidates for a later cleanup. | Noted |

### 2d. Other

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| O1 | Info | `public/_headers` HSTS is 1 y and applies only behind Cloudflare/Netlify; on GitHub Pages `github.io` is HSTS-preloaded anyway. | Recommendation (§6.3) |
| O2 | Info | No CAPTCHA on public forms (honeypot + rate limits in place); no MFA beyond the staff password. | Recommendation |
| O3 | Info | `npm audit --omit=dev` = **0**; 10 moderate advisories in dev-only tooling. | Monitor (Dependabot) |

**Verification after the fixes:** typecheck + lint clean; **108/108** unit+API tests (incl. new `tests/api/identity.test.ts`, claim/expiry/oracle/throttle and timing tests); **22/22** Playwright E2E (desktop + phone); red-team harness 44 attacks blocked (3 flagged items re-checked by hand and confirmed false positives: a lookup pattern absent from the fresh data, an unchanged settings row, and a meeting whose window had closed); production build has no source maps; anon surface still exactly 17 functions.

## 3. What was tested and held (defense in depth confirmed)

Live attacks were run against a **local copy** (never destructive tests on production); production was checked read-only.

- **Anonymous**: cannot read or write any of the 15 tables (`42501 permission denied` on production for every one); the `private` schema is not exposed (404); staff/admin RPCs are denied. Only the 17 `public_*` endpoints are callable (pinned by migration `…009000`, asserted by `tests/api/security.test.ts`).
- **A1 Broken access control / IDOR**: a signed-in account with **no staff row** (what an open sign-up produces) sees **0 rows in every table** and cannot insert or self-promote to admin (verified in-transaction as role `authenticated`). Coordinators cannot reach admin actions (create/modify users, anonymize, rotate site code, edit settings/templates, read the audit log, approve a speaker — the last blocked by a trigger). Door volunteers cannot read participant/registration tables; their check-in list exposes only name + last-4 phone digits + flags. Registration/cancel/check-in act only on a 1:1 hashed token, so one participant cannot act on another's record.
- **A3 Injection**: no SQL is built from user strings — every dynamic statement uses `format(%I)` on hard-coded identifiers or static trigger definitions; all user input is parameterized or normalized. Injection payloads (`' or '1'='1`, `; drop table…`, null bytes, 5 KB strings, `${7*7}`) are rejected cleanly, the table stays intact, and no database error text leaks.
- **A7 Identification & auth failures**: phone+password login locks after 8 bad attempts per phone and 30 per IP (the IP comes from Cloudflare and cannot be spoofed); every answer takes the same minimum time. The public forms give an **identical** answer for a known vs. unknown phone/email (no user enumeration). Invite links are one-time, 48-hour, throttled, stored only as a SHA-256 hash, and die on use.
- **A2 Cryptographic failures / secrets**: no secret is committed or in git history (scanned full history for `service_role` JWTs, `sb_secret`, SMTP/API-key and private-key patterns — none). The client bundle carries only the public anon key (`role:anon`). No source maps are published. Passwords are hashed by GoTrue (bcrypt); the app never stores or sees them.
- **A5 Security misconfiguration**: production CSP is strict — `script-src 'self'` (no `unsafe-inline`/`unsafe-eval`), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (via `_headers`), `connect-src` scoped to `'self'` + the one Supabase origin. CORS on the Edge Function reflects **only** the allow-listed origin — a foreign `Origin` (incl. another `*.github.io`) is never reflected.
- **Transport**: HTTPS only; `github.io` is HSTS-preloaded.

## 4. OWASP Top 10 (2021) mapping

| Risk | Status |
|------|--------|
| A01 Broken Access Control | RLS on every table + role re-checks in every privileged function; IDOR tested. **D1–D3 (phone-as-identity) fixed.** |
| A02 Cryptographic Failures | Supabase-managed TLS & password hashing; no secrets in client/history. **Held.** |
| A03 Injection | Parameterized/normalized throughout; no string-built SQL; XSS-safe (no `dangerouslySetInnerHTML` with user data). **Held.** |
| A04 Insecure Design | Server-side validation, rate limits, consent logging, least-privilege roles, no-enumeration design. **Held.** |
| A05 Security Misconfiguration | Strict CSP/headers; anon surface pinned & tested. **C1/C2 config items open.** |
| A06 Vulnerable Components | 0 production vulns; dev-only moderates. **Held; monitor.** |
| A07 Identification & Auth | Supabase auth; rate limits; single-use 48 h links; generic errors; constant-time login. **E1–E5 fixed; MFA/CAPTCHA recommended (O2).** |
| A08 Software & Data Integrity | SHA-pinned GitHub Actions; no untrusted CDN scripts; lockfile committed. **Held.** |
| A09 Logging & Monitoring | `audit_log` records staff actions and permission-relevant events; no passwords/tokens logged; no stack traces to users. **Held.** |
| A10 SSRF | No server-side fetch of user-supplied URLs. **N/A.** |

## 5. Checklist items that are N/A (and why)

- Next.js `NEXT_PUBLIC_` vars, server actions, API routes — **N/A** (Vite SPA, no server).
- Cookies (`HttpOnly`/`Secure`/`SameSite`) and CSRF — **N/A**: auth uses a Bearer token in `localStorage`, sent in the `Authorization` header, not cookies, so cross-site form forgery cannot ride a session.
- File uploads (type/size/content/filename/path) — **N/A** (no uploads).
- Stripe/webhook signature verification — **N/A** (no payments/webhooks).
- SSRF allow-list — **N/A** (no user-URL fetch).

## 6. Configuration actions for you (cannot be changed from code)

1. **Disable open sign-ups (C1).** Dashboard → Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". This is the most important item.
2. **Enable leaked-password protection (C2).** Dashboard → Authentication → Passwords → enable the HaveIBeenPwned check.
3. **WAF / abuse protection:** GitHub Pages has none. For rate-limiting and DDoS protection, front the site with **Cloudflare** (free tier: proxy the custom domain, enable "Under Attack" only if needed, and Bot Fight Mode). Cloudflare also lets the `public/_headers` file take effect (HSTS 2y + preload, Permissions-Policy, etc.).
4. **Dependabot:** enable in the GitHub repo (Settings → Code security) for automated dependency updates.
5. Keep the SMS/SMTP provider credentials only in the Supabase dashboard — never in the repo or chat.

## 7. Honest residual risk

No system is unbreakable, and this report does not claim it is. The realistic residual risks are:
- **Account takeover of a staff member** via a phished password, a stolen phone/SIM, or a leaked first-entry/invite link — mitigated by rate limits, one-time links, and admin block/reset, but not eliminated. True MFA (O2) would reduce this. Treat first-entry links like passwords: send each one personally.
- **The Supabase account itself**: whoever controls the Supabase login or the `service_role` key controls all data. Protect that account with a strong password and MFA; treat the service key as a crown jewel.
- **GitHub org / Pages**: whoever can push to `hemshech-tnua/crm` can change the live site. Protect the GitHub accounts (MFA) and limit who has write access.
- **Availability**: GitHub Pages and Supabase have their own uptime; a determined DDoS on the public site is best absorbed by Cloudflare (item 3).
- **Legal/privacy**: this is a technical review, not a legal compliance opinion. The privacy-law items remain for a privacy consultant, as noted in `docs/04-security-privacy.md`.
