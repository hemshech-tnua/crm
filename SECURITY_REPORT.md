# Security audit — Hemshech Tnua CRM

_Last updated: 2026-11-10. Auditor: automated senior-appsec pass (OWASP Top 10 2021) plus live red-team testing against a local copy, read-only checks against production, and two independent code reviewers._

> **תקציר בעברית:** נעשתה בדיקת אבטחה מעמיקה. לא נמצאו פרצות שמאפשרות לגנוב מידע, להסלים הרשאות או להפיל את המערכת. נמצאה הגדרה אחת חשובה שצריך לתקן בלוח הבקרה של Supabase (ההרשמה העצמית עדיין פתוחה), ושיפור קטן אחד בקוד (הגבלת קצב לקישור הכניסה הראשונה). הפירוט למטה. אף מערכת אינה "בלתי פריצה"; המסמך גם מפרט את הסיכונים שנשארים ותלויים בהגדרות שלך.

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

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| F1 | **High** (config) | Auth config | Open sign-ups enabled on the production project (`disable_signup:false`). A stranger can create an `authenticated` account. RLS gives such an account **zero** data access (verified), so no data exposure — but once an email/SMS provider is connected, open sign-up lets strangers trigger messages (quota burn / spam relay) and clutters `auth.users`. | **Action required (you)** — dashboard toggle |
| F2 | Low | Edge Function | `?claim=1` (first-entry invite) has no rate limit. Tokens are 32 chars over a 54-symbol alphabet (~190 bits), so brute force is infeasible, but unbounded requests are a minor abuse/DoS vector. | **Fix proposed** (code) |
| F3 | Low | Auth config | Supabase "leaked password protection" (HaveIBeenPwned check) is disabled. Staff who set a weak/known password are not warned. | **Action required (you)** — dashboard toggle |
| F4 | Info | Headers/hosting | `public/_headers` HSTS is `max-age=31536000` (1y) and applies only on Cloudflare/Netlify, not GitHub Pages. The brief asks for 2y + `preload`. On GitHub Pages, `github.io` is already in the browser HSTS preload list, so transport is HTTPS-only regardless. | Recommendation |
| F5 | Info | Abuse / MFA | No CAPTCHA/Turnstile on public forms (honeypot + per-IP/per-phone rate limits are in place) and no true MFA layered on top of the staff password. | Recommendation (needs your decision / a provider) |
| F6 | Info | Dependencies | `npm audit --omit=dev` = **0 vulnerabilities**. 10 moderate advisories exist in dev-only build tooling (not shipped to users). | Monitor (Dependabot) |

No Critical, and no High in the application code itself. **Independent deep review of the Edge Function and the SQL/RLS layer is still running; any findings it surfaces will be added here before fixes are finalized.**

## 3. What was tested and held (defense in depth confirmed)

Live attacks were run against a **local copy** (never destructive tests on production); production was checked read-only.

- **Anonymous**: cannot read or write any of the 15 tables (`42501 permission denied` on production for every one); the `private` schema is not exposed (404); staff/admin RPCs are denied. Only the 17 `public_*` endpoints are callable (pinned by migration `…009000`, asserted by `tests/api/security.test.ts`).
- **A1 Broken access control / IDOR**: a signed-in account with **no staff row** (what an open sign-up produces) sees **0 rows in every table** and cannot insert or self-promote to admin (verified in-transaction as role `authenticated`). Coordinators cannot reach admin actions (create/modify users, anonymize, rotate site code, edit settings/templates, read the audit log, approve a speaker — the last blocked by a trigger). Door volunteers cannot read participant/registration tables; their check-in list exposes only name + last-4 phone digits + flags. Registration/cancel/check-in act only on a 1:1 hashed token, so one participant cannot act on another's record.
- **A3 Injection**: no SQL is built from user strings — every dynamic statement uses `format(%I)` on hard-coded identifiers or static trigger definitions; all user input is parameterized or normalized. Injection payloads (`' or '1'='1`, `; drop table…`, null bytes, 5 KB strings, `${7*7}`) are rejected cleanly, the table stays intact, and no database error text leaks.
- **A7 Identification & auth failures**: phone+password login locks after 8 bad attempts per phone and 30 per IP; spoofing `x-forwarded-for` does **not** reset the per-phone limit. The public forms give an **identical** answer for a known vs. unknown phone/email (no user enumeration). Invite links are one-time, 7-day, stored only as a SHA-256 hash, and die on use.
- **A2 Cryptographic failures / secrets**: no secret is committed or in git history (scanned full history for `service_role` JWTs, `sb_secret`, SMTP/API-key and private-key patterns — none). The client bundle carries only the public anon key (`role:anon`). No source maps are published. Passwords are hashed by GoTrue (bcrypt); the app never stores or sees them.
- **A5 Security misconfiguration**: production CSP is strict — `script-src 'self'` (no `unsafe-inline`/`unsafe-eval`), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (via `_headers`), `connect-src` scoped to `'self'` + the one Supabase origin. CORS on the Edge Function reflects **only** the allow-listed origin — a foreign `Origin` (incl. another `*.github.io`) is never reflected.
- **Transport**: HTTPS only; `github.io` is HSTS-preloaded.

## 4. OWASP Top 10 (2021) mapping

| Risk | Status |
|------|--------|
| A01 Broken Access Control | RLS on every table + role re-checks in every privileged function; IDOR tested. **Held.** |
| A02 Cryptographic Failures | Supabase-managed TLS & password hashing; no secrets in client/history. **Held.** |
| A03 Injection | Parameterized/normalized throughout; no string-built SQL; XSS-safe (no `dangerouslySetInnerHTML` with user data). **Held.** |
| A04 Insecure Design | Server-side validation, rate limits, consent logging, least-privilege roles, no-enumeration design. **Held.** |
| A05 Security Misconfiguration | Strict CSP/headers; anon surface pinned & tested. **F1/F3 config items open.** |
| A06 Vulnerable Components | 0 production vulns; dev-only moderates. **Held; monitor.** |
| A07 Identification & Auth | Supabase auth; rate limits; single-use short-lived tokens; generic errors. **F5 (MFA/CAPTCHA) recommended.** |
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

1. **Disable open sign-ups (F1).** Dashboard → Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". This is the most important item.
2. **Enable leaked-password protection (F3).** Dashboard → Authentication → Passwords → enable the HaveIBeenPwned check.
3. **WAF / abuse protection:** GitHub Pages has none. For rate-limiting and DDoS protection, front the site with **Cloudflare** (free tier: proxy the custom domain, enable "Under Attack" only if needed, and Bot Fight Mode). Cloudflare also lets the `public/_headers` file take effect (HSTS 2y + preload, Permissions-Policy, etc.).
4. **Dependabot:** enable in the GitHub repo (Settings → Code security) for automated dependency updates.
5. Keep the SMS/SMTP provider credentials only in the Supabase dashboard — never in the repo or chat.

## 7. Honest residual risk

No system is unbreakable, and this report does not claim it is. The realistic residual risks are:
- **Account takeover of a staff member** via a phished password, a stolen phone/SIM, or a leaked first-entry/invite link — mitigated by rate limits, one-time links, and admin block/reset, but not eliminated. True MFA (F5) would reduce this.
- **The Supabase account itself**: whoever controls the Supabase login or the `service_role` key controls all data. Protect that account with a strong password and MFA; treat the service key as a crown jewel.
- **GitHub org / Pages**: whoever can push to `hemshech-tnua/crm` can change the live site. Protect the GitHub accounts (MFA) and limit who has write access.
- **Availability**: GitHub Pages and Supabase have their own uptime; a determined DDoS on the public site is best absorbed by Cloudflare (item 3).
- **Legal/privacy**: this is a technical review, not a legal compliance opinion. The privacy-law items remain for a privacy consultant, as noted in `docs/04-security-privacy.md`.
