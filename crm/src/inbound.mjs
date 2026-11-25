// Public, non-staff endpoints: Twilio incoming texts and email unsubscribe links.
import { toE164 } from "./forms.mjs";
import { parseBody, twilio, twilioSignatureOk, leadsByPhone, addActivity, setOptOut, updateLead, getLead, sendEmail, unsubToken, audit } from "./lib.mjs";
import { timingSafeEqual } from "node:crypto";

const STOP = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
const START = ["START", "UNSTOP", "YES"];
const twiml = { statusCode: 200, headers: { "content-type": "text/xml" }, body: "<Response></Response>" };
const page = (msg) => ({ statusCode: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Transitions</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#0F2740"><h1 style="font-size:24px">Family Transitions, Inc.</h1><p>${msg}</p><p><a href="https://familytransitionsinc.com/">Back to our website</a></p></body>` });

async function inboundSms(event) {
  const tw = await twilio();
  if (!tw) return { statusCode: 503, body: "" };
  const params = parseBody(event) || {};
  const url = `https://${event.requestContext.domainName}${event.rawPath}`;
  if (!twilioSignatureOk(tw.authToken, url, params, event.headers?.["x-twilio-signature"])) return { statusCode: 403, body: "" };

  const from = toE164(params.From);
  const text = String(params.Body || "").slice(0, 1600);
  const word = text.trim().toUpperCase();
  if (!from) return twiml;
  const [lead] = await leadsByPhone(from);

  if (STOP.includes(word) || START.includes(word)) {
    const out = STOP.includes(word);
    await setOptOut(from, out);
    if (lead) await addActivity(lead.id, "sms_in", "text reply", text, { optOut: out });
    return twiml; // Twilio sends the standard opt-out/opt-in confirmation itself.
  }
  if (lead) {
    await addActivity(lead.id, "sms_in", "text reply", text, { sid: params.MessageSid });
    await updateLead(lead.id, { unread: true });
  }
  if (process.env.NOTIFY_EMAIL) {
    await sendEmail({ to: process.env.NOTIFY_EMAIL.split(",").map((s) => s.trim()), subject: "New text message in the CRM",
      text: `Someone ${lead ? "on a lead" : "not yet in the CRM"} sent a text message.\n\nOpen the CRM to read it:\n${process.env.CRM_URL}${lead ? "#lead/" + lead.id : ""}` })
      .catch((e) => console.error("notify failed", e.message));
  }
  return twiml;
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
  if (event.routeKey === "GET /unsubscribe") return unsubscribe(event);
  return { statusCode: 404, body: "" };
}
