// Offline tests: fakes DynamoDB, SES, Secrets Manager, S3 presigning and Twilio, then runs the real handlers.
// Run: node crm/test/run.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../src/package.json", import.meta.url));
const bases = new Set(["@aws-sdk/client-dynamodb:DynamoDBClient", "@aws-sdk/lib-dynamodb:DynamoDBDocumentClient", "@aws-sdk/client-sesv2:SESv2Client",
  "@aws-sdk/client-secrets-manager:SecretsManagerClient"].map((s) => { const [m, c] = s.split(":"); return Object.getPrototypeOf(require(m)[c].prototype); }));

process.env.TABLE_NAME = "t"; process.env.FILES_BUCKET = "b"; process.env.NOTIFY_EMAIL = "staff@example.org";
process.env.FROM_EMAIL = "crm@example.org"; process.env.CRM_URL = "https://x/crm/"; process.env.TWILIO_SECRET_ARN = "tw";
process.env.UNSUB_SECRET_ARN = "un"; process.env.REVIEW_URL_NORTH_CHESTERFIELD = "https://g.page/r/nc"; process.env.AUTO_REPLY_SMS = "on";
process.env.AWS_REGION = "us-east-1"; process.env.AWS_ACCESS_KEY_ID = "x"; process.env.AWS_SECRET_ACCESS_KEY = "x";

const db = new Map(); const emails = []; const texts = [];
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
    const v = i.ExpressionAttributeValues, [hk] = i.IndexName ? [i.IndexName + "pk"] : ["pk"], sk = i.IndexName ? i.IndexName + "sk" : "sk";
    let items = [...db.values()].filter((x) => x[hk] === v[":p"] && (!v[":a"] || String(x[sk]).startsWith(v[":a"])));
    items.sort((a, b) => String(a[sk]).localeCompare(String(b[sk]))); if (i.ScanIndexForward === false) items.reverse();
    return { Items: structuredClone(items.slice(0, i.Limit || 1e9)) };
  }
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
const staff = (routeKey, { id, body, qs } = {}) => api({ routeKey, pathParameters: id ? { id } : undefined, queryStringParameters: qs,
  body: body && JSON.stringify(body), requestContext: { domainName: "api.example", authorizer: { jwt: { claims: { email: "glenn@example.org" } } } } });
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
console.log(`\n${pass} test groups passed`);
