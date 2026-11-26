import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const ses = new SESv2Client({});
const sm = new SecretsManagerClient({});
export const TABLE = process.env.TABLE_NAME;

export const now = () => new Date().toISOString();
export const newId = () => randomUUID().replace(/-/g, "").slice(0, 12);

export function json(status, body) {
  return { statusCode: status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const ct = (event.headers?.["content-type"] || "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = k in out ? [].concat(out[k], v) : v;
    return out;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------- data ----------
export async function getLead(id) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `LEAD#${id}`, sk: "META" } }));
  return r.Item ? stripKeys(r.Item) : null;
}

export function stripKeys(item) {
  const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, ...rest } = item;
  return rest;
}

export async function putLead(lead) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: `LEAD#${lead.id}`, sk: "META", gsi1pk: `PIPE#${lead.pipeline}`, gsi1sk: `${lead.createdAt}#${lead.id}`,
      ...(lead.phone ? { gsi2pk: `PHONE#${lead.phone}`, gsi2sk: lead.createdAt } : {}), ...lead },
    ConditionExpression: "attribute_not_exists(pk)",
  }));
}

export async function updateLead(id, fields) {
  const names = {}, values = { ":u": now() }, sets = ["updatedAt = :u"];
  Object.entries(fields).forEach(([k, v], i) => { names[`#f${i}`] = k; values[`:v${i}`] = v; sets.push(`#f${i} = :v${i}`); });
  const r = await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: `LEAD#${id}`, sk: "META" }, UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values, ConditionExpression: "attribute_exists(pk)", ReturnValues: "ALL_NEW",
  }));
  return stripKeys(r.Attributes);
}

export async function addActivity(leadId, kind, by, text, extra = {}) {
  const at = now();
  const item = { pk: `LEAD#${leadId}`, sk: `ACT#${at}#${newId().slice(0, 4)}`, kind, by, text, at, ...extra };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return { kind, by, text, at, ...extra };
}

export async function listActivity(leadId) {
  const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p AND begins_with(sk, :a)",
    ExpressionAttributeValues: { ":p": `LEAD#${leadId}`, ":a": "ACT#" }, ScanIndexForward: false, Limit: 200 }));
  return r.Items.map(({ pk, sk, ...a }) => a);
}

export async function listPipeline(pipeline, limit = 1000) {
  const items = []; let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: "gsi1", KeyConditionExpression: "gsi1pk = :p",
      ExpressionAttributeValues: { ":p": `PIPE#${pipeline}` }, ScanIndexForward: false, ExclusiveStartKey }));
    items.push(...r.Items.map(stripKeys)); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < limit);
  return items.slice(0, limit);
}

export async function leadsByPhone(phone) {
  const r = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: "gsi2", KeyConditionExpression: "gsi2pk = :p",
    ExpressionAttributeValues: { ":p": `PHONE#${phone}` }, ScanIndexForward: false, Limit: 5 }));
  return r.Items.map(stripKeys);
}

// HIPAA access log: who did what to which record, kept apart from the lead itself.
export async function audit(user, action, leadId, detail) {
  const at = now();
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: `AUDIT#${at.slice(0, 10)}`, sk: `${at}#${newId().slice(0, 6)}`, user, action, leadId, detail, at } }));
}

export async function isOptedOut(phone) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `OPTOUT#${phone}`, sk: "SMS" } }));
  return !!r.Item;
}

export async function setOptOut(phone, out) {
  const Key = { pk: `OPTOUT#${phone}`, sk: "SMS" };
  if (out) await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...Key, at: now() } }));
  else await ddb.send(new DeleteCommand({ TableName: TABLE, Key }));
}

// ---------- email (Amazon SES) ----------
export async function sendEmail({ to, subject, text, html }) {
  const from = process.env.FROM_EMAIL;
  if (!from) throw Object.assign(new Error("Email isn't set up yet (no sender address)."), { status: 400 });
  const r = await ses.send(new SendEmailCommand({
    FromEmailAddress: from, Destination: { ToAddresses: [].concat(to) },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text }, ...(html ? { Html: { Data: html } } : {}) } } },
  }));
  return r.MessageId;
}

// ---------- SMS (Twilio REST, no SDK needed) ----------
let twilioCache;
export async function twilio() {
  if (twilioCache) return twilioCache;
  if (!process.env.TWILIO_SECRET_ARN) return null;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: process.env.TWILIO_SECRET_ARN }));
  const s = JSON.parse(r.SecretString || "{}");
  twilioCache = s.accountSid && s.authToken && (s.from || s.messagingServiceSid) ? s : null;
  return twilioCache;
}

export async function sendSms(to, body) {
  const tw = await twilio();
  if (!tw) throw Object.assign(new Error("Texting isn't set up yet. Add the Twilio keys to the CRM secret."), { status: 400 });
  if (await isOptedOut(to)) throw Object.assign(new Error("This number replied STOP and has opted out of texts."), { status: 400 });
  const params = new URLSearchParams({ To: to, Body: body });
  if (tw.messagingServiceSid) params.set("MessagingServiceSid", tw.messagingServiceSid); else params.set("From", tw.from);
  if (process.env.TWILIO_STATUS_URL) params.set("StatusCallback", process.env.TWILIO_STATUS_URL);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tw.accountSid}/Messages.json`, {
    method: "POST", body: params,
    headers: { authorization: "Basic " + Buffer.from(`${tw.accountSid}:${tw.authToken}`).toString("base64") },
  });
  const out = await res.json();
  if (!res.ok) throw Object.assign(new Error(`Twilio: ${out.message || res.status}`), { status: 502 });
  return out.sid;
}

// Twilio request signature: HMAC-SHA1 over the full URL plus sorted POST params.
export function twilioSignatureOk(authToken, url, params, signature) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Fill {first_name}, {name}, {review_link} etc. in staff templates.
export function fillTemplate(text, lead) {
  const first = (lead.contactName || lead.name || "").split(" ")[0];
  const reviewLink = lead.location === "petersburg" ? process.env.REVIEW_URL_PETERSBURG : process.env.REVIEW_URL_NORTH_CHESTERFIELD;
  return String(text).replace(/\{first_name\}/g, first).replace(/\{name\}/g, lead.contactName || lead.name || "")
    .replace(/\{review_link\}/g, reviewLink || "").replace(/\{phone\}/g, "(804) 745-5101");
}

// ---------- email unsubscribe links (signed so they can't be forged) ----------
let unsubKey;
async function unsubSecret() {
  if (unsubKey) return unsubKey;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: process.env.UNSUB_SECRET_ARN }));
  return (unsubKey = r.SecretString);
}
export async function unsubToken(id) {
  return createHmac("sha256", await unsubSecret()).update(`unsub:${id}`).digest("base64url").slice(0, 32);
}
export async function unsubscribeLink(id, domain) {
  return `https://${domain || process.env.API_DOMAIN}/unsubscribe?id=${id}&t=${await unsubToken(id)}`;
}

// Referral partner key: organization name normalized so "Chesterfield Co. Schools" variants group together.
export function partnerKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/\b(the|inc|llc|co|corp|of)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}
