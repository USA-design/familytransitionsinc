/* Family Transitions website forms → CRM (AWS). Loaded on every page with `defer`.
   - Records first-visit attribution (UTM tags, referring site, landing page) so the CRM can report lead sources.
   - Posts any <form data-form="..."> to the CRM API, with a hidden spam trap.
   - Uploads a resume straight to private storage when the careers form has one. */
(function () {
  var s = document.currentScript, API = ((s && s.dataset.api) || "").replace(/\/$/, ""), PHONE = "(804) 745-5101";
  var KEY = "fti_attr", t0 = Date.now();
  try {
    var q = new URLSearchParams(location.search), a = JSON.parse(localStorage.getItem(KEY) || "null");
    var utm = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"].filter(function (k) { return q.get(k); });
    if (!a || utm.length) { // keep the first visit, but a new tagged campaign link replaces it
      a = { ref: document.referrer, landing: location.pathname, first_at: new Date().toISOString() };
      utm.forEach(function (k) { a[k] = q.get(k).slice(0, 120); });
      localStorage.setItem(KEY, JSON.stringify(a));
    }
  } catch (e) {}

  var TYPES = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  var THANKS = {
    consult: "Thank you! A care coordinator will call you back soon.",
    referral: "Thank you! Your referral was sent. Our intake team will call you to follow up.",
    tour: "Thank you! We'll call you to confirm a tour time.",
    provider: "Thank you! We'll call you to talk about becoming a provider.",
    careers: "Thank you for applying! We'll contact you if your experience matches an opening."
  };

  function msg(form, kind, text) {
    var el = form.querySelector(".form-msg");
    if (!el) { el = document.createElement("p"); el.className = "form-msg"; el.setAttribute("role", "status"); form.appendChild(el); }
    el.className = "form-msg " + kind; el.textContent = text; return el;
  }

  document.querySelectorAll("form[data-form]").forEach(function (f) {
    var hp = document.createElement("div");
    hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
    hp.innerHTML = '<label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>';
    f.appendChild(hp);

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!f.reportValidity()) return;
      if (!API) { msg(f, "err", "Online forms are almost ready. For now, please call us at " + PHONE + "."); return; }
      var data = {}, file = null, fi = f.querySelector('input[type="file"]');
      new FormData(f).forEach(function (v, k) {
        if (typeof v !== "string") return;
        data[k] = k in data ? [].concat(data[k], v) : v;
      });
      if (fi && fi.files[0]) {
        file = fi.files[0];
        var ext = (file.name.split(".").pop() || "").toLowerCase();
        data[fi.name] = { name: file.name, type: file.type || TYPES[ext] || "", size: file.size };
        if (file.size > 5 * 1024 * 1024) { msg(f, "err", "Your resume is over 5 MB. Please attach a smaller file."); return; }
      }
      data._elapsed = Date.now() - t0; data._page = location.pathname;
      try { data._attr = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}

      var btn = f.querySelector('button[type="submit"], button:not([type])'), label = btn && btn.textContent;
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
      fetch(API + "/submit/" + f.dataset.form, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (o) { if (!r.ok || !o.ok) throw new Error(o.error || ""); return o; }); })
        .then(function (o) {
          if (o.uploadUrl && file) return fetch(o.uploadUrl, { method: "PUT", headers: { "content-type": data[fi.name].type }, body: file }).then(function (u) { return u.ok; });
          return true;
        })
        .then(function (uploaded) {
          var text = THANKS[f.dataset.form] || "Thank you! We'll be in touch soon.";
          if (!uploaded) text += " (Your resume didn't upload. You can email it to us instead.)";
          Array.prototype.forEach.call(f.children, function (c) { c.style.display = "none"; });
          var el = msg(f, "ok", text); el.style.display = ""; el.tabIndex = -1; el.focus();
          if (window.gtag) window.gtag("event", "generate_lead", { form_name: f.dataset.form });
        })
        .catch(function (err) {
          if (btn) { btn.disabled = false; btn.textContent = label; }
          msg(f, "err", (err.message && err.message !== "Failed to fetch" ? err.message + " " : "We couldn't send your form. ") + "You can also call us at " + PHONE + ".");
        });
    });
  });
})();
