# Your Space — audit checklist (2026-11-18)

Full review of `web/`, `supabase/` and `.github/` — code read line by line, the live Supabase project probed with the public key only, and the app run locally.

**Severity:** 🔴 High · 🟠 Medium · 🟡 Low
**Status:** ☐ to do · ☑ fixed in code · 👤 needs you (dashboard / account setting, can't be done from code)

**Result:** 18 of 19 code items fixed and tested. S4 is waiting for your OK to download one file, and A1–A5 plus T3 need you in the Supabase dashboard.

## Already fine (checked, nothing to change)
- **XSS:** every user/database value written into the page goes through `esc()`; links go through `safeUrl()`. A scan of all ~400 template interpolations found none unescaped.
- **Database security:** Row-Level Security is forced on every table, and every policy also checks the private owner allow-list. The live project refuses anonymous reads (`permission denied` on `leads`, `files_metadata`, `is_app_owner`).
- **Storage:** private bucket, owner-folder-only policies, 1-hour signed URLs, 50 MB limit.
- **Edge Functions:** they check the caller's JWT, the owner check, input validation and email header injection (CR/LF blocked). The webhook secret is compared in constant time.
- **Libraries:** supabase-js 2.119.0, Chart.js 4.6.1, mammoth 1.13.0 (past the 1.11 path-traversal fix), docx 9.15.4 and SheetJS 0.20.3. None has a known vulnerability that affects browser use.
- **Secrets:** none in the repo; `config.js` holds only the public publishable key.

---

## 1. Supabase project & accounts
| # | Sev | Problem | Fix | Status |
|---|---|---|---|---|
| A1 | 🔴 | **Public sign-ups are ON** in the live project (`/auth/v1/settings` → `disable_signup: false`). Anyone can create an account. They can't see data (owner allow-list), but they use your auth quota and email sending, and it's one mistake away from a leak. | Authentication → Sign In / Providers → turn **Allow new users to sign up** OFF. | 👤 |
| A2 | 🔴 | Login email is **`cj.masujer@email.com`**. `email.com` is a public mail provider. If CJ doesn't own that exact mailbox, whoever does can use **Forgot password** and take over the account. | Confirm CJ can open that inbox. If not, change the user's email (Authentication → Users), or link Google (README 2b) and use that as the main login. | 👤 |
| A3 | 🟠 | **Edge Functions are not deployed** (`process-spreadsheet` and `send-email` return 404). Spreadsheet metrics stay "pending" forever and "Send automatically" fails. | README step 5b (GitHub Action or `npx supabase functions deploy`). | 👤 |
| A4 | 🟠 | Migration `20261118000003_uploads.sql` (PDF/.xls/HEIC uploads) is new and not yet run. | SQL Editor → run it. | 👤 |
| A5 | 🟡 | Changing the password does not ask for the current one. | Authentication → Providers → Email → turn on **Secure password change**. | 👤 |

## 2. Front-end security hardening
| # | Sev | Problem | Fix | Status |
|---|---|---|---|---|
| S1 | 🟠 | **Clickjacking:** GitHub Pages can't send `X-Frame-Options`, and `frame-ancestors` is ignored in a `<meta>` CSP. Another site could frame the app and trick a click on "Delete". | Frame-busting check in the first script: if the page is inside a frame, it refuses to render. | ☑ |
| S2 | 🟠 | **Word-file sanitizer is a deny-list** (it removes known-bad tags). A crafted `.docx` could still produce unexpected attributes (`xlink:href`, `srcset`, `formaction`…). | Replace it with an **allow-list** of tags and attributes, and only allow `http(s)/mailto/#` links and `data:image` sources. | ☑ |
| S3 | 🟡 | The login screen echoes `?error_description=` from the URL. A crafted link can show any text there ("Your account is locked, call …"). | Show only fixed, known messages; never echo URL text. | ☑ |
| S4 | 🟠 | **SheetJS is loaded at runtime from `cdn.sheetjs.com`** without an integrity check. If that CDN were compromised, it would run inside the signed-in app. `import()` can't use SRI. | Vendor `xlsx.mjs` 0.20.3 into `web/assets/vendor/` and drop the CDN from the CSP. **Needs your OK to download the file** (see the end of this checklist). | ☐ |
| S5 | 🟡 | `send-email`: `lead_id` isn't checked as a UUID, and a failed `email_log` insert is ignored. A failed log write means the email went out but wasn't counted, so the **400/day cap can be undercounted**. | Validate the UUID format; report log-write failures in the response. | ☑ |
| S6 | 🟡 | `deploy-functions.yml` installs the Supabase CLI as `version: latest`, so an unreviewed release runs with your access token. | Pin a version. | ☑ |

## 3. Correctness bugs by module
| # | Sev | Module | Problem | Fix | Status |
|---|---|---|---|---|---|
| B1 | 🔴 | Database / Home / Quota | `v_quota_progress` divides by `quota × goal%`. Setting **Quota = ₱0** (the form allows it) causes a *division by zero*, and **Home and Quota pages both crash**. | Migration `…000004_fixes.sql`: `nullif(…, 0)` in the view. | ☑ |
| B2 | 🟠 | Home | Overdue follow-ups are shown *faded* (they should stand out), and **cancelled posts** appear under "Posts this week". | Overdue shown in red with "overdue"; cancelled posts filtered out. | ☑ |
| B3 | 🟠 | Email | Personalization uses `String.replace` with the lead's name as the replacement. A name containing `$&`, `$'` or `` $` `` gets mangled (JS replacement patterns). | Use a replacer function. | ☑ |
| B4 | 🟠 | Theme toggle | Switching light/dark redraws the whole screen and **discards unsaved typing** (email draft, shortcut edits). | Redraw only screens that have charts. | ☑ |
| B5 | 🟠 | LTO calculator | Lease term isn't capped: typing `99999` builds an 8,000-row table and freezes the tab. The quotation also stays in the hidden print area, so **printing any other page prints the old quotation**. | Clamp term to 1–360; clear the print area on every navigation. | ☑ |
| B6 | 🟡 | Leads | `#/leads?open=<id>` for a lead that no longer exists (deleted, stale link from Home/Quota) throws a TypeError. | Guard, and show "Lead not found". | ☑ |
| B7 | 🟡 | Calendars | The month query stops at 23:59 on the last visible day, so items at 23:59–24:00 are missed. | Query up to the next day 00:00. | ☑ |
| B8 | 🟡 | Content | "Copy caption" throws when the Clipboard API is unavailable (http, older browsers). | Fallback copy method plus an error message. | ☑ |
| B9 | 🟡 | Settings → Import | The importer reads `.xls` but the file picker hides `.xls` files. | Add `.xls` to `accept`. | ☑ |
| B10 | 🟡 | All dialogs | Closing a dialog doesn't return keyboard focus to the button that opened it (accessibility). | Restore focus on close. | ☑ |
| B11 | 🟠 | App start | *Found during testing:* right after a deploy, GitHub Pages' 10-minute cache can give the browser a new `main.js` with an old `lib/*.js`. The app then fails with "does not provide an export" and stays on "Loading…". | Detect that error, re-fetch scripts past the cache once, reload; fall back to a clear message. | ☑ |

## 4. Testing
| # | What | Status |
|---|---|---|
| T1 | Unit tests (Node's built-in runner, no installs) for the pure helpers: phone normalising, email extraction, escaping, safe URLs, file names, spreadsheet metrics. | ☑ |
| T2 | Browser checks: login, theme toggle, frame-busting, sanitizer with hostile HTML, upload type detection, no console/CSP errors. | ☑ |
| T3 | Signed-in flows (real uploads, saving leads). **Not possible from here without the account password.** Listed for you to click through after deploying. | 👤 |

---
**Needs your OK:** S4 downloads `xlsx.mjs` (~1 MB, SheetJS 0.20.3) from `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs` into the repo. It's the exact file the app already runs today, just served from your own site instead.

## Test results
- **Unit tests:** `npm test` → **9/9 pass** (escaping, URL allow-list, PH phone normalising, email parsing, safe file names, Manila dates, CSV quoting, spreadsheet metrics incl. "phones are not summed").
- **Sanitizer (S2):** fed `javascript:` links, `onclick`/`onerror`, remote `<img>`/`srcset`, SVG `xlink:href`, `<form formaction>`, `<script>`, `<math>/<style>` mutation-XSS and a `#…`/`id="app"` hash hijack. Output kept only `<p>`, safe `<a href="https://…" target=_blank rel=noopener>` and a `data:image/png` picture. Normal Word structure (headings, bold/italic/underline, lists with `start`, tables with `colspan`) survives.
- **Clickjacking (S1):** a test page that framed the app was replaced by the app itself (test page deleted afterwards).
- **Dialogs (B10):** focus moves into the dialog, then returns to the opener on close.
- **Page load:** login screen in light and dark, no console or CSP errors after a fresh load.
- **Not testable here:** anything behind the login (no password). Click through after deploying: upload PDF/docx/xlsx/photo, set Quota to ₱0 (Home must still open after migration 4), LTO term 99999 (stays at 360), Email with a lead named `A$&B`.
