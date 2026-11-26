// Staff API. Every route sits behind the Cognito JWT authorizer (see template.yaml); roles come from auth.mjs.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient, ListUsersCommand, AdminListGroupsForUserCommand, AdminCreateUserCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminDisableUserCommand, AdminEnableUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { PIPELINES, toE164 } from "./forms.mjs";
import {
  ddb, TABLE, json, parseBody, getLead, putLead, updateLead, addActivity, listActivity, listPipeline, leadsByPhone, audit, newId, now,
  sendEmail, sendSms, twilio, isOptedOut, fillTemplate, unsubscribeLink, partnerKey,
} from "./lib.mjs";
import { who, canPipeline, mustAdmin, ROLES } from "./auth.mjs";
import { listSequences, getSequence, cleanSequence, saveSequence, deleteSequence, listEnrollments, enroll, stopEnrollment, ORG_FOOTER, STARTERS } from "./sequences.mjs";

const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const WON = { client: "Enrolled", provider: "Approved", applicant: "Hired" };
const CLOSED = /^(Not a fit|Enrolled|Approved|Hired)$/;

export const TEMPLATES = {
  sms: [
    { name: "Missed you", text: "Hi {first_name}, this is Family Transitions. We tried to reach you about your request. Call or text us back at {phone} when it's a good time." },
    { name: "Intake reminder", text: "Hi {first_name}, a reminder from Family Transitions about your intake appointment. Questions? Call {phone}." },
    { name: "Tour follow-up", text: "Hi {first_name}, thanks for your interest in DD Day Support at Family Transitions. When would you like to visit? Reply here or call {phone}." },
    { name: "Provider next step", text: "Hi {first_name}, thanks for your interest in becoming a Sponsored Residential provider. When is a good time for a quick call? – Family Transitions" },
    { name: "Interview invite", text: "Hi {first_name}, thanks for applying to Family Transitions. We'd like to set up an interview. What days work for you?" },
  ],
  review: { sms: "Hi {first_name}, thank you for choosing Family Transitions. Would you share a quick review? It helps other families find us: {review_link}",
    subject: "Would you share a quick review?",
    email: "Hi {first_name},\n\nThank you for choosing Family Transitions. If you have a minute, a short Google review helps other families find support:\n\n{review_link}\n\nThank you,\nThe Family Transitions team" },
};

const EDITABLE = ["status", "owner", "location", "nextFollowUp", "tags", "name", "phone", "email", "leadSource", "service",
  "contactName", "organization", "marketingConsent", "smsConsent", "lostReason", "value", "unread"];

async function mustLead(u, id) {
  const lead = await getLead(id);
  if (!lead) throw bad("Lead not found.", 404);
  canPipeline(u, lead.pipeline);
  return lead;
}
const allowedLeads = async (u, limit) => (await Promise.all(u.pipelines.map((p) => listPipeline(p, limit)))).flat();
const summary = ({ fields, attribution, ...l }) => l;
const etToday = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);

const routes = {
  "GET /config": async (e, u) => ({
    me: { email: u.email, groups: u.groups, isAdmin: u.isAdmin, pipelines: u.pipelines }, roles: ROLES,
    pipelines: Object.fromEntries(u.pipelines.map((p) => [p, PIPELINES[p]])), templates: TEMPLATES,
    sequences: (await listSequences()).filter((s) => u.pipelines.includes(s.pipeline)).map(({ id, name, pipeline, active, kind }) => ({ id, name, pipeline, active, kind })),
    smsReady: !!(await twilio().catch(() => null)), emailReady: !!process.env.FROM_EMAIL,
    reviewLinks: { "north-chesterfield": !!process.env.REVIEW_URL_NORTH_CHESTERFIELD, petersburg: !!process.env.REVIEW_URL_PETERSBURG },
  }),

  // ---------- today ----------
  "GET /today": async (e, u) => {
    const all = (await allowedLeads(u, 1000)).map(summary), today = etToday(), mine = e.queryStringParameters?.mine === "1";
    const pick = (f) => all.filter((l) => f(l) && (!mine || !l.owner || l.owner.toLowerCase() === u.email || l.owner.toLowerCase() === u.email.split("@")[0]));
    const waiting = pick((l) => l.status === PIPELINES[l.pipeline][0] && !l.lastContactAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const due = pick((l) => l.nextFollowUp && l.nextFollowUp <= today && !CLOSED.test(l.status)).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    const unread = pick((l) => l.unread);
    const stale = pick((l) => !CLOSED.test(l.status) && l.status !== PIPELINES[l.pipeline][0] && !l.nextFollowUp
      && Date.now() - Date.parse(l.updatedAt || l.createdAt) > 14 * 864e5);
    await audit(u.email, "today");
    return { today, waiting, due, unread, stale };
  },

  // ---------- leads ----------
  "GET /leads": async (e, u) => {
    const p = e.queryStringParameters?.pipeline || u.pipelines[0];
    if (!PIPELINES[p]) throw bad("Unknown pipeline.");
    canPipeline(u, p);
    const leads = await listPipeline(p);
    await audit(u.email, "list", null, p);
    return { leads: leads.map(summary) };
  },

  "POST /leads": async (e, u) => {
    const b = parseBody(e) || {};
    const pipeline = PIPELINES[b.pipeline] ? b.pipeline : u.pipelines[0];
    canPipeline(u, pipeline);
    if (!b.name) throw bad("Name is required.");
    const id = newId(), at = now();
    const lead = { id, form: "manual", formLabel: "Added by staff", pipeline, status: PIPELINES[pipeline][0], createdAt: at, updatedAt: at,
      name: String(b.name).slice(0, 120), phone: toE164(b.phone) || undefined, email: b.email ? String(b.email).slice(0, 254).toLowerCase() : undefined,
      service: b.service, leadSource: b.leadSource || "Phone call", channel: "Phone / walk-in", organization: b.organization || undefined,
      smsConsent: !!b.smsConsent, marketingConsent: !!b.marketingConsent, contactConsent: true, owner: u.email };
    if (lead.organization) lead.partnerKey = partnerKey(lead.organization);
    await putLead(lead);
    await addActivity(id, "created", u.email, "Added by staff");
    await audit(u.email, "create", id);
    return { lead };
  },

  "GET /leads/{id}": async (e, u, id) => {
    const lead = await mustLead(u, id);
    const [activity, enrollments] = await Promise.all([listActivity(id), listEnrollments(id)]);
    await audit(u.email, "view", id);
    return { lead, activity, enrollments, smsOptedOut: lead.phone ? await isOptedOut(lead.phone) : false };
  },

  "PATCH /leads/{id}": async (e, u, id) => {
    const b = parseBody(e) || {};
    const before = await mustLead(u, id);
    const patch = {};
    for (const k of EDITABLE) if (k in b) patch[k] = b[k];
    if ("phone" in patch) patch.phone = toE164(patch.phone) || null;
    if ("organization" in patch) patch.partnerKey = patch.organization ? partnerKey(patch.organization) : null;
    if (patch.status && !PIPELINES[before.pipeline].includes(patch.status)) throw bad("Unknown status.");
    if (patch.status && patch.status !== before.status) patch.lastContactAt = before.lastContactAt || now();
    if (!Object.keys(patch).length) return { lead: before };
    const lead = await updateLead(id, patch);
    if (patch.status && patch.status !== before.status) await addActivity(id, "status", u.email, `${before.status} → ${patch.status}`);
    if (patch.owner !== undefined && patch.owner !== before.owner) await addActivity(id, "owner", u.email, `Assigned to ${patch.owner || "nobody"}`);
    if (!(Object.keys(patch).length === 1 && "unread" in patch)) await audit(u.email, "update", id, Object.keys(patch).join(","));
    return { lead };
  },

  "POST /leads/{id}/notes": async (e, u, id) => {
    const text = String(parseBody(e)?.text || "").trim().slice(0, 4000);
    if (!text) throw bad("Note is empty.");
    await mustLead(u, id);
    const act = await addActivity(id, "note", u.email, text);
    await updateLead(id, { lastContactAt: now() });
    await audit(u.email, "note", id);
    return { activity: act };
  },

  "POST /leads/{id}/sms": async (e, u, id) => {
    const lead = await mustLead(u, id);
    if (!lead.phone) throw bad("This lead has no phone number.");
    if (!lead.smsConsent) throw bad("This person hasn't agreed to texts. Call instead, or record their consent first.");
    const text = fillTemplate(String(parseBody(e)?.text || "").slice(0, 640), lead).trim();
    if (!text) throw bad("Message is empty.");
    const sid = await sendSms(lead.phone, text);
    const act = await addActivity(id, "sms_out", u.email, text, { sid });
    await updateLead(id, { lastContactAt: now(), lastSmsAt: now(), lastSmsText: text.slice(0, 160), lastSmsDir: "out", unread: false });
    await audit(u.email, "sms", id);
    return { activity: act };
  },

  "POST /leads/{id}/email": async (e, u, id) => {
    const lead = await mustLead(u, id);
    if (!lead.email) throw bad("This lead has no email address.");
    const b = parseBody(e) || {};
    const subject = fillTemplate(String(b.subject || "").slice(0, 150), lead).trim();
    const text = fillTemplate(String(b.text || "").slice(0, 10000), lead).trim();
    if (!subject || !text) throw bad("Subject and message are required.");
    const mid = await sendEmail({ to: lead.email, subject, text: `${text}\n\n--\n${ORG_FOOTER}` });
    const act = await addActivity(id, "email_out", u.email, `${subject}\n\n${text}`, { mid });
    await updateLead(id, { lastContactAt: now() });
    await audit(u.email, "email", id);
    return { activity: act };
  },

  "POST /leads/{id}/review": async (e, u, id) => {
    const lead = await mustLead(u, id);
    const channel = parseBody(e)?.channel === "email" ? "email" : "sms";
    const link = lead.location === "petersburg" ? process.env.REVIEW_URL_PETERSBURG : process.env.REVIEW_URL_NORTH_CHESTERFIELD;
    if (!link) throw bad("Add the Google review link for this office in the CRM settings first.");
    let act;
    if (channel === "sms") {
      if (!lead.phone || !lead.smsConsent) throw bad("No phone number or no text consent for this lead.");
      const text = fillTemplate(TEMPLATES.review.sms, lead);
      act = await addActivity(id, "review", u.email, text, { sid: await sendSms(lead.phone, text) });
    } else {
      if (!lead.email) throw bad("This lead has no email address.");
      const text = fillTemplate(TEMPLATES.review.email, lead);
      act = await addActivity(id, "review", u.email, text, { mid: await sendEmail({ to: lead.email, subject: TEMPLATES.review.subject, text: `${text}\n\n--\n${ORG_FOOTER}` }) });
    }
    await updateLead(id, { reviewRequestedAt: now() });
    await audit(u.email, "review_request", id, channel);
    return { activity: act };
  },

  "GET /leads/{id}/resume": async (e, u, id) => {
    const lead = await mustLead(u, id);
    if (!lead.resumeKey) throw bad("No resume on file.", 404);
    await audit(u.email, "resume_download", id);
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.FILES_BUCKET, Key: lead.resumeKey,
      ResponseContentDisposition: `attachment; filename="${lead.resumeKey.split("/").pop()}"` }), { expiresIn: 120 });
    return { url };
  },

  "POST /leads/{id}/sequence": async (e, u, id) => {
    const lead = await mustLead(u, id);
    const b = parseBody(e) || {};
    if (b.stop) return { enrollment: await stopEnrollment(id, b.seqId, u.email) };
    const seq = await getSequence(b.seqId);
    if (!seq) throw bad("Sequence not found.", 404);
    if (!seq.active) throw bad("Turn this sequence on first (Campaigns → Sequences).");
    if (seq.kind === "marketing" && !lead.marketingConsent) throw bad("This is a marketing sequence and this person hasn't opted in to updates.");
    const enrollment = await enroll(lead, seq, u.email);
    await audit(u.email, "enroll", id, seq.id);
    return { enrollment };
  },

  // ---------- text inbox ----------
  "GET /inbox": async (e, u) => {
    const threads = (await allowedLeads(u, 1000)).filter((l) => l.lastSmsAt).map(summary).sort((a, b) => b.lastSmsAt.localeCompare(a.lastSmsAt));
    await audit(u.email, "inbox");
    return { threads };
  },

  // ---------- referral partners ----------
  "GET /partners": async (e, u) => {
    canPipeline(u, "client");
    const leads = await listPipeline("client", 5000);
    const stored = (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": "PARTNERS" } }))).Items;
    const map = {};
    for (const s of stored) map[s.sk] = { key: s.sk, name: s.name, type: s.type, notes: s.notes, phone: s.phone, email: s.email, owner: s.owner, referrals: 0, enrolled: 0, contacts: {} };
    for (const l of leads) {
      const key = l.partnerKey; if (!key) continue;
      const p = (map[key] ||= { key, name: l.organization || l.contactName, referrals: 0, enrolled: 0, contacts: {} });
      p.referrals++; if (l.status === WON.client) p.enrolled++;
      if (!p.lastReferralAt || l.createdAt > p.lastReferralAt) p.lastReferralAt = l.createdAt;
      if (l.contactName) p.contacts[l.contactName.toLowerCase()] = { name: l.contactName, role: l.contactRole, phone: l.phone, email: l.email };
    }
    await audit(u.email, "partners");
    return { partners: Object.values(map).map((p) => ({ ...p, contacts: Object.values(p.contacts) })).sort((a, b) => b.referrals - a.referrals || String(a.name).localeCompare(String(b.name))) };
  },

  "GET /partners/{id}": async (e, u, key) => {
    canPipeline(u, "client");
    const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: "PARTNERS", sk: key } }))).Item;
    const leads = (await listPipeline("client", 5000)).filter((l) => l.partnerKey === key).map(summary);
    await audit(u.email, "partner_view", null, key);
    return { partner: s ? { key, name: s.name, type: s.type, notes: s.notes, phone: s.phone, email: s.email, owner: s.owner } : { key, name: leads[0]?.organization || leads[0]?.contactName || key }, leads };
  },

  "PUT /partners/{id}": async (e, u, key) => {
    canPipeline(u, "client");
    const b = parseBody(e) || {};
    const name = String(b.name || "").trim().slice(0, 120);
    if (!name) throw bad("Partner name is required.");
    const k = key === "new" ? partnerKey(name) : key;
    const item = { pk: "PARTNERS", sk: k, name, type: String(b.type || "Other").slice(0, 40), notes: String(b.notes || "").slice(0, 4000),
      phone: toE164(b.phone) || undefined, email: b.email ? String(b.email).slice(0, 254).toLowerCase() : undefined, owner: String(b.owner || "").slice(0, 80), updatedAt: now() };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: JSON.parse(JSON.stringify(item)) }));
    await audit(u.email, "partner_update", null, k);
    return { partner: { key: k, ...item } };
  },

  // ---------- reports ----------
  "GET /reports": async (e, u) => {
    const days = Math.min(Number(e.queryStringParameters?.days) || 90, 730);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const all = (await allowedLeads(u, 5000)).filter((l) => l.createdAt >= since);
    const count = (key) => all.reduce((m, l) => ((m[l[key] || "Unknown"] = (m[l[key] || "Unknown"] || 0) + 1), m), {});
    const bySource = {};
    for (const l of all) { const s = (bySource[l.leadSource || "Unknown"] ||= { leads: 0, won: 0 }); s.leads++; if (l.status === WON[l.pipeline]) s.won++; }
    const byWeek = {};
    for (const l of all) { const d = new Date(l.createdAt); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); const k = d.toISOString().slice(0, 10); byWeek[k] = (byWeek[k] || 0) + 1; }
    const mins = all.filter((l) => l.lastContactAt && l.form !== "import").map((l) => (Date.parse(l.lastContactAt) - Date.parse(l.createdAt)) / 6e4).filter((m) => m >= 0).sort((a, b) => a - b);
    const statusByPipeline = Object.fromEntries(u.pipelines.map((p) => [p, Object.fromEntries(PIPELINES[p].map((s) => [s, all.filter((l) => l.pipeline === p && l.status === s).length]))]));
    await audit(u.email, "reports", null, String(days));
    return { days, total: all.length, byPipeline: count("pipeline"), byForm: count("formLabel"), byChannel: count("channel"), bySource, byWeek, statusByPipeline,
      medianMinutesToContact: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null };
  },

  // ---------- campaigns & sequences (admin) ----------
  "POST /campaigns": async (e, u) => {
    mustAdmin(u);
    const b = parseBody(e) || {};
    const channel = b.channel === "sms" ? "sms" : "email";
    const pipeline = PIPELINES[b.pipeline] ? b.pipeline : null;
    if (!pipeline) throw bad("Pick an audience.");
    const statuses = Array.isArray(b.statuses) && b.statuses.length ? b.statuses : PIPELINES[pipeline];
    let list = (await listPipeline(pipeline)).filter((l) => l.marketingConsent && statuses.includes(l.status));
    list = channel === "sms" ? list.filter((l) => l.phone) : list.filter((l) => l.email);
    if (channel === "sms") { const flags = await Promise.all(list.map((l) => isOptedOut(l.phone))); list = list.filter((_, i) => !flags[i]); }
    if (b.dryRun) return { recipients: list.length };
    if (list.length > 500) throw bad("More than 500 recipients. Narrow the audience.");
    const subject = String(b.subject || "").slice(0, 150), text = String(b.text || "").slice(0, channel === "sms" ? 480 : 10000);
    if (!text || (channel === "email" && !subject)) throw bad("Write a message first.");
    const campaignId = newId(); let sent = 0; const failed = [];
    for (const l of list) {
      try {
        if (channel === "sms") {
          const body = fillTemplate(text, l) + " Reply STOP to opt out.";
          await addActivity(l.id, "campaign", u.email, body, { campaignId, sid: await sendSms(l.phone, body) });
        } else {
          const body = `${fillTemplate(text, l)}\n\n--\n${ORG_FOOTER}\nTo stop these emails: ${await unsubscribeLink(l.id, e.requestContext?.domainName)}`;
          await addActivity(l.id, "campaign", u.email, `${subject}\n\n${body}`, { campaignId, mid: await sendEmail({ to: l.email, subject: fillTemplate(subject, l), text: body }) });
        }
        sent++;
      } catch (err) { failed.push({ id: l.id, error: err.message }); }
    }
    await audit(u.email, "campaign", null, `${channel}:${pipeline}:${sent}`);
    return { campaignId, sent, failed };
  },

  "GET /sequences": async (e, u) => { mustAdmin(u); return { sequences: await listSequences() }; },
  "POST /sequences": async (e, u) => {
    mustAdmin(u);
    const b = parseBody(e) || {};
    if (b.starters) { const made = []; for (const s of STARTERS) made.push(await saveSequence(cleanSequence(s))); await audit(u.email, "sequence_starters"); return { sequences: made }; }
    const seq = await saveSequence(cleanSequence(b));
    await audit(u.email, "sequence_create", null, seq.id);
    return { sequence: seq };
  },
  "PUT /sequences/{id}": async (e, u, id) => {
    mustAdmin(u);
    const existing = await getSequence(id);
    if (!existing) throw bad("Sequence not found.", 404);
    const seq = await saveSequence(cleanSequence(parseBody(e) || {}, existing));
    await audit(u.email, "sequence_update", null, id);
    return { sequence: seq };
  },
  "DELETE /sequences/{id}": async (e, u, id) => { mustAdmin(u); await deleteSequence(id); await audit(u.email, "sequence_delete", null, id); return { ok: true }; },

  "GET /export": async (e, u) => {
    mustAdmin(u);
    const p = e.queryStringParameters?.pipeline || "client";
    if (!PIPELINES[p]) throw bad("Unknown pipeline.");
    const cols = ["id", "createdAt", "formLabel", "status", "name", "phone", "email", "service", "leadSource", "channel", "organization", "owner", "location", "smsConsent", "marketingConsent"];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const rows = (await listPipeline(p)).map((l) => cols.map((c) => esc(l[c])).join(","));
    await audit(u.email, "export", null, p);
    return { csv: [cols.join(","), ...rows].join("\n") };
  },

  // ---------- contact import (e.g. HubSpot CSV export) ----------
  "POST /import": async (e, u) => {
    mustAdmin(u);
    const b = parseBody(e) || {};
    const pipeline = PIPELINES[b.pipeline] ? b.pipeline : null;
    if (!pipeline) throw bad("Pick a pipeline.");
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
    let created = 0, skipped = 0;
    for (const r of rows) {
      const name = String(r.name || "").trim().slice(0, 120), phone = toE164(r.phone), email = r.email ? String(r.email).trim().toLowerCase().slice(0, 254) : undefined;
      if (!name || (!phone && !email)) { skipped++; continue; }
      if (phone && (await leadsByPhone(phone)).length) { skipped++; continue; }
      const at = r.createdAt && !isNaN(Date.parse(r.createdAt)) ? new Date(r.createdAt).toISOString() : now();
      const status = PIPELINES[pipeline].includes(r.status) ? r.status : PIPELINES[pipeline][0];
      const id = newId();
      const lead = { id, form: "import", formLabel: String(b.label || "Imported").slice(0, 60), pipeline, status, createdAt: at, updatedAt: now(),
        name, phone: phone || undefined, email, service: r.service ? String(r.service).slice(0, 120) : undefined,
        leadSource: String(r.leadSource || "Imported").slice(0, 80), channel: String(b.label || "Imported").slice(0, 60),
        organization: r.organization ? String(r.organization).slice(0, 120) : undefined,
        contactConsent: true, smsConsent: false, marketingConsent: !!r.marketingConsent, lastContactAt: at };
      if (lead.organization && pipeline === "client") lead.partnerKey = partnerKey(lead.organization);
      Object.keys(lead).forEach((k) => lead[k] === undefined && delete lead[k]);
      await putLead(lead);
      if (r.notes) await addActivity(id, "note", "import", String(r.notes).slice(0, 4000));
      created++;
    }
    await audit(u.email, "import", null, `${pipeline}:${created}`);
    return { created, skipped };
  },

  // ---------- team (admin) ----------
  "GET /team": async (e, u) => {
    mustAdmin(u);
    const users = (await cognito.send(new ListUsersCommand({ UserPoolId: process.env.USER_POOL_ID, Limit: 60 }))).Users || [];
    const out = await Promise.all(users.map(async (x) => {
      const groups = ((await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: x.Username }))).Groups || []).map((g) => g.GroupName);
      return { username: x.Username, email: (x.Attributes || []).find((a) => a.Name === "email")?.Value, status: x.UserStatus, enabled: x.Enabled, created: x.UserCreateDate, groups };
    }));
    return { users: out, admins: String(process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) };
  },
  "POST /team": async (e, u) => {
    mustAdmin(u);
    const b = parseBody(e) || {};
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter a valid email.");
    if (!ROLES[b.role]) throw bad("Pick a role.");
    const r = await cognito.send(new AdminCreateUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: email, DesiredDeliveryMediums: ["EMAIL"],
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }] }));
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: process.env.USER_POOL_ID, Username: r.User.Username, GroupName: b.role }));
    await audit(u.email, "user_invite", null, `${email}:${b.role}`);
    return { ok: true };
  },
  "PATCH /team/{id}": async (e, u, username) => {
    mustAdmin(u);
    const b = parseBody(e) || {};
    const P = { UserPoolId: process.env.USER_POOL_ID, Username: username };
    if (b.role !== undefined) {
      if (b.role && !ROLES[b.role]) throw bad("Unknown role.");
      for (const g of Object.keys(ROLES)) if (g !== b.role) await cognito.send(new AdminRemoveUserFromGroupCommand({ ...P, GroupName: g })).catch(() => {});
      if (b.role) await cognito.send(new AdminAddUserToGroupCommand({ ...P, GroupName: b.role }));
    }
    if (b.enabled === false) await cognito.send(new AdminDisableUserCommand(P));
    if (b.enabled === true) await cognito.send(new AdminEnableUserCommand(P));
    await audit(u.email, "user_update", null, `${username}:${b.role ?? ""}:${b.enabled ?? ""}`);
    return { ok: true };
  },
  "GET /audit": async (e, u) => {
    mustAdmin(u);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(e.queryStringParameters?.date || "") ? e.queryStringParameters.date : now().slice(0, 10);
    const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": `AUDIT#${date}` }, ScanIndexForward: false, Limit: 500 }));
    return { date, entries: r.Items.map(({ pk, sk, ...a }) => a) };
  },
};

export async function handler(event) {
  const key = event.routeKey;
  const fn = routes[key];
  if (!fn) return json(404, { error: "Not found." });
  try {
    const u = who(event);
    if (!u.pipelines.length && key !== "GET /config") throw bad("Your account doesn't have a role yet. Ask an admin to assign one.", 403);
    return json(200, await fn(event, u, event.pathParameters?.id));
  } catch (err) {
    if (!err.status) console.error(key, err);
    return json(err.status || 500, { error: err.status ? err.message : `Something went wrong: ${err.message}` });
  }
}
