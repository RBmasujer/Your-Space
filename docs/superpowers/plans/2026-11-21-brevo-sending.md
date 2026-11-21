# Brevo Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Send automatically" sends each personalised email through Brevo when `BREVO_API_KEY` is set, Gmail otherwise.

**Architecture:** The `send-email` Edge Function picks the provider from its secrets. A pure JS helper (`brevo.js`, like `mime.js`) builds the Brevo request and explains Brevo errors so Node tests cover it. The Email screen reads `provider` from the setup check to word its status and hints.

**Tech Stack:** Deno Edge Function (TypeScript), plain ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-brevo-sending-design.md`

## Global Constraints
- Brevo endpoint `POST https://api.brevo.com/v3/smtp/email`, header `api-key`, plain text via `textContent`.
- Secrets: `BREVO_API_KEY`, `BREVO_SENDER`, `BREVO_SENDER_NAME` (optional), `REPLY_TO` (optional, default `BREVO_SENDER`).
- `DAILY_LIMIT` default: 300 with Brevo, 400 with Gmail.
- The API key never appears in the repo, the browser, or error text.
- No new dependencies.

## Review Focus
1. Expired/invalid key (Brevo 401) → message says to make a new key and update `BREVO_API_KEY`.
2. "unrecognised IP" (Brevo 401 with that text) → message says to turn off IP blocking in Brevo.
3. Sender not verified in Brevo (400 "sender … not valid") → message says to verify the sender.
4. `REPLY_TO` / `BREVO_SENDER` invalid → not configured (sender) / ignored (reply-to); never a broken request.
5. Sender name containing CR/LF or quotes → stripped, not sent raw.

---

### Task 1: `brevo.js` helper

**Files:**
- Create: `supabase/functions/send-email/brevo.js`
- Test: `tests/mail.test.mjs`

**Interfaces:**
- Produces: `buildBrevoPayload({ to, subject, body, sender, senderName = '', replyTo = '' }) -> object`; `explainBrevoError(status: number, payload: any) -> string`; `BREVO_URL` constant.

- [ ] **Step 1: Write failing tests** — `brevo payload` asserts `{ sender: { email, name }, to: [{ email }], subject, textContent, replyTo: { email } }`; name `'Me\r\nBcc: x'` comes out without CR/LF; invalid `to` throws `/invalid address/`; invalid `replyTo` omits `replyTo`. `brevo errors` asserts 401 + "unrecognised IP address" → `/IP/`, 401 other → `/BREVO_API_KEY/`, 400 "sender … not valid" → `/verify/i`, "not yet activated" → `/activat/`, unknown → Brevo's own `message`.
- [ ] **Step 2: Run `npm test`** — expect FAIL (module missing).
- [ ] **Step 3: Implement** in `brevo.js` reusing `EMAIL_RE` from `mime.js`.
- [ ] **Step 4: Run `npm test`** — expect PASS.

### Task 2: Provider choice in `send-email`

**Files:** Modify `supabase/functions/send-email/index.ts`

**Interfaces:** Consumes Task 1. Produces check response `{ configured, provider: 'brevo' | 'gmail', sender, reply_to, sent_24h, daily_limit }`.

- [ ] **Step 1:** Read Brevo secrets; `PROVIDER = BREVO_API_KEY ? 'brevo' : 'gmail'`; `configured` per provider; default `DAILY_LIMIT` per provider.
- [ ] **Step 2:** `sendOne(to, subject, body) -> { id }` per provider; Brevo errors throw `explainBrevoError(...)`. Gmail token fetched only for Gmail.
- [ ] **Step 3:** Run `npm test` (unchanged tests still PASS). No Deno locally; type-check by reading.

### Task 3: Email screen + error text

**Files:** Modify `web/assets/js/views/email.js`, `web/assets/js/lib/mail.js`, `tests/mail.test.mjs`

- [ ] **Step 1:** Test: `explainSendError(501, { error: 'not_configured' })` matches `/not connected/` and mentions Brevo or Gmail secrets.
- [ ] **Step 2:** Status line "✅ Automatic sending is ready — via Brevo · replies go to …"; hint and confirm text depend on `provider` (no "shows in Gmail → Sent" for Brevo; limit from `daily_limit`).
- [ ] **Step 3:** `npm test` PASS.

### Task 4: README guide + commit

**Files:** Modify `README.md` (new section "6b. Brevo sending"; architecture line).

- [ ] **Step 1:** Steps: create account → add & verify sender → turn off authorised-IP blocking → API key (Transactional email only, note expiry) → Supabase secrets table → deploy (push to main or CLI) → check the Email screen → troubleshooting table.
- [ ] **Step 2:** `npm test` PASS; commit.
