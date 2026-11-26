// Drip sequences: timed series of emails/texts. "follow-up" sequences need the person's contact consent
// (they asked us to reach them); "marketing" sequences need the separate opt-in.
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, now, newId, getLead, addActivity, sendEmail, sendSms, isOptedOut, fillTemplate, unsubscribeLink, updateLead } from "./lib.mjs";
import { PIPELINES } from "./forms.mjs";

export const ORG_FOOTER = "Family Transitions, Inc. · 620 Moorefield Park Dr, Suite 218, North Chesterfield, VA 23236 · (804) 745-5101";
const DAY = 864e5;

export async function listSequences() {
  const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": "SEQS" } }));
  return r.Items.map(({ pk, sk, ...s }) => s);
}
export async function getSequence(id) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: "SEQS", sk: id } }));
  if (!r.Item) return null; const { pk, sk, ...s } = r.Item; return s;
}

export function cleanSequence(b, existing = {}) {
  const pipeline = PIPELINES[b.pipeline] ? b.pipeline : existing.pipeline || "provider";
  const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 12).map((s) => ({
    day: Math.max(0, Math.min(365, Math.round(Number(s.day) || 0))),
    channel: s.channel === "sms" ? "sms" : "email",
    subject: String(s.subject || "").slice(0, 150),
    text: String(s.text || "").slice(0, s.channel === "sms" ? 480 : 8000),
  })).filter((s) => s.text.trim() && (s.channel === "sms" || s.subject.trim())).sort((a, b) => a.day - b.day);
  if (!String(b.name || "").trim()) throw Object.assign(new Error("Give the sequence a name."), { status: 400 });
  if (!steps.length) throw Object.assign(new Error("Add at least one step with a message."), { status: 400 });
  return {
    id: existing.id || newId(), name: String(b.name).trim().slice(0, 80), pipeline, steps,
    kind: b.kind === "marketing" ? "marketing" : "follow-up",
    autoForms: (Array.isArray(b.autoForms) ? b.autoForms : []).filter((f) => typeof f === "string").slice(0, 6),
    active: !!b.active, createdAt: existing.createdAt || now(), updatedAt: now(),
  };
}

export async function saveSequence(seq) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: "SEQS", sk: seq.id, ...seq } }));
  return seq;
}
export async function deleteSequence(id) { await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "SEQS", sk: id } })); }

export async function listEnrollments(leadId) {
  const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p AND begins_with(sk, :e)",
    ExpressionAttributeValues: { ":p": `LEAD#${leadId}`, ":e": "ENR#" } }));
  return r.Items.map(({ pk, sk, gsi1pk, gsi1sk, ...e }) => e);
}

async function putEnrollment(e) {
  const item = { pk: `LEAD#${e.leadId}`, sk: `ENR#${e.seqId}`, ...e };
  if (e.status === "active") { item.gsi1pk = "DUE"; item.gsi1sk = `${e.nextAt}#${e.leadId}`; }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function enroll(lead, seq, by) {
  if (seq.pipeline !== lead.pipeline) throw Object.assign(new Error("That sequence is for a different pipeline."), { status: 400 });
  const existing = (await listEnrollments(lead.id)).find((e) => e.seqId === seq.id && e.status === "active");
  if (existing) return existing;
  const start = now();
  const e = { leadId: lead.id, seqId: seq.id, seqName: seq.name, step: 0, status: "active", startedAt: start,
    startStatus: lead.status, nextAt: new Date(Date.parse(start) + seq.steps[0].day * DAY).toISOString(), by };
  await putEnrollment(e);
  await addActivity(lead.id, "sequence", by, `Started sequence "${seq.name}"`);
  return e;
}

export async function stopEnrollment(leadId, seqId, by, reason = "Stopped by staff") {
  const e = (await listEnrollments(leadId)).find((x) => x.seqId === seqId);
  if (!e || e.status !== "active") return e;
  Object.assign(e, { status: "stopped", stoppedAt: now(), stopReason: reason });
  await putEnrollment(e);
  await addActivity(leadId, "sequence", by, `Sequence "${e.seqName}" stopped: ${reason}`);
  return e;
}

export async function autoEnroll(lead) {
  const seqs = (await listSequences()).filter((s) => s.active && s.pipeline === lead.pipeline && s.autoForms.includes(lead.form));
  for (const s of seqs) await enroll(lead, s, "automation").catch((e) => console.error("auto-enroll", e.message));
}

// Called by the scheduler: send every step that is due, then schedule the next one.
export async function runDue(domain) {
  const r = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: "gsi1", KeyConditionExpression: "gsi1pk = :d AND gsi1sk <= :n",
    ExpressionAttributeValues: { ":d": "DUE", ":n": now() + "~" }, Limit: 200 }));
  const seqCache = {}; let sent = 0;
  for (const raw of r.Items) {
    const { pk, sk, gsi1pk, gsi1sk, ...e } = raw;
    const seq = seqCache[e.seqId] ??= await getSequence(e.seqId);
    const lead = await getLead(e.leadId);
    const stop = async (reason) => { Object.assign(e, { status: "stopped", stoppedAt: now(), stopReason: reason }); await putEnrollment(e);
      if (lead) await addActivity(e.leadId, "sequence", "automation", `Sequence "${e.seqName}" stopped: ${reason}`); };
    if (!seq || !seq.active) { await stop("sequence turned off"); continue; }
    if (!lead) { await stop("lead deleted"); continue; }
    if (lead.status !== e.startStatus) { await stop(`stage changed to ${lead.status}`); continue; }
    if (lead.lastInboundAt && lead.lastInboundAt > e.startedAt) { await stop("they replied"); continue; }
    if (seq.kind === "marketing" && !lead.marketingConsent) { await stop("no marketing opt-in"); continue; }
    if (!lead.contactConsent) { await stop("no contact consent"); continue; }

    const step = seq.steps[e.step];
    if (step) {
      try {
        if (step.channel === "sms" && lead.phone && lead.smsConsent && !(await isOptedOut(lead.phone))) {
          const body = fillTemplate(step.text, lead) + " Reply STOP to opt out.";
          await addActivity(lead.id, "sequence", "automation", body, { sid: await sendSms(lead.phone, body), seqId: seq.id });
          await updateLead(lead.id, { lastSmsAt: now(), lastSmsText: body.slice(0, 160), lastSmsDir: "out" }); sent++;
        } else if (step.channel === "email" && lead.email) {
          let body = `${fillTemplate(step.text, lead)}\n\n--\n${ORG_FOOTER}`;
          if (seq.kind === "marketing") body += `\nTo stop these emails: ${await unsubscribeLink(lead.id, domain)}`;
          const subject = fillTemplate(step.subject, lead);
          await addActivity(lead.id, "sequence", "automation", `${subject}\n\n${body}`, { mid: await sendEmail({ to: lead.email, subject, text: body }), seqId: seq.id });
          sent++;
        } else {
          await addActivity(lead.id, "sequence", "automation", `Skipped step ${e.step + 1} of "${seq.name}" (no ${step.channel === "sms" ? "text consent/phone" : "email"})`);
        }
      } catch (err) {
        console.error("sequence send", err.message);
        await addActivity(lead.id, "sequence", "automation", `Step ${e.step + 1} of "${seq.name}" failed: ${err.message}`);
      }
    }
    e.step += 1;
    if (e.step >= seq.steps.length) Object.assign(e, { status: "done", doneAt: now() });
    else e.nextAt = new Date(Date.parse(e.startedAt) + seq.steps[e.step].day * DAY).toISOString();
    await putEnrollment(e);
  }
  return sent;
}

export const STARTERS = [
  { name: "Provider recruitment follow-up", pipeline: "provider", kind: "follow-up", autoForms: ["provider"], active: false, steps: [
    { day: 0, channel: "email", subject: "Thanks for your interest in Sponsored Residential", text: "Hi {first_name},\n\nThank you for your interest in becoming a Sponsored Residential provider with Family Transitions. A member of our team will call you soon to talk about how it works, what training looks like and what support you'll have.\n\nIf you have questions before then, call us at {phone}.\n\nThe Family Transitions team" },
    { day: 3, channel: "sms", text: "Hi {first_name}, this is Family Transitions. Is now a good week for a quick call about becoming a provider? Reply with a good time." },
    { day: 7, channel: "email", subject: "What a day as a Sponsored Residential provider looks like", text: "Hi {first_name},\n\nMany of our providers tell us the best part is becoming part of someone's family. You'll have training, 24/7 support from our team and competitive compensation.\n\nReply to this email or call {phone} and we'll answer any questions.\n\nThe Family Transitions team" },
    { day: 14, channel: "sms", text: "Hi {first_name}, just checking in from Family Transitions. Still interested in becoming a provider? Reply YES and we'll call you." },
  ] },
  { name: "Referral partner updates", pipeline: "client", kind: "marketing", autoForms: [], active: false, steps: [
    { day: 0, channel: "email", subject: "Thank you for referring to Family Transitions", text: "Hi {first_name},\n\nThank you for trusting Family Transitions with your referral. We serve children, teens, adults and families across Richmond, Petersburg and Chesterfield with outpatient therapy, intensive in-home services, skill building, DD day support and sponsored residential.\n\nTo refer again, use https://familytransitionsinc.com/referrals/ or call {phone}.\n\nThe Family Transitions team" },
    { day: 30, channel: "email", subject: "Openings and updates from Family Transitions", text: "Hi {first_name},\n\nA quick note for our referral partners: if you're working with a child, adult or family who could use support, we'd be glad to help. Our intake team will follow up quickly on every referral.\n\nRefer online: https://familytransitionsinc.com/referrals/\n\nThe Family Transitions team" },
  ] },
];
