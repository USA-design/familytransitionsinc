/* "Which service fits?" quiz: two questions → a suggested program → optional call-back form (sent by forms.js). */
(function () {
  var root = document.getElementById("quiz");
  if (!root) return;
  var ans = {}, steps = root.querySelectorAll(".qstep");
  var LABEL = {};
  root.querySelectorAll(".qopt").forEach(function (b) { LABEL[b.dataset.k + ":" + b.dataset.v] = b.textContent; });
  var TITLE = {};
  root.querySelectorAll(".qres").forEach(function (r) { var h = r.querySelector("h3"); TITLE[r.dataset.svc] = h ? h.textContent : r.dataset.svc; });

  // Ages and eligibility as published on the service pages.
  function pick(who, need) {
    var young = who === "child" || who === "ya", idd = who === "idd";
    switch (need) {
      case "talk": return ["outpatient-therapy"];
      case "home": return young ? ["intensive-in-home", "outpatient-therapy"] : ["outpatient-therapy"];
      case "skills": return idd ? ["dd-day-support", "sponsored-residential"] : who === "child" ? ["intensive-in-home"] : ["mental-health-skill-building", "outpatient-therapy"];
      case "day": return idd ? ["dd-day-support"] : who === "child" ? ["intensive-in-home"] : ["mental-health-skill-building"];
      case "live": return idd ? ["sponsored-residential", "dd-day-support"] : ["talk-to-us"];
      default: return ["talk-to-us"];
    }
  }
  function show(n) {
    steps.forEach(function (s) { s.hidden = Number(s.dataset.step) !== n; });
    var cur = root.querySelector('.qstep[data-step="' + n + '"] h2, .qstep[data-step="' + n + '"] .qnum');
    if (cur) { cur.setAttribute("tabindex", "-1"); cur.focus(); }
  }
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("qopt")) {
      ans[b.dataset.k] = b.dataset.v;
      if (b.dataset.k === "who") return show(2);
      var svcs = pick(ans.who, ans.need);
      root.querySelectorAll(".qres").forEach(function (r) {
        var i = svcs.indexOf(r.dataset.svc);
        r.hidden = i < 0; r.classList.toggle("alt", i > 0);
        r.style.order = i < 0 ? 99 : i;
      });
      var f = root.querySelector("form");
      f.elements.for_whom.value = LABEL["who:" + ans.who] || "";
      f.elements.need.value = LABEL["need:" + ans.need] || "";
      f.elements.recommendation.value = TITLE[svcs[0]] || "";
      if (window.gtag) window.gtag("event", "quiz_complete", { recommendation: svcs[0] });
      return show(3);
    }
    if (b.classList.contains("qrestart")) { ans = {}; return show(1); }
    if (b.classList.contains("qback")) return show(1);
  });
})();
