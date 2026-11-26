// Offline tests: fakes DynamoDB, SES, Secrets Manager, S3 presigning and Twilio, then runs the real handlers.
// Run: node crm/test/run.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../src/package.json", import.meta.url));
const bases = new Set(["@aws-sdk/client-dynamodb:DynamoDBClient", "@aws-sdk/lib-dynamodb:DynamoDBDocumentClient", "@aws-sdk/client-sesv2:SESv2Client",
  "@aws-sdk/client-secrets-manager:SecretsManagerClient", "@aws-sdk/client-cognito-identity-provider:CognitoIdentityProviderClient"].map((s) => { const [m, c] = s.split(":"); return Object.getPrototypeOf(require(m)[c].prototype); }));

process.env.TABLE_NAME = "t"; process.env.FILES_BUCKET = "b"; process.env.NOTIFY_EMAIL = "staff@example.org";
process.env.FROM_EMAIL = "crm@example.org"; process.env.CRM_URL = "https://x/crm/"; process.env.TWILIO_SECRET_ARN = "tw";
process.env.UNSUB_SECRET_ARN = "un"; process.env.REVIEW_URL_NORTH_CHESTERFIELD = "https://g.page/r/nc"; process.env.AUTO_REPLY_SMS = "on";
process.env.ADMIN_EMAILS = "glenn@example.org"; process.env.USER_POOL_ID = "pool"; process.env.AWS_REGION = "us-east-1"; process.env.AWS_ACCESS_KEY_ID = "x"; process.env.AWS_SECRET_ACCESS_KEY = "x";

const db = new Map(); const emails = []; const texts = []; const cognitoCalls = [];
const key = (i) => `${i.pk}|${i.sk}`;
const get = (o, path) => o[path];
const fakeSend = async function (cmd) {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === "PutCommand") { if (i.ConditionExpression && db.has(key(i.Item))) throw new Error("exists"); db.set(key(i.Item), structuredClone(i.Item)); return {}; }
  if (n === "GetCommand") return { Item: structuredClone(db.get(key(i.Key))) };
  if (n === "DeleteCommand") { db.delete(key(i.Key)); return {}; }
  if (n === "UpdateCommand") {
    const it = db.get(key(i.Key)); if (!it) throw new Error("missing");
    i.UpdateExpression.replace(/^SET /, "").split(", ").forEach((p) => { const [l, r] = p.split(" = "); it[i.ExpressionAttributeNames?.[l] || l] = i.ExpressionAttributeValues[r]; });
    return { Attributes: structuredClone(it) };
  }
  if (n === "QueryCommand") {
    const v = i.ExpressionAttributeValues, ix = i.IndexName, hk = ix ? ix + "pk" : "pk", sk = ix ? ix + "sk" : "sk";
    const hv = v[i.KeyConditionExpression.match(/= (:\w+)/)[1]];
    const bw = i.KeyConditionExpression.match(/begins_with\(\w+, (:\w+)\)/), le = i.KeyConditionExpression.match(/<= (:\w+)/);
    let items = [...db.values()].filter((x) => x[hk] === hv && (!bw || String(x[sk]).startsWith(v[bw[1]])) && (!le || String(x[sk]) <= v[le[1]]));
    items.sort((a, b) => String(a[sk]).localeCompare(String(b[sk]))); if (i.ScanIndexForward === false) items.reverse();
    return { Items: structuredClone(items.slice(0, i.Limit || 1e9)) };
  }
  if (n === "ListUsersCommand") return { Users: [{ Username: "u1", Enabled: true, UserStatus: "CONFIRMED", Attributes: [{ Name: "email", Value: "glenn@example.org" }] }] };
  if (n === "AdminListGroupsForUserCommand") return { Groups: [{ GroupName: "admin" }] };
  if (/^Admin/.test(n)) { cognitoCalls.push(n); return { User: { Username: "u2" } }; }
  if (n === "SendEmailCommand") { emails.push(i); return { MessageId: "m" + emails.length }; }
  if (n === "GetSecretValueCommand") return { SecretString: i.SecretId === "tw" ? JSON.stringify({ accountSid: "AC1", authToken: "tok", from: "+18045550000" }) : "unsub-key" };
  throw new Error("unmocked " + n);
};
for (const b of bases) b.send = fakeSend;
globalThis.fetch = async (url, opts) => { texts.push(Object.fromEntries(opts.body)); return { ok: true, json: async () => ({ sid: "SM" + texts.length }) }; };

const { handler: submit } = await import("../src/submit.mjs");
const { handler: api } = await import("../src/api.mjs");
const { handler: inbound } = await import("../src/inbound.mjs");
const { clean } = await import("../src/forms.mjs");
const post = (form, body) => submit({ pathParameters: { form }, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const staff = (routeKey, { id, body, qs, as = "glenn@example.org", groups } = {}) => api({ routeKey, pathParameters: id ? { id } : undefined, queryStringParameters: qs,
  body: body && JSON.stringify(body), requestContext: { domainName: "api.example", authorizer: { jwt: { claims: { email: as, ...(groups ? { "cognito:groups": groups } : {}) } } } } });
const twilioPost = (path, params, sig) => {
  const url = "https://api.example" + path;
  sig ??= createHmac("sha1", "tok").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  return inbound({ routeKey: "POST " + path, rawPath: path, requestContext: { domainName: "api.example" }, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() });
};
const J = (r) => JSON.parse(r.body);
let pass = 0; const ok = (name, fn) => fn().then(() => { pass++; console.log("✓", name); });

await ok("allowlist drops unknown fields (e.g. diagnosis)", async () => {
  const r = clean("referral", { referrer_name: "A", referrer_phone: "804-555-1212", client_first: "Sam", service: "IIH", consent: "on", diagnosis: "x", dob: "2010-01-01" });
  assert.equal(r.ok, true); assert.equal(r.values.diagnosis, undefined); assert.equal(r.values.dob, undefined); assert.equal(r.values.referrer_phone, "+18045551212");
});
await ok("missing required + bad phone rejected", async () => {
  const r = await post("consult", { name: "", phone: "12", _elapsed: 9000 });
  assert.equal(r.statusCode, 400); assert.ok(J(r).errors.length >= 2);
});
await ok("honeypot and too-fast posts are silently dropped", async () => {
  const before = db.size;
  assert.equal((await post("consult", { name: "Bot", phone: "8045551212", website: "spam" })).statusCode, 200);
  assert.equal((await post("consult", { name: "Bot", phone: "8045551212", _elapsed: 300 })).statusCode, 200);
  assert.equal(db.size, before);
});
let leadId;
await ok("consultation stored, staff alert has no personal details, auto-reply text sent", async () => {
  const r = await post("consult", { name: "Jane Smith", phone: "(804) 555-0123", service: "Outpatient Therapy", sms_ok: "on", _elapsed: 8000, _page: "/",
    _attr: { ref: "https://www.google.com/", landing: "/services/outpatient-therapy/" } });
  assert.equal(r.statusCode, 200);
  const lead = [...db.values()].find((x) => x.sk === "META" && x.name === "Jane Smith");
  leadId = lead.id; assert.equal(lead.channel, "Google (organic)"); assert.equal(lead.status, "New"); assert.equal(lead.pipeline, "client");
  const alert = emails.at(-1).Content.Simple.Body.Text.Data;
  assert.ok(!alert.includes("Jane") && !alert.includes("0123") && alert.includes("#lead/" + leadId));
  assert.equal(texts.at(-1).To, "+18045550123");
});
await ok("referral keeps self-reported source; careers returns resume upload URL; bad file type refused", async () => {
  await post("referral", { referrer_name: "Ms. Lee", referrer_phone: "8045559999", client_first: "Sam", client_last_initial: "T", service: "Intensive In-Home", source: "School", consent: "on", marketing_ok: "on", _elapsed: 9000 });
  const ref = [...db.values()].find((x) => x.form === "referral");
  assert.equal(ref.leadSource, "School"); assert.equal(ref.name, "Sam T."); assert.equal(ref.marketingConsent, true);
  const c = J(await post("careers", { position: "QMHP-C", first_name: "Al", last_name: "B", phone: "8045551000", email: "AL@EX.com", contact_ok: "on", _elapsed: 9000,
    resume: { name: "resume.pdf", type: "application/pdf", size: 20000 } }));
  assert.ok(c.uploadUrl.includes("resumes%2F") || c.uploadUrl.includes("resumes/"));
  const bad = await post("careers", { position: "x", first_name: "A", last_name: "B", phone: "8045551000", email: "a@b.co", contact_ok: "on", _elapsed: 9000, resume: { name: "x.exe", type: "application/x-msdownload", size: 10 } });
  assert.equal(bad.statusCode, 400);
});
await ok("staff list, view (audited), status change, note", async () => {
  const list = J(await staff("GET /leads", { qs: { pipeline: "client" } }));
  assert.ok(list.leads.length >= 2 && !("fields" in list.leads[0]));
  const v = J(await staff("GET /leads/{id}", { id: leadId })); assert.equal(v.lead.name, "Jane Smith");
  const u = J(await staff("PATCH /leads/{id}", { id: leadId, body: { status: "Contacted", owner: "Tanya" } })); assert.equal(u.lead.status, "Contacted");
  assert.equal((await staff("PATCH /leads/{id}", { id: leadId, body: { status: "Bogus" } })).statusCode, 400);
  await staff("POST /leads/{id}/notes", { id: leadId, body: { text: "Left voicemail" } });
  const acts = J(await staff("GET /leads/{id}", { id: leadId })).activity.map((a) => a.kind);
  assert.ok(acts.includes("status") && acts.includes("note") && acts.includes("created"));
  assert.ok([...db.values()].some((x) => x.pk.startsWith("AUDIT#") && x.action === "view" && x.user === "glenn@example.org"));
});
await ok("SMS with template, review request, opt-out via STOP blocks texts", async () => {
  const s = J(await staff("POST /leads/{id}/sms", { id: leadId, body: { text: "Hi {first_name}, call {phone}" } }));
  assert.equal(s.activity.text, "Hi Jane, call (804) 745-5101");
  const rv = J(await staff("POST /leads/{id}/review", { id: leadId, body: { channel: "sms" } })); assert.ok(rv.activity.text.includes("https://g.page/r/nc"));
  const params = { From: "+18045550123", Body: "STOP", MessageSid: "SMx" };
  const url = "https://api.example/twilio/inbound";
  const sig = createHmac("sha1", "tok").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  const forged = await inbound({ routeKey: "POST /twilio/inbound", rawPath: "/twilio/inbound", requestContext: { domainName: "api.example" }, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "bad" }, body: new URLSearchParams(params).toString() });
  assert.equal(forged.statusCode, 403);
  await inbound({ routeKey: "POST /twilio/inbound", rawPath: "/twilio/inbound", requestContext: { domainName: "api.example" }, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() });
  const blocked = await staff("POST /leads/{id}/sms", { id: leadId, body: { text: "hello" } });
  assert.equal(blocked.statusCode, 400); assert.match(J(blocked).error, /opted out/);
});
await ok("campaign only reaches marketing opt-ins; unsubscribe link works and is tamper-proof", async () => {
  const dry = J(await staff("POST /campaigns", { body: { channel: "sms", pipeline: "client", dryRun: true } }));
  assert.equal(dry.recipients, 1); // only the referral partner opted in
  const before = emails.length;
  await staff("PATCH /leads/{id}", { id: [...db.values()].find((x) => x.form === "referral").id, body: { email: "lee@school.org" } });
  const c = J(await staff("POST /campaigns", { body: { channel: "email", pipeline: "client", subject: "News", text: "Hi {first_name}" } }));
  assert.equal(c.sent, 1); const body = emails.at(-1).Content.Simple.Body.Text.Data; assert.equal(emails.length, before + 1);
  const link = new URL(body.match(/https:\/\/api\.example\/unsubscribe\S+/)[0]);
  const bad = await inbound({ routeKey: "GET /unsubscribe", queryStringParameters: { id: link.searchParams.get("id"), t: "x".repeat(32) } });
  assert.match(bad.body, /isn't valid/);
  const good = await inbound({ routeKey: "GET /unsubscribe", queryStringParameters: Object.fromEntries(link.searchParams) });
  assert.match(good.body, /unsubscribed/);
  assert.equal(J(await staff("POST /campaigns", { body: { channel: "email", pipeline: "client", dryRun: true } })).recipients, 0);
});
await ok("reports and CSV export (formula injection escaped)", async () => {
  await staff("POST /leads", { body: { name: "=HYPERLINK(1)", phone: "8045552222", pipeline: "client" } });
  const r = J(await staff("GET /reports", { qs: { days: 30 } }));
  assert.ok(r.total >= 4 && r.bySource.School.leads === 1 && r.byChannel["Google (organic)"] === 1);
  const csv = J(await staff("GET /export", { qs: { pipeline: "client" } })).csv;
  assert.ok(csv.includes(`"'=HYPERLINK(1)"`));
});
const { handler: sched, speedToLead, digest } = await import("../src/scheduler.mjs");
const leadBy = (f) => [...db.values()].find((x) => x.sk === "META" && f(x));

await ok("roles: HR sees applicants only; no-role user is blocked; admin-only routes enforced", async () => {
  assert.equal((await staff("GET /leads", { qs: { pipeline: "client" }, as: "hr@x.org", groups: "[hr]" })).statusCode, 403);
  assert.equal((await staff("GET /leads", { qs: { pipeline: "applicant" }, as: "hr@x.org", groups: "[hr]" })).statusCode, 200);
  assert.equal((await staff("GET /leads", { qs: { pipeline: "client" }, as: "nobody@x.org" })).statusCode, 403);
  assert.equal((await staff("GET /export", { qs: { pipeline: "client" }, as: "in@x.org", groups: "[intake]" })).statusCode, 403);
  const cfg = J(await staff("GET /config", { as: "in@x.org", groups: "[intake]" }));
  assert.deepEqual(Object.keys(cfg.pipelines).sort(), ["client", "provider"]);
  const jane = leadBy((x) => x.name === "Jane Smith");
  assert.equal((await staff("GET /leads/{id}", { id: leadBy((x) => x.form === "careers").id, as: "in@x.org", groups: "[intake]" })).statusCode, 403);
  assert.equal((await staff("GET /leads/{id}", { id: jane.id, as: "in@x.org", groups: ["intake"] })).statusCode, 200);
});
await ok("quiz form saves the recommended service", async () => {
  assert.equal((await post("quiz", { name: "Q Person", phone: "8045553333", for_whom: "My child", need: "Help at home", recommendation: "Intensive In-Home", contact_ok: "on", _elapsed: 9000 })).statusCode, 200);
  assert.equal(leadBy((x) => x.form === "quiz").service, "Intensive In-Home");
});
await ok("unknown texter becomes a lead in the inbox; missed call texts back once", async () => {
  await twilioPost("/twilio/inbound", { From: "+18045557777", Body: "Do you take Medicaid?", MessageSid: "SM1" });
  const t = leadBy((x) => x.phone === "+18045557777");
  assert.ok(t && t.unread && t.smsConsent && t.lastSmsDir === "in");
  const inbox = J(await staff("GET /inbox")).threads; assert.equal(inbox[0].id, t.id);
  assert.match(emails.at(-1).Content.Simple.Body.Text.Data, /#inbox/);
  const before = texts.length;
  const r = await twilioPost("/twilio/voice-done", { From: "+18045558888", DialCallStatus: "no-answer", CallSid: "CA1" });
  assert.match(r.body, /<Say/); assert.equal(texts.length, before + 1); assert.match(texts.at(-1).Body, /missed your call/);
  const c = leadBy((x) => x.phone === "+18045558888"); assert.equal(c.form, "call"); assert.equal(c.smsConsent, false);
  assert.match((await twilioPost("/twilio/voice-done", { From: "+18045558888", DialCallStatus: "completed" })).body, /Hangup/);
  assert.equal((await twilioPost("/twilio/voice", { From: "+18045558888" }, "forged")).statusCode, 403);
});
await ok("today view, speed-to-lead alert (business hours only), digest has counts only", async () => {
  const q = leadBy((x) => x.form === "quiz"); q.createdAt = new Date(Date.now() - 2 * 36e5).toISOString(); q.gsi1sk = q.createdAt + "#" + q.id;
  const today = J(await staff("GET /today"));
  assert.ok(today.waiting.some((l) => l.id === q.id)); assert.ok(today.unread.length >= 1);
  const tue10 = new Date("2026-11-24T15:00:00Z"), sat = new Date("2026-11-28T15:00:00Z");
  assert.equal(await speedToLead(sat), 0);
  const n = await speedToLead(tue10 > new Date() ? tue10 : new Date(Date.now()));
  const alertMail = emails.at(-1).Content.Simple.Body.Text.Data;
  if (n) { assert.ok(!alertMail.includes("Q Person")); assert.ok(leadBy((x) => x.id === q.id).slowAlertAt); }
  const d = await digest(); assert.ok(d.waiting >= 1); assert.ok(!emails.at(-1).Content.Simple.Body.Text.Data.includes("Jane"));
});
await ok("sequences: starters, enroll, due step sends, reply stops it", async () => {
  const st = J(await staff("POST /sequences", { body: { starters: true } })).sequences; assert.equal(st.length, 2);
  const prov = st.find((x) => x.pipeline === "provider");
  assert.equal((await staff("POST /leads/{id}/sequence", { id: leadBy((x) => x.form === "careers").id, body: { seqId: prov.id } })).statusCode, 400); // inactive / wrong pipeline
  await staff("PUT /sequences/{id}", { id: prov.id, body: { ...prov, active: true } });
  const pl = J(await staff("POST /leads", { body: { name: "Pat Provider", phone: "8045554444", email: "pat@ex.org", pipeline: "provider", smsConsent: true } })).lead;
  const en = J(await staff("POST /leads/{id}/sequence", { id: pl.id, body: { seqId: prov.id } })).enrollment;
  assert.equal(en.status, "active");
  await sched({ job: "tick" });
  assert.match(emails.find((m) => m.Content.Simple.Subject.Data.includes("Sponsored Residential")).Content.Simple.Body.Text.Data, /Pat/);
  const e2 = J(await staff("GET /leads/{id}", { id: pl.id })).enrollments[0]; assert.equal(e2.step, 1); assert.equal(e2.status, "active");
  // they reply → next run stops the sequence
  await twilioPost("/twilio/inbound", { From: "+18045554444", Body: "Yes call me", MessageSid: "SM9" });
  const enr = db.get(`LEAD#${pl.id}|ENR#${prov.id}`); enr.nextAt = new Date(Date.now() - 1000).toISOString(); enr.gsi1sk = enr.nextAt + "#" + pl.id;
  await sched({ job: "tick" });
  const e3 = J(await staff("GET /leads/{id}", { id: pl.id })).enrollments[0]; assert.equal(e3.status, "stopped"); assert.equal(e3.stopReason, "they replied");
});
await ok("referral partners aggregate referrals and can be edited", async () => {
  await post("referral", { referrer_name: "Officer Diaz", referrer_phone: "8045556000", referrer_role: "Probation officer", organization: "Chesterfield Juvenile Probation", client_first: "Al", service: "Intensive In-Home", consent: "on", _elapsed: 9000 });
  await post("referral", { referrer_name: "Officer Diaz", referrer_phone: "8045556000", referrer_role: "Probation officer", organization: "Chesterfield  Juvenile Probation.", client_first: "Bo", service: "Intensive In-Home", consent: "on", _elapsed: 9000 });
  await post("referral", { referrer_name: "Mom", referrer_phone: "8045556111", referrer_role: "Parent or guardian", client_first: "Cy", service: "Outpatient Therapy", consent: "on", _elapsed: 9000 });
  const ps = J(await staff("GET /partners")).partners;
  const pr = ps.find((p) => p.name.startsWith("Chesterfield Juvenile")); assert.equal(pr.referrals, 2); assert.equal(pr.contacts.length, 1);
  assert.ok(!ps.some((p) => p.name === "Mom"));
  await staff("PUT /partners/{id}", { id: pr.key, body: { name: pr.name, type: "Probation", notes: "Monthly lunch" } });
  const d = J(await staff("GET /partners/{id}", { id: pr.key })); assert.equal(d.partner.type, "Probation"); assert.equal(d.leads.length, 2);
});
await ok("import skips duplicates and rows without contact info; team admin calls Cognito", async () => {
  const r = J(await staff("POST /import", { body: { pipeline: "client", label: "HubSpot import", rows: [
    { name: "Old Contact", phone: "8045559911", email: "old@ex.org", leadSource: "Organic Search", createdAt: "2025-03-01" },
    { name: "Dup Jane", phone: "(804) 555-0123" }, { name: "No Info" }] } }));
  assert.deepEqual(r, { created: 1, skipped: 2 });
  assert.equal(leadBy((x) => x.name === "Old Contact").createdAt.slice(0, 10), "2025-03-01");
  assert.equal(J(await staff("GET /team")).users[0].groups[0], "admin");
  await staff("POST /team", { body: { email: "new@ex.org", role: "intake" } });
  assert.ok(cognitoCalls.includes("AdminCreateUserCommand") && cognitoCalls.includes("AdminAddUserToGroupCommand"));
  assert.ok(J(await staff("GET /audit")).entries.some((x) => x.action === "user_invite"));
});
console.log(`\n${pass} test groups passed`);
