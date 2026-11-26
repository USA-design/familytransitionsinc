/* Family Transitions staff CRM (static page; all data comes from the AWS API after sign-in).
   Lead data is only ever inserted as text (never as HTML), so form input can't inject code. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var DEMO = new URLSearchParams(location.search).has("demo");
  var REDIRECT = location.origin + location.pathname;
  var IDLE_MS = 30 * 60 * 1000; // automatic sign-out after 30 idle minutes
  var cfg = {}, conf = null, state = { pipe: "client", leads: [], view: "today", open: null, thread: null };
  var PIPE_NAMES = { client: "Clients & referrals", provider: "Providers", applicant: "Applicants" };
  var WON = { client: "Enrolled", provider: "Approved", applicant: "Hired" };
  var PARTNER_TYPES = ["School", "Social worker / DSS", "Probation / court", "Doctor / clinic", "Community services board", "Hospital", "Faith community", "Other agency", "Other"];

  // ---------- tiny DOM helper (text only) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
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
  function banner(text) { var b = $("#banner"); b.textContent = text || ""; b.hidden = !text; if (text) setTimeout(function () { if (b.textContent === text && !/set up yet|Demo/.test(text)) b.hidden = true; }, 8000); }
  function pipes() { return Object.keys(conf.pipelines); }

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
  function fail(el) { return function (e) { if (el) clear(el).appendChild(h("p", { class: "err", text: e.message })); else banner(e.message); }; }

  // ---------- navigation ----------
  function showGate(msg) {
    $$(".view").forEach(function (v) { v.hidden = true; });
    $(".tabs").hidden = true; $(".me").hidden = true; $("#gate").hidden = false;
    if (msg) $("#gate-msg").textContent = msg;
  }
  var LOADERS = { today: loadToday, leads: loadLeads, inbox: loadInbox, partners: loadPartners, reports: loadReports, campaigns: setupCampaigns, team: loadTeam };
  function go(view, keepHash) {
    if (!LOADERS[view]) view = "today";
    state.view = view;
    $$(".tab").forEach(function (t) { t.classList.toggle("on", t.dataset.view === view); });
    $$(".view").forEach(function (v) { v.hidden = v.id !== "view-" + view; });
    if (!keepHash && !state.open) history.replaceState(null, "", location.pathname + location.search + "#" + view);
    LOADERS[view]();
  }
  function leadRow(l, right) {
    return h("button", { class: "rowlink", onclick: function () { openLead(l.id); } },
      h("span", {}, h("b", {}, l.name || "(no name)"), h("small", {}, [PIPE_NAMES[l.pipeline], l.service, l.leadSource].filter(Boolean).join(" · "))), right);
  }

  // ---------- today ----------
  function loadToday() {
    var root = clear($("#today")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/today" + ($("#mine").checked ? "?mine=1" : "")).then(function (t) {
      clear(root);
      $("#today-date").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      var card = function (title, list, cls, right, empty) {
        return h("div", { class: "tcard " + (list.length ? cls || "" : "") }, h("h3", {}, title, h("span", {}, String(list.length))),
          list.length ? list.slice(0, 25).map(function (l) { return leadRow(l, right(l)); }) : h("p", { class: "muted small", text: empty }));
      };
      root.append(
        card("New, not contacted yet", t.waiting, "hot", function (l) {
          var mins = (Date.now() - new Date(l.createdAt)) / 6e4; return h("span", { class: "age" + (mins > 60 ? " late" : "") }, ago(l.createdAt));
        }, "Everyone new has been contacted."),
        card("Follow-ups due", t.due, "", function (l) { return h("span", { class: "age" + (l.nextFollowUp < t.today ? " late" : "") }, l.nextFollowUp === t.today ? "Today" : new Date(l.nextFollowUp + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })); }, "No follow-ups due."),
        card("Unread texts", t.unread, "", function (l) { return h("span", { class: "age" }, l.lastSmsAt ? ago(l.lastSmsAt) : ""); }, "No unread texts."),
        card("Going quiet (no activity in 14+ days, no follow-up set)", t.stale, "", function (l) { return h("span", { class: "age" }, ago(l.updatedAt || l.createdAt)); }, "Nothing has gone quiet."));
      setUnread(t.unread.length);
    }).catch(fail(root));
  }
  function setUnread(n) { var b = $("#unread-n"); b.textContent = String(n); b.hidden = !n; }

  // ---------- leads board ----------
  function renderPipes() {
    var seg = clear($("#pipes"));
    if (pipes().indexOf(state.pipe) < 0) state.pipe = pipes()[0];
    pipes().forEach(function (p) {
      seg.appendChild(h("button", { role: "tab", class: p === state.pipe ? "on" : "", "aria-selected": p === state.pipe ? "true" : "false",
        onclick: function () { state.pipe = p; renderPipes(); loadLeads(); } }, PIPE_NAMES[p]));
    });
  }
  function loadLeads() {
    renderPipes();
    clear($("#board")).appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/leads?pipeline=" + state.pipe).then(function (o) { state.leads = o.leads; renderSources(); renderBoard(); }).catch(fail($("#board")));
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
    if (!conf.pipelines[state.pipe]) return;
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
          h("span", { class: "meta" }, (l.leadSource || "Unknown source") + " · " + ago(l.createdAt) + (l.owner ? " · " + l.owner.split("@")[0] : ""))));
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

  // ---------- drawer ----------
  function openDrawer(title) { $("#drawer").hidden = false; $("#d-name").textContent = title; return clear($("#d-body")); }
  function closeDrawer() {
    $("#drawer").hidden = true; state.open = null;
    history.replaceState(null, "", location.pathname + location.search + "#" + state.view);
  }

  // ---------- lead detail ----------
  function openLead(id) {
    state.open = id; history.replaceState(null, "", location.pathname + location.search + "#lead/" + id);
    var body = openDrawer("Loading…");
    api("GET", "/leads/" + id).then(renderLead).catch(function (e) { $("#d-name").textContent = "Lead"; body.appendChild(h("p", { class: "err", text: e.message })); });
  }
  function afterLeadChange() { if (state.view === "leads") renderBoard(); if (state.view === "today") loadToday(); }

  function renderLead(o) {
    var l = o.lead, body = clear($("#d-body")), statuses = (conf.pipelines[l.pipeline] || [l.status]);
    $("#d-name").textContent = l.name || "(no name)";
    if (l.unread) api("PATCH", "/leads/" + l.id, { unread: false }).then(function () { l.unread = false; afterLeadChange(); }).catch(function () {});
    var refresh = function () { return api("GET", "/leads/" + l.id).then(renderLead); };
    var save = function (patch) {
      return api("PATCH", "/leads/" + l.id, patch).then(function (r) {
        Object.assign(l, r.lead); var i = state.leads.findIndex(function (x) { return x.id === l.id; });
        if (i >= 0) state.leads[i] = Object.assign(state.leads[i], r.lead); afterLeadChange(); return refresh();
      }).catch(function (e) { banner(e.message); });
    };

    body.appendChild(h("div", { class: "contact" },
      l.phone ? h("a", { href: "tel:" + l.phone }, "📞 " + fmtPhone(l.phone)) : null,
      l.email ? h("a", { href: "mailto:" + l.email }, "✉ " + l.email) : null,
      l.lastSmsAt ? h("a", { href: "#inbox", onclick: function (e) { e.preventDefault(); state.thread = l.id; closeDrawer(); go("inbox"); } }, "💬 Texts") : null));
    body.appendChild(h("div", {},
      h("span", { class: "tag " + (l.smsConsent ? "ok" : "no") }, l.smsConsent ? "Texts OK" : "No text consent"),
      o.smsOptedOut ? h("span", { class: "tag no" }, "Replied STOP") : null,
      h("span", { class: "tag " + (l.marketingConsent ? "ok" : "") }, l.marketingConsent ? "Marketing opt-in" : "No marketing"),
      h("span", { class: "tag" }, PIPE_NAMES[l.pipeline] + " · " + l.formLabel)));

    var status = h("select", { onchange: function () { save({ status: status.value }); } }, statuses.map(function (s) { return h("option", { selected: s === l.status }, s); }));
    var owner = h("input", { value: l.owner || "", placeholder: "Who's following up?", onchange: function () { save({ owner: owner.value.trim() }); } });
    var loc = h("select", { onchange: function () { save({ location: loc.value }); } },
      [["", "Not set"], ["north-chesterfield", "North Chesterfield"], ["petersburg", "Petersburg"]].map(function (x) { return h("option", { value: x[0], selected: (l.location || "") === x[0] }, x[1]); }));
    var fup = h("input", { type: "date", value: l.nextFollowUp || "", onchange: function () { save({ nextFollowUp: fup.value }); } });
    var mine = h("button", { class: "link dark", type: "button", onclick: function () { save({ owner: conf.me.email }); } }, "Assign to me");
    body.appendChild(h("div", { class: "grid2" }, h("label", {}, h("span", {}, "Stage"), status), h("label", {}, h("span", {}, "Owner ", l.owner === conf.me.email ? null : mine), owner),
      h("label", {}, "Office", loc), h("label", {}, "Next follow-up", fup)));
    if (l.pipeline === "client") {
      var org = h("input", { value: l.organization || "", placeholder: "School, agency, practice…", onchange: function () { save({ organization: org.value.trim() }); } });
      body.appendChild(h("label", {}, "Referring organization (partner)", org));
    }

    var kv = h("dl", { class: "kv" });
    var add = function (k, v) { if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) { kv.appendChild(h("dt", {}, k)); kv.appendChild(h("dd", {}, Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : String(v))); } };
    add("Service", l.service); add("Referred by", l.contactName && [l.contactName, l.contactRole].filter(Boolean).join(", "));
    add("Heard about us", l.leadSource); add("Tracked channel", l.channel); add("Landing page", l.attribution && l.attribution.landing);
    add("Campaign", l.attribution && l.attribution.utm_campaign); add("Received", when(l.createdAt));
    add("First contact", l.lastContactAt && when(l.lastContactAt));
    var LABELS = { for_whom: "Quiz: who needs help", need: "Quiz: what would help", best_time: "Best time to call", own_rent: "Own or rent", household: "People in home", bedroom: "Private bedroom",
      license: "Driver's license", bg_ok: "Background check OK", experience: "Experience", why: "Why interested", days: "Tour days", time: "Tour time", availability: "Availability", credentials: "Credentials", city: "City", zip: "ZIP", position: "Position" };
    Object.keys(LABELS).forEach(function (k) { if (l.fields) add(LABELS[k], l.fields[k]); });
    body.appendChild(h("div", { class: "box" }, h("h3", {}, "Details"), kv,
      l.resumeKey ? h("button", { class: "btn line", onclick: function () { api("GET", "/leads/" + l.id + "/resume").then(function (r) { location.href = r.url; }).catch(fail()); } }, "Download resume") : null));

    // sequences
    var seqBox = h("div", { class: "box" }, h("h3", {}, "Sequences"));
    (o.enrollments || []).forEach(function (en) {
      seqBox.appendChild(h("div", { class: "actions" }, h("span", { class: "grow" }, en.seqName + " · ",
        h("span", { class: "tag " + (en.status === "active" ? "ok" : "") }, en.status === "active" ? "step " + (en.step + 1) + ", next " + when(en.nextAt) : en.status + (en.stopReason ? ": " + en.stopReason : ""))),
        en.status === "active" ? h("button", { class: "btn line", onclick: function () { api("POST", "/leads/" + l.id + "/sequence", { seqId: en.seqId, stop: true }).then(refresh).catch(fail()); } }, "Stop") : null));
    });
    var avail = (conf.sequences || []).filter(function (s) { return s.pipeline === l.pipeline && s.active; });
    if (avail.length) {
      var pick = h("select", {}, avail.map(function (s) { return h("option", { value: s.id }, s.name + (s.kind === "marketing" ? " (marketing)" : "")); }));
      seqBox.appendChild(h("div", { class: "actions" }, pick, h("button", { class: "btn", onclick: function () { api("POST", "/leads/" + l.id + "/sequence", { seqId: pick.value }).then(refresh).catch(fail()); } }, "Start")));
    } else seqBox.appendChild(h("p", { class: "muted small", text: "No active sequences for " + PIPE_NAMES[l.pipeline] + ". Admins can turn some on under Campaigns." }));
    body.appendChild(seqBox);

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
        var st = h("textarea", { rows: "3", maxlength: "640", placeholder: "Message" });
        var tpl = h("select", { onchange: function () { st.value = tpl.value; } }, h("option", { value: "" }, "Templates…"), conf.templates.sms.map(function (x) { return h("option", { value: x.text }, x.name); }));
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

    var KIND = { created: "Lead created", note: "Note", status: "Stage changed", owner: "Assigned", sms_out: "Text sent", sms_in: "Text received", email_out: "Email sent",
      review: "Review request", campaign: "Campaign", unsubscribe: "Unsubscribed", sequence: "Sequence", missed_call: "Missed call" };
    body.appendChild(h("div", { class: "box" }, h("h3", {}, "Activity"), h("ul", { class: "timeline" }, o.activity.map(function (a) {
      return h("li", { class: a.kind }, h("div", { class: "when" }, (KIND[a.kind] || a.kind) + " · " + a.by + " · " + when(a.at)), h("div", { class: "txt" }, a.text));
    }))));
  }

  // ---------- inbox ----------
  function loadInbox() {
    var list = clear($("#threads")); list.appendChild(h("p", { class: "muted pad", text: "Loading…" }));
    api("GET", "/inbox").then(function (o) {
      clear(list);
      setUnread(o.threads.filter(function (t) { return t.unread; }).length);
      if (!o.threads.length) list.appendChild(h("p", { class: "muted pad", text: "No text conversations yet." }));
      if (!state.thread && o.threads[0]) state.thread = o.threads[0].id;
      o.threads.forEach(function (t) {
        list.appendChild(h("button", { class: "th" + (t.unread ? " unread" : "") + (state.thread === t.id ? " on" : ""), onclick: function () { state.thread = t.id; loadInbox(); } },
          h("div", { class: "top1" }, h("b", {}, t.unread ? "● " : "", t.name || fmtPhone(t.phone)), h("span", { class: "when" }, ago(t.lastSmsAt))),
          h("div", { class: "pv" }, (t.lastSmsDir === "out" ? "You: " : "") + (t.lastSmsText || ""))));
      });
      if (state.thread) openThread(state.thread);
    }).catch(fail(list));
  }
  function openThread(id) {
    var pane = clear($("#thread"));
    api("GET", "/leads/" + id).then(function (o) {
      var l = o.lead;
      if (l.unread) api("PATCH", "/leads/" + id, { unread: false }).then(function () { var el = $(".th.on"); if (el) el.classList.remove("unread"); }).catch(function () {});
      pane.appendChild(h("div", { class: "thread-h" }, h("div", {}, h("b", {}, l.name), h("div", { class: "muted small" }, fmtPhone(l.phone) + " · " + PIPE_NAMES[l.pipeline] + " · " + l.status)),
        h("button", { class: "btn line", onclick: function () { openLead(id); } }, "Open lead")));
      var msgs = h("div", { class: "msgs" });
      o.activity.slice().reverse().forEach(function (a) {
        if (a.kind === "sms_in") msgs.appendChild(h("div", { class: "msg in" }, a.text, h("span", { class: "t" }, when(a.at))));
        else if (a.kind === "sms_out" || (a.sid && /campaign|sequence|review/.test(a.kind))) msgs.appendChild(h("div", { class: "msg out" }, a.text, h("span", { class: "t" }, a.by + " · " + when(a.at))));
        else if (a.kind === "missed_call") msgs.appendChild(h("div", { class: "msg sys" }, "📞 Missed call · " + when(a.at)));
      });
      pane.appendChild(msgs);
      var err = h("p", { class: "err pad" });
      if (!conf.smsReady) pane.appendChild(h("p", { class: "muted pad", text: "Texting turns on once the Twilio account is connected." }));
      else if (o.smsOptedOut) pane.appendChild(h("p", { class: "muted pad", text: "This number replied STOP. They need to text START before you can text them again." }));
      else if (!l.smsConsent) pane.appendChild(h("p", { class: "muted pad", text: "No text consent yet (missed call). Call them back, or wait for them to reply to the automatic text." }));
      else {
        var ta = h("textarea", { rows: "2", maxlength: "640", placeholder: "Reply… (no health details)" });
        var send = function () { if (!ta.value.trim()) return; ta.disabled = true;
          api("POST", "/leads/" + id + "/sms", { text: ta.value }).then(function () { loadInbox(); }).catch(function (e) { err.textContent = e.message; ta.disabled = false; }); };
        ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
        pane.append(h("div", { class: "reply" }, ta, h("button", { class: "btn", onclick: send }, "Send")), err);
        setTimeout(function () { ta.focus(); }, 0);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }).catch(fail(pane));
  }

  // ---------- partners ----------
  var partnerCache = [];
  function loadPartners() {
    var root = clear($("#partners")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/partners").then(function (o) { partnerCache = o.partners; renderPartners(); }).catch(fail(root));
  }
  function renderPartners() {
    var root = clear($("#partners")), q = $("#pq").value.trim().toLowerCase();
    var list = partnerCache.filter(function (p) { return !q || (p.name + " " + (p.type || "") + " " + p.contacts.map(function (c) { return c.name; }).join(" ")).toLowerCase().indexOf(q) >= 0; });
    if (!list.length) { root.appendChild(h("p", { class: "muted", text: partnerCache.length ? "No matches." : "No partners yet. They appear automatically when a referral names an organization, or add one for outreach." })); return; }
    root.appendChild(h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Partner"), h("th", {}, "Type"), h("th", { class: "n" }, "Referrals"), h("th", { class: "n" }, "Enrolled"), h("th", {}, "Last referral"), h("th", {}, "Contacts"))),
      h("tbody", {}, list.map(function (p) {
        return h("tr", { class: "click", onclick: function () { openPartner(p.key); } }, h("td", {}, h("b", {}, p.name)), h("td", {}, p.type || "—"), h("td", { class: "n" }, String(p.referrals)),
          h("td", { class: "n" }, String(p.enrolled)), h("td", {}, p.lastReferralAt ? ago(p.lastReferralAt) : "—"), h("td", {}, p.contacts.map(function (c) { return c.name; }).join(", ") || "—"));
      }))));
  }
  function openPartner(key) {
    var body = openDrawer("Loading…");
    var p0 = partnerCache.find(function (x) { return x.key === key; }) || { contacts: [] };
    var load = key === "new" ? Promise.resolve({ partner: { key: "new", name: "" }, leads: [] }) : api("GET", "/partners/" + encodeURIComponent(key));
    load.then(function (o) {
      var p = o.partner; $("#d-name").textContent = p.name || "New partner";
      var f = { name: h("input", { value: p.name || "" }), type: h("select", {}, h("option", { value: "" }, "Choose…"), PARTNER_TYPES.map(function (t) { return h("option", { selected: t === p.type }, t); })),
        phone: h("input", { value: p.phone ? fmtPhone(p.phone) : "", type: "tel" }), email: h("input", { value: p.email || "", type: "email" }),
        owner: h("input", { value: p.owner || "", placeholder: "Who keeps in touch?" }), notes: h("textarea", { rows: "4", placeholder: "Relationship notes, best contact, last visit…" }) };
      f.notes.value = p.notes || "";
      var err = h("p", { class: "err" });
      body.append(h("div", { class: "box" }, h("label", {}, "Name", f.name), h("div", { class: "grid2" }, h("label", {}, "Type", f.type), h("label", {}, "Relationship owner", f.owner),
        h("label", {}, "Main phone", f.phone), h("label", {}, "Main email", f.email)), h("label", {}, "Notes", f.notes),
        h("div", { class: "actions" }, h("span", { class: "grow" }), h("button", { class: "btn", onclick: function () {
          api("PUT", "/partners/" + encodeURIComponent(key), { name: f.name.value, type: f.type.value, phone: f.phone.value, email: f.email.value, owner: f.owner.value, notes: f.notes.value })
            .then(function (r) { closeDrawer(); loadPartners(); banner("Saved " + r.partner.name + "."); }).catch(function (e) { err.textContent = e.message; }); } }, "Save")), err));
      if (p0.contacts.length) body.appendChild(h("div", { class: "box" }, h("h3", {}, "People who referred"), h("ul", { class: "timeline" }, p0.contacts.map(function (c) {
        return h("li", {}, h("b", {}, c.name), c.role ? " · " + c.role : "", h("div", { class: "muted small" }, [c.phone && fmtPhone(c.phone), c.email].filter(Boolean).join(" · ")));
      }))));
      if (o.leads.length) body.appendChild(h("div", { class: "box" }, h("h3", {}, "Referrals (" + o.leads.length + ")"), o.leads.map(function (l) { return leadRow(l, h("span", { class: "tag " + (l.status === "Enrolled" ? "ok" : "") }, l.status)); })));
    }).catch(fail(body));
  }

  // ---------- reports ----------
  function loadReports() {
    var root = clear($("#reports")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/reports?days=" + $("#days").value).then(function (r) {
      clear(root);
      var m = r.medianMinutesToContact;
      root.appendChild(h("div", { class: "kpis" },
        h("div", { class: "kpi" }, h("b", {}, String(r.total)), h("span", {}, "New leads")),
        h("div", { class: "kpi" }, h("b", {}, m == null ? "—" : m < 60 ? m + "m" : Math.round(m / 60) + "h"), h("span", {}, "Median time to first contact")),
        Object.keys(r.statusByPipeline).map(function (p) {
          var sp = r.statusByPipeline[p] || {}, n = r.byPipeline[p] || 0;
          return h("div", { class: "kpi" }, h("b", {}, String(n)), h("span", {}, PIPE_NAMES[p] + " · " + (sp[WON[p]] || 0) + " " + WON[p].toLowerCase()));
        })));
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
          var x = r.bySource[s], mt = h("i"); mt.style.width = (x.leads / smax * 100) + "%";
          return h("tr", {}, h("td", {}, s), h("td", { class: "n" }, String(x.leads)), h("td", {}, h("div", { class: "meter" }, mt)), h("td", { class: "n" }, String(x.won)), h("td", { class: "n" }, Math.round(x.won / x.leads * 100) + "%"));
        })));
      var table = function (title, obj) {
        var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
        return h("div", { class: "panel" }, h("h3", {}, title), h("table", { class: "t" }, h("tbody", {}, keys.map(function (k) { return h("tr", {}, h("td", {}, k), h("td", { class: "n" }, String(obj[k]))); }))));
      };
      root.appendChild(h("div", { class: "rgrid" },
        h("div", { class: "panel" }, h("h3", {}, "Leads per week"), chart, axis),
        h("div", { class: "panel" }, h("h3", {}, "Lead sources"), srcTable),
        table("Tracked channel (website visits)", r.byChannel), table("By form", r.byForm),
        Object.keys(r.statusByPipeline).map(function (p) { return table(PIPE_NAMES[p] + " by stage", r.statusByPipeline[p]); })));
    }).catch(fail(root));
  }

  // ---------- campaigns: sequences + one-time ----------
  var camp = { confirm: false, ready: false };
  function setupCampaigns() {
    if (!camp.ready) {
      camp.ready = true;
      $$("#campseg button").forEach(function (b) { b.addEventListener("click", function () {
        $$("#campseg button").forEach(function (x) { x.classList.toggle("on", x === b); });
        $("#camp-seqs").hidden = b.dataset.c !== "seqs"; $("#camp-once").hidden = b.dataset.c !== "once";
      }); });
      var pipe = $("#c-pipe");
      [["client", "Referral partners (opted in)"], ["provider", "Provider prospects (opted in)"], ["applicant", "Job applicants (opted in)"]].forEach(function (x) { pipe.appendChild(h("option", { value: x[0] }, x[1])); });
      pipe.addEventListener("change", function () { renderStatuses(); resetSend(); });
      $("#c-channel").addEventListener("change", function () { $("#c-subject-wrap").hidden = $("#c-channel").value === "sms"; resetSend(); });
      $("#c-send").addEventListener("click", sendCampaign);
      ["#c-text", "#c-subject"].forEach(function (s) { $(s).addEventListener("input", resetSend); });
      $("#newseq").addEventListener("click", function () { editSequence(null); });
      $("#starters").addEventListener("click", function () { api("POST", "/sequences", { starters: true }).then(function () { loadSequences(); banner("Added 2 starter sequences (turned off). Review and turn them on."); }).catch(fail()); });
      renderStatuses();
    }
    loadSequences();
  }
  function loadSequences() {
    var root = clear($("#seqs")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/sequences").then(function (o) {
      clear(root);
      conf.sequences = o.sequences.map(function (s) { return { id: s.id, name: s.name, pipeline: s.pipeline, active: s.active, kind: s.kind }; });
      if (!o.sequences.length) root.appendChild(h("p", { class: "muted", text: "No sequences yet. Start with the starter sequences or create your own." }));
      o.sequences.forEach(function (s) {
        root.appendChild(h("div", { class: "seq" },
          h("div", { class: "actions" }, h("h3", { class: "grow" }, s.name), h("span", { class: "tag " + (s.active ? "ok" : "") }, s.active ? "On" : "Off")),
          h("div", { class: "muted small" }, PIPE_NAMES[s.pipeline] + " · " + (s.kind === "marketing" ? "Marketing (opt-in only)" : "Follow-up") + (s.autoForms.length ? " · starts automatically on new " + s.autoForms.map(function (f) { return FORM_NAMES[f] || f; }).join(", ") + " leads" : " · started by staff")),
          h("ol", {}, s.steps.map(function (st) { return h("li", {}, "Day " + st.day + " · " + (st.channel === "sms" ? "Text" : "Email: " + st.subject)); })),
          h("div", { class: "actions" }, h("span", { class: "grow" }),
            h("button", { class: "btn line", onclick: function () { api("PUT", "/sequences/" + s.id, Object.assign({}, s, { active: !s.active })).then(loadSequences).catch(fail()); } }, s.active ? "Turn off" : "Turn on"),
            h("button", { class: "btn", onclick: function () { editSequence(s); } }, "Edit"))));
      });
    }).catch(fail(root));
  }
  var FORM_NAMES = { consult: "Consultation", referral: "Referral", tour: "DD tour", quiz: "Service quiz", provider: "Provider interest", careers: "Job application" };
  var FORM_PIPE = { consult: "client", referral: "client", tour: "client", quiz: "client", provider: "provider", careers: "applicant" };
  function editSequence(s) {
    s = s || { name: "", pipeline: "provider", kind: "follow-up", autoForms: [], active: false, steps: [{ day: 0, channel: "email", subject: "", text: "" }] };
    var body = openDrawer(s.id ? "Edit sequence" : "New sequence"), err = h("p", { class: "err" });
    var name = h("input", { value: s.name }), pipe = h("select", {}, Object.keys(PIPE_NAMES).map(function (p) { return h("option", { value: p, selected: p === s.pipeline }, PIPE_NAMES[p]); }));
    var kind = h("select", {}, h("option", { value: "follow-up", selected: s.kind !== "marketing" }, "Follow-up (about their own inquiry)"), h("option", { value: "marketing", selected: s.kind === "marketing" }, "Marketing (opt-in only, unsubscribe link)"));
    var autos = h("div", { class: "checks" }), steps = h("div", { class: "box" }, h("h3", {}, "Steps"));
    var drawAutos = function () { clear(autos); Object.keys(FORM_NAMES).filter(function (f) { return FORM_PIPE[f] === pipe.value; }).forEach(function (f) {
      autos.appendChild(h("label", { class: "check" }, h("input", { type: "checkbox", value: f, checked: s.autoForms.indexOf(f) >= 0 }), FORM_NAMES[f])); }); };
    pipe.addEventListener("change", drawAutos); drawAutos();
    var rows = [];
    var addBtn = h("button", { class: "btn line", type: "button", onclick: function () { addStep({ day: rows.length ? Number(rows[rows.length - 1].get().day) + 3 : 0, channel: "email" }); } }, "+ Add step");
    var addStep = function (st) {
      var day = h("input", { type: "number", min: "0", max: "365", value: String(st.day) }), ch = h("select", {}, h("option", { value: "email", selected: st.channel === "email" }, "Email"), h("option", { value: "sms", selected: st.channel === "sms" }, "Text"));
      var subj = h("input", { value: st.subject || "", placeholder: "Email subject" }), text = h("textarea", { rows: "4", placeholder: "Hi {first_name}," }); text.value = st.text || "";
      var subjWrap = h("label", {}, "Subject", subj);
      var row = h("div", { class: "step" }, h("div", { class: "row3" }, h("label", {}, "Day", day), h("label", {}, "Send by", ch), subjWrap), text,
        h("div", { class: "actions" }, h("span", { class: "grow" }), h("button", { class: "link dark", type: "button", onclick: function () { row.remove(); rows = rows.filter(function (r) { return r.row !== row; }); } }, "Remove step")));
      var sync = function () { subjWrap.hidden = ch.value === "sms"; }; ch.addEventListener("change", sync); sync();
      rows.push({ row: row, get: function () { return { day: day.value, channel: ch.value, subject: subj.value, text: text.value }; } });
      steps.insertBefore(row, addBtn);
    };
    steps.appendChild(addBtn); s.steps.forEach(addStep);
    var active = h("input", { type: "checkbox", checked: s.active });
    body.append(h("div", { class: "box" }, h("label", {}, "Name", name), h("div", { class: "grid2" }, h("label", {}, "Pipeline", pipe), h("label", {}, "Type", kind)),
      h("fieldset", {}, h("legend", {}, "Start automatically when these forms come in"), autos), h("label", { class: "check" }, active, "Sequence is on")),
      h("p", { class: "muted small", text: "Personalize with {first_name}. Texts get \"Reply STOP to opt out.\" added. It stops on its own when the person replies, their stage changes, or they opt out. Keep health details out of messages." }),
      steps, err,
      h("div", { class: "actions" }, s.id ? h("button", { class: "btn line", onclick: function () { api("DELETE", "/sequences/" + s.id).then(function () { closeDrawer(); loadSequences(); }).catch(function (e) { err.textContent = e.message; }); } }, "Delete") : null,
        h("span", { class: "grow" }), h("button", { class: "btn", onclick: function () {
          var payload = { name: name.value, pipeline: pipe.value, kind: kind.value, active: active.checked,
            autoForms: Array.prototype.map.call(autos.querySelectorAll("input:checked"), function (i) { return i.value; }), steps: rows.map(function (r) { return r.get(); }) };
          (s.id ? api("PUT", "/sequences/" + s.id, payload) : api("POST", "/sequences", payload)).then(function () { closeDrawer(); loadSequences(); }).catch(function (e) { err.textContent = e.message; });
        } }, "Save sequence")));
  }
  function renderStatuses() {
    var box = clear($("#c-statuses"));
    (conf.pipelines[$("#c-pipe").value] || []).forEach(function (s) {
      box.appendChild(h("label", { class: "check" }, h("input", { type: "checkbox", value: s, checked: s !== "Not a fit", onchange: resetSend }), s));
    });
  }
  function resetSend() { camp.confirm = false; $("#c-send").textContent = "Check recipients"; $("#c-send").classList.remove("danger"); $("#c-count").textContent = ""; }
  function campBody(dry) {
    return { channel: $("#c-channel").value, pipeline: $("#c-pipe").value, subject: $("#c-subject").value, text: $("#c-text").value, dryRun: dry,
      statuses: $$("#c-statuses input:checked").map(function (i) { return i.value; }) };
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

  // ---------- team, import, audit ----------
  function loadTeam() {
    var root = clear($("#team")); root.appendChild(h("p", { class: "muted", text: "Loading…" }));
    api("GET", "/team").then(function (o) {
      clear(root);
      root.appendChild(h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Person"), h("th", {}, "Role"), h("th", {}, "Status"), h("th", {}, ""))),
        h("tbody", {}, o.users.map(function (x) {
          var always = o.admins.indexOf(String(x.email).toLowerCase()) >= 0;
          var role = h("select", { disabled: always, onchange: function () { api("PATCH", "/team/" + encodeURIComponent(x.username), { role: role.value }).then(function () { banner("Role updated. It applies at their next sign-in."); }).catch(fail()); } },
            h("option", { value: "" }, "No access"), Object.keys(conf.roles).map(function (r) { return h("option", { value: r, selected: always ? r === "admin" : x.groups.indexOf(r) >= 0 }, conf.roles[r].label); }));
          return h("tr", {}, h("td", {}, x.email, always ? h("div", { class: "muted small" }, "Always admin (deploy setting)") : null), h("td", {}, role),
            h("td", {}, x.enabled ? (x.status === "FORCE_CHANGE_PASSWORD" ? "Invited" : "Active") : "Disabled"),
            h("td", {}, x.email === conf.me.email ? null : h("button", { class: "link dark", onclick: function () { api("PATCH", "/team/" + encodeURIComponent(x.username), { enabled: !x.enabled }).then(loadTeam).catch(fail()); } }, x.enabled ? "Disable" : "Enable")));
        }))));
    }).catch(fail(root));
    if (!$("#aud-date").value) $("#aud-date").value = new Date().toISOString().slice(0, 10);
    loadAudit();
  }
  function loadAudit() {
    var root = clear($("#audit"));
    api("GET", "/audit?date=" + $("#aud-date").value).then(function (o) {
      if (!o.entries.length) { root.appendChild(h("p", { class: "muted", text: "No activity that day." })); return; }
      root.appendChild(h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Time"), h("th", {}, "Who"), h("th", {}, "Action"), h("th", {}, "Record"), h("th", {}, "Detail"))),
        h("tbody", {}, o.entries.slice(0, 300).map(function (a) {
          return h("tr", {}, h("td", {}, new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })), h("td", {}, a.user), h("td", {}, a.action),
            h("td", {}, a.leadId ? h("a", { href: "#lead/" + a.leadId, onclick: function (e) { e.preventDefault(); openLead(a.leadId); } }, a.leadId) : "—"), h("td", {}, a.detail || ""));
        }))));
    }).catch(fail(root));
  }
  // CSV import (HubSpot export columns are mapped automatically)
  var importRows = [];
  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function mapRows(rows) {
    var head = rows[0].map(function (x) { return x.replace(/^﻿/, "").trim().toLowerCase(); });
    var col = function () { for (var i = 0; i < arguments.length; i++) { var j = head.indexOf(arguments[i]); if (j >= 0) return j; } return -1; };
    var c = { first: col("first name", "firstname"), last: col("last name", "lastname"), name: col("name", "full name", "contact name"), email: col("email", "email address"),
      phone: col("phone number", "mobile phone number", "phone", "mobile"), source: col("original source", "lead source", "source"), created: col("create date", "created", "createdate"),
      org: col("company name", "company", "organization"), notes: col("notes", "message"), service: col("service", "service of interest") };
    return rows.slice(1).map(function (r) {
      var g = function (i) { return i >= 0 ? String(r[i] || "").trim() : ""; };
      return { name: g(c.name) || [g(c.first), g(c.last)].filter(Boolean).join(" "), email: g(c.email), phone: g(c.phone), leadSource: g(c.source) || "HubSpot",
        createdAt: g(c.created), organization: g(c.org), notes: g(c.notes), service: g(c.service) };
    });
  }

  // ---------- wiring ----------
  $("#signin").addEventListener("click", signIn);
  $("#signout").addEventListener("click", function () { signOut(false); });
  $("#d-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  $$(".tab").forEach(function (t) { t.addEventListener("click", function () { go(t.dataset.view); }); });
  $("#q").addEventListener("input", renderBoard); $("#src").addEventListener("change", renderBoard);
  $("#pq").addEventListener("input", renderPartners);
  $("#addpartner").addEventListener("click", function () { openPartner("new"); });
  $("#mine").addEventListener("change", loadToday);
  $("#days").addEventListener("change", loadReports);
  $("#aud-date").addEventListener("change", loadAudit);
  $("#export").addEventListener("click", function () {
    api("GET", "/export?pipeline=" + state.pipe).then(function (r) {
      var a = h("a", { href: URL.createObjectURL(new Blob([r.csv], { type: "text/csv" })), download: "fti-" + state.pipe + "-leads.csv" }); document.body.appendChild(a); a.click(); a.remove();
    }).catch(fail());
  });
  $("#add").addEventListener("click", function () {
    var sel = clear($("#add-pipe")); pipes().forEach(function (p) { sel.appendChild(h("option", { value: p }, PIPE_NAMES[p])); });
    $("#addform").reset(); sel.value = state.pipe; $("#addlg").showModal();
  });
  $("#addlg").addEventListener("close", function () {
    if ($("#addlg").returnValue !== "ok") return;
    var f = new FormData($("#addform")), b = {}; f.forEach(function (v, k) { b[k] = v; }); b.smsConsent = !!b.smsConsent;
    api("POST", "/leads", b).then(function (r) { state.pipe = r.lead.pipeline; go("leads"); openLead(r.lead.id); }).catch(fail());
  });
  $("#invite").addEventListener("submit", function (e) {
    e.preventDefault(); var f = new FormData(e.target);
    api("POST", "/team", { email: f.get("email"), role: f.get("role") }).then(function () { e.target.reset(); banner("Invitation sent."); loadTeam(); }).catch(fail());
  });
  $("#csv").addEventListener("change", function () {
    var file = $("#csv").files[0]; importRows = []; $("#imp-go").disabled = true;
    if (!file) return;
    file.text().then(function (t) {
      var rows = parseCSV(t); if (rows.length < 2) throw new Error("That file has no rows.");
      importRows = mapRows(rows).filter(function (r) { return r.name; });
      var usable = importRows.filter(function (r) { return r.phone || r.email; }).length;
      $("#imp-preview").textContent = importRows.length + " contacts found, " + usable + " with a phone or email. First: " + (importRows[0] ? importRows[0].name : "—");
      $("#imp-go").disabled = !usable;
    }).catch(function (e) { $("#imp-preview").textContent = e.message; });
  });
  $("#imp-go").addEventListener("click", function () {
    var total = { created: 0, skipped: 0 }, rows = importRows.slice(), mkt = $("#imp-mkt").checked;
    $("#imp-go").disabled = true;
    (function next() {
      if (!rows.length) { $("#imp-preview").textContent = "Done: " + total.created + " imported, " + total.skipped + " skipped (duplicates or no contact info)."; return; }
      var batch = rows.splice(0, 100).map(function (r) { return Object.assign({}, r, { marketingConsent: mkt }); });
      $("#imp-preview").textContent = "Importing… " + total.created + " so far";
      api("POST", "/import", { pipeline: $("#imp-pipe").value, label: "HubSpot import", rows: batch })
        .then(function (r) { total.created += r.created; total.skipped += r.skipped; next(); }).catch(function (e) { $("#imp-preview").textContent = e.message; });
    })();
  });
  window.addEventListener("hashchange", function () {
    var m = location.hash.match(/^#lead\/(\w+)/);
    if (m) { if (state.open !== m[1]) openLead(m[1]); return; }
    var v = location.hash.replace("#", "");
    if (LOADERS[v] && v !== state.view) go(v, true);
  });

  function start() {
    $("#gate").hidden = true; $(".tabs").hidden = false; $(".me").hidden = false;
    api("GET", "/config").then(function (c) {
      conf = c;
      $("#who").textContent = DEMO ? "Demo (sample data)" : c.me.email;
      if (!c.me.pipelines.length) { showGate("Your account doesn't have a role yet. Ask an admin to give you access on the Team page."); $("#signin").hidden = true; return; }
      $$("[data-admin]").forEach(function (el) { el.hidden = !c.me.isAdmin; });
      $$("[data-needs]").forEach(function (el) { el.hidden = c.me.pipelines.indexOf(el.dataset.needs) < 0; });
      if (DEMO) banner("Demo mode: sample data only, nothing is saved or sent.");
      else if (!c.smsReady || !c.emailReady) banner([!c.emailReady && "Email sending isn't set up yet.", !c.smsReady && "Texting isn't set up yet (Twilio)."].filter(Boolean).join(" "));
      var m = location.hash.match(/^#lead\/(\w+)/), v = location.hash.replace("#", "");
      go(LOADERS[v] ? v : "today", true); idle();
      if (m) openLead(m[1]);
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
    var P = { client: ["New", "Contacted", "Intake scheduled", "Enrolled", "Not a fit"], provider: ["New", "Contacted", "Training", "Home study", "Approved", "Not a fit"], applicant: ["New", "Screening", "Interview", "Offer", "Hired", "Not a fit"] };
    var t = function (d, hrs) { return new Date(Date.now() - (d * 24 + (hrs || 0)) * 36e5).toISOString(); };
    if (!D) {
      var day = function (n) { return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10); };
      var mk = function (id, pipeline, status, name, extra, d, hrs) {
        return Object.assign({ id: id, pipeline: pipeline, status: status, name: name, createdAt: t(d, hrs == null ? 3 : hrs), updatedAt: t(d), smsConsent: true, contactConsent: true, phone: "+1804555" + String(1000 + d * 37 + id.charCodeAt(1)).slice(-4),
          formLabel: pipeline === "client" ? "Consultation request" : pipeline === "provider" ? "Sponsored Residential provider" : "Job application", fields: {}, attribution: { landing: "/" } }, extra);
      };
      D = { leads: [
        mk("a1", "client", "New", "Jane S.", { service: "Outpatient Therapy", leadSource: "Google (organic)", channel: "Google (organic)" }, 0, 2),
        mk("a2", "client", "New", "Sam T.", { formLabel: "Referral", service: "Intensive In-Home", leadSource: "School", channel: "Direct", contactName: "Ms. Lee", contactRole: "School", organization: "Chesterfield County Public Schools", partnerKey: "chesterfield-county-public-schools", marketingConsent: true, email: "lee@example.org", unread: true, lastSmsAt: t(0, 1), lastSmsText: "Afternoons after 3 work best, thanks!", lastSmsDir: "in", fields: { best_time: "Afternoon" } }, 1),
        mk("a3", "client", "Contacted", "Maria R.", { service: "Mental Health Skill Building", leadSource: "Social worker", channel: "Direct", owner: "tanya@familytransitionsinc.com", lastContactAt: t(3, 1), nextFollowUp: day(0) }, 3),
        mk("a4", "client", "Intake scheduled", "Devon W.", { formLabel: "DD Day Support tour", service: "DD Day Support", leadSource: "Word of mouth", channel: "Social", fields: { days: ["Tuesday", "Thursday"], time: "Morning (9–11 AM)" }, location: "petersburg", nextFollowUp: day(-1), lastContactAt: t(5) }, 6),
        mk("a5", "client", "Enrolled", "Ken P.", { service: "Outpatient Therapy", leadSource: "Doctor or clinician", channel: "AI assistant", owner: "franko", lastContactAt: t(19) }, 20),
        mk("a6", "client", "New", "Caller (804) 555-2211", { formLabel: "Missed call", form: "call", leadSource: "Phone call", channel: "Phone call (missed)", smsConsent: false, unread: true, lastSmsAt: t(0, 0.2), lastSmsText: "Hi, this is Family Transitions. Sorry we missed your call!", lastSmsDir: "out" }, 0, 0.3),
        mk("a7", "client", "Contacted", "Lia M.", { formLabel: "Referral", service: "Intensive In-Home", leadSource: "Probation officer", contactName: "Officer Diaz", contactRole: "Probation officer", organization: "Chesterfield Juvenile Probation", partnerKey: "chesterfield-juvenile-probation", lastContactAt: t(20) }, 21),
        mk("a8", "client", "Enrolled", "Ty B.", { formLabel: "Referral", service: "Intensive In-Home", leadSource: "Probation officer", contactName: "Officer Diaz", contactRole: "Probation officer", organization: "Chesterfield Juvenile Probation", partnerKey: "chesterfield-juvenile-probation", lastContactAt: t(40) }, 41),
        mk("b1", "provider", "New", "Lisa Grant", { service: "Sponsored Residential provider", leadSource: "Radio", channel: "Direct", marketingConsent: true, email: "lisa@example.org", fields: { city: "Petersburg", own_rent: "Own", household: "2", bedroom: "Yes", license: "Yes", bg_ok: "Yes", why: "I cared for my brother for years." } }, 2),
        mk("b2", "provider", "Training", "Robert Hill", { service: "Sponsored Residential provider", leadSource: "Google (organic)", channel: "Google (organic)", lastContactAt: t(10) }, 25),
        mk("c1", "applicant", "Screening", "Alicia Brown", { service: "QMHP-C Counselor", leadSource: "Direct", channel: "Direct", email: "alicia@example.org", resumeKey: "resumes/c1/resume.pdf", fields: { availability: "Full time", credentials: "QMHP-C, CPR" }, lastContactAt: t(3) }, 4),
        mk("c2", "applicant", "Interview", "Marcus Lee", { service: "Direct Support Professional", leadSource: "Indeed", channel: "Referral site: indeed.com", lastContactAt: t(8) }, 9),
      ], acts: {}, enr: {}, partners: { "chesterfield-county-public-schools": { name: "Chesterfield County Public Schools", type: "School", owner: "Franko", notes: "Counselor team at Manchester HS." } },
        seqs: [{ id: "s1", name: "Provider recruitment follow-up", pipeline: "provider", kind: "follow-up", autoForms: ["provider"], active: true, steps: [
          { day: 0, channel: "email", subject: "Thanks for your interest in Sponsored Residential", text: "Hi {first_name}, …" }, { day: 3, channel: "sms", text: "Hi {first_name}, is now a good week for a quick call?" },
          { day: 7, channel: "email", subject: "What a day as a provider looks like", text: "Hi {first_name}, …" }, { day: 14, channel: "sms", text: "Still interested? Reply YES." }] },
          { id: "s2", name: "Referral partner updates", pipeline: "client", kind: "marketing", autoForms: [], active: false, steps: [{ day: 0, channel: "email", subject: "Thank you for referring to Family Transitions", text: "Hi {first_name}, …" }, { day: 30, channel: "email", subject: "Updates from Family Transitions", text: "Hi {first_name}, …" }] }] };
      D.leads.forEach(function (l) { D.acts[l.id] = [{ kind: "created", by: "website", text: l.formLabel + " submitted", at: l.createdAt }]; });
      D.acts.a2.push({ kind: "sms_out", by: "tanya@familytransitionsinc.com", text: "Hi Ms. Lee, thanks for the referral for Sam. When is a good time to talk?", at: t(0, 2), sid: "x" }, { kind: "sms_in", by: "text reply", text: "Afternoons after 3 work best, thanks!", at: t(0, 1) });
      D.acts.a6.push({ kind: "missed_call", by: "phone", text: "Missed call (no-answer)", at: t(0, 0.25) }, { kind: "sms_out", by: "missed-call text-back", text: "Hi, this is Family Transitions. Sorry we missed your call! How can we help? Reply here, or we'll call you back soon. Reply STOP to opt out.", at: t(0, 0.2), sid: "x" });
      Object.keys(D.acts).forEach(function (k) { D.acts[k].sort(function (a, b) { return b.at.localeCompare(a.at); }); });
      D.enr.b1 = [{ seqId: "s1", seqName: "Provider recruitment follow-up", status: "active", step: 1, nextAt: new Date(Date.now() + 2 * 864e5).toISOString(), startedAt: t(1) }];
    }
    var ok = function (x) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(x))); }, 120); }); };
    var no = function (msg) { return Promise.reject(new Error(msg)); };
    var today = new Date().toISOString().slice(0, 10), q = path.split("?")[1] || "", base = path.split("?")[0];
    var m = base.match(/^\/leads\/(\w+)(?:\/(\w+))?/), id = m && m[1], sub = m && m[2], lead = id && D.leads.find(function (l) { return l.id === id; });
    var log = function (kind, text, extra) { var a = Object.assign({ kind: kind, by: "demo", text: text, at: new Date().toISOString() }, extra); D.acts[id].unshift(a); return { activity: a }; };
    var CLOSED = /Not a fit|Enrolled|Approved|Hired/;
    if (base === "/config") return ok({ me: { email: "demo@familytransitionsinc.com", isAdmin: true, groups: ["admin"], pipelines: ["client", "provider", "applicant"] },
      roles: { admin: { label: "Admin" }, intake: { label: "Intake" }, hr: { label: "HR" } }, pipelines: P, smsReady: true, emailReady: true,
      sequences: D.seqs.map(function (s) { return { id: s.id, name: s.name, pipeline: s.pipeline, active: s.active, kind: s.kind }; }),
      templates: { sms: [{ name: "Missed you", text: "Hi {first_name}, this is Family Transitions. We tried to reach you about your request. Call or text us back at (804) 745-5101 when it's a good time." }] } });
    if (base === "/today") return ok({ today: today, waiting: D.leads.filter(function (l) { return l.status === P[l.pipeline][0] && !l.lastContactAt; }),
      due: D.leads.filter(function (l) { return l.nextFollowUp && l.nextFollowUp <= today && !CLOSED.test(l.status); }), unread: D.leads.filter(function (l) { return l.unread; }),
      stale: D.leads.filter(function (l) { return l.id === "b2"; }) });
    if (base === "/leads" && method === "GET") { var p = q.split("=")[1]; return ok({ leads: D.leads.filter(function (l) { return l.pipeline === p; }) }); }
    if (base === "/leads" && method === "POST") { var nl = { id: "n" + Date.now().toString(36).slice(-6), pipeline: body.pipeline, status: P[body.pipeline][0], name: body.name, phone: body.phone, email: body.email, service: body.service, leadSource: body.leadSource || "Phone call", channel: "Phone / walk-in", formLabel: "Added by staff", smsConsent: body.smsConsent, createdAt: new Date().toISOString(), fields: {} }; D.leads.push(nl); D.acts[nl.id] = [{ kind: "created", by: "demo", text: "Added by staff", at: nl.createdAt }]; return ok({ lead: nl }); }
    if (lead && !sub && method === "GET") return ok({ lead: lead, activity: D.acts[id], enrollments: D.enr[id] || [], smsOptedOut: false });
    if (lead && !sub && method === "PATCH") { if (body.status && body.status !== lead.status) { log("status", lead.status + " → " + body.status); lead.lastContactAt = lead.lastContactAt || new Date().toISOString(); } Object.assign(lead, body); return ok({ lead: lead }); }
    if (sub === "notes") { if (!body.text.trim()) return no("Note is empty."); lead.lastContactAt = new Date().toISOString(); return ok(log("note", body.text)); }
    if (sub === "sms") { if (!body.text.trim()) return no("Message is empty."); var tx = body.text.replace(/\{first_name\}/g, lead.name.split(" ")[0]); Object.assign(lead, { lastSmsAt: new Date().toISOString(), lastSmsText: tx, lastSmsDir: "out", unread: false, lastContactAt: new Date().toISOString() }); return ok(log("sms_out", tx, { sid: "x" })); }
    if (sub === "email") return body.subject && body.text ? ok(log("email_out", body.subject + "\n\n" + body.text)) : no("Subject and message are required.");
    if (sub === "review") return ok(log("review", "Hi " + lead.name.split(" ")[0] + ", thank you for choosing Family Transitions. Would you share a quick review? https://g.page/r/…"));
    if (sub === "resume") return no("Demo mode: no real files.");
    if (sub === "sequence") {
      var s = D.seqs.find(function (x) { return x.id === body.seqId; }); D.enr[id] = D.enr[id] || [];
      var en = D.enr[id].find(function (x) { return x.seqId === body.seqId; });
      if (body.stop) { if (en) { en.status = "stopped"; en.stopReason = "Stopped by staff"; } return ok({ enrollment: en }); }
      if (!en) { en = { seqId: s.id, seqName: s.name, status: "active", step: 0, nextAt: new Date().toISOString(), startedAt: new Date().toISOString() }; D.enr[id].push(en); log("sequence", 'Started sequence "' + s.name + '"'); }
      return ok({ enrollment: en });
    }
    if (base === "/inbox") return ok({ threads: D.leads.filter(function (l) { return l.lastSmsAt; }).sort(function (a, b) { return b.lastSmsAt.localeCompare(a.lastSmsAt); }) });
    if (base === "/partners" && method === "GET") {
      var map = {};
      Object.keys(D.partners).forEach(function (k) { map[k] = Object.assign({ key: k, referrals: 0, enrolled: 0, contacts: [] }, D.partners[k]); });
      D.leads.forEach(function (l) { if (!l.partnerKey) return; var pp = (map[l.partnerKey] = map[l.partnerKey] || { key: l.partnerKey, name: l.organization, referrals: 0, enrolled: 0, contacts: [] });
        pp.referrals++; if (l.status === "Enrolled") pp.enrolled++; if (!pp.lastReferralAt || l.createdAt > pp.lastReferralAt) pp.lastReferralAt = l.createdAt;
        if (l.contactName && !pp.contacts.some(function (c) { return c.name === l.contactName; })) pp.contacts.push({ name: l.contactName, role: l.contactRole, email: l.email, phone: l.phone }); });
      return ok({ partners: Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.referrals - a.referrals; }) });
    }
    var pm = base.match(/^\/partners\/(.+)$/);
    if (pm && method === "GET") { var k = decodeURIComponent(pm[1]); return ok({ partner: Object.assign({ key: k }, D.partners[k] || { name: (D.leads.find(function (l) { return l.partnerKey === k; }) || {}).organization }), leads: D.leads.filter(function (l) { return l.partnerKey === k; }) }); }
    if (pm && method === "PUT") { if (!body.name) return no("Partner name is required."); var k2 = decodeURIComponent(pm[1]); if (k2 === "new") k2 = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"); D.partners[k2] = body; return ok({ partner: Object.assign({ key: k2 }, body) }); }
    if (base === "/reports") {
      var r = { total: 0, byPipeline: { client: 71, provider: 14, applicant: 6 }, byForm: { "Consultation request": 40, Referral: 22, "Service quiz": 9, "DD Day Support tour": 5, "Sponsored Residential provider": 14, "Job application": 6, "Missed call": 4 }, byChannel: { "Google (organic)": 38, Direct: 33, "AI assistant": 7, Social: 8, "Phone call (missed)": 4 }, bySource: {}, byWeek: {}, statusByPipeline: {}, medianMinutesToContact: 42 };
      for (var w = 12; w >= 0; w--) { var d = new Date(Date.now() - w * 7 * 864e5); d.setDate(d.getDate() - d.getDay()); r.byWeek[d.toISOString().slice(0, 10)] = [3, 5, 4, 6, 8, 5, 7, 9, 6, 10, 8, 11, 9][12 - w]; }
      r.total = Object.keys(r.byWeek).reduce(function (s2, k3) { return s2 + r.byWeek[k3]; }, 0);
      r.bySource = { "Google (organic)": { leads: 31, won: 9 }, School: { leads: 14, won: 6 }, "Social worker": { leads: 12, won: 7 }, "Word of mouth": { leads: 11, won: 5 }, "Doctor or clinician": { leads: 9, won: 4 }, Radio: { leads: 6, won: 1 }, "AI assistant": { leads: 5, won: 2 }, "Probation officer": { leads: 3, won: 1 } };
      Object.keys(P).forEach(function (p2) { r.statusByPipeline[p2] = {}; P[p2].forEach(function (s3, i) { r.statusByPipeline[p2][s3] = [9, 6, 4, 3, 1, 1][i] * (p2 === "client" ? 3 : 1); }); });
      return ok(r);
    }
    if (base === "/sequences" && method === "GET") return ok({ sequences: D.seqs });
    if (base === "/sequences" && method === "POST") { if (body.starters) return ok({ sequences: D.seqs }); if (!body.name) return no("Give the sequence a name."); var ns = Object.assign({ id: "s" + Date.now() }, body); ns.steps = ns.steps.map(function (st) { return Object.assign({}, st, { day: Number(st.day) }); }); D.seqs.push(ns); return ok({ sequence: ns }); }
    var sm = base.match(/^\/sequences\/(\w+)$/);
    if (sm && method === "PUT") { var ix = D.seqs.findIndex(function (x) { return x.id === sm[1]; }); D.seqs[ix] = Object.assign({}, D.seqs[ix], body, { id: sm[1] }); return ok({ sequence: D.seqs[ix] }); }
    if (sm && method === "DELETE") { D.seqs = D.seqs.filter(function (x) { return x.id !== sm[1]; }); return ok({ ok: true }); }
    if (base === "/campaigns") { var n = D.leads.filter(function (l) { return l.pipeline === body.pipeline && l.marketingConsent; }).length; return body.dryRun ? ok({ recipients: n }) : ok({ sent: n, failed: [] }); }
    if (base === "/export") return ok({ csv: "id,name,status\n" + D.leads.filter(function (l) { return l.pipeline === state.pipe; }).map(function (l) { return [l.id, l.name, l.status].join(","); }).join("\n") });
    if (base === "/team" && method === "GET") return ok({ admins: ["demo@familytransitionsinc.com"], users: [
      { username: "u1", email: "demo@familytransitionsinc.com", status: "CONFIRMED", enabled: true, groups: ["admin"] },
      { username: "u2", email: "tanya@familytransitionsinc.com", status: "CONFIRMED", enabled: true, groups: ["intake"] },
      { username: "u3", email: "hr@familytransitionsinc.com", status: "FORCE_CHANGE_PASSWORD", enabled: true, groups: ["hr"] }] });
    if (base === "/team" || /^\/team\//.test(base)) return ok({ ok: true });
    if (base === "/audit") return ok({ date: today, entries: [{ at: new Date().toISOString(), user: "tanya@familytransitionsinc.com", action: "view", leadId: "a2" }, { at: t(0, 1), user: "demo@familytransitionsinc.com", action: "export", detail: "client" }] });
    if (base === "/import") return ok({ created: body.rows.filter(function (r2) { return r2.phone || r2.email; }).length, skipped: body.rows.filter(function (r2) { return !r2.phone && !r2.email; }).length });
    return no("Not available in demo.");
  }
})();
