// Public, non-staff endpoints: Twilio texts and calls, and email unsubscribe links.
import { toE164 } from "./forms.mjs";
import { parseBody, twilio, twilioSignatureOk, leadsByPhone, addActivity, setOptOut, updateLead, getLead, putLead, sendEmail, sendSms,
  isOptedOut, unsubToken, audit, newId, now } from "./lib.mjs";
import { timingSafeEqual } from "node:crypto";

const STOP = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
const START = ["START", "UNSTOP", "YES"];
const xml = (body) => ({ statusCode: 200, headers: { "content-type": "text/xml" }, body: `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>` });
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const pretty = (p) => { const d = String(p).replace(/\D/g, "").slice(-10); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
const page = (msg) => ({ statusCode: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Transitions</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#0F2740"><h1 style="font-size:24px">Family Transitions, Inc.</h1><p>${msg}</p><p><a href="https://familytransitionsinc.com/">Back to our website</a></p></body>` });
export const TEXT_BACK = "Hi, this is Family Transitions. Sorry we missed your call! How can we help? Reply here, or we'll call you back soon. Reply STOP to opt out.";

async function verified(event) {
  const tw = await twilio();
  if (!tw) return null;
  const params = parseBody(event) || {};
  const url = `https://${event.requestContext.domainName}${event.rawPath}`;
  return twilioSignatureOk(tw.authToken, url, params, event.headers?.["x-twilio-signature"]) ? { tw, params } : null;
}

function notify(subject, text) {
  if (!process.env.NOTIFY_EMAIL) return;
  return sendEmail({ to: process.env.NOTIFY_EMAIL.split(",").map((s) => s.trim()), subject, text }).catch((e) => console.error("notify failed", e.message));
}

// Someone not in the CRM texted or called: start a lead so nobody falls through the cracks.
async function findOrCreateLead(phone, how) {
  const [lead] = await leadsByPhone(phone);
  if (lead) return { lead, isNew: false };
  const at = now();
  const nl = { id: newId(), form: how === "call" ? "call" : "sms", formLabel: how === "call" ? "Missed call" : "Text message", pipeline: "client", status: "New",
    createdAt: at, updatedAt: at, name: `${how === "call" ? "Caller" : "Texter"} ${pretty(phone)}`, phone, leadSource: "Phone call",
    channel: how === "call" ? "Phone call (missed)" : "Text message", contactConsent: true, smsConsent: how !== "call" };
  await putLead(nl);
  await addActivity(nl.id, "created", how === "call" ? "phone" : "text", how === "call" ? "Missed call from a new number" : "First text from a new number");
  return { lead: nl, isNew: true };
}

async function inboundSms(event) {
  const ok = await verified(event);
  if (!ok) return { statusCode: 403, body: "" };
  const { params } = ok;
  const from = toE164(params.From);
  const text = String(params.Body || "").slice(0, 1600);
  const word = text.trim().toUpperCase();
  if (!from) return xml("");

  if (STOP.includes(word) || START.includes(word)) {
    const out = STOP.includes(word);
    await setOptOut(from, out);
    const [lead] = await leadsByPhone(from);
    if (lead) await addActivity(lead.id, "sms_in", "text reply", text, { optOut: out });
    return xml(""); // Twilio sends the standard opt-out/opt-in confirmation itself.
  }
  const { lead, isNew } = await findOrCreateLead(from, "sms");
  await addActivity(lead.id, "sms_in", "text reply", text, { sid: params.MessageSid });
  // Texting us counts as permission to text back about their own question.
  await updateLead(lead.id, { unread: true, lastInboundAt: now(), lastSmsAt: now(), lastSmsText: text.slice(0, 160), lastSmsDir: "in", smsConsent: true, contactConsent: true });
  await notify(isNew ? "New text from a new number" : "New text message in the CRM",
    `${isNew ? "Someone new" : "A lead"} sent a text message.\n\nOpen the CRM inbox to read and reply:\n${process.env.CRM_URL}#inbox`);
  return xml("");
}

// Incoming call: ring the office line; if nobody answers, /twilio/voice-done sends a text back.
async function voice(event) {
  const ok = await verified(event);
  if (!ok) return { statusCode: 403, body: "" };
  const done = `https://${event.requestContext.domainName}/twilio/voice-done`;
  const fwd = toE164(ok.tw.forwardTo);
  if (!fwd) return voiceDone(event, ok);
  return xml(`<Dial timeout="20" answerOnBridge="true" action="${esc(done)}" method="POST">${esc(fwd)}</Dial>`);
}

async function voiceDone(event, pre) {
  const ok = pre || (await verified(event));
  if (!ok) return { statusCode: 403, body: "" };
  const { params } = ok;
  const status = params.DialCallStatus || "no-answer";
  if (status === "completed") return xml("<Hangup/>");
  const from = toE164(params.From);
  if (from) {
    const { lead, isNew } = await findOrCreateLead(from, "call");
    await addActivity(lead.id, "missed_call", "phone", `Missed call (${status})`);
    await updateLead(lead.id, { unread: true, lastInboundAt: now() });
    if (!(await isOptedOut(from))) {
      // One reply to someone who just called us. Ongoing texts still need their consent.
      await sendSms(from, TEXT_BACK).then((sid) => Promise.all([addActivity(lead.id, "sms_out", "missed-call text-back", TEXT_BACK, { sid }),
        updateLead(lead.id, { lastSmsAt: now(), lastSmsText: TEXT_BACK.slice(0, 160), lastSmsDir: "out" })])).catch((e) => console.error("text-back failed", e.message));
    }
    await notify(isNew ? "Missed call from a new number" : "Missed call from a lead", `A call to the office wasn't answered. We sent the caller a text.\n\nOpen the CRM:\n${process.env.CRM_URL}#lead/${lead.id}`);
  }
  return xml(`<Say voice="Polly.Joanna">Sorry we missed your call. We just sent you a text message, or we'll call you back soon. Thank you for calling Family Transitions.</Say><Hangup/>`);
}

async function unsubscribe(event) {
  const { id, t } = event.queryStringParameters || {};
  if (!id || !t || !/^[a-f0-9]{12}$/.test(id)) return page("This unsubscribe link isn't valid.");
  const want = Buffer.from(await unsubToken(id)), got = Buffer.from(String(t));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return page("This unsubscribe link isn't valid.");
  if (await getLead(id)) {
    await updateLead(id, { marketingConsent: false });
    await addActivity(id, "unsubscribe", "email link", "Unsubscribed from marketing emails");
    await audit("public", "unsubscribe", id);
  }
  return page("You're unsubscribed. You won't receive marketing emails from us anymore. If you have a question about services, call (804) 745-5101.");
}

export async function handler(event) {
  if (event.routeKey === "POST /twilio/inbound") return inboundSms(event);
  if (event.routeKey === "POST /twilio/voice") return voice(event);
  if (event.routeKey === "POST /twilio/voice-done") return voiceDone(event);
  if (event.routeKey === "GET /unsubscribe") return unsubscribe(event);
  return { statusCode: 404, body: "" };
}
