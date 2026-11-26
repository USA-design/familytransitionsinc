# Family Transitions CRM

The website stays on Cloudflare. Everything that touches lead data runs in AWS, using only services
covered by the AWS Business Associate Addendum (BAA): API Gateway, Lambda, DynamoDB, S3, Cognito,
SES, Secrets Manager and CloudWatch Logs.

```
Website form ──POST──▶ API Gateway ─▶ Lambda ─▶ DynamoDB (encrypted, point-in-time backup)
(Cloudflare)                                └─▶ S3 (resumes, private, encrypted)
                                            └─▶ SES: staff alert with NO personal details, only a CRM link
Staff browser ─ /crm/ page (static, no data) ─▶ Cognito sign-in (password + authenticator code)
              ─ Bearer token ──────────────▶ API Gateway ─▶ Lambda ─▶ DynamoDB / SES / Twilio
Twilio ─ incoming texts, STOP ─────────────▶ API Gateway ─▶ Lambda
```

Cloudflare only serves the HTML and JavaScript. Form data and lead records go straight between the
visitor's browser and AWS, so Cloudflare never holds them.

## What it does

- **Lead capture** from all 5 website forms (consultation, referral, DD tour, provider, careers + resume).
  Fields are allowlisted on the server, so a clinical field can't be stored by mistake. A hidden spam trap and
  a timing check drop bots.
- **Lead source tracking**: what the person said ("How did you hear about us?") plus what the site measured
  (Google, AI assistant, social, UTM campaign tags, landing page).
- **Pipelines** for Clients & referrals, Sponsored Residential providers and Job applicants, with
  drag-and-drop stages, owner, office, follow-up date, notes and a full activity timeline.
- **Text messages** (Twilio): one-off texts with templates, optional auto-reply, incoming replies land on
  the lead, STOP/START honored automatically.
- **Email** (Amazon SES): one-off emails and marketing campaigns with a signed unsubscribe link.
- **Review requests**: one click sends the Google review link for the right office.
- **Campaigns** go only to people who ticked the optional updates box (referral partners, provider prospects).
- **Reports**: leads per week, sources with conversion rate, channel, form and stage counts. CSV export.
- **Today view**: new leads not yet contacted (oldest first), follow-ups due, unread texts and leads going quiet.
  Alerts when a new lead waits more than an hour during business hours, and a weekday 8 AM digest (counts only).
- **Text inbox**: every conversation in one place; texts from unknown numbers start a new lead automatically.
- **Missed-call text-back**: point the Twilio number's voice webhook at `TwilioVoiceWebhook`; calls ring the office line
  (add `"forwardTo": "+18047455101"` to the Twilio secret) and unanswered callers get one text back.
- **Sequences**: timed email/text series (e.g. provider recruitment day 0/3/7/14), auto-started by form or by staff,
  stopping on reply, stage change or opt-out. Two starter sequences can be added from Campaigns.
- **Referral partners**: organizations from the referral form with referral and enrollment counts, contacts and notes.
- **Roles**: Admin, Intake (clients, referrals, providers) and HR (applicants), managed on the Team page; `CRM_ADMIN_EMAILS`
  (or `CRM_NOTIFY_EMAIL`) are always admins. The Team page also shows the access log and imports HubSpot CSV exports.
- **Website quiz** at `/which-service/` recommends a program and captures a call-back request.
- **HIPAA safeguards**: MFA-required staff sign-in, 30-minute idle sign-out, audit log of every view,
  change, message and export, encryption at rest and in transit, no personal details in alert emails.

Demo with sample data: `/crm/?demo=1` on the site.

## Dev setup (Glenn's AWS account, test data only)

No BAA is in place on the dev account, so **use only made-up test leads** until go-live.

1. **AWS account**: sign in to the AWS console, region **US East (N. Virginia) us-east-1**.
2. **Let GitHub deploy**: CloudFormation → Create stack → Upload `crm/bootstrap-github-role.yaml` →
   stack name `fti-crm-github` → tick the IAM acknowledgement → Create. Copy the **RoleArn** output.
3. **GitHub variables**: repo → Settings → Secrets and variables → Actions → **Variables** tab:
   - `AWS_ROLE_ARN` = the RoleArn from step 2
   - `CRM_NOTIFY_EMAIL` = where new-lead alerts go
   - `CRM_FROM_EMAIL` = the sender address (can be the same address in dev)
   - optional: `CRM_REVIEW_URL_NC`, `CRM_REVIEW_URL_PB` (Google review links), `CRM_AUTO_REPLY_SMS` = `on`
4. **Deploy**: Actions → *Deploy CRM (AWS)* → Run workflow. It builds, tests, deploys, then commits the API
   address into `crm/config.json` and the site, which Cloudflare redeploys automatically.
5. **Verify the sender**: click the link in the "Amazon Web Services – Email Address Verification" email.
   While SES is in its sandbox it can only send to verified addresses; request production access before launch.
6. **Staff logins**: Cognito → User pools → `fti-crm-dev-staff` → Users → Create user (email, "Send an email
   invitation"). On first sign-in they set a password and scan a QR code with an authenticator app.
7. **Texting (optional in dev)**: Secrets Manager → `fti-crm-dev/twilio` → Retrieve → Edit and fill in
   `accountSid`, `authToken` and `from` (+1XXXXXXXXXX) or `messagingServiceSid`. In Twilio, set the number's
   "A message comes in" webhook to the `TwilioIncomingWebhook` stack output (HTTP POST). US texting also needs
   A2P 10DLC registration in Twilio (a few days to approve).

## Go-live (FTI's account)

1. Franko opens an AWS account in FTI's name and accepts the **AWS BAA** in AWS Artifact (Agreements).
2. Repeat dev steps 2–6 in that account with GitHub variables `CRM_STAGE=prod`,
   `CRM_URL=https://familytransitionsinc.com/crm/`, `CRM_SIGNIN_PREFIX=fti-crm`.
3. Twilio: FTI's account on **Security or Enterprise Edition** with Twilio's BAA signed.
4. SES: production access, verify the `familytransitionsinc.com` domain with DKIM, send from e.g. `care@`.
5. Turn on CloudTrail for the account, and set a billing alert.
6. Import any existing HubSpot contacts as needed, then cancel HubSpot.

## Costs (estimate at FTI's volume)

AWS: a few dollars a month (Lambda, API Gateway and DynamoDB are pay-per-use; Secrets Manager about $0.80).
SES: about $0.10 per 1,000 emails. Twilio: a monthly number fee plus a per-text charge, plus the Security
Edition plan needed for the BAA (check Twilio's current pricing).

## Code

| Path | What |
|---|---|
| `template.yaml` | All AWS resources (SAM) |
| `src/forms.mjs` | Form allowlists, required fields, pipelines and stages |
| `src/submit.mjs` | Public form endpoint |
| `src/api.mjs` | Staff API (sign-in required) |
| `src/inbound.mjs` | Twilio incoming texts, unsubscribe links |
| `test/run.mjs` | Offline tests with fake AWS and Twilio (`node crm/test/run.mjs`) |
| `../public/crm/` | Staff dashboard page |
| `../tools/forms.js` | Website form script (copied to `public/assets/` by the build) |
