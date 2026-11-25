/* Family Transitions staff CRM (static page; all data comes from the AWS API after sign-in).
   Lead data is only ever inserted as text (never as HTML), so form input can't inject code. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEMO = new URLSearchParams(location.search).has("demo");
  var REDIRECT = location.origin + location.pathname;
  var IDLE_MS = 30 * 60 * 1000; // automatic sign-out after 30 idle minutes
  var cfg = {}, conf = null, state = { pipe: "client", leads: [], view: "leads", open: null };
  var PIPE_NAMES = { client: "Clients & referrals", provider: "Providers", applicant: "Applicants" };

  // ---------- tiny DOM helper (text only) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); });
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmtPhone(p) { var d = String(p || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : p || ""; }
  function ago(iso) {
    var m = (Date.now() - new Date(iso)) / 6e4;
    if (m < 60) return Math.max(1, Math.round(m)) + "m ago";
    if (m < 1440) return Math.round(m / 60) + "h ago";
    var d = Math.round(m / 1440); return d < 30 ? d + "d ago" : new Date(iso).toLocaleDateString();
  }
  function when(iso) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function banner(text) { var b = $("#banner"); b.textContent = text || ""; b.hidden = !text; }

  // ---------- sign-in (Cognito hosted page, PKCE) ----------
  var tok = JSON.parse(sessionStorage.getItem("fti_tok") || "null");
  function b64url(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function rand() { var a = new Uint8Array(32); crypto.getRandomValues(a); return b64url(a); }
  function signIn() {
    var verifier = rand(), st = rand();
    sessionStorage.setItem("fti_pkce", JSON.stringify({ v: verifier, s: st, hash: location.hash }));
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (d) {
      location.href = cfg.signInDomain + "/oauth2/authorize?" + new URLSearchParams({ response_type: "code", client_id: cfg.userPoolClientId,
        redirect_uri: REDIRECT, scope: "openid email", code_challenge_method: "S256", code_challenge: b64url(d), state: st });
    });
  }
  function tokenCall(params) {
    return fetch(cfg.signInDomain + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.assign({ client_id: cfg.userPoolClientId }, params)) })
      .then(function (r) { if (!r.ok) throw new Error("Sign-in failed. Please try again."); return r.json(); })
      .then(function (t) {
        tok = { id: t.id_token, refresh: t.refresh_token || (tok && tok.refresh), exp: Date.now() + (t.expires_in - 60) * 1000 };
        sessionStorage.setItem("fti_tok", JSON.stringify(tok)); return tok;
      });
  }
  function freshToken() {
    if (tok && tok.exp > Date.now()) return Promise.resolve(tok.id);
    if (tok && tok.refresh) return tokenCall({ grant_type: "refresh_token", refresh_token: tok.refresh }).then(function (t) { return t.id; }).catch(function () { signOut(true); throw new Error("Session expired."); });
    signOut(true); return Promise.reject(new Error("Not signed in."));
  }
  function signOut(local) {
    sessionStorage.removeItem("fti_tok"); tok = null;
    if (DEMO) { location.href = REDIRECT; return; }
    if (local) { showGate(); return; }
    location.href = cfg.signInDomain + "/logout?" + new URLSearchParams({ client_id: cfg.userPoolClientId, logout_uri: REDIRECT });
  }
  function claims() { try { return JSON.parse(atob(tok.id.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; } }
  var idleT; function idle() { clearTimeout(idleT); idleT = setTimeout(function () { if (tok || DEMO) signOut(); }, IDLE_MS); }
  ["click", "keydown", "mousemove", "touchstart"].forEach(function (e) { document.addEventListener(e, idle, { passive: true }); });

  // ---------- API ----------
  function api(method, path, body) {
    if (DEMO) return demo(method, path, body);
    return freshToken().then(function (t) {
      return fetch(cfg.apiUrl + path, { method: method, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (o) { if (!r.ok) throw new Error(o.error || o.message || "Request failed (" + r.status + ")"); return o; });
    });
  }

  // ---------- views ----------
  function showGate(msg) {
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = true; });
    $(".tabs").hidden = true; $(".me").hidden = true; $("#gate").hidden = false;
    if (msg) $("#gate-msg").textContent = msg;
  }
  function go(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("on", t.dataset.view === view); });
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.id !== "view-" + view; });
    if (view === "leads") loadLeads();
    if (view === "reports") loadReports();
    if (view === "campaigns") setupCampaign();
  }

  function renderPipes() {
    var seg = clear($("#pipes"));
    Object.keys(conf.pipelines).forEach(function (p) {
      seg.appendChild(h("button", { role: "tab", class: p === state.pipe ? "on" : "", "aria-selected": p === state.pipe ? "true" : "false",
        onclick: function () { state.pipe = p; renderPipes(); loadLeads(); } }, PIPE_NAMES[p]));
    });
  }

  function loadLeads() {
    clear($("#board")).appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/leads?pipeline=" + state.pipe).then(function (o) { state.leads = o.leads; renderSources(); renderBoard(); })
      .catch(function (e) { clear($("#board")).appendChild(h("p", { class: "err", text: e.message })); });
  }
  function renderSources() {
    var sel = $("#src"), cur = sel.value, seen = {};
    state.leads.forEach(function (l) { if (l.leadSource) seen[l.leadSource] = 1; });
    clear(sel).appendChild(h("option", { value: "" }, "All sources"));
    Object.keys(seen).sort().forEach(function (s) { sel.appendChild(h("option", { value: s, selected: s === cur }, s)); });
  }
  function matches(l) {
    var q = $("#q").value.trim().toLowerCase(), src = $("#src").value;
    if (src && l.leadSource !== src) return false;
    if (!q) return true;
    var digits = q.replace(/\D/g, "");
    if (digits.length >= 3 && String(l.phone || "").replace(/\D/g, "").indexOf(digits) >= 0) return true;
    return [l.name, l.contactName, l.email, l.organization, l.service].join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function renderBoard() {
    var board = clear($("#board")), statuses = conf.pipelines[state.pipe];
    statuses.forEach(function (st) {
      var items = state.leads.filter(function (l) { return l.status === st && matches(l); });
      var col = h("div", { class: "col", "data-status": st,
        ondragover: function (e) { e.preventDefault(); col.classList.add("over"); },
        ondragleave: function () { col.classList.remove("over"); },
        ondrop: function (e) { e.preventDefault(); col.classList.remove("over"); moveLead(e.dataTransfer.getData("text/plain"), st); } },
        h("div", { class: "col-h" }, st, h("span", {}, String(items.length))));
      if (!items.length) col.appendChild(h("div", { class: "empty", text: "No leads" }));
      items.forEach(function (l) {
        col.appendChild(h("button", { class: "card", draggable: "true", ondragstart: function (e) { e.dataTransfer.setData("text/plain", l.id); },
          onclick: function () { openLead(l.id); } },
          h("span", { class: "nm" }, l.unread ? h("span", { class: "dot", title: "New text reply" }) : null, l.name || "(no name)"),
          h("span", { class: "meta" }, [l.service, l.contactName && "via " + l.contactName].filter(Boolean).join(" · ")),
          h("span", { class: "meta" }, (l.leadSource || "Unknown source") + " · " + ago(l.createdAt) + (l.owner ? " · " + l.owner : ""))));
      });
      board.appendChild(col);
    });
  }
  function moveLead(id, status) {
    var l = state.leads.find(function (x) { return x.id === id; });
    if (!l || l.status === status) return;
    var old = l.status; l.status = status; renderBoard();
    api("PATCH", "/leads/" + id, { status: status }).catch(function (e) { l.status = old; renderBoard(); banner(e.message); });
  }

  // ---------- lead drawer ----------
  function openLead(id) {
    state.open = id; history.replaceState(null, "", "#lead/" + id);
    $("#drawer").hidden = false; $("#d-name").textContent = "Loading…"; clear($("#d-body"));
    api("GET", "/leads/" + id).then(renderLead).catch(function (e) { $("#d-name").textContent = "Lead"; $("#d-body").appendChild(h("p", { class: "err", text: e.message })); });
  }
  function closeLead() { $("#drawer").hidden = true; state.open = null; history.replaceState(null, "", location.pathname + location.search); }

  function renderLead(o) {
    var l = o.lead, body = clear($("#d-body")), statuses = conf.pipelines[l.pipeline];
    $("#d-name").textContent = l.name || "(no name)";
    if (l.unread) api("PATCH", "/leads/" + l.id, { unread: false }).catch(function () {});
    var save = function (patch) {
      return api("PATCH", "/leads/" + l.id, patch).then(function (r) {
        Object.assign(l, r.lead); var i = state.leads.findIndex(function (x) { return x.id === l.id; });
        if (i >= 0) state.leads[i] = Object.assign(state.leads[i], r.lead); renderBoard(); return refresh();
      }).catch(function (e) { banner(e.message); });
    };
    var refresh = function () { return api("GET", "/leads/" + l.id).then(renderLead); };

    body.appendChild(h("div", { class: "contact" },
      l.phone ? h("a", { href: "tel:" + l.phone }, "📞 " + fmtPhone(l.phone)) : null,
      l.email ? h("a", { href: "mailto:" + l.email }, "✉ " + l.email) : null));
    body.appendChild(h("div", {},
      h("span", { class: "tag " + (l.smsConsent ? "ok" : "no") }, l.smsConsent ? "Texts OK" : "No text consent"),
      o.smsOptedOut ? h("span", { class: "tag no" }, "Replied STOP") : null,
      h("span", { class: "tag " + (l.marketingConsent ? "ok" : "") }, l.marketingConsent ? "Marketing opt-in" : "No marketing"),
      h("span", { class: "tag" }, l.formLabel)));

    var status = h("select", { onchange: function () { save({ status: status.value }); } }, statuses.map(function (s) { return h("option", { selected: s === l.status }, s); }));
    var owner = h("input", { value: l.owner || "", placeholder: "Who's following up?", onchange: function () { save({ owner: owner.value.trim() }); } });
    var loc = h("select", { onchange: function () { save({ location: loc.value }); } },
      [["", "Not set"], ["north-chesterfield", "North Chesterfield"], ["petersburg", "Petersburg"]].map(function (x) { return h("option", { value: x[0], selected: (l.location || "") === x[0] }, x[1]); }));
    var fup = h("input", { type: "date", value: l.nextFollowUp || "", onchange: function () { save({ nextFollowUp: fup.value }); } });
    body.appendChild(h("div", { class: "grid2" }, h("label", {}, "Stage", status), h("label", {}, "Owner", owner), h("label", {}, "Office", loc), h("label", {}, "Next follow-up", fup)));

    var kv = h("dl", { class: "kv" });
    var add = function (k, v) { if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) { kv.appendChild(h("dt", {}, k)); kv.appendChild(h("dd", {}, Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : String(v))); } };
    add("Service", l.service); add("Referred by", l.contactName && [l.contactName, l.contactRole, l.organization].filter(Boolean).join(", "));
    add("Heard about us", l.leadSource); add("Tracked channel", l.channel); add("Landing page", l.attribution && l.attribution.landing);
    add("Campaign", l.attribution && l.attribution.utm_campaign); add("Received", when(l.createdAt));
    var LABELS = { best_time: "Best time to call", own_rent: "Own or rent", household: "People in home", bedroom: "Private bedroom", license: "Driver's license", bg_ok: "Background check OK",
      experience: "Experience", why: "Why interested", days: "Tour days", time: "Tour time", availability: "Availability", credentials: "Credentials", city: "City", zip: "ZIP", position: "Position" };
    Object.keys(LABELS).forEach(function (k) { if (l.fields) add(LABELS[k], l.fields[k]); });
    body.appendChild(h("div", { class: "box" }, h("h3", {}, "Details"), kv,
      l.resumeKey ? h("button", { class: "btn line", onclick: function () { api("GET", "/leads/" + l.id + "/resume").then(function (r) { location.href = r.url; }).catch(function (e) { banner(e.message); }); } }, "Download resume") : null));

    // actions
    var panel = h("div", {}), tabs = h("div", { class: "acts" });
    var modes = { note: "Note", sms: "Text", email: "Email", review: "Ask for review" };
    var setMode = function (m) {
      Array.prototype.forEach.call(tabs.children, function (b) { b.classList.toggle("on", b.dataset.m === m); });
      clear(panel);
      var err = h("p", { class: "err" });
      if (m === "note") {
        var t = h("textarea", { rows: "3", placeholder: "Call notes, next steps…" });
        panel.append(t, h("div", { class: "actions" }, h("span", { class: "grow" }), h("button", { class: "btn", onclick: function () {
          api("POST", "/leads/" + l.id + "/notes", { text: t.value }).then(refresh).catch(function (e) { err.textContent = e.message; }); } }, "Save note")), err);
      } else if (m === "sms") {
        if (!conf.smsReady) { panel.append(h("p", { class: "muted", text: "Texting turns on once the Twilio account is connected." })); return; }
        var tpl = h("select", { onchange: function () { st.value = tpl.value; } }, h("option", { value: "" }, "Templates…"), conf.templates.sms.map(function (x) { return h("option", { value: x.text }, x.name); }));
        var st = h("textarea", { rows: "3", maxlength: "640", placeholder: "Message" });
        panel.append(tpl, st, h("p", { class: "muted small", text: "Don't include diagnoses or other health details in texts." }),
          h("div", { class: "actions" }, h("span", { class: "grow" }), h("button", { class: "btn", disabled: !l.phone || !l.smsConsent || o.smsOptedOut, onclick: function (e) {
            e.target.disabled = true; api("POST", "/leads/" + l.id + "/sms", { text: st.value }).then(refresh).catch(function (x) { err.textContent = x.message; e.target.disabled = false; }); } }, "Send text")), err);
      } else if (m === "email") {
        var sub = h("input", { placeholder: "Subject" }), em = h("textarea", { rows: "6", placeholder: "Hi {first_name}," });
        panel.append(sub, em, h("p", { class: "muted small", text: "Regular email isn't encrypted end to end: keep health details out of it." }),
          h("div", { class: "actions" }, h("span", { class: "grow" }), h("button", { class: "btn", disabled: !l.email, onclick: function (e) {
            e.target.disabled = true; api("POST", "/leads/" + l.id + "/email", { subject: sub.value, text: em.value }).then(refresh).catch(function (x) { err.textContent = x.message; e.target.disabled = false; }); } }, "Send email")), err);
      } else {
        panel.append(h("p", { class: "muted", text: "Sends a short thank-you with the Google review link for this lead's office" + (l.reviewRequestedAt ? ". Last asked " + when(l.reviewRequestedAt) + "." : ".") }),
          h("div", { class: "actions" }, h("span", { class: "grow" }),
            h("button", { class: "btn line", disabled: !l.email, onclick: function () { api("POST", "/leads/" + l.id + "/review", { channel: "email" }).then(refresh).catch(function (x) { err.textContent = x.message; }); } }, "By email"),
            h("button", { class: "btn", disabled: !l.phone || !l.smsConsent || !conf.smsReady, onclick: function () { api("POST", "/leads/" + l.id + "/review", { channel: "sms" }).then(refresh).catch(function (x) { err.textContent = x.message; }); } }, "By text")), err);
      }
    };
    Object.keys(modes).forEach(function (m) { tabs.appendChild(h("button", { "data-m": m, onclick: function () { setMode(m); } }, modes[m])); });
    body.appendChild(h("div", { class: "box" }, tabs, panel)); setMode("note");

    var KIND = { created: "Lead created", note: "Note", status: "Stage changed", owner: "Assigned", sms_out: "Text sent", sms_in: "Text received", email_out: "Email sent", review: "Review request", campaign: "Campaign", unsubscribe: "Unsubscribed" };
    body.appendChild(h("div", { class: "box" }, h("h3", {}, "Activity"), h("ul", { class: "timeline" }, o.activity.map(function (a) {
      return h("li", { class: a.kind }, h("div", { class: "when" }, (KIND[a.kind] || a.kind) + " · " + a.by + " · " + when(a.at)), h("div", { class: "txt" }, a.text));
    }))));
  }

  // ---------- reports ----------
  function loadReports() {
    var root = clear($("#reports")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/reports?days=" + $("#days").value).then(function (r) {
      clear(root);
      var won = { client: "Enrolled", provider: "Approved", applicant: "Hired" };
      root.appendChild(h("div", { class: "kpis" },
        h("div", { class: "kpi" }, h("b", {}, String(r.total)), h("span", {}, "New leads")),
        Object.keys(PIPE_NAMES).map(function (p) {
          var sp = r.statusByPipeline[p] || {}, n = r.byPipeline[p] || 0;
          return h("div", { class: "kpi" }, h("b", {}, String(n)), h("span", {}, PIPE_NAMES[p] + " · " + (sp[won[p]] || 0) + " " + won[p].toLowerCase()));
        })));
      // leads per week (single series → no legend; hover shows the value)
      var weeks = Object.keys(r.byWeek).sort(), max = Math.max.apply(null, weeks.map(function (w) { return r.byWeek[w]; }).concat(1));
      var chart = h("div", { class: "chart", role: "img", "aria-label": "Leads per week" });
      weeks.forEach(function (w) {
        var b = h("div", { class: "b", tabindex: "0" }, h("span", { class: "tip" }, "Week of " + new Date(w + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) + ": " + r.byWeek[w] + " leads"));
        b.style.height = (r.byWeek[w] / max * 100) + "%"; chart.appendChild(b);
      });
      var axis = h("div", { class: "axis" }, h("span", {}, weeks[0] ? new Date(weeks[0] + "T12:00").toLocaleDateString() : ""), h("span", {}, "peak " + max + "/week"), h("span", {}, weeks.length ? new Date(weeks[weeks.length - 1] + "T12:00").toLocaleDateString() : ""));
      var srcRows = Object.keys(r.bySource).sort(function (a, b) { return r.bySource[b].leads - r.bySource[a].leads; });
      var smax = Math.max.apply(null, srcRows.map(function (s) { return r.bySource[s].leads; }).concat(1));
      var srcTable = h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "How they heard about us"), h("th", { class: "n" }, "Leads"), h("th", {}, ""), h("th", { class: "n" }, "Converted"), h("th", { class: "n" }, "Rate"))),
        h("tbody", {}, srcRows.map(function (s) {
          var x = r.bySource[s], m = h("i"); m.style.width = (x.leads / smax * 100) + "%";
          return h("tr", {}, h("td", {}, s), h("td", { class: "n" }, String(x.leads)), h("td", {}, h("div", { class: "meter" }, m)), h("td", { class: "n" }, String(x.won)), h("td", { class: "n" }, Math.round(x.won / x.leads * 100) + "%"));
        })));
      var table = function (title, obj) {
        var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
        return h("div", { class: "panel" }, h("h3", {}, title), h("table", { class: "t" }, h("tbody", {}, keys.map(function (k) { return h("tr", {}, h("td", {}, k), h("td", { class: "n" }, String(obj[k]))); }))));
      };
      var funnels = Object.keys(PIPE_NAMES).map(function (p) { return table(PIPE_NAMES[p] + " by stage", r.statusByPipeline[p] || {}); });
      root.appendChild(h("div", { class: "rgrid" },
        h("div", { class: "panel" }, h("h3", {}, "Leads per week"), chart, axis),
        h("div", { class: "panel" }, h("h3", {}, "Lead sources"), srcTable),
        table("Tracked channel (website visits)", r.byChannel), table("By form", r.byForm), funnels));
    }).catch(function (e) { clear(root).appendChild(h("p", { class: "err", text: e.message })); });
  }

  // ---------- campaigns ----------
  var camp = { confirm: false };
  function setupCampaign() {
    var pipe = $("#c-pipe");
    if (!pipe.options.length) {
      [["client", "Referral partners (opted in)"], ["provider", "Provider prospects (opted in)"], ["applicant", "Job applicants (opted in)"]].forEach(function (x) { pipe.appendChild(h("option", { value: x[0] }, x[1])); });
      pipe.addEventListener("change", function () { renderStatuses(); resetSend(); });
      $("#c-channel").addEventListener("change", function () { $("#c-subject-wrap").hidden = $("#c-channel").value === "sms"; resetSend(); });
      $("#c-send").addEventListener("click", sendCampaign);
      ["#c-text", "#c-subject"].forEach(function (s) { $(s).addEventListener("input", resetSend); });
      renderStatuses();
    }
  }
  function renderStatuses() {
    var box = clear($("#c-statuses"));
    conf.pipelines[$("#c-pipe").value].forEach(function (s) {
      box.appendChild(h("label", { class: "check" }, h("input", { type: "checkbox", value: s, checked: s !== "Not a fit", onchange: resetSend }), s));
    });
  }
  function resetSend() { camp.confirm = false; $("#c-send").textContent = "Check recipients"; $("#c-send").classList.remove("danger"); $("#c-count").textContent = ""; }
  function campBody(dry) {
    return { channel: $("#c-channel").value, pipeline: $("#c-pipe").value, subject: $("#c-subject").value, text: $("#c-text").value, dryRun: dry,
      statuses: Array.prototype.map.call(document.querySelectorAll("#c-statuses input:checked"), function (i) { return i.value; }) };
  }
  function sendCampaign() {
    var btn = $("#c-send"); btn.disabled = true; $("#c-result").textContent = "";
    if (!camp.confirm) {
      api("POST", "/campaigns", campBody(true)).then(function (r) {
        $("#c-count").textContent = r.recipients + " recipient" + (r.recipients === 1 ? "" : "s");
        if (r.recipients) { camp.confirm = true; btn.textContent = "Send to " + r.recipients + " now"; btn.classList.add("danger"); }
      }).catch(function (e) { $("#c-result").textContent = e.message; }).then(function () { btn.disabled = false; });
      return;
    }
    api("POST", "/campaigns", campBody(false)).then(function (r) {
      $("#c-result").textContent = "Sent to " + r.sent + "." + (r.failed.length ? " " + r.failed.length + " failed." : ""); resetSend();
    }).catch(function (e) { $("#c-result").textContent = e.message; }).then(function () { btn.disabled = false; });
  }

  // ---------- wiring ----------
  $("#signin").addEventListener("click", signIn);
  $("#signout").addEventListener("click", function () { signOut(false); });
  $("#d-close").addEventListener("click", closeLead);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#drawer").hidden) closeLead(); });
  document.querySelectorAll(".tab").forEach(function (t) { t.addEventListener("click", function () { go(t.dataset.view); }); });
  $("#q").addEventListener("input", renderBoard); $("#src").addEventListener("change", renderBoard);
  $("#days").addEventListener("change", loadReports);
  $("#export").addEventListener("click", function () {
    api("GET", "/export?pipeline=" + state.pipe).then(function (r) {
      var a = h("a", { href: URL.createObjectURL(new Blob([r.csv], { type: "text/csv" })), download: "fti-" + state.pipe + "-leads.csv" }); document.body.appendChild(a); a.click(); a.remove();
    }).catch(function (e) { banner(e.message); });
  });
  $("#add").addEventListener("click", function () { $("#addform").reset(); $("#addlg").showModal(); });
  $("#addlg").addEventListener("close", function () {
    if ($("#addlg").returnValue !== "ok") return;
    var f = new FormData($("#addform")), b = {}; f.forEach(function (v, k) { b[k] = v; }); b.smsConsent = !!b.smsConsent;
    api("POST", "/leads", b).then(function (r) { state.pipe = r.lead.pipeline; renderPipes(); loadLeads(); openLead(r.lead.id); }).catch(function (e) { banner(e.message); });
  });

  function start() {
    $("#gate").hidden = true; $(".tabs").hidden = false; $(".me").hidden = false;
    $("#who").textContent = DEMO ? "Demo (sample data)" : (claims().email || "");
    if (DEMO) banner("Demo mode: sample data only, nothing is saved or sent.");
    api("GET", "/config").then(function (c) {
      conf = c; renderPipes(); go("leads"); idle();
      var m = location.hash.match(/^#lead\/(\w+)/); if (m) openLead(m[1]);
      if (!DEMO && (!c.smsReady || !c.emailReady)) banner([!c.emailReady && "Email sending isn't set up yet.", !c.smsReady && "Texting isn't set up yet (Twilio)."].filter(Boolean).join(" "));
    }).catch(function (e) { showGate(e.message); });
  }

  fetch("/crm/config.json", { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (c) {
    cfg = c || {};
    if (DEMO) return start();
    if (!cfg.apiUrl) { showGate("The CRM isn't connected to its secure database yet. Once the AWS setup is finished, staff will sign in here."); $("#signin").hidden = true; return; }
    var q = new URLSearchParams(location.search);
    if (q.get("code")) {
      var pk = JSON.parse(sessionStorage.getItem("fti_pkce") || "{}"); sessionStorage.removeItem("fti_pkce");
      history.replaceState(null, "", location.pathname + (pk.hash || ""));
      if (q.get("state") !== pk.s) return showGate("Sign-in check failed. Please try again.");
      return tokenCall({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: REDIRECT, code_verifier: pk.v }).then(start).catch(function (e) { showGate(e.message); });
    }
    if (tok) return start();
    showGate();
  });

  // ---------- demo data (only with ?demo=1) ----------
  var D;
  function demo(method, path, body) {
    if (!D) {
      var t = function (d, hrs) { return new Date(Date.now() - (d * 24 + (hrs || 0)) * 36e5).toISOString(); };
      var mk = function (id, pipeline, status, name, extra, d) {
        return Object.assign({ id: id, pipeline: pipeline, status: status, name: name, createdAt: t(d, 3), updatedAt: t(d), smsConsent: true, phone: "+1804555" + String(1000 + d * 37).slice(-4),
          formLabel: pipeline === "client" ? "Consultation request" : pipeline === "provider" ? "Sponsored Residential provider" : "Job application", fields: {}, attribution: { landing: "/" } }, extra);
      };
      D = { leads: [
        mk("a1", "client", "New", "Jane S.", { service: "Outpatient Therapy", leadSource: "Google (organic)", channel: "Google (organic)", attribution: { landing: "/services/outpatient-therapy/" } }, 0),
        mk("a2", "client", "New", "Sam T.", { formLabel: "Referral", service: "Intensive In-Home", leadSource: "School", channel: "Direct", contactName: "Ms. Lee", contactRole: "School", organization: "Chesterfield County Public Schools", marketingConsent: true, email: "lee@example.org", unread: true, fields: { best_time: "Afternoon" } }, 1),
        mk("a3", "client", "Contacted", "Maria R.", { service: "Mental Health Skill Building", leadSource: "Social worker", channel: "Direct", owner: "Tanya" }, 3),
        mk("a4", "client", "Intake scheduled", "Devon W.", { formLabel: "DD Day Support tour", service: "DD Day Support", leadSource: "Word of mouth", channel: "Social", fields: { days: ["Tuesday", "Thursday"], time: "Morning (9–11 AM)" }, location: "petersburg", nextFollowUp: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }, 6),
        mk("a5", "client", "Enrolled", "Ken P.", { service: "Outpatient Therapy", leadSource: "Doctor or clinician", channel: "AI assistant", owner: "Franko" }, 20),
        mk("b1", "provider", "New", "Lisa Grant", { service: "Sponsored Residential provider", leadSource: "Radio", channel: "Direct", marketingConsent: true, email: "lisa@example.org", fields: { city: "Petersburg", own_rent: "Own", household: "2", bedroom: "Yes", license: "Yes", bg_ok: "Yes", why: "I cared for my brother for years." } }, 2),
        mk("b2", "provider", "Training", "Robert Hill", { service: "Sponsored Residential provider", leadSource: "Google (organic)", channel: "Google (organic)" }, 12),
        mk("c1", "applicant", "Screening", "Alicia Brown", { service: "QMHP-C Counselor", leadSource: "Direct", channel: "Direct", email: "alicia@example.org", resumeKey: "resumes/c1/resume.pdf", fields: { availability: "Full time", credentials: "QMHP-C, CPR" } }, 4),
        mk("c2", "applicant", "Interview", "Marcus Lee", { service: "Direct Support Professional", leadSource: "Indeed", channel: "Referral site: indeed.com" }, 9),
      ], acts: {} };
      D.leads.forEach(function (l) { D.acts[l.id] = [{ kind: "created", by: "website", text: l.formLabel + " submitted", at: l.createdAt }]; });
      D.acts.a2.unshift({ kind: "sms_in", by: "text reply", text: "Afternoons after 3 work best, thanks!", at: t(0, 2) });
    }
    var ok = function (x) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(x))); }, 150); }); };
    var no = function (m) { return Promise.reject(new Error(m)); };
    var P = { client: ["New", "Contacted", "Intake scheduled", "Enrolled", "Not a fit"], provider: ["New", "Contacted", "Training", "Home study", "Approved", "Not a fit"], applicant: ["New", "Screening", "Interview", "Offer", "Hired", "Not a fit"] };
    var m = path.match(/^\/leads\/(\w+)(?:\/(\w+))?/), id = m && m[1], sub = m && m[2], lead = id && D.leads.find(function (l) { return l.id === id; });
    var log = function (kind, text) { var a = { kind: kind, by: "demo", text: text, at: new Date().toISOString() }; D.acts[id].unshift(a); return { activity: a }; };
    if (path === "/config") return ok({ pipelines: P, smsReady: true, emailReady: true, templates: { sms: [{ name: "Missed you", text: "Hi {first_name}, this is Family Transitions. We tried to reach you about your request. Call or text us back at (804) 745-5101 when it's a good time." }] } });
    if (path.indexOf("/leads?") === 0) { var p = path.split("=")[1]; return ok({ leads: D.leads.filter(function (l) { return l.pipeline === p; }) }); }
    if (path === "/leads" && method === "POST") { var nl = { id: "n" + Date.now().toString(36).slice(-6), pipeline: body.pipeline, status: P[body.pipeline][0], name: body.name, phone: body.phone, email: body.email, service: body.service, leadSource: body.leadSource || "Phone call", channel: "Phone / walk-in", formLabel: "Added by staff", smsConsent: body.smsConsent, createdAt: new Date().toISOString(), fields: {} }; D.leads.push(nl); D.acts[nl.id] = [{ kind: "created", by: "demo", text: "Added by staff", at: nl.createdAt }]; return ok({ lead: nl }); }
    if (lead && !sub && method === "GET") return ok({ lead: lead, activity: D.acts[id], smsOptedOut: false });
    if (lead && !sub && method === "PATCH") { if (body.status && body.status !== lead.status) log("status", lead.status + " → " + body.status); Object.assign(lead, body); return ok({ lead: lead }); }
    if (sub === "notes") return body.text.trim() ? ok(log("note", body.text)) : no("Note is empty.");
    if (sub === "sms") return body.text.trim() ? ok(log("sms_out", body.text.replace(/\{first_name\}/g, lead.name.split(" ")[0]))) : no("Message is empty.");
    if (sub === "email") return body.subject && body.text ? ok(log("email_out", body.subject + "\n\n" + body.text)) : no("Subject and message are required.");
    if (sub === "review") return ok(log("review", "Hi " + lead.name.split(" ")[0] + ", thank you for choosing Family Transitions. Would you share a quick review? https://g.page/r/…"));
    if (sub === "resume") return no("Demo mode: no real files.");
    if (path.indexOf("/reports") === 0) {
      var r = { total: D.leads.length, byPipeline: {}, byForm: {}, byChannel: {}, bySource: {}, byWeek: {}, statusByPipeline: {} }, won = { client: "Enrolled", provider: "Approved", applicant: "Hired" };
      for (var w = 12; w >= 0; w--) { var d = new Date(Date.now() - w * 7 * 864e5); d.setDate(d.getDate() - d.getDay()); r.byWeek[d.toISOString().slice(0, 10)] = [3, 5, 4, 6, 8, 5, 7, 9, 6, 10, 8, 11, 9][12 - w]; }
      r.total = Object.keys(r.byWeek).reduce(function (s, k) { return s + r.byWeek[k]; }, 0);
      r.byPipeline = { client: 71, provider: 14, applicant: 6 };
      r.bySource = { "Google (organic)": { leads: 31, won: 9 }, School: { leads: 14, won: 6 }, "Social worker": { leads: 12, won: 7 }, "Word of mouth": { leads: 11, won: 5 }, "Doctor or clinician": { leads: 9, won: 4 }, Radio: { leads: 6, won: 1 }, "AI assistant": { leads: 5, won: 2 }, "Probation officer": { leads: 3, won: 1 } };
      r.byChannel = { "Google (organic)": 38, Direct: 33, "AI assistant": 7, Social: 8, "Other search": 5 };
      r.byForm = { "Consultation request": 44, Referral: 22, "DD Day Support tour": 5, "Sponsored Residential provider": 14, "Job application": 6 };
      Object.keys(P).forEach(function (p) { r.statusByPipeline[p] = {}; P[p].forEach(function (s, i) { r.statusByPipeline[p][s] = Math.max(0, [9, 6, 4, 3, 1, 1][i] * (p === "client" ? 3 : 1)); }); });
      return ok(r);
    }
    if (path === "/campaigns") { var n = D.leads.filter(function (l) { return l.pipeline === body.pipeline && l.marketingConsent; }).length; return body.dryRun ? ok({ recipients: n }) : ok({ sent: n, failed: [] }); }
    if (path.indexOf("/export") === 0) return ok({ csv: "id,name,status\n" + D.leads.filter(function (l) { return l.pipeline === state.pipe; }).map(function (l) { return [l.id, l.name, l.status].join(","); }).join("\n") });
    return no("Not available in demo.");
  }
})();
