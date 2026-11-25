// Staff API. Every route sits behind the Cognito JWT authorizer (see template.yaml).
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PIPELINES, toE164 } from "./forms.mjs";
import {
  json, parseBody, getLead, putLead, updateLead, addActivity, listActivity, listPipeline, audit, newId, now,
  sendEmail, sendSms, twilio, isOptedOut, fillTemplate, unsubscribeLink,
} from "./lib.mjs";

const s3 = new S3Client({});
const ORG_FOOTER = "Family Transitions, Inc. · 620 Moorefield Park Dr, Suite 218, North Chesterfield, VA 23236 · (804) 745-5101";

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

const user = (e) => e.requestContext?.authorizer?.jwt?.claims?.email || e.requestContext?.authorizer?.jwt?.claims?.["cognito:username"] || "staff";

async function mustLead(id) {
  const lead = await getLead(id);
  if (!lead) throw Object.assign(new Error("Lead not found."), { status: 404 });
  return lead;
}

const routes = {
  "GET /config": async () => ({
    pipelines: PIPELINES, templates: TEMPLATES,
    smsReady: !!(await twilio().catch(() => null)), emailReady: !!process.env.FROM_EMAIL,
    reviewLinks: { "north-chesterfield": !!process.env.REVIEW_URL_NORTH_CHESTERFIELD, petersburg: !!process.env.REVIEW_URL_PETERSBURG },
  }),

  "GET /leads": async (e) => {
    const p = e.queryStringParameters?.pipeline || "client";
    if (!PIPELINES[p]) throw Object.assign(new Error("Unknown pipeline."), { status: 400 });
    const leads = await listPipeline(p);
    await audit(user(e), "list", null, p);
    // List view gets summary fields only; full details load per lead (and are logged).
    return { leads: leads.map(({ fields, attribution, ...l }) => l) };
  },

  "POST /leads": async (e) => {
    const b = parseBody(e) || {};
    const pipeline = PIPELINES[b.pipeline] ? b.pipeline : "client";
    if (!b.name) throw Object.assign(new Error("Name is required."), { status: 400 });
    const id = newId(), at = now();
    const lead = { id, form: "manual", formLabel: "Added by staff", pipeline, status: PIPELINES[pipeline][0], createdAt: at, updatedAt: at,
      name: String(b.name).slice(0, 120), phone: toE164(b.phone) || undefined, email: b.email ? String(b.email).slice(0, 254).toLowerCase() : undefined,
      service: b.service, leadSource: b.leadSource || "Phone call", channel: "Phone / walk-in",
      smsConsent: !!b.smsConsent, marketingConsent: !!b.marketingConsent, contactConsent: true, owner: user(e) };
    await putLead(lead);
    await addActivity(id, "created", user(e), "Added by staff");
    await audit(user(e), "create", id);
    return { lead };
  },

  "GET /leads/{id}": async (e, id) => {
    const lead = await mustLead(id);
    const activity = await listActivity(id);
    await audit(user(e), "view", id);
    return { lead, activity, smsOptedOut: lead.phone ? await isOptedOut(lead.phone) : false };
  },

  "PATCH /leads/{id}": async (e, id) => {
    const b = parseBody(e) || {};
    const before = await mustLead(id);
    const patch = {};
    for (const k of EDITABLE) if (k in b) patch[k] = b[k];
    if ("phone" in patch) patch.phone = toE164(patch.phone) || null;
    if (patch.status && !PIPELINES[before.pipeline].includes(patch.status)) throw Object.assign(new Error("Unknown status."), { status: 400 });
    if (!Object.keys(patch).length) return { lead: before };
    const lead = await updateLead(id, patch);
    if (patch.status && patch.status !== before.status) await addActivity(id, "status", user(e), `${before.status} → ${patch.status}`);
    if (patch.owner !== undefined && patch.owner !== before.owner) await addActivity(id, "owner", user(e), `Assigned to ${patch.owner || "nobody"}`);
    await audit(user(e), "update", id, Object.keys(patch).join(","));
    return { lead };
  },

  "POST /leads/{id}/notes": async (e, id) => {
    const text = String(parseBody(e)?.text || "").trim().slice(0, 4000);
    if (!text) throw Object.assign(new Error("Note is empty."), { status: 400 });
    await mustLead(id);
    const act = await addActivity(id, "note", user(e), text);
    await audit(user(e), "note", id);
    return { activity: act };
  },

  "POST /leads/{id}/sms": async (e, id) => {
    const lead = await mustLead(id);
    if (!lead.phone) throw Object.assign(new Error("This lead has no phone number."), { status: 400 });
    if (!lead.smsConsent) throw Object.assign(new Error("This person hasn't agreed to texts. Call instead, or record their consent first."), { status: 400 });
    const text = fillTemplate(String(parseBody(e)?.text || "").slice(0, 640), lead).trim();
    if (!text) throw Object.assign(new Error("Message is empty."), { status: 400 });
    const sid = await sendSms(lead.phone, text);
    const act = await addActivity(id, "sms_out", user(e), text, { sid });
    await audit(user(e), "sms", id);
    return { activity: act };
  },

  "POST /leads/{id}/email": async (e, id) => {
    const lead = await mustLead(id);
    if (!lead.email) throw Object.assign(new Error("This lead has no email address."), { status: 400 });
    const b = parseBody(e) || {};
    const subject = fillTemplate(String(b.subject || "").slice(0, 150), lead).trim();
    const text = fillTemplate(String(b.text || "").slice(0, 10000), lead).trim();
    if (!subject || !text) throw Object.assign(new Error("Subject and message are required."), { status: 400 });
    const mid = await sendEmail({ to: lead.email, subject, text: `${text}\n\n--\n${ORG_FOOTER}` });
    const act = await addActivity(id, "email_out", user(e), `${subject}\n\n${text}`, { mid });
    await audit(user(e), "email", id);
    return { activity: act };
  },

  "POST /leads/{id}/review": async (e, id) => {
    const lead = await mustLead(id);
    const channel = parseBody(e)?.channel === "email" ? "email" : "sms";
    const link = lead.location === "petersburg" ? process.env.REVIEW_URL_PETERSBURG : process.env.REVIEW_URL_NORTH_CHESTERFIELD;
    if (!link) throw Object.assign(new Error("Add the Google review link for this office in the CRM settings first."), { status: 400 });
    let act;
    if (channel === "sms") {
      if (!lead.phone || !lead.smsConsent) throw Object.assign(new Error("No phone number or no text consent for this lead."), { status: 400 });
      const text = fillTemplate(TEMPLATES.review.sms, lead);
      act = await addActivity(id, "review", user(e), text, { sid: await sendSms(lead.phone, text) });
    } else {
      if (!lead.email) throw Object.assign(new Error("This lead has no email address."), { status: 400 });
      const text = fillTemplate(TEMPLATES.review.email, lead);
      act = await addActivity(id, "review", user(e), text, { mid: await sendEmail({ to: lead.email, subject: TEMPLATES.review.subject, text: `${text}\n\n--\n${ORG_FOOTER}` }) });
    }
    await updateLead(id, { reviewRequestedAt: now() });
    await audit(user(e), "review_request", id, channel);
    return { activity: act };
  },

  "GET /leads/{id}/resume": async (e, id) => {
    const lead = await mustLead(id);
    if (!lead.resumeKey) throw Object.assign(new Error("No resume on file."), { status: 404 });
    await audit(user(e), "resume_download", id);
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.FILES_BUCKET, Key: lead.resumeKey,
      ResponseContentDisposition: `attachment; filename="${lead.resumeKey.split("/").pop()}"` }), { expiresIn: 120 });
    return { url };
  },

  "GET /reports": async (e) => {
    const days = Math.min(Number(e.queryStringParameters?.days) || 90, 730);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const all = (await Promise.all(Object.keys(PIPELINES).map((p) => listPipeline(p)))).flat().filter((l) => l.createdAt >= since);
    const count = (key) => all.reduce((m, l) => ((m[l[key] || "Unknown"] = (m[l[key] || "Unknown"] || 0) + 1), m), {});
    const won = { client: "Enrolled", provider: "Approved", applicant: "Hired" };
    const bySource = {};
    for (const l of all) {
      const s = (bySource[l.leadSource || "Unknown"] ||= { leads: 0, won: 0 });
      s.leads++; if (l.status === won[l.pipeline]) s.won++;
    }
    const byWeek = {};
    for (const l of all) {
      const d = new Date(l.createdAt); d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const k = d.toISOString().slice(0, 10); byWeek[k] = (byWeek[k] || 0) + 1;
    }
    const statusByPipeline = Object.fromEntries(Object.keys(PIPELINES).map((p) => [p,
      Object.fromEntries(PIPELINES[p].map((s) => [s, all.filter((l) => l.pipeline === p && l.status === s).length]))]));
    await audit(user(e), "reports", null, String(days));
    return { days, total: all.length, byPipeline: count("pipeline"), byForm: count("formLabel"), byChannel: count("channel"),
      bySource, byWeek, statusByPipeline };
  },

  "POST /campaigns": async (e) => {
    const b = parseBody(e) || {};
    const channel = b.channel === "sms" ? "sms" : "email";
    const pipeline = PIPELINES[b.pipeline] ? b.pipeline : null;
    if (!pipeline) throw Object.assign(new Error("Pick an audience."), { status: 400 });
    const statuses = Array.isArray(b.statuses) && b.statuses.length ? b.statuses : PIPELINES[pipeline];
    let list = (await listPipeline(pipeline)).filter((l) => l.marketingConsent && statuses.includes(l.status));
    list = channel === "sms" ? list.filter((l) => l.phone) : list.filter((l) => l.email);
    if (channel === "sms") {
      const flags = await Promise.all(list.map((l) => isOptedOut(l.phone)));
      list = list.filter((_, i) => !flags[i]);
    }
    if (b.dryRun) return { recipients: list.length };
    if (list.length > 500) throw Object.assign(new Error("More than 500 recipients. Narrow the audience."), { status: 400 });
    const subject = String(b.subject || "").slice(0, 150), text = String(b.text || "").slice(0, channel === "sms" ? 480 : 10000);
    if (!text || (channel === "email" && !subject)) throw Object.assign(new Error("Write a message first."), { status: 400 });
    const campaignId = newId();
    let sent = 0; const failed = [];
    for (const l of list) {
      try {
        if (channel === "sms") {
          const body = fillTemplate(text, l) + " Reply STOP to opt out.";
          await addActivity(l.id, "campaign", user(e), body, { campaignId, sid: await sendSms(l.phone, body) });
        } else {
          const body = `${fillTemplate(text, l)}\n\n--\n${ORG_FOOTER}\nTo stop these emails: ${await unsubscribeLink(l.id, e.requestContext?.domainName)}`;
          await addActivity(l.id, "campaign", user(e), `${subject}\n\n${body}`, { campaignId, mid: await sendEmail({ to: l.email, subject: fillTemplate(subject, l), text: body }) });
        }
        sent++;
      } catch (err) { failed.push({ id: l.id, error: err.message }); }
    }
    await audit(user(e), "campaign", null, `${channel}:${pipeline}:${sent}`);
    return { campaignId, sent, failed };
  },

  "GET /export": async (e) => {
    const p = e.queryStringParameters?.pipeline || "client";
    if (!PIPELINES[p]) throw Object.assign(new Error("Unknown pipeline."), { status: 400 });
    const cols = ["id", "createdAt", "formLabel", "status", "name", "phone", "email", "service", "leadSource", "channel", "owner", "location", "smsConsent", "marketingConsent"];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const rows = (await listPipeline(p)).map((l) => cols.map((c) => esc(l[c])).join(","));
    await audit(user(e), "export", null, p);
    return { csv: [cols.join(","), ...rows].join("\n") };
  },
};

export async function handler(event) {
  const key = event.routeKey;
  const fn = routes[key];
  if (!fn) return json(404, { error: "Not found." });
  try {
    return json(200, await fn(event, event.pathParameters?.id));
  } catch (err) {
    if (!err.status) console.error(key, err);
    return json(err.status || 500, { error: err.status ? err.message : `Something went wrong: ${err.message}` });
  }
}
