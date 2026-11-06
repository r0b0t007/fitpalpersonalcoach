# Transfer impact assessment: FitPal Coach and its sub-processors

**Version 1, 6 November 2026.** Prepared by FitPal Coach (Ahmed Chioua) as processor. This is the
assessment of the laws of the countries of destination that Clause 14 of the standard contractual
clauses requires, which the [coach terms](https://fitpal.ma/en/terms) (Part B §11) promise to keep
up to date and to make available to a coach on request. It is measure M1 of the
[DPIA](2026-11-01-dpia-coaching-and-join-requests.md). Linear: CHW-359.

Method: the lawve-ai skill `transfer-impact-assessment-tia-oliver-schmidt-prietz` (EDPB
Recommendations 01/2020, six steps; the CNIL TIA guide of January 2025; its US country profiles,
checked against later events in section 3). **This is not legal advice.** No DPO has been appointed;
qualified review is recommended before relying on it, in particular for section 4 (Morocco), which
the skill does not cover.

Facts checked on 6 November 2026 are marked as such. Facts only the owner can confirm are marked
**to verify (owner)** and listed in section 6.

---

## 0. Summary

| # | Transfer | Mechanism | Verdict |
|---|---|---|---|
| T1 | Coach in the EEA → FitPal Coach, run from Morocco (remote access by the operator) | SCCs Module Two, incorporated in the coach terms | Proceed. Documented "no reason to believe" (section 2.1), with the measures already in place |
| T2 | FitPal → **Namecheap** (US): hosting of the app and the database | SCCs (Namecheap DPA, deemed signed with its terms of service). **Not DPF-certified** | Proceed with a gap: the DPA offers Module Two only, and the database is necessarily readable by the host. Recommend an EU data centre (CHW-362) |
| T3 | FitPal → **Resend** (US): email | DPF (active, re-certification under review) and SCCs in Resend's DPA, Module Three when the customer is a processor | Proceed (lightweight) |
| T4 | FitPal → **Cloudflare** (US): traffic, and encrypted backups stored in the EU (R2) | DPF (active) and SCCs as fallback in Cloudflare's DPA | Proceed. Backups: encryption with a key Cloudflare does not hold is an effective measure. Traffic: covered by the DPF |
| T5 | FitPal → browser push services (Google, Apple, Mozilla) | Payload end-to-end encrypted (Web Push); only an opaque endpoint is sent | Proceed: the importer cannot read the content |
| M | Morocco, law 09-08 (Moroccan coaches, and FitPal's own data on coaches) | The US is **not** on the CNDP's list of adequate states (deliberation 236-2015): a basis under article 44 is needed | **Not settled**: an owner decision with the CNDP (section 4; filing prepared in [CHW-367](2026-11-06-cndp-filing.md)) |

Join requests stay closed until the DPIA's conditions are met. Here: items 1 and 2 of section 6
belong to its condition 1 (the DPAs and this assessment), item 3 is its condition 3 (the CNDP), and
item 5 should be checked before relying on T3.

---

## 1. Know the transfers (step 1)

**Exporters.** Each coach is the controller of their clients' data (coach terms, Part B). A coach
established in the EEA exports it to FitPal Coach, the processor, which is operated by one person in
Tétouan, Morocco. FitPal is the controller only of the coach accounts themselves (name, email,
plan, the security log).

**Data.**
- Client accounts: email, first name, phone number (optional).
- Training: programs, logged workouts, body weight and measurements, weekly check-ins, meals.
- Health data (GDPR Art. 9): injuries in the intake, check-in answers, progress photos.
- Coach accounts: name, email, plan.

**Subjects.** Coaches and their clients, adults and some minors with a parent's consent
(DPIA R10). Volume: test accounts only today; a few hundred clients expected in the first year.
Continuous, as the app is used.

**Flows.**

| # | Importer | Country | What reaches it | Readable by the importer? |
|---|---|---|---|---|
| T1 | FitPal Coach (operator) | Morocco | Everything, by SSH and the admin panel, when needed to run, secure and support the service | Yes |
| T2 | Namecheap, Inc. | US (Phoenix, Arizona; cPanel server `server215.web-hosting.com`) | The database, photos and files, stored | Yes: a shared host has the files in the clear |
| T3 | Resend | US ("primary processing operations take place in the United States", DPA §6.1) | Email address, first name, message (codes, sign-in links, a coach's answer to a request) | Yes |
| T4a | Cloudflare, Inc. | US, edge network worldwide | All web traffic, in transit: TLS ends at Cloudflare's edge | Yes, in transit |
| T4b | Cloudflare, Inc. (R2) | Stored in the **EU** (bucket in the EU jurisdiction) | The nightly database dump, encrypted with age to a key held offline by the operator | **No** |
| T5 | Google, Apple, Mozilla push services | US | A push endpoint and an encrypted payload (RFC 8291) | **No** (the payload); the endpoint is opaque |

**Onward transfers.** Each provider's own sub-processors (for example the cloud infrastructure
Resend sends from) are covered by that provider's DPA and its notice of sub-processor changes.

---

## 2. Transfer tools and assessment, per transfer (steps 2–4)

### 2.1 T1: coach in the EEA → FitPal Coach (Morocco)

**Tool.** SCCs of Decision (EU) 2021/914, **Module Two**, incorporated by reference into the coach
terms, Part B §11 (accepted at sign-up and again in the app at each new version).

**Morocco: law and practice** (to be reviewed by counsel; the skill has no Morocco profile).
- **Data protection.** Law 09-08 (2009) and its decree 2-09-165. The CNDP is the supervisory
  authority. Morocco acceded to Council of Europe Convention 108 on 28 May 2019 (as recited in CNDP
  deliberation D-02-2023). Data subjects have rights of access, rectification and objection.
- **Government access.** Interception of communications is governed by the Code of Criminal
  Procedure (ordered by a judge; urgent exceptions) — **to verify (counsel)**. Spyware use against
  journalists and activists has been documented by NGOs (2021). Those reports concern targeted
  surveillance of individuals, not compelled access to a provider's customer database.
- **Practical risk.** The data is not stored in Morocco: it is reached remotely, by one operator,
  over SSH with keys and an admin panel behind a password. The data is fitness coaching for
  private individuals. There is no realistic reason to believe Moroccan authorities would seek it
  through FitPal, and FitPal has never received a request.

**Conclusion (CNIL option 3, with the justification above).** Proceed. Measures already in place
(coach terms Annex 2): access limited to the operator; the tenancy checks; data minimisation;
TLS; the security log; deletion on request. FitPal will tell the coach of any request from an
authority, as Clause 15 of the SCCs requires.

### 2.2 T2: Namecheap (US, not DPF-certified)

**Tool.** Namecheap's Data Processing Addendum (last revised 27 September 2021) is part of its
Universal Terms of Service: "As of the date of Data Exporter's acceptance of Data Importer's Terms
of Service, Data Exporter is deemed to have signed" it, SCCs included. Its SCCs are **Module Two
(controller to processor)**, in Appendix 1. Namecheap is **not on the Data Privacy Framework list**
(searched 6 November 2026: no active participant).

**Gap: the module.** For client data FitPal is a processor, so the right module for FitPal →
Namecheap is **Three (processor to processor)**. Module Two still binds Namecheap to the Clause 8
obligations and gives data subjects third-party rights, which is why this is a gap to close rather
than a missing safeguard. **To verify (owner):** ask Namecheap support whether Module Three applies
when the customer acts as a processor, and keep the answer.

**US law** (skill profile `us-non-dpf`, updated in section 3). A hosting provider is a remote
computing service under FISA Section 702 and is subject to the CLOUD Act. The essential guarantees
are rated insufficient (702: A and B) or of concern (C and D).

**Supplementary measures.** TM-1 (encryption with a key the importer does not hold) **cannot work
for the live database**: the application runs on Namecheap's server and must read it. It does work
for the backups (T4b). What remains:
- **Practical risk** (CNIL option 3). Namecheap is a mass-market shared host, not a communications
  provider in the usual sense of Section 702. The data is fitness coaching, with no foreign
  intelligence value. FitPal has never received a request. This makes access unlikely, but the data
  includes health data, so the residual is accepted only as a stage.
- **Restructure (recommended).** Namecheap offers shared hosting in data centres outside the US —
  **to verify (owner):** an EU location for this plan. Hosting in the EU removes the stored data
  from US territory. The CLOUD Act still reaches a US company's data abroad (EDPB Guidelines 05/2021,
  example 12), so this narrows the risk rather than closing it. Do it together with **CHW-362**
  (FitPal on its own hosting account).

**Conclusion.** Proceed for now, documented, with two actions: the module (section 6, item 2) and
the hosting location (item 6). The legal pages say the hosting transfer relies on the SCCs in
Namecheap's DPA: true of the clauses it binds Namecheap to today, Module Two. If Namecheap will not
apply Module Three, record its answer here and say so on the pages.

### 2.3 T3: Resend (US, DPF)

**Tool.** Resend is on the **Data Privacy Framework list**: EU-U.S. DPF and UK Extension, "Active -
Re-certification under Review" (checked 6 November 2026). Its DPA is part of its terms of service
("legally binding upon Customer entering into the Agreement"; an executed copy is in the Resend
dashboard). It applies the 2021 SCCs: Module Two when the customer is a controller, **Module Three
when the customer is a processor** — FitPal's case — so the SCCs are there as a fallback too.

**Assessment.** Lightweight (Art. 45 adequacy). Supplementary measures are not required. The data is
small: an address, a first name, and the message, which can be a coach's answer to a request.

**Conclusion.** Proceed. Watch the re-certification (section 5).

### 2.4 T4: Cloudflare (US, DPF)

**Tool.** Cloudflare, Inc. is on the **Data Privacy Framework list**: EU-U.S., Swiss-U.S. and UK
Extension, Active, HR and non-HR data (checked 6 November 2026). Its Customer DPA (version 6.4, 3 April
2026) is "hereby incorporated by reference" into the Self-Serve Subscription Agreement (§6.1,
updated 12 September 2025), relies on the DPF, and keeps the 2021 SCCs as the fallback "should
these certifications lapse or become otherwise invalidated": Module Two where the customer is a
controller, **Module Three where it is a processor** (§6.2(a)(i)), as FitPal is here.

**T4a, traffic.** TLS ends at Cloudflare's edge, so traffic is readable there in transit. Covered by
the DPF; the realistic risk is that of any CDN.

**T4b, backups (R2).** Stored in the EU jurisdiction, and encrypted (age: X25519 and
ChaCha20-Poly1305) to a key that Cloudflare does not hold and the server does not hold either.
**TM-1 is effective here**: Cloudflare never needs the plaintext, so a compelled disclosure would
yield nothing readable.

**Conclusion.** Proceed.

### 2.5 T5: browser push services

The server sends each push to the endpoint the user's browser gave it, encrypted for that browser
alone (Web Push, RFC 8291). The service sees an opaque endpoint and the payload's size and time.
TM-1 is effective by design. **Conclusion.** Proceed.

---

## 3. US law since the skill's profile (31 May 2026)

Checked on 6 November 2026, from secondary sources; to be reread at the next review.

- **Trump v. Slaughter** (US Supreme Court, 29 June 2026, 6–3): for-cause removal protection for FTC
  commissioners is unconstitutional, overruling *Humphrey's Executor*. The FTC enforces the DPF, so
  the independence the adequacy decision counted on is weaker.
- **FISA Section 702** lapsed on 12 June 2026, when Congress did not reauthorise it. Collection
  continues under the certifications the FISA Court approved in March 2026. Whether Congress has
  since acted was not found: **to verify** at the next review.
- **Latombe v Commission**: the General Court upheld the DPF on 3 September 2025. The appeal
  (C-703/25 P) is pending, with no judgment reported.

**Effect on this assessment.** The DPF still stands (T3, T4), but its foundations are weaker than in
2023. That is why the SCCs in Resend's and Cloudflare's DPAs matter as a fallback, and why the
backups are encrypted (T4b).

---

## 4. Morocco, law 09-08

**The rule.** Article 43: a controller may transfer personal data to a foreign state only if it
ensures a sufficient level of protection; the CNDP lists those states. Deliberation **236-2015**
(18 December 2015, amending 465-2013) lists them: the EU and EEA states, the United Kingdom,
Switzerland and Canada. **The United States is not on it.** Its article 1 also subjects every
transfer abroad, even to a listed state, to notification to the CNDP.

**The exceptions** (article 44, the law's own text). A transfer to an unlisted state is allowed:
- if the data subject has **expressly consented** to the transfer; or
- if it is necessary, among other reasons, for the performance of a contract between the controller
  and the data subject (44.1.d); or
- **on the CNDP's express and reasoned authorisation**, where the processing guarantees a sufficient
  level of protection, notably through contractual clauses (44.3).

**Who it applies to.**
- **Moroccan coaches**, controllers of their clients' data, hosted in the US through FitPal.
- **FitPal itself**, a controller established in Morocco for the coach accounts, hosted in the US.
- Whether law 09-08 also applies to FitPal's processing of EEA coaches' data, because the operator
  works from Morocco, is a question for counsel or the CNDP.

**Options** (the owner's decision, not made here):
1. **CNDP authorisation (44.3)**, relying on the three DPAs' SCCs, filed with the declaration of
   **CHW-367**. The most durable. The health data needs the CNDP's prior authorisation in any case (article
   12.1(a): health data is sensitive data under article 1(3)).
2. **Express consent (44, first paragraph)**, added to the client's consent screen (CHW-360) for
   clients of Moroccan coaches, and to coach sign-up. Available at once, but it must be express
   and specific to the transfer, and is weaker for continuous, systematic transfers.
3. **Contract necessity (44.1.d)** is weak: hosting in the US is a choice, not a necessity, for a
   coaching contract.

**Recommendation** (not legal advice): option 1, with option 2 as the interim basis if join requests
are to open for Moroccan coaches before the CNDP answers. The CNDP's position is the "done when" of
CHW-359.

---

## 5. Re-assessment (step 6)

- **Periodic:** every November, with the DPIA review (M8).
- **Standing:** Resend's DPF re-certification ("under review" on 6 November 2026; if it lapses,
  the legal pages stop naming the DPF for Resend, and T3 rests on its SCCs); Namecheap's DPA
  (last revised 2021); Section 702 reauthorisation; Latombe (C-703/25 P); any new noyb challenge.
- **Events:** a request from any authority to FitPal or a provider; a change of provider or hosting
  location (CHW-362); a sub-processor notice from Namecheap, Resend or Cloudflare; the CNDP's answer.

---

## 6. Actions

| # | Action | Who | Status |
|---|---|---|---|
| 1 | Keep a dated copy of each DPA, outside this public repository (`Code Projects/fitpal-legal/processor-agreements/`). Saved on 6 November 2026: Cloudflare DPA v6.4 and the Self-Serve Subscription Agreement, Resend's public DPA. Still to save: Namecheap's DPA and Universal Terms (its site refuses automated copies), and Resend's executed copy from the dashboard | Owner | In progress |
| 2 | Ask Namecheap whether its SCCs apply as Module Three when the customer is a processor; keep the answer | Owner | To do |
| 3 | Settle the Moroccan basis for transfers to the US (section 4): CNDP declaration and authorisation, with **CHW-367** | Owner | To do |
| 4 | Legal pages: name the DPF beside the SCCs for Cloudflare and Resend | Done in this change | Done |
| 5 | Check in the Resend dashboard which region the sending domain uses | Owner | To do |
| 6 | Move the hosting to an EU data centre, with CHW-362 | Owner | Recommended |
| 7 | Review this assessment in November 2027, or at any event in section 5 | Owner | Planned |

### Sources

- Namecheap Data Processing Addendum, https://www.namecheap.com/legal/universal/data-processing-addendum/ (read 6 November 2026).
- Resend DPA, https://resend.com/legal/dpa (read 6 November 2026); Resend changelog, Data Privacy Framework certification.
- Cloudflare Customer DPA v6.4 (3 April 2026), https://www.cloudflare.com/cloudflare-customer-dpa/; Self-Serve Subscription Agreement §6.1, https://www.cloudflare.com/terms/ (updated 12 September 2025).
- Data Privacy Framework list, https://www.dataprivacyframework.gov/list (searched 6 November 2026).
- Law 09-08, articles 43 and 44 (text of the Dahir 1-09-15, as published); CNDP deliberation 236-2015 of 18 December 2015, https://www.cndp.ma/wp-content/uploads/2023/12/deliberation-n-236-2015-18-12-2015.pdf.
- Trump v. Slaughter: NPR, 29 June 2026; Congressional Research Service LSB11448. FISA Section 702: NPR, 12 June 2026. Latombe: WilmerHale, 1 December 2025.
