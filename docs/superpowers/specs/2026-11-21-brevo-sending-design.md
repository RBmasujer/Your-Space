# Brevo sending for "Send automatically" — design

**Status:** approved in conversation, 2026-11-21. Small change.

## Intent
CJ wants the Email screen's **Send automatically** to send personalised emails to leads through a new
Brevo account instead of needing the Gmail API OAuth setup. Personal-use site, **no custom domain**.

## Goals
- One personal email per recipient, same templates / `{{first_name}}` / signature / preview as today.
- Brevo API key lives only in Supabase Edge Function secrets.
- Clear, plain-language errors for the usual new-account problems.
- Step-by-step setup guide in the README.

## Non-goals
- HTML emails, open/click tracking, Brevo webhooks, scheduled sending.
- Removing Gmail sending.

## Constraints
- Supabase Edge Functions block SMTP ports → use Brevo's HTTPS API (`POST https://api.brevo.com/v3/smtp/email`).
- No domain: Brevo replaces a `@gmail.com` sender with its own address (`…@<id>.t-sender-sib.com`).
  The display name stays; **Reply-To** is set to CJ's Gmail so replies reach him.
- Brevo free plan: 300 emails/day. Key expires (current key: 2027-11-21).
- Brevo "authorised IPs" blocks unknown IPs; Supabase's outbound IPs change, so it must be turned off.

## Approaches
1. **Add Brevo to the existing `send-email` function, Gmail kept as fallback (chosen).** Reuses owner
   auth, validation, daily cap, `email_log`; Email screen keeps working.
2. Call Brevo from the browser — rejected: exposes the API key (public repo/site).
3. Replace Gmail code entirely — rejected: throws away a working path for no gain.

## Design
- Provider: `BREVO_API_KEY` set → Brevo; otherwise Gmail (as today).
- Secrets: `BREVO_API_KEY`, `BREVO_SENDER` (verified sender in Brevo), `BREVO_SENDER_NAME` (optional),
  `REPLY_TO` (optional, defaults to `BREVO_SENDER`). `DAILY_LIMIT` defaults to 300 with Brevo, 400 with Gmail.
- Request body built by a pure JS helper (`brevo.js`) so it is unit-tested in Node, like `mime.js`.
  Plain text (`textContent`). Brevo `messageId` stored in `email_log.provider_message_id`.
- Brevo errors (401 key invalid/expired, unrecognised IP, sender not valid, account not activated) mapped to
  plain sentences by the function; the browser shows them.
- Setup check returns `provider`; the Email screen shows "via Brevo" / "via Gmail" and adjusts its hint text.

## Left to the builder
Exact wording of messages and README steps.
