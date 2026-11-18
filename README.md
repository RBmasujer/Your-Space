# Your Space — CJ Masujer's work dashboard

A private, serverless work site for a property specialist at RLC Residences.

| Part | Runs on | Cost |
|---|---|---|
| Website (HTML/CSS/JS, no build step) | **GitHub Pages** | Free |
| Login | **Supabase Auth** (email + password, sign-ups disabled) | Free |
| Data (leads, quota, calendars, files metadata, email log) | **Supabase Postgres** + Row-Level Security | Free (500 MB) |
| Documents, spreadsheets, images, short videos | **Supabase Storage**, private bucket | Free (1 GB, 50 MB per file) |
| Spreadsheet metrics + sending email from Gmail | **Supabase Edge Functions** (Deno/TypeScript) | Free |

**Theme:** light or dark — follows the device, or tap 🌙/☀️ in the header (saved per device).

**Screens:** Home (goal meter, today's agenda, follow-ups due, shortcuts, Google Drive folder) · Leads (funnel board, filters, bulk updates, add/edit) · Quota & Progress (auto-computed from Closed leads, graphs, **downloadable PDF progress report**: sales, completed leads, total earnings) · Content Calendar (schedule/reschedule posts, attach media) · Manning & Tripping calendar · Files (upload PDF/Word/Excel/CSV/images/videos; preview PDFs; edit .xlsx/.xls/.csv/.docx/images; metrics) · Showcase · **Quotation** (Lease-to-Own 120 computation + printable quotation; upload the developer's **price list** — Excel, CSV, PDF or Word — and pick a unit to fill in its price, discount, dues and deposit) · Email (templates, groups, automatic Gmail sending or Gmail compose) · Settings (profile photo, Google account, theme, shortcuts, import, backup, password).

```
Browser (GitHub Pages)  ──anon key + user JWT──▶  Supabase
  web/                                             ├─ Auth (one user)
  └─ supabase-js                                   ├─ Postgres  (RLS: owner only)
                                                   ├─ Storage   (private bucket, owner folder only)
                                                   └─ Edge Functions
                                                        ├─ process-spreadsheet → metrics → files_metadata, file_metrics_log
                                                        └─ send-email → Gmail API (HTTPS) → email_log
```

---

## 0. Before you start

- A **GitHub** account. On the free plan, GitHub Pages only works from a **public** repository. The code is public; the data is not (it lives in Supabase behind the login and RLS).  
  *If you have GitHub Pro (free with the GitHub Student Developer Pack), you can make the repo private and Pages still works.*
- A **Supabase** account (free).
- Login account: **cj.masujer@email.com** (one user only).
- For automatic email sending: access to the **cjmasujer.rpmmc@gmail.com** Google account (once, to grant permission).
- ⚠️ **Never commit client data** (`Leads_List.csv`, `Leads_Tracker.xlsx`, backups) to the repo. `.gitignore` already blocks `*.csv`, `*.xlsx`, `*.docx` and backup files. Import them through the app instead (step 7).

---

## 1. Create the Supabase project

1. supabase.com → **New project** → name `your-space`, region **Southeast Asia (Singapore)**, generate a strong database password and store it in a password manager.
2. When it's ready, open **Project Settings → API** (or **API Keys**) and note:
   - **Project URL** — `https://<project-ref>.supabase.co`
   - **Project ref** — the `<project-ref>` part
   - **anon** key (legacy) *or* **publishable** key. Either works. **Do not** use the `service_role` / secret key anywhere in `web/`.

## 2. Lock down authentication

1. **Authentication → Sign In / Providers**: keep **Email** enabled; turn **OFF** "Allow new users to sign up".
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://<github-username>.github.io/<repo-name>/`
   - **Redirect URLs:** add `https://<github-username>.github.io/<repo-name>/**`
3. **Authentication → Users → Add user → Create new user**: email **`cj.masujer@email.com`**, the password agreed with CJ, tick **Auto confirm user**.
   - This is the **only** account. The repo is public, so the password is never written in any file — type it only here.
   - Password resets are emailed to `cj.masujer@email.com`, so that inbox must be one he can open.
   - The login account and the Gmail that sends emails to leads (`cjmasujer.rpmmc@gmail.com`, step 6) are separate on purpose.

## 2b. (Recommended) Sign in with Google — make the Gmail the main account

This lets CJ tap **Continue with Google** instead of typing a password, and shows the Gmail profile photo in the header. The Google account is *linked* to the existing login, so it's the same user and the same data. Sign-ups stay off, so a stranger's Google account still can't get in.

1. **console.cloud.google.com** → the same project as step 6 (or a new one) → **Google Auth Platform → Clients → Create client → Web application**.
   - **Authorized JavaScript origins:** `https://<github-username>.github.io`
   - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**. (Scopes needed: only the default `openid`, `email`, `profile`.)
2. Supabase → **Authentication → Sign In / Providers → Google** → enable, paste the Client ID and secret → Save.
3. Same page, scroll to **User Signups**: keep **Allow new users to sign up** OFF, and turn **Allow manual linking** ON.
4. Sign in to Your Space with email + password → **Settings → Google account → Connect Google account** → pick the Gmail (e.g. `cjmasujer.rpmmc@gmail.com`). After that, **Continue with Google** on the login screen works.
5. Testing locally? Add `http://localhost:5500/**` to **Authentication → URL Configuration → Redirect URLs** as well.

Profile photo: **Settings → Profile → Upload photo** (or click the round photo in the header). Without one, the Google photo is used; without either, the initials "CM" are shown as a placeholder.

## 3. Create the database, security rules and storage bucket

In **SQL Editor → New query**, run these files **in order** (paste the whole file, then **Run**):

1. `supabase/migrations/20261118000001_schema.sql` — tables, triggers, views, RLS policies, the private `workspace` bucket and its policies.
2. `supabase/migrations/20261118000002_app_extras.sql` — the keep-alive `ping()` function.
3. `supabase/migrations/20261118000003_uploads.sql` — lets the bucket accept **PDF, .xls, .doc and iPhone/modern photo formats (HEIC, AVIF, BMP)**. ⚠️ Projects set up before this file existed must run it once too, or those uploads are refused.
4. `supabase/migrations/20261118000004_fixes.sql` — audit fixes (the Home/Quota pages no longer crash when Quota is ₱0) and the commission rate used by the PDF progress report. Run it on existing projects too.
5. `supabase/seed/seed.sql` — registers the user from step 2 as the **only** owner, plus quota settings (₱25M, 150% goal, Nov 2026 – Feb 2027), 10 shortcuts and 6 email templates.  
   ✋ Open `seed.sql` first and check the TODO about Facebook ID `100079897745013`: if that's CJ's *personal* account, delete that line (he wants Messenger only, no feed).

Then check **Advisors → Security Advisor**. It should report no RLS issues.

**What the security model does**
- Every table has RLS **forced on**. A row is visible only if `owner_id = auth.uid()` **and** the user is on the private allow-list (`private.app_owner`). So even if someone re-enables sign-ups by mistake, a new account sees and writes nothing.
- Anonymous visitors (people who only have the public anon key) get *permission denied* on every table and view.
- Storage: files must live under `<owner-uuid>/…` in the private `workspace` bucket; only the owner can read, write or delete them. Files are shown through signed URLs that expire after 1 hour.
- The dashboard views use `security_invoker`, so they obey RLS (a plain Supabase view would bypass it).

## 4. Put the code on GitHub

1. Create a new **public** repository, e.g. `your-space` (no README).
2. Edit `web/assets/js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
   export const SUPABASE_ANON_KEY = '<anon or publishable key>';
   ```
3. Push:
   ```bash
   cd your-space
   git init -b main
   git add .
   git commit -m "Your Space v1"
   git remote add origin https://github.com/<github-username>/your-space.git
   git push -u origin main
   ```
4. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.  
   The workflow `.github/workflows/pages.yml` publishes **only the `web/` folder**. Re-run it from the **Actions** tab if the first push happened before you changed this setting.
5. Open `https://<github-username>.github.io/your-space/` and sign in.

## 5. Deploy the Edge Functions

### 5a. Secrets (Supabase → Edge Functions → Secrets, or CLI)
| Name | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://<github-username>.github.io` (no path, no trailing slash) |
| `WEBHOOK_SECRET` | a long random string, e.g. the output of `openssl rand -hex 32` |

(`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.)

### 5b. Deploy — option 1: from GitHub (no installs)
1. Supabase → your avatar → **Account → Access Tokens** → generate a token.
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_ACCESS_TOKEN` = that token
   - `SUPABASE_PROJECT_REF` = your project ref
3. **Actions → Deploy Supabase Edge Functions → Run workflow.** After that it redeploys automatically whenever `supabase/functions/**` changes.

### 5b. Deploy — option 2: from your laptop
```bash
npx supabase login
npx supabase functions deploy process-spreadsheet --project-ref <project-ref>
npx supabase functions deploy send-email --project-ref <project-ref>
npx supabase secrets set --project-ref <project-ref> ALLOWED_ORIGINS=https://<github-username>.github.io WEBHOOK_SECRET=<random>
```
`supabase/config.toml` sets `verify_jwt = false` for `process-spreadsheet` (it checks the webhook secret or the user's token itself) and `true` for `send-email`.

### 5c. (Optional) Database webhook for spreadsheets
The app already calls `process-spreadsheet` right after every spreadsheet upload or save. The webhook is a backup trigger (for example, if the browser closes mid-upload):  
**Database → Webhooks → Create** → table `files_metadata`, event **Insert**, type **Supabase Edge Functions** → `process-spreadsheet`, method POST, add HTTP header `x-webhook-secret: <WEBHOOK_SECRET>`.  
A row is processed only once, because the function atomically claims rows whose status is `pending`.

## 6. Gmail sending (automatic emails from cjmasujer.rpmmc@gmail.com)

Supabase Edge Functions block outbound SMTP ports, so the function uses the **Gmail API over HTTPS**. Emails are sent *from his real Gmail* and appear in **Gmail → Sent**. Until this is set up, the Email screen's **"Open in Gmail"** button still works (compose windows, BCC batches of 25).

1. **console.cloud.google.com** → create a project "Your Space Mail".
2. **APIs & Services → Library** → enable **Gmail API**.
3. **Google Auth Platform / OAuth consent screen**: user type **External**, app name "Your Space", support email = his Gmail. Under **Data access / Scopes** add `https://www.googleapis.com/auth/gmail.send`.
4. **Audience / Publishing status** → **Publish app** (set it to **In production**).  
   ⚠️ In **Testing** mode Google expires the refresh token after **7 days**, and sending would stop every week. An unverified app in production is fine for a single personal account: you'll see "Google hasn't verified this app" → **Advanced → Go to Your Space (unsafe)**. That's expected for your own app.
5. **Clients → Create client → Web application** → Authorized redirect URI: `https://developers.google.com/oauthplayground`. Copy the **Client ID** and **Client secret**.
6. Go to **developers.google.com/oauthplayground** → ⚙️ (top right) → tick **Use your own OAuth credentials** → paste the ID and secret.  
   Step 1: type the scope `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs** → sign in **as cjmasujer.rpmmc@gmail.com** → Allow.  
   Step 2: **Exchange authorization code for tokens** → copy the **Refresh token**.
7. Add Supabase Edge Function secrets:
   | Name | Value |
   |---|---|
   | `GMAIL_CLIENT_ID` | from step 5 |
   | `GMAIL_CLIENT_SECRET` | from step 5 |
   | `GMAIL_REFRESH_TOKEN` | from step 6 |
   | `GMAIL_SENDER` | `cjmasujer.rpmmc@gmail.com` |
   | `GMAIL_SENDER_NAME` | `CJ Masujer — RLC Residences` |
   | `DAILY_LIMIT` | `400` (optional; Gmail allows about 500/day for personal accounts) |
8. In the app, open **Email**. The line above the Send buttons should say **✅ Automatic sending is ready — from …**. If it shows ⚠️, it says which step is missing (function not deployed, Gmail secrets not set, or ALLOWED_ORIGINS). Then: pick recipients → choose a template **or type your own message** → **Send automatically**. Every email is logged in *Recently sent*.

**Templates:** `{{first_name}}` and `{{name}}` work in the subject and the message, whether it comes from a saved template or is typed fresh; the **Preview** shows exactly what the first person will get. **Send automatically** personalises every email. **Open in Gmail** personalises when you email one person; with several people it opens BCC windows of 25, so names become "there".

If sending ever fails with `invalid_grant`, the token was revoked (for example, after a Google password change). Repeat step 6 and update `GMAIL_REFRESH_TOKEN`.

## 7. Load his data

Sign in → **Settings**:
- **Import leads**: choose `Leads_List.csv` or `Leads_Tracker.xlsx`. The importer finds the header row by itself (the Excel tracker's header is on row 4), skips duplicates (same name + email), and restores PH mobile numbers that Excel stripped (`9171234567` → `+639171234567`).
- **Import from the old app**: in the browser where the old `your_space.html` was used, open DevTools → Console → `copy(localStorage.ys)`, paste into a file `old.json`, import it. This brings over leads (with stage, hot/cold, qualified, deal amounts), posts, schedule, showcase and quota settings.

## 8. Keep it awake (free plan)

Free Supabase projects pause after 7 days without activity. `.github/workflows/keepalive.yml` calls the harmless `ping()` function every 3 days. Add two repository secrets: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (both are public values). Note that GitHub turns off scheduled workflows in repos with no commits for 60 days; if that happens, re-enable it from the **Actions** tab.

---

## Automatic file import (Files screen)
Upload a spreadsheet (.xlsx/.xls/.csv), Word file (.docx) or PDF and Your Space reads it straight away:

| Found in the file | Goes to | How it's recognised |
|---|---|---|
| **Schedule** | Manning & Tripping calendar | a *Date* column (list), a roster with days across the top (only CJ's row is used when other people are listed), a monthly calendar grid (Sun–Sat), or text lines that start with a date |
| **Leads list** | Leads | *Name* + *Phone* or *Email* columns. Only new people are added; existing leads are never changed |
| **Content plan** | Content calendar | *Caption* or *Platform* columns |
| anything else | — | an **overview** only: pages/sheets, words, peso amounts, dates, emails, phone numbers |

- **Dates and times:** `Dec 3, 2026`, `12/3/2026`, `3 Dec`, Excel dates, `10AM-7PM`, `10:00-7:00`, `2PM`. `OFF`, `RD`, `Rest day` and `Leave` are skipped. When the year is missing, it comes from the title or file name ("December 2026"), otherwise the nearest sensible year.
- **Monthly updates:** re-uploading an updated schedule **replaces** what earlier uploads added for the same dates. Entries typed in by hand, or imported entries edited since (e.g. marked Done), are never removed and never duplicated.
- **Undo:** every upload shows what it added, with **↶ Undo**. Also in the file's ✎ details, along with **Read & apply again**. Undo removes what that upload added and puts back anything it replaced. Deleting a file asks whether to remove what it added.
- **Editing a spreadsheet in the app** and saving re-applies it the same way.
- **PDFs** are read by a built-in reader (no extra library). Scanned PDFs (photos of paper) and password-protected PDFs have no readable text; they are stored but not imported.

## How the quota math works
- Only leads with **Stage = Closed** count, and only if their **closed date** falls inside the contract period (Settings on the Quota page).
- A lead can't be saved as Closed without a **contract price** (enforced by the database).
- The closed date is stamped automatically in **Manila time**; re-opening a lead removes it from the totals; **Cancelled** never counts.
- **Reserved** deals show as pipeline value but don't count yet.
- Goal = quota × goal % (default 150%). "Needed per month" = remaining ÷ months left.

## Limits to know
| Thing | Limit |
|---|---|
| Database | 500 MB (hundreds of thousands of leads) |
| File storage | 1 GB total, 50 MB per file |
| Spreadsheet metrics | files up to 5 MB (2-second CPU limit per function call); larger files still open and edit in the browser |
| Browser spreadsheet editor | shows the first 1,000 rows × 50 columns; keeps values and formulas, but not colors/borders, so use **Save as copy** for formatted workbooks |
| Word editor | saves an **edited copy** (headings, bold/italic, lists, tables, pictures kept; page layout simplified) |
| Automatic emails | 20 per request (the app batches), 400 per 24 h |
| Backups | none on the free plan: use **Settings → Backup** weekly |

## Daily-use tips
- **Install it on the phone like an app:** iPhone (Safari) → Share → **Add to Home Screen**; Android (Chrome) → ⋮ → **Install app / Add to Home screen**. It opens full-screen with its own icon.
- **Phone layout:** bottom tab bar (Home · Leads · Schedule · Posts · More), lead cards with one-tap 📞 Call / 💬 Text / ✉️ Email, calendars that show dots per day and list the tapped day's entries, forms that open full-screen with Save pinned at the bottom, and inputs sized so iPhones don't zoom in while typing. Tested at 360 px, 390 px, landscape and tablet widths.
- Password reset: tap **Forgot password?**. Open the email link **on the same device and browser** where you asked for the reset.
- Facebook, Messenger, Instagram, TikTok, Meta Business Suite and Salesforce refuse to be embedded in other sites, so their shortcuts open in a new tab. The Google Drive folder *is* embedded on Home (it must stay shared as "anyone with the link").

## Troubleshooting
| Symptom | Fix |
|---|---|
| Login page says "Setup needed" | `web/assets/js/config.js` still has placeholders |
| "Not authorized" after login | run `supabase/seed/seed.sql` (the user isn't on the owner allow-list); the login must be exactly `cj.masujer@email.com` |
| "Could not reach the database" | project paused (open the Supabase dashboard → Restore), or wrong URL/key |
| Spreadsheet stays **pending** | Edge Function not deployed, or `ALLOWED_ORIGINS` doesn't match your Pages origin |
| Email says "not set up yet" | Gmail secrets missing (step 6) |
| CORS error in the console | `ALLOWED_ORIGINS` must be exactly `https://<user>.github.io` |
| Upload says "bucket does not accept …" or "database does not know pdf files" | run `supabase/migrations/20261118000003_uploads.sql` (step 3) |
| No **Continue with Google** button on the login screen | Google provider is not enabled in Supabase (step 2b) |
| "That Google account is not connected" | sign in with email + password, then **Settings → Google account → Connect** |
| A photo shows "this browser cannot display this format" | it's HEIC from an iPhone: it's stored fine, but only Safari can preview it. Download it, or set the iPhone camera to **Most Compatible** |

## Tests
No installs needed (Node 22+):
```bash
npm test
```
Security/bug review and its status: `AUDIT_CHECKLIST.md`.

## Project layout
```
web/                      ← published to GitHub Pages
  index.html              ← CSP, loads vendor libs + main.js
  assets/css/app.css
  assets/js/config.js     ← your Supabase URL + anon key
  assets/js/main.js       ← auth gate, owner check, router
  assets/js/lib/          ← supabase client, utils, calendar, charts, files, goal meter
  assets/js/views/        ← one module per screen
  assets/vendor/          ← supabase-js, Chart.js, Mammoth, docx (bundled, MIT/BSD)
supabase/
  migrations/             ← schema + RLS + storage; ping()
  seed/seed.sql           ← owner, settings, shortcuts, templates
  functions/              ← process-spreadsheet, send-email (+ _shared/cors.ts)
  config.toml
.github/workflows/        ← pages.yml, deploy-functions.yml, keepalive.yml
```
SheetJS (spreadsheets) is loaded on demand from its official CDN (`cdn.sheetjs.com`, v0.20.3). The npm copy of `xlsx` is outdated and has known vulnerabilities, so it isn't used.
