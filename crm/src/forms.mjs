// Allowlist of website forms. Any field not listed here is dropped before storage,
// so a clinical field added to a page by mistake never reaches the database.
// pipeline: which CRM board the lead lands on.

export const PIPELINES = {
  client: ["New", "Contacted", "Intake scheduled", "Enrolled", "Not a fit"],
  provider: ["New", "Contacted", "Training", "Home study", "Approved", "Not a fit"],
  applicant: ["New", "Screening", "Interview", "Offer", "Hired", "Not a fit"],
};

const t = (max = 120) => ({ type: "text", max });

export const FORMS = {
  consult: {
    label: "Consultation request",
    pipeline: "client",
    fields: { name: t(), phone: { type: "phone" }, service: t(), sms_ok: { type: "bool" } },
    required: ["name", "phone"],
    map: (f) => ({ name: f.name, phone: f.phone, service: f.service, smsConsent: !!f.sms_ok, contactConsent: true }),
  },
  referral: {
    label: "Referral",
    pipeline: "client",
    fields: {
      referrer_name: t(), referrer_phone: { type: "phone" }, referrer_email: { type: "email" },
      referrer_role: t(), organization: t(), client_first: t(60), client_last_initial: t(1),
      service: t(), source: t(), best_time: t(), consent: { type: "bool" }, marketing_ok: { type: "bool" },
    },
    required: ["referrer_name", "referrer_phone", "client_first", "service", "consent"],
    map: (f) => ({
      name: [f.client_first, f.client_last_initial && f.client_last_initial + "."].filter(Boolean).join(" "),
      phone: f.referrer_phone, email: f.referrer_email, service: f.service, leadSource: f.source,
      contactName: f.referrer_name, contactRole: f.referrer_role, organization: f.organization,
      contactConsent: !!f.consent, smsConsent: !!f.consent, marketingConsent: !!f.marketing_ok,
    }),
  },
  quiz: {
    label: "Service quiz",
    pipeline: "client",
    fields: { name: t(), phone: { type: "phone" }, email: { type: "email" }, for_whom: t(60), need: t(80), recommendation: t(80), sms_ok: { type: "bool" }, contact_ok: { type: "bool" } },
    required: ["name", "phone", "contact_ok"],
    map: (f) => ({ name: f.name, phone: f.phone, email: f.email, service: f.recommendation, smsConsent: !!f.sms_ok, contactConsent: !!f.contact_ok }),
  },
  tour: {
    label: "DD Day Support tour",
    pipeline: "client",
    fields: { name: t(), phone: { type: "phone" }, email: { type: "email" }, days: { type: "list", max: 5 }, time: t(), contact_ok: { type: "bool" } },
    required: ["name", "phone", "contact_ok"],
    map: (f) => ({ name: f.name, phone: f.phone, email: f.email, service: "DD Day Support", contactConsent: !!f.contact_ok, smsConsent: !!f.contact_ok }),
  },
  provider: {
    label: "Sponsored Residential provider",
    pipeline: "provider",
    fields: {
      first_name: t(60), last_name: t(60), phone: { type: "phone" }, email: { type: "email" }, city: t(60), zip: t(10),
      own_rent: t(20), household: t(10), bedroom: t(20), license: t(10), bg_ok: t(10),
      experience: t(1500), why: t(1500), contact_ok: { type: "bool" }, marketing_ok: { type: "bool" },
    },
    required: ["first_name", "last_name", "phone", "contact_ok"],
    map: (f) => ({ name: `${f.first_name} ${f.last_name}`, phone: f.phone, email: f.email, service: "Sponsored Residential provider",
      contactConsent: !!f.contact_ok, smsConsent: !!f.contact_ok, marketingConsent: !!f.marketing_ok }),
  },
  careers: {
    label: "Job application",
    pipeline: "applicant",
    fields: {
      position: t(), first_name: t(60), last_name: t(60), phone: { type: "phone" }, email: { type: "email" },
      city: t(60), availability: t(20), credentials: t(300), contact_ok: { type: "bool" },
    },
    required: ["position", "first_name", "last_name", "phone", "email", "contact_ok"],
    file: { field: "resume", types: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], maxBytes: 5 * 1024 * 1024 },
    map: (f) => ({ name: `${f.first_name} ${f.last_name}`, phone: f.phone, email: f.email, service: f.position,
      contactConsent: !!f.contact_ok, smsConsent: !!f.contact_ok }),
  },
};

export function toE164(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Returns { ok, errors, values } with only allowlisted, cleaned values.
export function clean(formKey, input) {
  const form = FORMS[formKey];
  if (!form) return { ok: false, errors: ["unknown form"] };
  const values = {}, errors = [];
  for (const [k, spec] of Object.entries(form.fields)) {
    let v = input?.[k];
    if (v === undefined || v === null || v === "") continue;
    if (spec.type === "bool") { values[k] = v === true || v === "on" || v === "true" || v === "1"; continue; }
    if (spec.type === "list") {
      const arr = (Array.isArray(v) ? v : [v]).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, spec.max);
      if (arr.length) values[k] = arr;
      continue;
    }
    v = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
    if (!v) continue;
    if (spec.type === "phone") { const p = toE164(v); if (!p) errors.push(`${k}: invalid phone`); else values[k] = p; continue; }
    if (spec.type === "email") { if (!EMAIL.test(v) || v.length > 254) errors.push(`${k}: invalid email`); else values[k] = v.toLowerCase(); continue; }
    values[k] = (spec.max > 300 ? v : v.replace(/\s+/g, " ")).slice(0, spec.max);
  }
  for (const r of form.required) if (!values[r]) errors.push(`${r}: required`);
  return { ok: errors.length === 0, errors, values };
}
