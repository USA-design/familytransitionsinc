// Public endpoint: POST /submit/{form}. Receives website form posts.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FORMS, clean } from "./forms.mjs";
import { json, parseBody, putLead, addActivity, newId, now, sendEmail, sendSms } from "./lib.mjs";

const s3 = new S3Client({});

function channelOf(attr = {}) {
  if (attr.utm_source) return [attr.utm_source, attr.utm_medium].filter(Boolean).join(" / ").slice(0, 80);
  const ref = String(attr.ref || "");
  let host = "";
  try { host = new URL(ref).hostname.replace(/^www\./, ""); } catch {}
  if (!host || host.endsWith("familytransitionsinc.com") || host.endsWith("workers.dev")) return "Direct";
  if (/google\./.test(host)) return "Google (organic)";
  if (/bing\.|duckduckgo|yahoo\./.test(host)) return "Other search";
  if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot/.test(host)) return "AI assistant";
  if (/facebook|instagram|linkedin|tiktok|t\.co|x\.com|nextdoor/.test(host)) return "Social";
  return "Referral site: " + host.slice(0, 60);
}

const pick = (o, keys, max = 300) => Object.fromEntries(keys.filter((k) => o?.[k]).map((k) => [k, String(o[k]).slice(0, max)]));

export async function handler(event) {
  const formKey = event.pathParameters?.form;
  const form = FORMS[formKey];
  if (!form) return json(404, { ok: false, error: "Unknown form." });
  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  // Bot checks: hidden field must stay empty and a person takes more than ~2.5s to fill a form.
  // Bots get a normal-looking success so they don't retry, but nothing is stored.
  if (body.website || (Number(body._elapsed) > 0 && Number(body._elapsed) < 2500)) return json(200, { ok: true });

  const { ok, errors, values } = clean(formKey, body);
  if (!ok) return json(400, { ok: false, error: "Please check the form.", errors });

  const id = newId(), createdAt = now();
  const attr = pick(body._attr, ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "ref", "landing", "first_at"]);
  const lead = {
    id, form: formKey, formLabel: form.label, pipeline: form.pipeline, status: "New", createdAt, updatedAt: createdAt,
    ...form.map(values), fields: values, page: String(body._page || "").slice(0, 200), channel: channelOf(attr), attribution: attr,
  };
  if (!lead.leadSource) lead.leadSource = lead.channel;

  let uploadUrl;
  const meta = form.file && body[form.file.field];
  if (meta && typeof meta === "object" && meta.name) {
    if (!form.file.types.includes(meta.type) || !(meta.size > 0 && meta.size <= form.file.maxBytes))
      return json(400, { ok: false, error: "Resume must be a PDF or Word file under 5 MB." });
    const safe = String(meta.name).replace(/[^\w.\- ]/g, "_").slice(-80);
    lead.resumeKey = `resumes/${id}/${safe}`;
    uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.FILES_BUCKET, Key: lead.resumeKey, ContentType: meta.type }), { expiresIn: 600 });
  }

  Object.keys(lead).forEach((k) => (lead[k] === undefined || lead[k] === "") && delete lead[k]);
  await putLead(lead);
  await addActivity(id, "created", "website", `${form.label} submitted on ${lead.page || "the website"}`);

  // Staff alert carries no personal details, only a link into the secured CRM.
  if (process.env.NOTIFY_EMAIL) {
    await sendEmail({
      to: process.env.NOTIFY_EMAIL.split(",").map((s) => s.trim()),
      subject: `New ${form.label.toLowerCase()} on the website`,
      text: `A new ${form.label.toLowerCase()} came in at ${new Date(createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })}.\n\nOpen the CRM to view it:\n${process.env.CRM_URL}#lead/${id}\n\n(For privacy, details are only shown inside the CRM.)`,
    }).catch((e) => console.error("notify failed", e.message));
  }

  if (process.env.AUTO_REPLY_SMS === "on" && lead.smsConsent && lead.phone) {
    const msg = "Family Transitions: Thank you, we received your request and will call you soon. Questions? (804) 745-5101. Reply STOP to opt out.";
    await sendSms(lead.phone, msg).then((sid) => addActivity(id, "sms_out", "auto-reply", msg, { sid }))
      .catch((e) => console.error("auto-reply failed", e.message));
  }

  return json(200, { ok: true, ...(uploadUrl ? { uploadUrl } : {}) });
}
