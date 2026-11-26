#!/usr/bin/env python3
"""Builds the service pages and keeps the shared header/footer in sync.

Run from the repo root:  python3 tools/build.py
It writes plain HTML into public/ (commit the output). Cloudflare only serves public/,
so there is no build step on deploy.

Text wrapped in [[double brackets]] is a placeholder for a fact Family Transitions
still has to confirm; it renders as a highlighted "To confirm" note so nobody misses it.
"""
import hashlib, html, json, re, pathlib

CSS_V = ""
ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
SITE = "https://familytransitionsinc.com"
PHONE, PHONE_TEL = "(804) 745-5101", "8047455101"

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&amp;'
         'family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet">')

NAV = [("/services/", "Services"), ("/who-we-help/", "Who We Help"), ("/locations/", "Locations"),
       ("/resources/", "Resources"), ("/about/", "About")]

SERVICES_ORDER = ["outpatient-therapy", "intensive-in-home", "mental-health-skill-building",
                  "dd-day-support", "sponsored-residential"]


def topbar():
    return f'''<div style="background:#033B6B;color:#fff;font-size:14px">
<div style="max-width:1200px;margin:0 auto;padding:10px 24px;display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;align-items:center">
<span>Serving Richmond, Petersburg &amp; Central Virginia since 2003</span>
<div style="display:flex;gap:20px;flex-wrap:wrap"><a href="tel:{PHONE_TEL}" style="color:#fff;text-decoration:none;font-weight:600">{PHONE}</a><a href="/careers/" style="color:#CFE3F5;text-decoration:none">Careers</a><a href="#" style="color:#CFE3F5;text-decoration:none">Client Portal</a></div>
</div></div>'''


def header(home=False):
    start = "#start" if home else "/#start"
    sub = "".join(f'<li><a href="/services/{s}/">{SERVICES[s]["title"]}<small>{html.escape(SERVICES[s]["who"])}</small></a></li>' for s in SERVICES_ORDER)
    items = []
    for u, t in NAV:
        if u == "/services/":
            items.append(f'<div class="dd"><a href="{u}" class="dd-top" aria-haspopup="true" style="color:#1B2A3A;text-decoration:none">{t} <span aria-hidden="true">▾</span></a>'
                         f'<ul class="dd-menu">{sub}<li class="dd-all"><a href="/services/">All services →</a></li></ul></div>')
        else:
            items.append(f'<a href="{u}" style="color:#1B2A3A;text-decoration:none">{t}</a>')
    links = "\n".join(items)
    return f'''<header style="background:#fff;border-bottom:1px solid #E3EAF2">
<div style="max-width:1200px;margin:0 auto;padding:18px 24px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
<a href="/" style="display:flex;align-items:center;text-decoration:none">
<img src="/assets/fti-logo.svg" alt="Family Transitions, Inc." width="164" height="64" style="height:64px;width:auto;display:block">
</a>
<nav aria-label="Main" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 28px;font-weight:500;font-size:15px">
{links}
</nav>
<div style="display:flex;gap:10px;flex-wrap:wrap">
<a href="/referrals/" style="padding:12px 18px;border:1.5px solid #055496;border-radius:10px;text-decoration:none;font-weight:600;color:#055496">Make a Referral</a>
<a href="{start}" style="padding:12px 18px;background:#078643;border-radius:10px;text-decoration:none;font-weight:600;color:#fff">Get Started</a>
</div>
</div></header>'''


def footer():
    svc = "".join(f'<a href="/services/{s}/" style="color:#BCCBDB">{SERVICES[s]["short"]}</a>' for s in SERVICES_ORDER)
    return f'''<footer style="background:#0F2740;color:#BCCBDB;font-size:14px">
<div style="max-width:1200px;margin:0 auto;padding:56px 24px 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:32px">
<div style="display:flex;flex-direction:column;gap:10px"><img src="/assets/fti-logo-light.svg" alt="Family Transitions, Inc." width="200" height="75" style="width:200px;height:auto;display:block"><p>A behavioral health organization serving Central Virginia since 2003.</p></div>
<div style="display:flex;flex-direction:column;gap:8px"><strong style="color:#fff">Services</strong>{svc}</div>
<div style="display:flex;flex-direction:column;gap:8px"><strong style="color:#fff">Organization</strong><a href="/about/" style="color:#BCCBDB">Mission &amp; Philosophy</a><a href="/referrals/" style="color:#BCCBDB">Referrals</a><a href="/careers/" style="color:#BCCBDB">Employment</a><a href="/privacy/" style="color:#BCCBDB">Privacy Policy</a></div>
<div style="display:flex;flex-direction:column;gap:8px"><strong style="color:#fff">Stay connected</strong><p>Get resources and program news by email.</p><label style="display:flex;flex-direction:column;gap:6px">Email address<input type="email" placeholder="you@example.com" style="padding:11px 12px;border-radius:8px;border:0"></label></div>
</div>
<div style="max-width:1200px;margin:0 auto;padding:20px 24px;border-top:1px solid #23405E">© 2003–2026 Family Transitions, Inc. · If you are in crisis, call or text 988.</div>
</footer>'''


def v(url):
    """Add a content hash to an /assets/ URL so replaced files bypass the long cache."""
    f = PUB / url.lstrip("/")
    return f"{url}?v={hashlib.sha1(f.read_bytes()).hexdigest()[:8]}" if f.exists() else url

TITLE_MAP = {
 "/about/": "About Family Transitions | Central Virginia Since 2003",
 "/become-a-provider/": "Become a Sponsored Residential Provider | Central VA",
 "/careers/": "Careers: Counselor, QMHP & DSP Jobs | Family Transitions",
 "/locations/": "Our Locations: North Chesterfield & Petersburg, VA",
 "/locations/north-chesterfield/": "Outpatient Therapy Office in North Chesterfield, VA",
 "/locations/petersburg/": "DD Day Support Center in Petersburg, VA | FTI",
 "/referrals/": "Make a Referral | Family Transitions, Inc.",
 "/resources/intensive-in-home-services-richmond-va/": "Intensive In-Home Services in Richmond, VA",
 "/services/dd-day-support/": "DD Day Support for Adults in Petersburg, VA",
 "/services/": "Behavioral Health & DD Services | Central Virginia",
 "/services/intensive-in-home/": "Intensive In-Home Services, Ages 5–21 | Richmond, VA",
 "/services/mental-health-skill-building/": "Mental Health Skill Building for Adults | Central VA",
 "/services/outpatient-therapy/": "Outpatient Therapy in Richmond & Petersburg, VA",
 "/services/sponsored-residential/": "Sponsored Residential for Adults with ID/DD | Central VA",
}
DESC_MAP = {
 "/become-a-provider/": "Open your home to an adult with ID/DD in Richmond, Petersburg or Chesterfield, VA. Training, 24/7 support and competitive pay.",
 "/resources/what-is-sponsored-residential/": "How sponsored residential gives adults with intellectual and developmental disabilities a family-like home and a place in the community.",
 "/who-we-help/": "Family Transitions helps children, teens, families and adults with mental illness or ID/DD in Richmond and Petersburg, VA.",
}


ADMIN = {"name": "Administrative Office", "street": "620 Moorefield Park Drive, Suite 218",
         "city": "North Chesterfield", "zip": "23236", "phone": "(804) 745-5101", "tel": "8047455101"}
PETERSBURG = {"name": "DD Day Support Center", "street": "111 Morton Avenue", "city": "Petersburg",
              "zip": "23805", "phone": "(804) 733-3922", "tel": "8047333922"}

SERVICES = {
 "outpatient-therapy": {
  "short": "Outpatient Therapy", "title": "Outpatient Therapy",
  "seo_title": "Outpatient Therapy in Richmond & Petersburg, VA | Family Transitions, Inc.",
  "desc": "Individual, couples and family therapy for children, teens and adults in Central Virginia, provided with our sister practice Core Behavioral Health.",
  "who": "Children · Teens · Adults · Families",
  "alt": "A counselor and a client smiling and talking in armchairs in a warm, sunlit counseling room",
  "lead": "Counseling for individuals, couples and families, provided in partnership with our sister organization, Core Behavioral Health, LLC. Our therapists look at the root causes of what you're facing and help you build insight, coping skills and practical tools for change.",
  "for_title": "What we help with",
  "for": ["Anxiety and phobias", "Depression", "Bipolar disorder", "Trauma and abuse", "ADHD", "Obsessive-compulsive disorder",
          "Grief and loss", "Anger management and impulse control", "Behavioral concerns in children and teens",
          "Self-esteem and body image", "Substance use", "Serious mental illness"],
  "offer_title": "How therapy works here",
  "offer": ["Individual therapy for children, adolescents and adults", "Couples counseling",
            "Family therapy that treats the family as a unit", "Evidence-based approaches, including cognitive behavioral therapy (CBT)"],
  "location": [ADMIN],
  "facts": [("Ages", "All ages"), ("Insurance", "[[Insurance and Medicaid plans accepted]]"),
            ("Telehealth", "[[Is telehealth available?]]"), ("Hours", "Mon–Thu 9 AM–5 PM, Fri 9 AM–4 PM")],
  "faqs": [("Who provides outpatient therapy?", "Outpatient therapy is provided in partnership with Core Behavioral Health, LLC, the sister organization of Family Transitions, Inc."),
           ("What ages do you see?", "We work with children, adolescents and adults, as individuals, couples or families."),
           ("Do you take insurance?", "[[List of insurance and Medicaid plans accepted for outpatient therapy.]]"),
           ("How do I schedule a first appointment?", f"Call {PHONE} or request a call back online, and our team will help you schedule. [[Typical wait time for a first appointment.]]")],
 },
 "intensive-in-home": {
  "short": "Intensive In-Home", "title": "Intensive In-Home Services",
  "seo_title": "Intensive In-Home Services for Youth Ages 5–21 | Richmond & Petersburg, VA",
  "desc": "Home-based, family-focused counseling for children and young people ages 5 to 21 with emotional or behavioral challenges in Central Virginia.",
  "who": "Youth ages 5–21 and their families",
  "alt": "An in-home counselor talking with a smiling mother and daughter at their kitchen table",
  "lead": "Intensive In-Home Services bring counseling into the family's home for children and young people ages 5 to 21 who have emotional or behavioral difficulties, are at risk of being placed outside the home, or are returning home from a placement.",
  "for_title": "Who it's for",
  "for": ["Children and young people ages 5 to 21", "Experiencing emotional or behavioral difficulties",
          "At serious risk of out-of-home placement", "Returning home from an out-of-home placement",
          "A clinical need from a serious mental health, behavioral or emotional condition that significantly affects daily life"],
  "offer_title": "What makes our program different",
  "offer": ["Small caseloads, usually four to five families per counselor", "Treatment plans built with maximum family input",
            "A focus on the family's strengths, culture and values", "Skills for handling stress and crisis long after services end",
            "Help connecting to educational, medical, social and legal services"],
  "location": [ADMIN],
  "facts": [("Ages", "5 to 21"), ("Where", "In your home and community"), ("Areas served", "[[Cities and counties served]]"),
            ("Insurance", "[[Insurance and Medicaid plans accepted]]")],
  "faqs": [("What ages does Intensive In-Home serve?", "Intensive In-Home Services are for children and young people ages 5 to 21 and their families."),
           ("Where do sessions happen?", "Counselors work with the family in the home and community, not in an office."),
           ("Who can make a referral?", "Parents, guardians, schools, social workers, probation officers and other professionals can refer a young person through our referral form or by phone."),
           ("How long does the program last?", "[[Typical length of services and how often counselors visit.]]")],
 },
 "mental-health-skill-building": {
  "short": "MH Skill Building", "title": "Adult Mental Health Skill Building",
  "seo_title": "Mental Health Skill Building Services for Adults | Central Virginia",
  "desc": "Individualized life-skills training and support in the home and community for adults 18 and older living with serious mental illness in Central Virginia.",
  "who": "Adults 18+",
  "alt": "A skill-building coach and an adult client smiling while planning meals and a budget at a kitchen counter",
  "lead": "Mental Health Skill Building gives adults 18 and older one-on-one coaching and life-skills training in their homes and communities, so that mental illness doesn't stand in the way of stability and independence.",
  "for_title": "Who is eligible",
  "for": ["Adults 18 and older", "A diagnosis of serious mental illness, such as schizophrenia, recurrent major depression or bipolar disorder",
          "Needs individualized training in basic living skills", "[[Current DMAS eligibility criteria, in DSM-5 terms, to confirm with FTI]]"],
  "offer_title": "What we help with",
  "offer": ["Daily living skills, meal planning and nutrition", "Budgeting and household management",
            "Medication education and keeping health care appointments", "Finding and using community resources",
            "Crisis support and coordination", "Building social supports and independent living skills",
            "Case management and discharge planning"],
  "location": [ADMIN],
  "facts": [("Ages", "18 and older"), ("Where", "In your home and community"), ("Areas served", "[[Cities and counties served]]"),
            ("Insurance", "[[Insurance and Medicaid plans accepted]]")],
  "faqs": [("Who is Mental Health Skill Building for?", "Adults 18 and older with a serious mental illness who need individualized training in daily living skills to stay stable and independent in the community."),
           ("Where do services take place?", "In the person's home and community."),
           ("Is it covered by Medicaid?", "[[Confirm Medicaid coverage and other accepted plans.]]"),
           ("How do I get started?", f"Call {PHONE}, request a call back online, or have a provider send a referral. [[Intake steps and response time.]]")],
 },
 "dd-day-support": {
  "short": "DD Day Support", "title": "DD Day Support Services",
  "seo_title": "DD Day Support for Adults in Petersburg, VA | Family Transitions, Inc.",
  "desc": "Center-based day support in Petersburg, VA for adults 18+ with developmental disabilities: daily living skills, community outings and recreation. DD Waiver accepted.",
  "who": "Adults 18+ with developmental disabilities",
  "alt": "Adults at a day support center smiling while working together on a colorful collage with a staff member",
  "lead": "Our DD Day Support center in Petersburg helps adults with developmental disabilities build daily living skills, confidence and connections in the community, with person-centered goals set together with each participant, their family and their support coordinator.",
  "for_title": "Who is eligible",
  "for": ["Adults 18 and older", "A confirmed developmental disability diagnosis, which may include intellectual disability",
          "Significant limitations in at least three areas of adaptive functioning, such as communication, self-care or independent living"],
  "offer_title": "Program activities",
  "offer": ["Daily living and self-care skills", "Money management", "Shopping and community outings", "Volunteering and social events",
            "Recreation, sports, games and YMCA exercise", "Arts and crafts", "Health and safety skills"],
  "location": [PETERSBURG],
  "facts": [("Ages", "18 and older"), ("Location", "111 Morton Avenue, Petersburg"), ("Funding", "DD Waiver, Day Support Waiver and private pay"),
            ("Licensed by", "Virginia Department of Behavioral Health and Developmental Services (DBHDS)"), ("Hours", "Mon–Fri 8:30 AM–3:30 PM")],
  "faqs": [("Who can attend DD Day Support?", "Adults 18 and older with a confirmed developmental disability diagnosis and significant limitations in at least three areas of adaptive functioning."),
           ("How is the program paid for?", "We accept the DD Waiver, Day Support Waiver services and private pay."),
           ("Can we tour the center?", "Yes. Tours are offered Monday through Friday. Call (804) 733-3922 to arrange a visit."),
           ("Is transportation provided?", "[[Confirm whether transportation is provided.]]")],
 },
 "sponsored-residential": {
  "short": "Sponsored Residential", "title": "Sponsored Residential Services",
  "seo_title": "Sponsored Residential Services for Adults with ID/DD | Central Virginia",
  "desc": "Family-style homes for adults with intellectual and developmental disabilities in Central Virginia, with personalized care, 24/7 support and community involvement.",
  "who": "Adults with ID/DD",
  "alt": "A provider family and an adult resident laughing and passing dishes at a home-cooked family dinner",
  "lead": "Sponsored Residential Services give adults with intellectual and developmental disabilities (ID/DD) a place to live in a caring family home, with a personalized plan that supports independence and community life.",
  "for_title": "Who it's for",
  "for": ["Adults with intellectual or developmental disabilities, including autism", "People who need daily support, full-time or occasional",
          "Families looking for a home-like alternative to group settings", "[[Eligibility requirements, including waiver]]"],
  "offer_title": "What residents receive",
  "offer": ["A personalized care plan", "24/7 support from trained caregivers and our team",
            "Help with daily activities, meals, transportation and personal care", "Community activities and relationship-building",
            "Funding through Medicaid and state programs for eligible individuals"],
  "location": [ADMIN],
  "facts": [("Ages", "Adults [[confirm minimum age]]"), ("Where", "Approved provider homes in Central Virginia"),
            ("Funding", "Medicaid waiver and state programs [[confirm waiver names]]")],
  "faqs": [("What is sponsored residential?", "It's a service where an adult with ID/DD lives in the home of a trained, approved provider family, with support from Family Transitions."),
           ("How is it paid for?", "Services are funded through Medicaid and state programs for eligible individuals. [[Confirm waiver names and any costs to families.]]"),
           ("Can I become a provider?", "Yes. We're looking for caring individuals and families in Richmond, Petersburg and Chesterfield. See Become a Provider to learn more and apply."),
           ("How do I start the process?", f"Call {PHONE} or request a call back online. [[Referral and matching steps.]]")],
 },
}


def ph(text):
    """Render [[placeholder]] as a visible To-confirm note; escape everything else."""
    out, pos = [], 0
    for m in re.finditer(r"\[\[(.+?)\]\]", text):
        out.append(html.escape(text[pos:m.start()]))
        out.append(f'<mark class="tbc">To confirm: {html.escape(m.group(1))}</mark>')
        pos = m.end()
    out.append(html.escape(text[pos:]))
    return "".join(out)


def plain(text):
    return re.sub(r"\s*\[\[.+?\]\]", "", text).strip()


CSS = """
body{margin:0;font-family:Inter,system-ui,sans-serif;color:#1B2A3A;background:#fff}
h1,h2,h3{font-family:Outfit,Inter,sans-serif;margin:0;letter-spacing:-0.01em}
p{margin:0;line-height:1.6}
a{color:#055496}a:hover{color:#033b6b}
input,select{font:inherit}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.crumbs{font-size:14px;color:#5A6B7D;padding:20px 0 0}.crumbs a{color:#5A6B7D}
.hero{background:#F2F7FC}.hero .wrap{padding:40px 24px 64px;display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}
.hero-main{flex:2 1 520px;min-width:0;display:flex;flex-direction:column;gap:18px}
.pill{align-self:flex-start;background:#DCEAF7;color:#033B6B;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600}
h1{font-size:48px;line-height:1.1;color:#0F2740}
.lead{font-size:19px;color:#3E5064;max-width:680px}
.btns{display:flex;gap:12px;flex-wrap:wrap}
.btn{padding:15px 24px;border-radius:12px;text-decoration:none;font-weight:600}
.btn-green{background:#078643;color:#fff}.btn-green:hover{color:#fff;background:#06713a}
.btn-line{background:#fff;color:#055496;border:1.5px solid #BFD3E8}
.facts{flex:1 1 300px;background:#fff;border-radius:18px;padding:28px;box-shadow:0 20px 50px rgba(3,59,107,.10)}
.facts dl{margin:0;display:grid;gap:14px}.facts dt{font-size:13px;font-weight:600;color:#5A6B7D}.facts dd{margin:2px 0 0;color:#0F2740;font-weight:500}
.cols{padding:48px 24px 72px;display:flex;flex-wrap:wrap;gap:48px}
.col{flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:16px}
h2{font-size:32px;color:#0F2740}
.ticks{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ticks li{padding-left:30px;position:relative;line-height:1.5;color:#3E5064}
.ticks li:before{content:"";position:absolute;left:0;top:5px;width:16px;height:16px;border-radius:50%;background:#E4F4EA;box-shadow:inset 0 0 0 5px #078643}
.steps{background:#0F2740;color:#fff}.steps .wrap{padding:64px 24px;display:flex;flex-direction:column;gap:32px}
.steps h2{color:#fff}.steps .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.steps .grid div{border-top:2px solid #5FC98E;padding-top:18px;display:flex;flex-direction:column;gap:8px}
.steps span{color:#5FC98E;font-weight:600;font-size:14px;font-family:Outfit,sans-serif}.steps p{color:#BCCBDB}
.faq{padding:72px 24px;display:flex;flex-wrap:wrap;gap:48px}
.faq .list{flex:2 1 520px;min-width:0;display:flex;flex-direction:column;gap:12px}
details{border:1px solid #E3EAF2;border-radius:14px;padding:0 22px}
summary{padding:20px 0;font:600 17px Outfit,sans-serif;color:#0F2740;cursor:pointer}
details p{padding:0 0 20px;color:#3E5064}
.loc{background:#F2F7FC}.loc .wrap{padding:56px 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.card{background:#fff;border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:8px}
.card h3{font-size:20px;color:#0F2740}
.cta{padding:72px 24px}.cta-box{background:#078643;color:#fff;border-radius:24px;padding:44px;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}
.cta-box h2{color:#fff}.cta-box p{color:#E3F4EA}
.cta-box .btn{background:#0F2740;color:#fff}
.related{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0 24px 72px}
.related a{border:1px solid #E3EAF2;border-radius:14px;padding:20px;text-decoration:none;font-weight:600;color:#0F2740}
.hub{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:56px 24px 80px}
.hub a{text-decoration:none;color:inherit;border:1px solid #E3EAF2;border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:10px}
.hub small{font-size:12px;font-weight:600;color:#8A5A12;background:#FDF1DC;padding:4px 10px;border-radius:999px;align-self:flex-start}
.hub h2{font-size:22px}.hub p{color:#4A5B6E;font-size:15px}.hub span{color:#055496;font-weight:600;margin-top:auto}
.dd{position:relative}
.dd-top span{font-size:11px;color:#5A6B7D}
.dd-menu{display:none;position:absolute;left:-20px;top:100%;z-index:50;list-style:none;margin:0;padding:10px;min-width:300px;background:#fff;border:1px solid #E3EAF2;border-radius:14px;box-shadow:0 20px 50px rgba(3,59,107,.14)}
.dd:before{content:"";position:absolute;left:0;right:0;top:100%;height:14px}
.dd-menu{margin-top:12px}
.dd:hover .dd-menu,.dd:focus-within .dd-menu{display:block}
.dd-menu a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;text-decoration:none;color:#0F2740;font-weight:600}
.dd-menu a:hover,.dd-menu a:focus{background:#F2F7FC}
.dd-menu small{font-weight:400;font-size:12px;color:#5A6B7D}
.dd-all{border-top:1px solid #E3EAF2;margin-top:6px;padding-top:6px}.dd-all a{color:#055496}
.hh{position:relative;min-height:600px;display:flex;align-items:center;background:#F2F7FC;overflow:hidden}
.hh picture,.hh-img{position:absolute;inset:0;width:100%;height:100%}
.hh-img{object-fit:cover;object-position:30% 50%}
.hh:after{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(255,255,255,.94) 0%,rgba(255,255,255,.88) 34%,rgba(255,255,255,0) 62%)}
.hh-inner{position:relative;z-index:1;width:100%;max-width:1200px;margin:0 auto;padding:64px 24px;display:flex;justify-content:flex-end}
.hh-text{max-width:520px;display:flex;flex-direction:column;gap:20px}
.hh h1{font-size:46px;line-height:1.1}
.hh .lead{font-size:18px}
.btn-blue{background:#055496;color:#fff}.btn-blue:hover{color:#fff;background:#033B6B}
.hh-stats{display:flex;gap:28px;flex-wrap:wrap;font-size:14px;color:#3E5064}
.hh-stats strong{display:block;font-family:Outfit,sans-serif;font-size:26px;color:#033B6B}
.qf{position:relative;z-index:2;max-width:1200px;margin:-56px auto 0;padding:0 24px}
.qf-box{background:#fff;border-radius:20px;box-shadow:0 20px 50px rgba(3,59,107,.14);padding:28px 32px;display:flex;flex-direction:column;gap:16px}
.qf-head{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline}.qf-head h2{font-size:24px}.qf-head p{color:#5A6B7D;font-size:14px}
.qf-form{display:grid;grid-template-columns:1fr 1fr 1.2fr auto;gap:14px;align-items:end}
.qf-form label{font-size:13px;font-weight:600;color:#3E5064;display:flex;flex-direction:column;gap:6px}
.qf-form input[type=text],.qf-form input[type=tel],.qf-form select{padding:12px 14px;border:1px solid #CBD6E2;border-radius:10px;background:#fff}
.qf-form button{padding:14px 22px;background:#078643;border:0;border-radius:12px;font:700 16px Inter,sans-serif;color:#fff;cursor:pointer;white-space:nowrap}
.qf-form button:hover{background:#06713a}
.qf-form .qf-sms{grid-column:1/-1;flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;color:#5A6B7D}
@media (max-width:900px){.qf-form{grid-template-columns:1fr 1fr}.qf-form button{grid-column:1/-1}}
@media (max-width:760px){.hh{display:block;min-height:0}.hh picture,.hh-img{position:static;height:auto;aspect-ratio:4/3}.hh:after{display:none}.hh-inner{padding:32px 24px 72px;justify-content:flex-start}.hh h1{font-size:34px}.qf-form{grid-template-columns:1fr}}
.sh{position:relative;min-height:540px;display:flex;align-items:center;background:#F2F7FC;overflow:hidden}
.crumbs-below .crumbs{padding:28px 0 0}
.sh picture,.sh-img{position:absolute;inset:0;width:100%;height:100%}
.sh-img{object-fit:cover;object-position:0% 50%}
.sh:after{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(255,255,255,.94) 0%,rgba(255,255,255,.88) 36%,rgba(255,255,255,0) 64%)}
.sh-inner{position:relative;z-index:1;width:100%;max-width:1200px;margin:0 auto;padding:56px 24px 88px;display:flex;justify-content:flex-end}
.sh-text{max-width:520px;display:flex;flex-direction:column;gap:18px}
.sh h1{font-size:44px}.sh .lead{font-size:17px}
.facts-strip{position:relative;z-index:2;margin-top:-56px}
.facts-strip dl{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px 28px}
@media (max-width:760px){.sh{display:block;min-height:0}.sh picture,.sh-img{position:static;height:auto;aspect-ratio:4/3}.sh:after{display:none}.sh-inner{padding:28px 24px 72px;justify-content:flex-start}.sh h1{font-size:34px}}
mark.tbc{background:#FFF3C4;color:#6B4E00;padding:1px 6px;border-radius:4px;font-size:.9em}
@media (max-width:960px){.hub{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.hub{grid-template-columns:1fr}h1{font-size:36px}h2{font-size:26px}.cta-box{padding:28px}}
"""


def page(path, title, desc, body, schemas, home=False):
    title = TITLE_MAP.get(path, title)
    desc = DESC_MAP.get(path, desc)
    ld = "\n".join(f'<script type="application/ld+json">{json.dumps(s, ensure_ascii=False)}</script>' for s in schemas)
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta name="theme-color" content="#005494">
<meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{SITE}{path}">
<meta property="og:image" content="{SITE}/assets/img/share.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/fti-logo.svg" type="image/svg+xml">
{FONTS}
<link rel="stylesheet" href="/assets/site.css?v={CSS_V}">
{ld}
</head>
<body>
{topbar()}
{header(home)}
<main>
{body}
</main>
{footer()}
{FORMS_TAG}
</body>
</html>
'''
    out = PUB / path.strip("/") / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc)


def addr_card(loc):
    return (f'<div class="card"><h3>{loc["name"]}</h3><p>{loc["street"]}<br>{loc["city"]}, VA {loc["zip"]}</p>'
            f'<a href="tel:{loc["tel"]}" style="font-weight:600;text-decoration:none">{loc["phone"]}</a></div>')


def crumbs(items):
    parts = [f'<a href="{u}">{t}</a>' for u, t in items[:-1]] + [items[-1][1]]
    return f'<nav class="crumbs" aria-label="Breadcrumb">{" › ".join(parts)}</nav>'


def crumb_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": t, "item": SITE + u}
                                for i, (u, t) in enumerate(items)]}


ORG_REF = {"@type": "MedicalOrganization", "name": "Family Transitions, Inc.", "url": SITE + "/", "telephone": "+1-804-745-5101"}


def build_service(slug):
    s = SERVICES[slug]
    path = f"/services/{slug}/"
    trail = [("/", "Home"), ("/services/", "Services"), (path, s["title"])]
    facts = "".join(f"<div><dt>{k}</dt><dd>{ph(v)}</dd></div>" for k, v in s["facts"])
    fors = "".join(f"<li>{ph(x)}</li>" for x in s["for"])
    offers = "".join(f"<li>{ph(x)}</li>" for x in s["offer"])
    faqs = "".join(f"<details><summary>{html.escape(q)}</summary><p>{ph(a)}</p></details>" for q, a in s["faqs"])
    related = "".join(f'<a href="/services/{o}/">{SERVICES[o]["title"]} →</a>' for o in SERVICES_ORDER if o != slug)
    locs = "".join(addr_card(l) for l in s["location"])
    tour = ""
    if slug == "dd-day-support":
        days = "".join(f'<label class="check"><input type="checkbox" name="days" value="{d}">{d}</label>' for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
        tour = f'''<section class="wrap" style="padding-top:56px"><div class="form-card" style="flex-direction:row;flex-wrap:wrap;gap:28px;align-items:flex-start">
<div style="flex:1 1 300px;display:flex;flex-direction:column;gap:10px"><h2>Schedule a tour</h2><p style="color:#3E5064">See the center, meet our team and ask questions. Tours are offered Monday through Friday. Pick what works and we'll call to confirm a time.</p></div>
<form data-form="tour" action="#" method="post" style="flex:2 1 420px;display:flex;flex-direction:column;gap:12px">
<div class="row"><label>Name<input name="name" autocomplete="name" required></label><label>Phone<input type="tel" name="phone" autocomplete="tel" required></label></div>
<label>Email<input type="email" name="email" autocomplete="email"></label>
<fieldset><legend>Best days</legend><div style="display:flex;flex-wrap:wrap;gap:6px 18px">{days}</div></fieldset>
<label>Preferred time<select name="time"><option>Morning (9–11 AM)</option><option>Afternoon (1–2 PM)</option><option>Either</option></select></label>
<label class="check"><input type="checkbox" name="contact_ok" required>I agree to be contacted by phone, email or text to schedule my tour.</label>
<button type="submit">Request a tour</button></form></div></section>'''
    intro = f'''<span class="pill">{html.escape(s["who"])}</span>
<h1>{html.escape(s["title"])}</h1>
<p class="lead">{ph(s["lead"])}</p>
<div class="btns"><a class="btn btn-green" href="/#start">Request a free consultation</a><a class="btn btn-line" href="tel:{PHONE_TEL}">Call {PHONE}</a></div>'''
    if (PUB / "assets" / "img" / f"hero-{slug}-1920.webp").exists():
        img = f"/assets/img/hero-{slug}"
        body = f'''<section class="sh"><picture><source media="(max-width:760px)" srcset="{v(img + "-mobile.webp")}">
<img class="sh-img" src="{v(img + "-1920.webp")}" srcset="{v(img + "-1280.webp")} 1280w, {v(img + "-1920.webp")} 1920w" sizes="100vw" width="1920" height="640" alt="{html.escape(s.get("alt", ""))}" fetchpriority="high"></picture>
<div class="sh-inner"><div class="sh-text">{intro}</div></div></section>
<div class="wrap"><aside class="facts facts-strip" aria-label="At a glance"><dl>{facts}</dl></aside><div class="crumbs-below">{crumbs(trail)}</div></div>
'''
    else:
        body = f'''<section class="hero"><div class="wrap" style="display:block;padding-bottom:0">{crumbs(trail)}</div>
<div class="wrap">
<div class="hero-main">
{intro}
</div>
<aside class="facts" aria-label="At a glance"><dl>{facts}</dl></aside>
</div></section>
'''
    body += f'''<div class="wrap cols">
<section class="col"><h2>{s["for_title"]}</h2><ul class="ticks">{fors}</ul></section>
<section class="col"><h2>{s["offer_title"]}</h2><ul class="ticks">{offers}</ul></section>
</div>
<section class="steps"><div class="wrap"><h2>How to get started</h2><div class="grid">
<div><span>STEP 1</span><h3>Reach out</h3><p>Call {PHONE}, request a call back, or have a professional send a referral.</p></div>
<div><span>STEP 2</span><h3>Free consultation</h3><p>We talk through your needs, check eligibility and insurance, and explain your options.</p></div>
<div><span>STEP 3</span><h3>Begin services</h3><p>You're matched with a counselor or program team and services begin.</p></div>
</div></div></section>
{tour}<div class="wrap faq"><div style="flex:1 1 300px;display:flex;flex-direction:column;gap:12px"><h2>Common questions</h2><p style="color:#3E5064">Don't see your question? Call us at <a href="tel:{PHONE_TEL}">{PHONE}</a>.</p></div>
<div class="list">{faqs}</div></div>
<section class="loc" aria-label="Location"><div class="wrap">{locs}</div></section>
<div class="wrap cta"><div class="cta-box"><div style="flex:1 1 420px;display:flex;flex-direction:column;gap:8px"><h2>Ready to talk?</h2><p>A care coordinator will help you find the right service. If you are in crisis, call or text 988.</p></div><a class="btn" href="tel:{PHONE_TEL}">Call {PHONE}</a></div></div>
<div class="wrap"><h2 style="font-size:24px;padding-bottom:16px">Other services</h2></div>
<div class="wrap related">{related}</div>'''
    service_ld = {"@context": "https://schema.org", "@type": "Service", "name": s["title"], "serviceType": s["title"],
                  "description": plain(s["desc"]), "provider": ORG_REF, "url": SITE + path,
                  "areaServed": [{"@type": "City", "name": "Richmond, VA"}, {"@type": "City", "name": "Petersburg, VA"},
                                 {"@type": "AdministrativeArea", "name": "Chesterfield County, VA"}],
                  "audience": {"@type": "PeopleAudience", "audienceType": s["who"]}}
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": plain(a)}}
        for q, a in s["faqs"] if plain(a)]}
    page(path, s["seo_title"], s["desc"], body, [service_ld, faq_ld, crumb_ld(trail)])


def build_hub():
    trail = [("/", "Home"), ("/services/", "Services")]
    cards = "".join(f'<a href="/services/{k}/"><small>{html.escape(SERVICES[k]["who"])}</small><h2>{SERVICES[k]["title"]}</h2>'
                    f'<p>{html.escape(SERVICES[k]["desc"])}</p><span>Learn more →</span></a>' for k in SERVICES_ORDER)
    cards += (f'<a href="tel:{PHONE_TEL}" style="background:#055496;border-color:#055496;color:#fff"><h2 style="color:#fff">Not sure which fits?</h2>'
              f'<p style="color:#D6E6F5">Call our team and we\'ll help you find the right program, usually in one conversation.</p>'
              f'<span style="color:#fff">Call {PHONE} →</span></a>')
    img = "/assets/img/hero-services"
    body = f'''<section class="sh"><picture><source media="(max-width:760px)" srcset="{v(img + "-mobile.webp")}">
<img class="sh-img" src="{v(img + "-1920.webp")}" srcset="{v(img + "-1280.webp")} 1280w, {v(img + "-1920.webp")} 1920w" sizes="100vw" width="1920" height="640" alt="People of all ages being welcomed in a bright, friendly family services center" fetchpriority="high"></picture>
<div class="sh-inner" style="padding-bottom:56px"><div class="sh-text"><span class="pill">Children · Teens · Adults · Families</span><h1>Our Services</h1>
<p class="lead">Behavioral health and developmental disability services for children, teens, adults and families across Richmond, Petersburg and Central Virginia.</p>
<div class="btns"><a class="btn btn-green" href="/#start">Not sure? Get a free consultation</a><a class="btn btn-line" href="tel:{PHONE_TEL}">Call {PHONE}</a></div></div></div></section>
<div class="wrap crumbs-below">{crumbs(trail)}</div>
<div class="wrap hub" style="padding-top:28px">{cards}</div>'''
    page("/services/", "Behavioral Health & DD Services in Central Virginia | Family Transitions, Inc.",
         "Outpatient therapy, intensive in-home services, mental health skill building, DD day support and sponsored residential services in Richmond and Petersburg, VA.",
         body, [crumb_ld(trail)])


def sync_home():
    """Replace the homepage's top bar, header and footer with the shared versions."""
    p = PUB / "index.html"
    t = p.read_text()
    t = re.sub(r'<div style="background:#033B6B.*?</div></div>', lambda m: topbar(), t, count=1, flags=re.S)
    t = re.sub(r"<header.*?</header>", lambda m: header(home=True), t, count=1, flags=re.S)
    t = re.sub(r"<footer.*?</footer>", lambda m: footer(), t, count=1, flags=re.S)
    if '"@type": "WebSite"' not in t:
        ws = {"@context": "https://schema.org", "@type": "WebSite", "name": "Family Transitions, Inc.", "url": SITE + "/"}
        t = t.replace("</head>", f'<script type="application/ld+json">{json.dumps(ws)}</script>\n</head>', 1)
    t = re.sub(r'<link rel="stylesheet" href="/assets/site.css[^"]*">\n?', "", t)
    t = t.replace("</head>", f'<link rel="stylesheet" href="/assets/site.css?v={CSS_V}">\n</head>', 1)
    t = re.sub(r'<script src="/assets/forms.js[^"]*"[^>]*></script>\n?', "", t)
    t = t.replace("</body>", FORMS_TAG + "\n</body>", 1)
    t = t.replace('<form class="qf-form" action="#" method="post">', '<form class="qf-form" data-form="consult" action="#" method="post">')
    t = t.replace('<input type="text" name="name" autocomplete="name" placeholder="Jane Smith">', '<input type="text" name="name" autocomplete="name" placeholder="Jane Smith" required>')
    t = t.replace('<input type="tel" name="phone" autocomplete="tel" placeholder="(804) 555-0123">', '<input type="tel" name="phone" autocomplete="tel" placeholder="(804) 555-0123" required>')
    p.write_text(t)


FORM_CSS = """
.form-msg{margin:0;padding:12px 14px;border-radius:10px;font-size:15px;line-height:1.5}.form-msg.ok{background:#E7F5EC;color:#06713a;font-weight:600}.form-msg.err{background:#FDECEC;color:#9B1C1C}.qf-form .form-msg{grid-column:1/-1;flex-basis:100%}
.page-hero{background:#F2F7FC}.page-hero .wrap{padding:56px 24px 64px;display:flex;flex-direction:column;gap:18px;max-width:1200px}
.page-hero .lead{max-width:760px}
.split{padding:40px 24px 64px;display:flex;flex-wrap:wrap;gap:48px;align-items:flex-start}
.split .main{flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:40px}
.split .side{flex:2 1 340px;min-width:0;position:sticky;top:24px}
.block{display:flex;flex-direction:column;gap:14px}.block p{color:#3E5064}
.form-card{background:#fff;border:1px solid #E3EAF2;border-radius:20px;box-shadow:0 20px 50px rgba(3,59,107,.10);padding:28px;display:flex;flex-direction:column;gap:14px}
.form-card h2{font-size:24px}.form-card .note{font-size:13px;color:#5A6B7D}
.form-card fieldset{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.form-card legend{font:600 15px Outfit,sans-serif;color:#0F2740;padding:0 0 6px}
.form-card label{font-size:13px;font-weight:600;color:#3E5064;display:flex;flex-direction:column;gap:6px}
.form-card input:not([type=checkbox]),.form-card select,.form-card textarea{padding:11px 13px;border:1px solid #CBD6E2;border-radius:10px;background:#fff;font:inherit}
.form-card .row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.form-card label,.form-card fieldset{min-width:0}
.form-card input:not([type=checkbox]),.form-card select,.form-card textarea{width:100%;box-sizing:border-box;min-width:0}
.form-card .check{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;color:#5A6B7D}
.form-card button{padding:15px;background:#078643;border:0;border-radius:12px;font:700 16px Inter,sans-serif;color:#fff;cursor:pointer}
.form-card button:hover{background:#06713a}
.alert{background:#FFF6E5;border:1px solid #F2D9A6;border-radius:14px;padding:18px 20px;color:#5A4200;display:flex;flex-direction:column;gap:6px}
.alert strong{color:#3B2E12}
.numbered{counter-reset:n;list-style:none;margin:0;padding:0;display:grid;gap:16px}
.numbered li{counter-increment:n;padding-left:52px;position:relative;color:#3E5064;line-height:1.5}
.numbered li:before{content:counter(n);position:absolute;left:0;top:-2px;width:36px;height:36px;border-radius:50%;background:#055496;color:#fff;font:700 16px Outfit,sans-serif;display:flex;align-items:center;justify-content:center}
.numbered strong{display:block;color:#0F2740;font-family:Outfit,sans-serif;font-size:18px}
.loc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px;padding:56px 24px 80px}
.loc-card{border:1px solid #E3EAF2;border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:16px}
.loc-body{padding:0 8px 8px;display:flex;flex-direction:column;gap:12px}.loc-body h2{font-size:26px}.loc-body p{color:#3E5064}
.side .form-card .btn{display:block}
@media (max-width:640px){.loc-grid{grid-template-columns:1fr}.form-card .row{grid-template-columns:1fr}.split .side{position:static}}
"""

SVC_OPTIONS = "".join(f"<option>{SERVICES[s]['title']}</option>" for s in SERVICES_ORDER)


def simple_hero(trail, pill, title, lead, buttons=True, slug=None, alt=""):
    btns = (f'<div class="btns"><a class="btn btn-green" href="#form">{"Start below"}</a>'
            f'<a class="btn btn-line" href="tel:{PHONE_TEL}">Call {PHONE}</a></div>') if buttons else ""
    if slug and (PUB / "assets" / "img" / f"hero-{slug}-1920.webp").exists():
        img = f"/assets/img/hero-{slug}"
        return (f'<section class="sh"><picture><source media="(max-width:760px)" srcset="{v(img + "-mobile.webp")}">'
                f'<img class="sh-img" src="{v(img + "-1920.webp")}" srcset="{v(img + "-1280.webp")} 1280w, {v(img + "-1920.webp")} 1920w" sizes="100vw" width="1920" height="640" alt="{html.escape(alt)}" fetchpriority="high"></picture>'
                f'<div class="sh-inner" style="padding-bottom:56px"><div class="sh-text"><span class="pill">{pill}</span><h1>{title}</h1><p class="lead">{lead}</p>{btns}</div></div></section>'
                f'<div class="wrap crumbs-below">{crumbs(trail)}</div>')
    return (f'<section class="page-hero"><div class="wrap">{crumbs(trail)}<span class="pill">{pill}</span>'
            f'<h1>{title}</h1><p class="lead">{lead}</p>{btns}</div></section>')


def faq_html(faqs):
    return "".join(f"<details><summary>{html.escape(q)}</summary><p>{ph(a)}</p></details>" for q, a in faqs)


def faq_ld(faqs):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": plain(a)}} for q, a in faqs if plain(a)]}


def build_provider():
    path = "/become-a-provider/"
    trail = [("/", "Home"), ("/services/sponsored-residential/", "Sponsored Residential"), (path, "Become a Provider")]
    faqs = [("Who can become a sponsored residential provider?", "Individuals and families in Central Virginia, including Richmond, Petersburg and Chesterfield, who have a caring nature and a stable, safe home. Caregiving experience helps, but we provide training."),
            ("Do I need experience?", "No. Experience with people with disabilities is welcome, but a willingness to learn matters most. We train every provider before a placement."),
            ("How are providers paid?", "Providers receive competitive compensation through Medicaid and state programs. [[Typical compensation range and how often providers are paid.]]"),
            ("What does my home need?", "A safe, stable home with a private bedroom for the resident. [[Full home requirements and what the home assessment checks.]]"),
            ("How long does it take to become a provider?", "[[Typical timeline from application to first placement, and length of training.]]"),
            ("Will there be a background check?", "Yes. Background checks are required for providers and adult household members. We collect that information securely later in the process, not on this form.")]
    body = simple_hero(trail, "Sponsored Residential · Now recruiting", "Become a Sponsored Residential Provider",
        "Open your home to an adult with an intellectual or developmental disability, and help them live a full life in the community. You'll get training, 24/7 support from our team, and competitive compensation.",
        slug="become-a-provider", alt="A smiling provider couple welcoming two adults with a duffel bag at the front door of their home")
    body += f'''<div class="wrap split"><div class="main">
<section class="block"><h2>Why become a provider</h2><ul class="ticks">
<li>Make a lasting difference by giving someone a real home and a place in a family</li>
<li>Provide care in your own home instead of a facility</li>
<li>Competitive compensation through Medicaid and state programs</li>
<li>Training before your first placement, and ongoing support from our team 24/7</li></ul></section>
<section class="block"><h2>What providers do</h2><ul class="ticks">
<li>Help with daily activities such as meals, transportation and personal care</li>
<li>Encourage independence and involvement in the community</li>
<li>Build a caring, respectful relationship that improves the resident's quality of life</li></ul></section>
<section class="block"><h2>Who we're looking for</h2><p>People with a caring nature and a stable, safe home in Central Virginia, including Richmond, Petersburg and Chesterfield. We especially welcome families or individuals who are patient, reliable and empathetic. Caregiving experience is a plus, but not required.</p></section>
<section class="block"><h2>How it works</h2><ol class="numbered">
<li><strong>Tell us about yourself</strong>Fill out the short interest form. It takes about two minutes.</li>
<li><strong>Talk with our team</strong>We call to answer your questions and explain the next steps.</li>
<li><strong>Training and home assessment</strong>You complete provider training, and we visit your home to make sure it's ready.</li>
<li><strong>Welcome a resident</strong>{ph("[[Confirm how residents are matched with providers.]]")}</li></ol></section>
<section class="block"><h2>Common questions</h2><div style="display:flex;flex-direction:column;gap:12px">{faq_html(faqs)}</div></section>
</div>
<aside class="side" id="form"><form class="form-card" data-form="provider" action="#" method="post">
<h2>I'm interested</h2><p class="note">No commitment. We'll call you to talk it through.</p>
<div class="row"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Last name<input name="last_name" autocomplete="family-name" required></label></div>
<label>Phone<input type="tel" name="phone" autocomplete="tel" required></label>
<label>Email<input type="email" name="email" autocomplete="email"></label>
<div class="row"><label>City<input name="city" autocomplete="address-level2"></label><label>ZIP<input name="zip" inputmode="numeric" autocomplete="postal-code"></label></div>
<div class="row"><label>Own or rent?<select name="own_rent"><option>Own</option><option>Rent</option></select></label>
<label>People in your home<select name="household"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6+</option></select></label></div>
<label>Do you have a private bedroom available?<select name="bedroom"><option>Yes</option><option>No</option><option>Not sure yet</option></select></label>
<div class="row"><label>Valid driver's license?<select name="license"><option>Yes</option><option>No</option></select></label>
<label>Open to a background check?<select name="bg_ok"><option>Yes</option><option>No</option></select></label></div>
<label>Experience with people with disabilities (optional)<textarea name="experience" rows="2"></textarea></label>
<label>Why are you interested? (optional)<textarea name="why" rows="2"></textarea></label>
<label class="check"><input type="checkbox" name="contact_ok" required>I agree to be contacted by phone, email or text about becoming a provider. Msg &amp; data rates may apply. Reply STOP to opt out.</label>
<label class="check"><input type="checkbox" name="marketing_ok">Send me occasional news about provider openings and events (optional).</label>
<button type="submit">Send my interest</button>
<p class="note">See our <a href="/privacy/">Privacy Policy</a>.</p>
</form></aside></div>'''
    page(path, "Become a Sponsored Residential Provider in Central Virginia | Family Transitions, Inc.",
         "Open your home to an adult with intellectual or developmental disabilities in Richmond, Petersburg or Chesterfield, VA. Training, 24/7 support and competitive compensation.",
         body, [faq_ld(faqs), crumb_ld(trail)])


def build_referrals():
    path = "/referrals/"
    trail = [("/", "Home"), (path, "Referrals")]
    faqs = [("Who can make a referral?", "Anyone: parents and guardians, the person seeking services, schools, doctors, case managers, social workers, probation officers, Department of Social Services staff and other community agencies."),
            ("What happens after I send a referral?", "Our intake team reviews it and calls the person who made the referral to gather details and check eligibility. [[Typical response time.]]"),
            ("Can I fax a referral?", "[[Confirm the referral fax number.]]"),
            ("Why doesn't the form ask for diagnosis or medical details?", "To protect privacy, we collect clinical information by phone or through a secure process during intake, not through the website.")]
    body = simple_hero(trail, "For families and professionals", "Make a Referral",
        "Refer yourself, a family member, or a client to Family Transitions. Send a short referral below or call us, and our intake team will follow up.",
        slug="referrals", alt="A smiling intake coordinator wearing a headset and taking notes at her desk")
    body += f'''<div class="wrap split"><div class="main">
<div class="alert" role="note"><strong>Is this an emergency?</strong><span>If someone is in immediate danger, call 911. For a mental health crisis, call or text 988, available 24/7.</span></div>
<section class="block"><h2>Who can refer</h2><p>Anyone can make a referral, including the person seeking services. We often receive referrals from parents and guardians, schools, physicians, case managers, social workers, probation officers and community agencies.</p></section>
<section class="block"><h2>Services you can refer to</h2><ul class="ticks">{"".join(f'<li><a href="/services/{s}/">{SERVICES[s]["title"]}</a>, {html.escape(SERVICES[s]["who"])}</li>' for s in SERVICES_ORDER)}</ul></section>
<section class="block"><h2>What happens next</h2><ol class="numbered">
<li><strong>We receive your referral</strong>Send the short form or call {PHONE}.</li>
<li><strong>Intake call</strong>Our team calls to learn more, check eligibility and insurance, and answer questions. {ph("[[Typical response time.]]")}</li>
<li><strong>Services begin</strong>The person is matched with the right program and team.</li></ol></section>
<section class="block"><h2>Common questions</h2><div style="display:flex;flex-direction:column;gap:12px">{faq_html(faqs)}</div></section>
</div>
<aside class="side" id="form"><form class="form-card" data-form="referral" action="#" method="post">
<h2>Send a referral</h2><p class="note">Please don't include diagnoses, medical history or other clinical details. We'll collect those securely during intake.</p>
<fieldset><legend>About you</legend>
<div class="row"><label>Your name<input name="referrer_name" autocomplete="name" required></label><label>Your phone<input type="tel" name="referrer_phone" autocomplete="tel" required></label></div>
<label>Your email<input type="email" name="referrer_email" autocomplete="email"></label>
<div class="row"><label>You are<select name="referrer_role"><option>Parent or guardian</option><option>Referring myself</option><option>School</option><option>Doctor or clinician</option><option>Case manager or social worker</option><option>Probation officer</option><option>Other professional</option><option>Other</option></select></label>
<label>Organization (if any)<input name="organization" autocomplete="organization"></label></div></fieldset>
<fieldset><legend>Who is the referral for?</legend>
<div class="row"><label>First name<input name="client_first" required></label><label>Last initial<input name="client_last_initial" maxlength="1"></label></div>
<label>Service<select name="service" required><option>Not sure — help us choose</option>{SVC_OPTIONS}</select></label>
<label>How did you hear about us?<select name="source"><option>Social worker</option><option>Probation officer</option><option>School</option><option>Doctor or clinician</option><option>Word of mouth / friend</option><option>Google or online search</option><option>Radio</option><option>Other</option></select></label>
<label>Best time to call<select name="best_time"><option>Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select></label></fieldset>
<label class="check"><input type="checkbox" name="consent" required>I confirm I have permission to share this information, and I agree to be contacted by phone, email or text about this referral.</label>
<label class="check"><input type="checkbox" name="marketing_ok">Send me occasional updates for referral partners (optional).</label>
<button type="submit">Send referral</button>
<p class="note">Prefer to talk? Call <a href="tel:{PHONE_TEL}">{PHONE}</a>. See our <a href="/privacy/">Privacy Policy</a>.</p>
</form></aside></div>'''
    page(path, "Make a Referral | Family Transitions, Inc. | Richmond & Petersburg, VA",
         "Refer yourself, a family member or a client to Family Transitions for therapy, in-home counseling, skill building, DD day support or sponsored residential services.",
         body, [faq_ld(faqs), crumb_ld(trail)])


LOCATIONS = {
 "north-chesterfield": {**ADMIN, "label": "North Chesterfield", "title": "Administrative Office & Outpatient Therapy",
   "intro": "Our main office in North Chesterfield is home to our administrative team and outpatient therapy, and it's the base for our in-home and community-based programs across the Richmond area.",
   "services": ["outpatient-therapy", "intensive-in-home", "mental-health-skill-building", "sponsored-residential"],
   "hours": "Mon–Thu 9 AM–5 PM, Fri 9 AM–4 PM", "hours_ld": ["Mo-Th 09:00-17:00", "Fr 09:00-16:00"], "alt": "A receptionist warmly greeting a parent and teen in a bright counseling office waiting area"},
 "petersburg": {**PETERSBURG, "label": "Petersburg", "title": "DD Day Support Center",
   "intro": "Our Petersburg center is where adults with developmental disabilities come for day support: skill building, recreation, community outings and friendship in a bright, modern space.",
   "services": ["dd-day-support"],
   "hours": "Mon–Fri 8:30 AM–3:30 PM", "hours_ld": ["Mo-Fr 08:30-15:30"], "alt": "A staff member welcoming adults arriving at a bright day support center"},
}


def map_embed(loc, h=320):
    q = f'{loc["street"]}, {loc["city"]}, VA {loc["zip"]}'.replace(" ", "+")
    return (f'<iframe title="Map of {html.escape(loc["street"])}, {loc["city"]}" src="https://www.google.com/maps?q={q}&amp;output=embed" '
            f'width="100%" height="{h}" style="border:0;border-radius:16px;display:block" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>')


def directions(loc):
    q = f'{loc["street"]}, {loc["city"]}, VA {loc["zip"]}'.replace(" ", "+")
    return f"https://www.google.com/maps/dir/?api=1&amp;destination={q}"


def loc_ld(slug):
    l = LOCATIONS[slug]
    return {"@context": "https://schema.org", "@type": "MedicalClinic", "name": f"Family Transitions, Inc. – {l['label']}",
            "url": f"{SITE}/locations/{slug}/", "telephone": "+1-" + l["phone"].replace("(", "").replace(") ", "-"),
            "address": {"@type": "PostalAddress", "streetAddress": l["street"], "addressLocality": l["city"], "addressRegion": "VA",
                        "postalCode": l["zip"], "addressCountry": "US"},
            "parentOrganization": ORG_REF, "openingHours": l.get("hours_ld", []),
            "availableService": [{"@type": "MedicalTherapy", "name": SERVICES[s]["title"], "url": f"{SITE}/services/{s}/"} for s in l["services"]]}


def build_locations():
    path = "/locations/"
    trail = [("/", "Home"), (path, "Locations")]
    cards = ""
    for slug, l in LOCATIONS.items():
        svcs = "".join(f'<li><a href="/services/{s}/">{SERVICES[s]["title"]}</a></li>' for s in l["services"])
        cards += f'''<article class="loc-card">{map_embed(l, 260)}
<div class="loc-body"><span class="pill">{l["label"]}</span><h2><a href="/locations/{slug}/" style="color:inherit;text-decoration:none">{l["title"]}</a></h2>
<p>{l["street"]}<br>{l["city"]}, VA {l["zip"]}</p>
<p><a href="tel:{l["tel"]}" style="font-weight:600;text-decoration:none">{l["phone"]}</a> · Hours: {ph(l["hours"])}</p>
<ul class="ticks">{svcs}</ul>
<div class="btns"><a class="btn btn-line" href="{directions(l)}" target="_blank" rel="noopener">Get directions</a><a class="btn btn-green" href="/locations/{slug}/">Location details</a></div></div></article>'''
    body = simple_hero(trail, "Richmond · Petersburg · Central Virginia", "Our Locations",
        "Two offices serving families across Central Virginia. Many of our services also come to you, at home and in the community.", buttons=False,
        slug="locations", alt="A tree-lined historic main street in a Central Virginia small city")
    body += f'<div class="wrap loc-grid">{cards}</div>'
    page(path, "Locations in North Chesterfield & Petersburg, VA | Family Transitions, Inc.",
         "Visit Family Transitions at 620 Moorefield Park Drive in North Chesterfield or our DD Day Support center at 111 Morton Avenue in Petersburg, VA.",
         body, [crumb_ld(trail)] + [loc_ld(s) for s in LOCATIONS])
    for slug, l in LOCATIONS.items():
        lp = f"/locations/{slug}/"
        tr = [("/", "Home"), ("/locations/", "Locations"), (lp, l["label"])]
        svc_cards = "".join(f'<a href="/services/{s}/"><small>{html.escape(SERVICES[s]["who"])}</small><h2>{SERVICES[s]["title"]}</h2><p>{html.escape(SERVICES[s]["desc"])}</p><span>Learn more →</span></a>' for s in l["services"])
        other = [o for o in LOCATIONS if o != slug][0]
        b = simple_hero(tr, f'{l["label"]}, VA', f'{l["title"]} in {l["city"]}', l["intro"], buttons=False,
                        slug=f"location-{slug}", alt=l.get("alt", ""))
        b += f'''<div class="wrap split"><div class="main">
<section class="block"><h2>Services at this location</h2></section>
<div class="hub" style="padding:0;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">{svc_cards}</div>
<section class="block"><h2>Visiting us</h2><p>{ph("[[Parking, entrance and accessibility details for this location.]]")}</p></section>
<p>Looking for our other office? See <a href="/locations/{other}/">{LOCATIONS[other]["title"]} in {LOCATIONS[other]["city"]}</a>.</p>
</div>
<aside class="side"><div class="form-card">{map_embed(l, 280)}
<h2>{l["street"]}<br>{l["city"]}, VA {l["zip"]}</h2>
<p><a href="tel:{l["tel"]}" style="font-weight:600;text-decoration:none">{l["phone"]}</a></p>
<p class="note">Hours: {ph(l["hours"])}</p>
<a class="btn btn-green" style="text-align:center" href="{directions(l)}" target="_blank" rel="noopener">Get directions</a></div></aside></div>'''
        page(lp, f'{l["title"]} in {l["city"]}, VA | Family Transitions, Inc.',
             f'Family Transitions {l["title"]} at {l["street"]}, {l["city"]}, VA {l["zip"]}. Call {l["phone"]}.', b, [loc_ld(slug), crumb_ld(tr)])


def build_about():
    path = "/about/"
    trail = [("/", "Home"), (path, "About")]
    values = ["Our clients' needs come first, always.", "We pursue positive, lasting results.",
              "We're committed to our staff, with teamwork and open communication.", "We provide the highest level of service to the people we serve.",
              "We continuously improve how we work.", "We live up to our commitments."]
    vals = "".join(f"<li>{v}</li>" for v in values)
    body = simple_hero(trail, "Since 2003", "About Family Transitions",
        "We help individuals and families live healthy, fulfilling lives at home and in their communities. For more than 20 years, we've provided behavioral health and developmental disability services across Central Virginia.", buttons=False,
        slug="about", alt="Neighbors of all ages enjoying a tree-lined Central Virginia street at sunset")
    body += f'''<div class="wrap split"><div class="main">
<section class="block"><h2>Our mission</h2><p>Family Transitions, Inc. believes the family is at the center of each person's well-being. We identify youth, adults and families who are at risk and provide services that strengthen families and help people stay in their homes and communities.</p>
<p>That work can mean reuniting families, setting healthy boundaries, reducing problem behaviors, stepping in at school when needed, and supporting families over the long term. Through community-based therapeutic services, we help people build a healthier sense of self, stronger coping skills and greater independence.</p></section>
<section class="block"><h2>Our story</h2><p>Family Transitions began in 2003 as a small agency offering intensive in-home services. Today we provide five programs, from outpatient therapy to sponsored residential homes, for children, teens, adults and families in Richmond, Petersburg and the surrounding area. We focus on high-quality, cost-effective care, community participation, and hiring from the communities we serve.</p></section>
<section class="block"><h2>Our values</h2><ul class="ticks">{vals}</ul></section>
<section class="block"><h2>Licensing</h2><p>Our programs are licensed by the Virginia Department of Behavioral Health and Developmental Services (DBHDS). {ph("[[License numbers and any accreditations.]]")}</p></section>
<section class="block"><h2>Our leadership</h2><p>{ph("[[Leadership names, titles and short bios, with photos.]]")}</p></section>
</div>
<aside class="side"><div class="form-card"><h2>At a glance</h2>
<dl style="margin:0;display:grid;gap:12px"><div><dt class="note">Founded</dt><dd style="margin:0;font-weight:600">2003</dd></div>
<div><dt class="note">Programs</dt><dd style="margin:0;font-weight:600">5 services for all ages</dd></div>
<div><dt class="note">Locations</dt><dd style="margin:0;font-weight:600"><a href="/locations/north-chesterfield/">North Chesterfield</a> and <a href="/locations/petersburg/">Petersburg</a></dd></div>
<div><dt class="note">Main phone</dt><dd style="margin:0;font-weight:600"><a href="tel:{PHONE_TEL}">{PHONE}</a></dd></div></dl>
<a class="btn btn-green" style="text-align:center" href="/services/">Explore our services</a>
<a class="btn btn-line" style="text-align:center" href="/careers/">Work with us</a></div></aside></div>'''
    about_ld = {"@context": "https://schema.org", "@type": "AboutPage", "url": SITE + path, "mainEntity": {**ORG_REF, "foundingDate": "2003",
                "logo": SITE + "/assets/fti-logo.svg", "address": {"@type": "PostalAddress", "streetAddress": ADMIN["street"], "addressLocality": ADMIN["city"],
                "addressRegion": "VA", "postalCode": ADMIN["zip"], "addressCountry": "US"}}}
    page(path, "About Family Transitions, Inc. | Behavioral Health in Central Virginia Since 2003",
         "Family Transitions, Inc. has helped individuals and families in Richmond, Petersburg and Central Virginia since 2003. Our mission, story and values.",
         body, [about_ld, crumb_ld(trail)])


ARTICLES = [
 {"slug": "intensive-in-home-services-richmond-va", "title": "Intensive In-Home Services in Richmond, VA: Support for Children, Youth and Families",
  "short": "Intensive In-Home Services in Richmond, VA", "date": "2026-05-12", "modified": "2026-11-25", "topic": "Intensive In-Home",
  "desc": "How Intensive In-Home Services help children and young adults ages 5 to 21 and their families in Richmond, North Chesterfield and Petersburg, VA.",
  "image": "/assets/img/article-intensive-in-home-services-richmond-va.webp",
  "image_alt": "An in-home counselor talking with a smiling mother and daughter at their kitchen table",
  "faqs": [("What are Intensive In-Home Services?", "Intensive In-Home Services are home-based behavioral health services for children and young adults who are experiencing emotional, behavioral or mental health challenges. They support the child and family in the home and community."),
           ("Who is eligible for Intensive In-Home Services?", "Family Transitions, Inc. provides Intensive In-Home Services for children and young adults ages 5 to 21 who meet clinical necessity criteria and are experiencing serious emotional, behavioral or mental health difficulties."),
           ("Does Family Transitions provide Intensive In-Home Services in Richmond, VA?", "Yes. Family Transitions, Inc. serves families in Richmond, North Chesterfield, Petersburg and surrounding Central Virginia communities."),
           ("Can Intensive In-Home Services help prevent out-of-home placement?", "Yes. One of the program's goals is to prevent unnecessary out-of-home placements and preserve the family whenever clinically appropriate."),
           ("How do I make a referral for Intensive In-Home Services?", "Contact the In-Home Services Director or Clinical Director at Family Transitions, Inc. by calling (804) 745-5101, or send a referral online.")],
  "body": """<p>When a child or young adult is struggling emotionally, behaviorally or mentally, the whole family can feel overwhelmed. Many families in Richmond, North Chesterfield, Petersburg and surrounding Central Virginia communities need more than occasional support. They need structured, compassionate help delivered where life actually happens: <strong>inside the home</strong>.</p>
<p>Family Transitions, Inc. provides <a href="/services/intensive-in-home/">Intensive In-Home Services</a> for children and young adults ages <strong>5 to 21</strong> who are experiencing emotional difficulties, are at risk of out-of-home placement, or are returning home after an out-of-home placement.</p>
<p>Our goal is simple but powerful: help families build stability, strengthen coping skills, and keep the family together whenever clinically appropriate.</p>
<h2>What are Intensive In-Home Services?</h2>
<p>Intensive In-Home Services, often called IIH services, are home-based behavioral health services that support children, adolescents, young adults and their families during periods of emotional or behavioral difficulty.</p>
<p>Unlike traditional office-based therapy, Intensive In-Home Services take place in the family's natural environment. That lets counselors understand family dynamics, daily stressors, routines, communication patterns and safety concerns.</p>
<p>At Family Transitions, our Intensive In-Home Services are family-focused. They address the child's mental health needs while also helping the family connect with educational, medical, social, economic and legal supports when needed.</p>
<h2>Who can benefit?</h2>
<p>Intensive In-Home Services may be right for children and young adults facing serious emotional, behavioral or mental health challenges. A referral may be appropriate when a child or youth:</p>
<ul><li>Is experiencing emotional difficulties</li><li>Is returning home from an out-of-home placement</li><li>Is at serious risk of out-of-home placement</li><li>Needs Intensive In-Home Services as a necessary treatment strategy</li></ul>
<p>We serve children and young adults ages 5 to 21 who meet clinical criteria.</p>
<h2>Why families in Central Virginia choose Family Transitions</h2>
<p>Every family has strengths, and every child has potential. We approach Intensive In-Home Services with respect for each family's culture, values, spiritual life, emotional needs and right to make its own decisions. We don't impose values on families. We help them identify their own strengths and build on them.</p>
<p>Our program emphasizes:</p>
<ul><li><strong>Individualized support</strong> tailored to each family's needs</li><li><strong>Small counselor caseloads</strong>, typically no more than four to five clients</li><li><strong>Family empowerment</strong> through skill building and crisis-management strategies</li><li><strong>Strength-based treatment planning</strong> with meaningful family input</li><li><strong>Training and accountability</strong> for counselors to ensure quality care</li></ul>
<p>This approach helps families feel supported, heard and actively involved in treatment.</p>
<h2>Goals of Intensive In-Home Services</h2>
<p>The main goal is to help children and families function better at home, at school and in the community. Our services are designed to:</p>
<ul><li>Preserve the integrity of the family</li><li>Prevent unnecessary out-of-home placements</li><li>Connect children and families with the right community agencies</li><li>Help create an ongoing support system</li><li>Strengthen family coping skills</li><li>Improve the family's ability to handle stress and crises</li></ul>
<h2>How in-home counseling helps families</h2>
<p>Because the work happens at home, counselors can help families practice new skills in real situations instead of only talking about them in an office. Services can help families:</p>
<ul><li>Improve communication between caregivers and children</li><li>Develop healthier ways to resolve conflict</li><li>Create safer, more consistent routines</li><li>Understand emotional and behavioral triggers</li><li>Build crisis-prevention and coping skills</li><li>Connect with community resources</li><li>Support a child's transition back home after a placement</li></ul>
<h2>Eligibility</h2>
<p>Eligibility is based on clinical necessity. A young person must show a need for services arising from a serious mental health, behavioral or emotional condition that significantly affects major life activities. This may include serious difficulty with relationships, repeated involvement of community systems because of behavior, or difficulty recognizing personal danger or significantly inappropriate social behavior.</p>
<p>Because eligibility depends on clinical need, families and referral sources should <a href="/referrals/">contact us</a> to talk about whether Intensive In-Home Services are a good fit.</p>
<h2>Serving Richmond, North Chesterfield and Petersburg</h2>
<p>Families in Central Virginia are served from our <a href="/locations/north-chesterfield/">administrative office in North Chesterfield</a> (620 Moorefield Park Drive, Suite 218) and our <a href="/locations/petersburg/">Petersburg location</a> (111 Morton Avenue). Counselors come to you, at home and in the community.</p>
<h2>When should you make a referral?</h2>
<p>A referral may be appropriate when a child's emotional or behavioral needs are straining the family, raising safety concerns, or creating a risk of removal from the home. Parents, guardians, case managers, schools, social services professionals, court service units and other referral sources can all refer.</p>
<p>To make a referral, contact the In-Home Services Director or Clinical Director by calling <a href="tel:8047455101">(804) 745-5101</a>, or <a href="/referrals/">send a referral online</a>.</p>
<h2>Frequently asked questions</h2>
{faq}"""},
 {"slug": "what-is-sponsored-residential", "title": "What Is Sponsored Residential? A Beneficial Approach for Families and Individuals with ID/DD",
  "short": "What Is Sponsored Residential?", "date": "2025-01-21", "modified": "2026-05-12", "topic": "Sponsored Residential",
  "desc": "How sponsored residential services give adults with intellectual and developmental disabilities a family-like home, personalized support and a place in the community.",
  "image": "/assets/img/article-what-is-sponsored-residential.webp",
  "image_alt": "A young man and a caregiver smiling together at a kitchen table, with the article title and Family Transitions phone numbers",
  "body": """<p>Sponsored residential services are a vital resource for individuals with intellectual and developmental disabilities (ID/DD) and their families. This person-centered care model allows individuals to live in a nurturing, family-like environment while receiving personalized support tailored to their unique needs and preferences.</p>
<h2>A closer look at sponsored residential</h2>
<p>Sponsored residential services allow individuals with ID/DD to live in the home of a trained provider or family. These homes are licensed and meet stringent state and federal requirements to ensure safety, quality and accessibility. Providers offer comprehensive support for daily living activities, community involvement and personal development.</p>
<p>Unlike traditional group homes, sponsored residential services offer a highly personalized approach. With smaller caregiver-to-individual ratios, individuals benefit from focused attention and meaningful relationships. This model fosters personal growth, independence and a sense of belonging.</p>
<h2>Key benefits of sponsored residential services</h2>
<ol>
<li><strong>Personalized care:</strong> Providers create individualized support plans addressing physical, emotional and social needs, so each individual receives the care and guidance they need to achieve their goals.</li>
<li><strong>Community integration:</strong> Living in a community setting helps individuals with ID/DD take part in social events, employment opportunities and volunteer activities, promoting a sense of inclusion and belonging.</li>
<li><strong>Family-like environment:</strong> Smaller settings and a consistent caregiver presence create a warm, supportive atmosphere that helps individuals thrive in close relationships.</li>
<li><strong>Relief for families:</strong> Families gain peace of mind knowing their loved one is cared for in a safe and compassionate environment by trained professionals.</li>
<li><strong>Skill development:</strong> Individuals learn essential life skills such as cooking, budgeting, personal hygiene and communication, which build independence and confidence.</li>
</ol>
<h2>Why sponsored residential services are important</h2>
<p>Sponsored residential services fill a growing need for inclusive and flexible care models. They:</p>
<ul>
<li><strong>Promote inclusion:</strong> They uphold the principles of dignity and community inclusion by offering placements in welcoming, residential settings.</li>
<li><strong>Support family dynamics:</strong> For families unable to provide 24/7 care, sponsored residential services serve as a trusted partner.</li>
<li><strong>Encourage independence:</strong> Personalized care plans help individuals with ID/DD pursue their goals and lead fulfilling lives.</li>
</ul>
<h2>How to access sponsored residential services</h2>
<p>To explore sponsored residential options for yourself or a loved one:</p>
<ul>
<li>Contact your local Department of Social Services or Community Services Board.</li>
<li>Work with a case manager or support coordinator to determine eligibility and identify suitable placements.</li>
</ul>
<p>Sponsored residential services are a cornerstone of comprehensive care for individuals with ID/DD. They provide an environment where individuals can flourish, and families can be confident in the quality of care. Together, we can create a more inclusive community where everyone has the opportunity to live with dignity and purpose.</p>
<p>Family Transitions, Inc. is proud to offer <a href="/services/sponsored-residential/">sponsored residential services</a>. To learn more, <a href="/referrals/">make a referral</a> or call <a href="tel:8047455101">(804) 745-5101</a>. Interested in opening your home? <a href="/become-a-provider/">Become a provider</a>.</p>
<h2>Helpful links and resources</h2>
<ul>
<li><a href="https://dbhds.virginia.gov/" rel="noopener" target="_blank">Virginia Department of Behavioral Health and Developmental Services</a></li>
<li><a href="https://thearc.org/" rel="noopener" target="_blank">The Arc of the United States</a></li>
<li><a href="https://nacdd.org/" rel="noopener" target="_blank">National Association of Councils on Developmental Disabilities</a></li>
</ul>"""},
]

ARTICLE_CSS = """
.article{max-width:760px;margin:0 auto;padding:40px 24px 72px}
.article .meta{color:#5A6B7D;font-size:14px}
.article h1{font-size:40px;margin:10px 0 18px}
.article img.feature{width:100%;height:auto;border-radius:18px;margin:8px 0 28px}
.article h2{font-size:26px;margin:32px 0 12px}
.article p,.article li{font-size:17px;line-height:1.7;color:#2E3F52}
.article p{margin:0 0 16px}.article ul,.article ol{padding-left:22px;display:grid;gap:8px;margin:0 0 16px}
.article details{margin-bottom:12px}.article details p{font-size:16px}
.article .cta-inline{background:#F2F7FC;border-radius:16px;padding:22px;margin-top:28px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
.posts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;padding:40px 24px 80px}
.post-card{border:1px solid #E3EAF2;border-radius:18px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column}
.post-card img{width:100%;aspect-ratio:3/2;object-fit:cover}
.post-card div{padding:20px;display:flex;flex-direction:column;gap:8px}.post-card h2{font-size:21px}.post-card p{color:#4A5B6E;font-size:15px}
.post-card small{color:#8A5A12;font-weight:600}
.aud{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;padding:48px 24px 80px}
.aud section{border:1px solid #E3EAF2;border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:12px}
.aud h2{font-size:24px}.aud p{color:#3E5064}
.jobs{display:grid;gap:16px}
.job{border:1px solid #E3EAF2;border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:8px}
.job h3{font-size:20px;color:#0F2740}.job p{color:#3E5064}.job .tags{display:flex;gap:8px;flex-wrap:wrap}
.job .tags span{font-size:12px;font-weight:600;background:#EEF4FA;color:#033B6B;padding:4px 10px;border-radius:999px}
.legal{max-width:820px;margin:0 auto;padding:40px 24px 80px}.legal h2{font-size:24px;margin:28px 0 10px}.legal p,.legal li{color:#2E3F52;line-height:1.7}.legal p{margin:0 0 14px}
"""


def build_resources():
    path = "/resources/"
    trail = [("/", "Home"), (path, "Resources")]
    cards = "".join(f'<a class="post-card" href="/resources/{a["slug"]}/"><img src="{v(a["image"])}" alt="" loading="lazy" width="1200" height="800"><div><small>{a["topic"]}</small><h2>{html.escape(a["short"])}</h2><p>{html.escape(a["desc"])}</p></div></a>' for a in ARTICLES)
    body = simple_hero(trail, "Guides and articles", "Resources",
        "Plain-language guides for families, caregivers and professionals about our services, disability supports and mental health in Central Virginia.", buttons=False,
        slug="resources", alt="A mother and her teenage son smiling as they read together on a laptop at the kitchen table")
    body += f'<div class="wrap posts">{cards}</div>'
    page(path, "Resources & Articles | Family Transitions, Inc.",
         "Guides and articles from Family Transitions about sponsored residential, in-home services, disability supports and mental health in Central Virginia.",
         body, [crumb_ld(trail)])
    for a in ARTICLES:
        ap = f"/resources/{a['slug']}/"
        tr = [("/", "Home"), (path, "Resources"), (ap, a["short"])]
        from datetime import date
        nice = date.fromisoformat(a["date"]).strftime("%B %-d, %Y")
        body_html = a["body"].replace("{faq}", faq_html(a.get("faqs", [])))
        b = f'''<article class="article">{crumbs(tr)}
<p class="meta" style="margin-top:18px">{a["topic"]} · Published <time datetime="{a["date"]}">{nice}</time></p>
<h1>{html.escape(a["title"])}</h1>
<img class="feature" src="{v(a["image"])}" alt="{html.escape(a["image_alt"])}" width="1200" height="800">
{body_html}
<div class="cta-inline"><strong style="font-family:Outfit,sans-serif;font-size:19px;color:#0F2740">Have questions? We can help.</strong><a class="btn btn-green" href="tel:{PHONE_TEL}">Call {PHONE}</a></div>
</article>'''
        ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": a["title"], "description": a["desc"],
              "image": SITE + a["image"], "datePublished": a["date"], "dateModified": a["modified"],
              "author": {"@type": "Organization", "name": "Family Transitions, Inc.", "url": SITE + "/"}, "publisher": ORG_REF,
              "mainEntityOfPage": SITE + ap}
        page(ap, f'{a["short"]} | Family Transitions, Inc.', a["desc"], b, [ld, crumb_ld(tr)] + ([faq_ld(a["faqs"])] if a.get("faqs") else []))


def build_who():
    path = "/who-we-help/"
    trail = [("/", "Home"), (path, "Who We Help")]
    groups = [
     ("Children, teens and their families", "When a young person is struggling with emotions or behavior, the whole family feels it. We work with kids, teens and parents together, at home and in the office.", ["intensive-in-home", "outpatient-therapy"]),
     ("Adults living with mental illness", "Support to manage symptoms, build daily living skills and stay stable and independent in the community.", ["mental-health-skill-building", "outpatient-therapy"]),
     ("Adults with intellectual and developmental disabilities", "Day programs and family-style homes where adults with ID/DD build skills, friendships and a full life in the community.", ["dd-day-support", "sponsored-residential"]),
     ("Couples and individuals", "Counseling for anxiety, depression, trauma, grief, relationships and life changes, for people of all ages.", ["outpatient-therapy"]),
    ]
    secs = ""
    for title, text, svcs in groups:
        links = "".join(f'<li><a href="/services/{s}/">{SERVICES[s]["title"]}</a></li>' for s in svcs)
        secs += f'<section><h2>{title}</h2><p>{text}</p><ul class="ticks">{links}</ul></section>'
    secs += (f'<section style="background:#F2F7FC;border-color:#F2F7FC"><h2>Professionals and referral partners</h2><p>Schools, doctors, case managers, social workers and probation officers can refer clients to any of our programs.</p>'
             f'<div class="btns"><a class="btn btn-green" href="/referrals/">Make a referral</a></div></section>'
             f'<section style="background:#F2F7FC;border-color:#F2F7FC"><h2>Families who want to help</h2><p>Open your home to an adult with ID/DD as a sponsored residential provider, with training and 24/7 support.</p>'
             f'<div class="btns"><a class="btn btn-green" href="/become-a-provider/">Become a provider</a></div></section>')
    body = simple_hero(trail, "Children · Teens · Adults · Families", "Who We Help",
        "From young children to older adults, we support people at every stage of life. Find the group that sounds like you, and we'll show you where to start.", buttons=False,
        slug="who-we-help", alt="A multigenerational family walking together in a sunny neighborhood park")
    body += f'<div class="wrap aud">{secs}</div>'
    page(path, "Who We Help | Family Transitions, Inc. | Central Virginia",
         "Family Transitions helps children, teens, families, adults with mental illness and adults with intellectual and developmental disabilities in Richmond and Petersburg, VA.",
         body, [crumb_ld(trail)])


JOBS = [
 ("Direct Support Professional (DSP)", "DD Day Support", "Provides direct support, supervision and day-to-day services for adults in our DD Day Support program."),
 ("Lead Direct Support Professional", "DD Day Support", "Leads the direct support team and helps supervise and run day support program activities."),
 ("Qualified Intellectual Disabilities Professional (QIDP)", "DD Day Support", "Writes individual service plans and activity schedules for participants in our day support program."),
 ("Mental Health Skill Building Case Manager (QMHP-A)", "Mental Health Skill Building", "Manages a small caseload of adults with serious mental illness, providing skill building in the home and community. Must be registered as a QMHP-A in Virginia."),
 ("Intensive In-Home Counselor (QMHP-C)", "Intensive In-Home", "Provides in-home and community counseling to children, adolescents and families, and completes treatment documentation. Hourly position."),
 ("Clinical Supervisor (LPC, LCSW, Resident in Counseling or Supervisee in Social Work)", "Clinical", "Provides clinical and administrative supervision and completes diagnostic assessments. Requires a Virginia LPC or LCSW license, or registration as a Resident in Counseling or Supervisee in Social Work. Leadership experience preferred."),
]


def build_careers():
    path = "/careers/"
    trail = [("/", "Home"), (path, "Careers")]
    jobs = "".join(f'<div class="job"><h3>{html.escape(t)}</h3><div class="tags"><span>{p}</span><span>{ph("[[Full or part time]]")}</span><span>{ph("[[Location]]")}</span></div><p>{html.escape(d)}</p><p class="note">Pay: {ph("[[Pay range]]")}</p></div>' for t, p, d in JOBS)
    opts = "".join(f"<option>{html.escape(t)}</option>" for t, _, _ in JOBS)
    body = simple_hero(trail, "Now hiring in Central Virginia", "Build a Career That Matters",
        "Join a team that has helped families in Richmond and Petersburg since 2003. We hire counselors, QMHPs, direct support professionals and clinicians who want their work to make a difference.",
        slug="careers", alt="Three smiling coworkers, one with a staff badge and one holding a tablet, talking together in a sunny office")
    body += f'''<div class="wrap split"><div class="main">
<section class="block"><h2>Open positions</h2><div class="jobs">{jobs}</div></section>
<section class="block"><h2>Why work with us</h2><ul class="ticks"><li>Meaningful work with children, families and adults in your own community</li><li>Supportive supervision and a team that works together</li><li>Small caseloads in our in-home programs</li><li>{ph("[[Benefits: health insurance, paid time off, training, etc.]]")}</li></ul></section>
<section class="block"><h2>How hiring works</h2><ol class="numbered"><li><strong>Apply</strong>Send the short application and your resume.</li><li><strong>Interview</strong>We'll contact qualified applicants to schedule a conversation.</li><li><strong>Offer and onboarding</strong>All positions require a criminal background check. We collect the information needed for it securely after an offer, not on this website.</li></ol></section>
</div>
<aside class="side" id="form"><form class="form-card" data-form="careers" action="#" method="post" enctype="multipart/form-data">
<h2>Apply now</h2><p class="note">It takes about three minutes. We'll ask for anything else later.</p>
<label>Position<select name="position" required>{opts}<option>Other / general application</option></select></label>
<div class="row"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Last name<input name="last_name" autocomplete="family-name" required></label></div>
<label>Phone<input type="tel" name="phone" autocomplete="tel" required></label>
<label>Email<input type="email" name="email" autocomplete="email" required></label>
<div class="row"><label>City<input name="city" autocomplete="address-level2"></label><label>Availability<select name="availability"><option>Full time</option><option>Part time</option><option>Either</option></select></label></div>
<label>Licenses or certifications (optional)<input name="credentials" placeholder="e.g. QMHP-C, LPC, CPR, Mandt"></label>
<label>Resume<input type="file" name="resume" accept=".pdf,.doc,.docx"></label>
<label class="check"><input type="checkbox" name="contact_ok" required>I agree to be contacted by phone, email or text about my application.</label>
<button type="submit">Submit application</button>
<p class="note">Please don't include your Social Security number. See our <a href="/privacy/">Privacy Policy</a>.</p>
</form></aside></div>'''
    page(path, "Careers | Counselor, QMHP & DSP Jobs in Richmond & Petersburg, VA | Family Transitions",
         "Join Family Transitions in Central Virginia. Openings for direct support professionals, QIDPs, QMHP-A and QMHP-C counselors and clinical supervisors.",
         body, [crumb_ld(trail)])


def build_privacy():
    path = "/privacy/"
    trail = [("/", "Home"), (path, "Privacy Policy")]
    body = simple_hero(trail, "Website privacy", "Privacy Policy",
        "How Family Transitions, Inc. handles the information you share through this website.", buttons=False)
    body += f'''<div class="legal">
<div class="alert" role="note"><strong>Draft for review</strong><span>{ph("[[FTI must review this policy with its compliance officer or attorney before launch, and link its HIPAA Notice of Privacy Practices.]]")}</span></div>
<h2>Information we collect</h2>
<p>We collect only what you choose to send through our forms: your name, phone number, email address, the service you're asking about, and any message you write. Our referral form asks for a client's first name and last initial, and our job application asks for contact details, work history and an optional resume. We do not ask for Social Security numbers, diagnoses or medical history on this website.</p>
<h2>How we use it</h2>
<p>We use your information to respond to you, schedule consultations, process referrals and job applications, and, if you agree, send updates about our services. We do not sell your information.</p>
<h2>Text messages</h2>
<p>If you check the box to receive texts, we may send appointment reminders and updates about your request. Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time, or HELP for help. We do not share your mobile number with third parties for their marketing.</p>
<h2>Health information</h2>
<p>Information about the services you receive from us is protected under HIPAA and handled according to our Notice of Privacy Practices. {ph("[[Link to FTI's Notice of Privacy Practices.]]")}</p>
<h2>Cookies and analytics</h2>
<p>We may use basic analytics to understand how visitors use our website. We do not use advertising or tracking tools on pages with forms. {ph("[[Confirm the final analytics setup.]]")}</p>
<h2>How we protect it</h2>
<p>Form submissions are sent over an encrypted connection and stored in systems with access limited to staff who need it.</p>
<h2>Contact us</h2>
<p>Questions about this policy? Call <a href="tel:{PHONE_TEL}">{PHONE}</a> or write to Family Transitions, Inc., {ADMIN["street"]}, {ADMIN["city"]}, VA {ADMIN["zip"]}.</p>
<p class="note">Last updated: {ph("[[Date approved]]")}</p>
</div>'''
    page(path, "Privacy Policy | Family Transitions, Inc.", "How Family Transitions, Inc. collects, uses and protects information shared through its website.",
         body, [crumb_ld(trail)])


def all_pages():
    return sorted(str(p.parent.relative_to(PUB)).replace(".", "") for p in PUB.rglob("index.html"))


def build_sitemap():
    from datetime import date
    today = date.today().isoformat()
    urls = []
    for rel in all_pages():
        path = "/" if rel in ("", "/") else f"/{rel}/"
        pri = "1.0" if path == "/" else "0.9" if path.startswith("/services/") else "0.6" if path in ("/privacy/",) else "0.8"
        urls.append(f"<url><loc>{SITE}{path}</loc><lastmod>{today}</lastmod><priority>{pri}</priority></url>")
    (PUB / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n")


def build_llms():
    svc = "\n".join(f"- [{SERVICES[s]['title']}]({SITE}/services/{s}/): {plain(SERVICES[s]['desc'])}" for s in SERVICES_ORDER)
    locs = "\n".join(f"- [{l['title']}, {l['city']}]({SITE}/locations/{k}/): {l['street']}, {l['city']}, VA {l['zip']}. Phone {l['phone']}. Hours: {plain(l['hours'])}." for k, l in LOCATIONS.items())
    arts = "\n".join(f"- [{a['short']}]({SITE}/resources/{a['slug']}/): {a['desc']}" for a in ARTICLES)
    txt = f"""# Family Transitions, Inc.

> Family Transitions, Inc. is a behavioral health and developmental disability services organization in Central Virginia, founded in 2003. It serves children, teens, adults and families in Richmond, North Chesterfield, Chesterfield County, Petersburg and surrounding communities. Main phone: {PHONE}.

Key facts:
- Founded in 2003 as an intensive in-home services agency; now offers five programs.
- Programs are licensed by the Virginia Department of Behavioral Health and Developmental Services (DBHDS).
- DD Day Support accepts the DD Waiver, Day Support Waiver services and private pay.
- Outpatient therapy is provided with sister organization Core Behavioral Health, LLC.
- Anyone can make a referral, including families, schools, doctors, case managers, social workers and probation officers.
- In a crisis, call or text 988. In an emergency, call 911.

## Services
{svc}

## Locations
{locs}

## Get help
- [Make a referral]({SITE}/referrals/): Refer yourself, a family member or a client.
- [Become a sponsored residential provider]({SITE}/become-a-provider/): Open your home to an adult with ID/DD.
- [Who we help]({SITE}/who-we-help/): Find the right program by age and need.
- [Careers]({SITE}/careers/): Openings for DSPs, QIDPs, QMHP-A and QMHP-C counselors and clinical supervisors.

## Resources
{arts}

## Optional
- [About]({SITE}/about/): Mission, history and values.
- [Privacy Policy]({SITE}/privacy/)
"""
    (PUB / "llms.txt").write_text(txt)


CRM_CONFIG = json.loads((ROOT / "crm" / "config.json").read_text()) if (ROOT / "crm" / "config.json").exists() else {}
FORMS_JS = (ROOT / "tools" / "forms.js").read_text()
FORMS_V = hashlib.sha1(FORMS_JS.encode()).hexdigest()[:8]
FORMS_TAG = f'<script src="/assets/forms.js?v={FORMS_V}" data-api="{html.escape(CRM_CONFIG.get("apiUrl", ""))}" defer></script>'


if __name__ == "__main__":
    (PUB / "assets" / "forms.js").write_text(FORMS_JS)
    (PUB / "crm").mkdir(exist_ok=True)
    (PUB / "crm" / "config.json").write_text(json.dumps(CRM_CONFIG, indent=2) + "\n")
    CSS_V = hashlib.sha1((CSS + FORM_CSS + ARTICLE_CSS).encode()).hexdigest()[:8]
    (PUB / "assets" / "site.css").write_text((CSS + FORM_CSS + ARTICLE_CSS).strip() + "\n")
    for slug in SERVICES_ORDER:
        build_service(slug)
    build_hub()
    build_provider()
    build_referrals()
    build_locations()
    build_about()
    build_resources()
    build_who()
    build_careers()
    build_privacy()
    build_sitemap()
    build_llms()
    sync_home()
    print("built", len(SERVICES_ORDER), "service pages + hub; homepage header/footer synced")
