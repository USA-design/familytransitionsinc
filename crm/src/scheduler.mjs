// Runs on a schedule (see template.yaml):
//  - "tick" every 15 minutes: send due sequence steps; alert staff about new leads nobody has contacted for an hour.
//  - "digest" weekday mornings: one summary email with counts only (no personal details).
import { PIPELINES } from "./forms.mjs";
import { listPipeline, updateLead, sendEmail, now } from "./lib.mjs";
import { runDue } from "./sequences.mjs";

const HOUR = 36e5;
const firstStage = (p) => PIPELINES[p][0];
const etParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23", weekday: "short" })
  .formatToParts(d).map((x) => [x.type, x.value]));
export const businessHours = (d = new Date()) => { const p = etParts(d); const h = Number(p.hour); return !["Sat", "Sun"].includes(p.weekday) && h >= 8 && h < 19; };
const notify = () => (process.env.NOTIFY_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);

export async function speedToLead(at = new Date()) {
  if (!businessHours(at) || !notify().length) return 0;
  const all = (await Promise.all(Object.keys(PIPELINES).map((p) => listPipeline(p, 300)))).flat();
  const t = at.getTime();
  const slow = all.filter((l) => l.status === firstStage(l.pipeline) && !l.lastContactAt && !l.slowAlertAt
    && t - Date.parse(l.createdAt) > HOUR && t - Date.parse(l.createdAt) < 72 * HOUR);
  if (!slow.length) return 0;
  await sendEmail({ to: notify(), subject: `${slow.length} new lead${slow.length > 1 ? "s" : ""} waiting over an hour`,
    text: `${slow.length} new lead${slow.length > 1 ? "s have" : " has"} not been contacted for more than an hour.\n\nOpen Today in the CRM:\n${process.env.CRM_URL}#today\n\nFast follow-up is the biggest driver of intake. (Details are only shown inside the CRM.)` });
  for (const l of slow) await updateLead(l.id, { slowAlertAt: now() });
  return slow.length;
}

export async function digest(at = new Date()) {
  if (!notify().length) return null;
  const all = (await Promise.all(Object.keys(PIPELINES).map((p) => listPipeline(p, 1000)))).flat();
  const today = new Date(at.toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);
  const c = {
    newDay: all.filter((l) => at - Date.parse(l.createdAt) < 24 * HOUR).length,
    waiting: all.filter((l) => l.status === firstStage(l.pipeline) && !l.lastContactAt).length,
    due: all.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !/Not a fit|Enrolled|Approved|Hired/.test(l.status)).length,
    unread: all.filter((l) => l.unread).length,
  };
  await sendEmail({ to: notify(), subject: `FTI CRM: ${c.newDay} new, ${c.due} follow-ups due today`,
    text: `Good morning. Here's today in the CRM:\n\n• New leads in the last 24 hours: ${c.newDay}\n• New leads not yet contacted: ${c.waiting}\n• Follow-ups due today or overdue: ${c.due}\n• Unread text replies: ${c.unread}\n\nOpen Today:\n${process.env.CRM_URL}#today` });
  return c;
}

export async function handler(event) {
  const job = event?.job || "tick";
  if (job === "digest") return { digest: await digest() };
  const sent = await runDue(process.env.API_DOMAIN).catch((e) => (console.error("sequences", e), -1));
  const alerted = await speedToLead().catch((e) => (console.error("speed-to-lead", e), -1));
  return { sent, alerted };
}
