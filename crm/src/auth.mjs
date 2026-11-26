// Staff roles from Cognito groups. Admins see everything; intake works client and provider leads;
// HR works job applicants. Anyone listed in ADMIN_EMAILS is always an admin (bootstrap).
import { PIPELINES } from "./forms.mjs";

export const ROLES = {
  admin: { label: "Admin", pipelines: Object.keys(PIPELINES) },
  intake: { label: "Intake", pipelines: ["client", "provider"] },
  hr: { label: "HR", pipelines: ["applicant"] },
};

function groupsFrom(claim) {
  if (!claim) return [];
  if (Array.isArray(claim)) return claim;
  // HTTP API passes array claims as a string such as "[admin intake]".
  return String(claim).replace(/[\[\]"]/g, "").split(/[\s,]+/).filter(Boolean);
}

export function who(event) {
  const c = event.requestContext?.authorizer?.jwt?.claims || {};
  const email = String(c.email || c["cognito:username"] || "staff").toLowerCase();
  const admins = String(process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const groups = groupsFrom(c["cognito:groups"]).filter((g) => ROLES[g]);
  if (admins.includes(email) && !groups.includes("admin")) groups.push("admin");
  const pipelines = [...new Set(groups.flatMap((g) => ROLES[g].pipelines))];
  return { email, groups, isAdmin: groups.includes("admin"), pipelines };
}

export const deny = (msg = "Your role doesn't include this. Ask an admin.") => Object.assign(new Error(msg), { status: 403 });

export function canPipeline(u, p) { if (!u.pipelines.includes(p)) throw deny(); }
export function mustAdmin(u) { if (!u.isAdmin) throw deny("Only admins can do this."); }
