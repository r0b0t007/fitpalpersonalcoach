# DPIA: coaching clients on FitPal Coach, and requests to join a coach

**Version 1, 1 November 2026.** Prepared by FitPal Coach (Ahmed Chioua) as processor, for the coaches
who are the controllers, under Art. 28(3)(f) GDPR and Part B section 8 of the
[coach terms](https://fitpal.ma/en/terms). A coach adopts it as their own DPIA by recording that they
have read it; FitPal keeps it current. Linear: CHW-358.

Method: the lawve-ai skill `dpia-sentinel-oliver-schmidt-prietz` (EDPB WP 248 rev.01 criteria, the
French and Belgian Art. 35(4) lists, the Spanish whitelist, a 5 × 5 likelihood × severity matrix,
structure of the EDPB DPIA template v1.0 of March 2026). **This is not legal advice.** No DPO has
been appointed (section 5); qualified review is recommended before relying on it.

Everything described below is what the code does as of commit `e3d5b7c6`, checked in the code, not
taken from documentation.

---

## 0. Overview

| | |
|---|---|
| **Controllers** | Each coach using FitPal Coach, for their own clients and the people who ask to join them. Coaches are independent professionals in France, Belgium, Spain and Morocco. |
| **Processor** | FitPal Coach, Ahmed Chioua, auto-entrepreneur, ICE 003586839000050, Tétouan, Morocco. |
| **Sub-processors** | Namecheap, Inc. (US): hosting of app and database. Resend, Inc. (US): email. Cloudflare, Inc. (US): traffic. Browser push services (Google, Apple, Mozilla): encrypted notifications. |
| **Processing** | A coaching app: a coach's public page, requests to join with an intake form, a client roster, programs, workout logging, body weight and measurements, check-ins, meals, progress photos. |
| **Status** | Coaching is live (test accounts only, 1 November 2026). The public "Ask to join" button is **not yet live**: this DPIA comes before it, as Art. 35(1) requires. |

---

## 1. Threshold assessment: is a DPIA required?

### 1.1 Art. 35(3) mandatory triggers

| Trigger | Applies? | Why |
|---|---|---|
| (a) Systematic, extensive automated evaluation with legal or similar effects | No | Coaches accept or decline requests by hand; the app computes adherence and estimated maxima to inform the coach, and decides nothing about anyone. |
| (b) Large-scale processing of Art. 9 data | No, today | Each controller is one coach with at most 75 clients (Studio plan; Free 3, Solo 10, Pro 30). The EDPB's example of what is *not* large scale is an individual physician. To be reassessed if a single coach, or FitPal itself as a controller, ever processed far more. |
| (c) Large-scale systematic monitoring of a public area | No | — |

### 1.2 The nine EDPB criteria (WP 248 rev.01)

| # | Criterion | Met? | Reasoning |
|---|---|---|---|
| 1 | Evaluation or scoring | Partly | Adherence, progress and estimated one-rep maxima evaluate a client's training. They inform the coach; no scoring of the person for any decision. |
| 2 | Automated decisions with significant effect | No | Accepting a request is a human decision. (CHW-338 plans an *auto-accept* option: it decides only to accept, never to refuse, and is re-checked when built.) |
| 3 | Systematic monitoring | No | Clients log their own training, knowingly and at their own initiative; nothing is collected without their action. |
| 4 | **Sensitive or highly personal data** | **Yes** | Injuries and pain in the intake (Art. 9 health data); body weight, measurements and progress photos, which can reveal health and are intimate. |
| 5 | Large scale | No | As 1.1(b). |
| 6 | Matching or combining datasets | No | No outside data is brought in. |
| 7 | Vulnerable data subjects | Partly | The public form accepts people from 16; a coach may invite a younger client themselves (coach terms Part A §5 puts that on the coach). No employment or care dependency. |
| 8 | Innovative technology | No | A standard web app; passkeys are established technology. |
| 9 | Prevents using a service | No | A coach declining a request to train privately is not denial of an essential service. |

**One criterion fully met (4), two partly (1, 7).** Under WP 248 that is below the two-criteria
presumption, but the skill's rule applies: with one criterion, assess its strength, the severity of
the impact, and what a supervisory authority would expect.

### 1.3 National lists

| Jurisdiction | Why relevant | Art. 35(4) blacklist | Art. 35(5) whitelist | Result |
|---|---|---|---|---|
| **France (CNIL)** | Coaches and clients there | No entry matches. Closest: #1 health data warehouses (large scale, research: no), #10 large-scale data of vulnerable persons (no). | Individual health professional patient care (#3) does not fit: coaches are not health professionals. | Not listed |
| **Belgium (APD)** | Coaches and clients there | No entry matches (biometrics, genetics, third-party exclusion data, employee monitoring, children's profiling, implantable devices, large-scale evaluation, public CCTV: none apply). | — | Not listed |
| **Spain (AEPD)** | Coaches and clients there | **To verify:** the skill's reference set has no Spanish blacklist. The AEPD's published list is built on the same criteria as WP 248; check it directly for an entry combining health data with another criterion. | Self-employed professionals' client management (#3) excludes Art. 9 data, so it does not apply. | To verify |
| **Morocco (law 09-08)** | The processor, Moroccan coaches and clients | Law 09-08 has no DPIA procedure. Processing health data is subject to the CNDP's prior **authorisation** rather than a declaration: **to verify with CHW-58.** | — | CNDP route |

### 1.4 Verdict

**DPIA recommended, and carried out.** No mandatory trigger and no blacklist entry apply, and only
one criterion is clearly met. But that criterion is health data together with intimate photos, collected
through a public form reached from Instagram, from people as young as 16, and hosted outside the
EU by a processor outside the EU. A supervisory authority would reasonably expect an assessment,
and the cost of doing one is low (WP 248: "when in doubt, conduct the DPIA"). The coach terms also
promise this help to coaches.

---

## 2. Systematic description

### 2.1 Personal data

| Category | Source | Mandatory? | Who sees it |
|---|---|---|---|
| Name, email address | The person (sign-up, intake) | Yes | The person, their coach |
| WhatsApp number | The person (intake) | No | Their coach |
| Goal, level, sessions a week, equipment | The person (intake) | Yes (equipment optional) | Their coach |
| **Injuries or pain** (free text, ≤ 500 characters) | The person (intake) | **No**; explicit consent required to send the form | Their coach |
| Passkey public keys, sessions | The device | Yes (to sign in) | Nobody (server only) |
| Programs, workouts, sets, estimated maxima | Coach and client | — | Client, coach |
| **Body weight, measurements, progress photos, check-ins, meals** | The client | Optional | Client, coach |
| Security log (account ids, names, actions; no IPs) | The server | — | Operator; FitPal is controller for it |

### 2.2 Purposes

The coach's coaching of their clients: receiving and answering requests to join, preparing programs
(taking injuries into account), following training and progress, communicating. **No secondary use:**
no advertising, sale, profiling for others, or model training (coach terms Part B §2).

### 2.3 Nature, scope, context

- **Scope:** per coach up to 75 clients; a request queue capped at 50 waiting requests.
- **Data subjects:** adults, and 16–17-year-olds via the public form.
- **Context:** followers reach a coach's page from Instagram. The coach is usually a sole trader
  with no data-protection training, and often uses WhatsApp alongside the app.

### 2.4 Assets and architecture

| Layer | Asset |
|---|---|
| Hosting | One Namecheap shared-hosting (cPanel) account in the US, **shared with another product (FIT'ONE) deployed from another repository**. LiteSpeed web server, MariaDB database, the app's files, photos under `media/photo/<client>/`. |
| Edge | Cloudflare in front of the site. |
| Application | Laravel API (`backend/`), React PWA (`frontend/`); tenancy scope on every coach query (`OwnedByCoach`); passkeys (WebAuthn) and email codes/links. |
| Backups | Nightly database dumps kept 14 days, pre-deploy dumps kept 90 days at most, **on the same hosting account, not encrypted**. |
| People | One operator (SSH keys, Filament admin panel with a password). |
| Delivery | GitHub Actions: tests gate every deploy. |

---

## 3. Legal basis, necessity, proportionality

### 3.1 Legal basis

- **Intake health data:** explicit consent, Art. 6(1)(a) with Art. 9(2)(a). A separate checkbox,
  stamped `consent_at`, is required to send the form, and the age is confirmed. Withdrawal is honoured by
  the coach's "Delete these answers" or `fitpal:forget-join`.
- **Account and coaching:** the contract between client and coach, Art. 6(1)(b). Body data a client
  logs is given by them for that coaching. **Gap to note:** for photos and measurements that reveal
  health, an Art. 9(2) exception is needed too. Explicit consent at the client's first logging is the
  natural one, and **is not collected today** (measure M6).

### 3.2 Necessity (is each item needed, and the least intrusive way?)

- **Injuries:** a coach needs to know them to avoid harm. They are optional free text, short, and
  only the coach reads them. Asking through the form is less intrusive than the usual alternative: a
  WhatsApp voice note that stays on both phones indefinitely.
- **WhatsApp number:** optional; email works without it.
- **Photos and measurements:** optional features the client chooses to use.
- **Retention:**
  - unverified requests are deleted after 24 hours;
  - the answers are erased at a no or a lapse, and the rest deleted 30 days later;
  - accepted requests are kept while the client trains with the coach, then forgotten (Unlink, Detach).

### 3.3 Proportionality

The benefit is safer, better-informed coaching, chosen by the client. The impact is limited to one
coach seeing what the client chose to tell them. With the measures in section 4, the processing is
proportionate.

---

## 4. Risk assessment

Scored from the **data subject's** side. L = likelihood, S = severity (1–5). Score = L × S:
1–3 Low, 4–6 Medium, 7–12 High, 13–25 Very High. Inherent scores assume the measures already in
place.

### 4.1 Inherent risk register

| ID | Track | Risk | Rights | L | S | Score | Modulating factors | Level |
|---|---|---|---|---|---|---|---|---|
| R1 | B | **Outside attacker reads health answers and progress photos** through a compromise of the hosting account: this app, or the other product on the same cPanel account. The database, files and backups are all unencrypted there. | Confidentiality, dignity (REPD-03, CONF-02) | 3 | 4 | 12 | ↑ public-facing; ↑ shared account widens the attack surface; ↓ small target today | **High** |
| R2 | B | A coach sees another coach's clients through a tenancy bug | Confidentiality (CONF-02) | 2 | 3 | 6 | ↓ global scope plus cross-tenant tests on every change | Medium |
| R3 | B | Coach account taken over (email account compromised: a sign-in link) | Confidentiality (IDTH-02) | 2 | 3 | 6 | ↓ passkeys, revocable sessions | Medium |
| R4 | B | US authorities access data at the hosts | Confidentiality (CONF-03) | 2 | 3 | 6 | ↑ no transfer impact assessment yet (CHW-359) | Medium |
| R5 | B | Data lost: host failure takes the database and its backups together | Availability | 2 | 2 | 4 | ↑ backups on the same account | Medium |
| R6 | B | Operator misuses access | Confidentiality | 1 | 3 | 3 | ↓ one person, bound by the terms; admin actions audited | Low |
| R7 | B | Training data overwritten (sync conflict, bug) leading to a wrong program | Integrity (PHYS-04) | 2 | 2 | 4 | ↓ tests on training logic, client sees their own log | Medium |
| R8 | A | Coach copies health answers out of the app (screenshots, WhatsApp) beyond need | Control (CTRL-03) | 3 | 2 | 6 | ↑ coaches untrained in data protection | Medium |
| R9 | A | Body data revealing health is processed without an Art. 9(2) exception | Lawfulness (CTRL-01) | 4 | 2 | 8 | Inherent in the design today (3.1) | **High** |
| R10 | A | Minors: 16–17-year-olds by the form, younger ones invited by a coach | Vulnerable subjects | 2 | 3 | 6 | ↑ age not verifiable | Medium |
| R11 | A | Rights hard to exercise: no self-service deletion of a client account; requests go by email | Control (CTRL-02) | 3 | 2 | 6 | ↓ coach tools, `fitpal:forget-join`, client export | Medium |
| R12 | A | Coach declines someone because of a health condition | Discrimination (DISC-04) | 2 | 2 | 4 | ↓ private relationship, not an essential service | Medium |
| R13 | A | Data kept after it is needed (photos and measurements while the account lives) | Control (CTRL-04) | 2 | 2 | 4 | ↓ intake retention automated | Medium |

### 4.2 Additional measures

| ID | Measure | Addresses | Owner | Status |
|---|---|---|---|---|
| M1 | Processor DPAs on file for Namecheap, Resend and Cloudflare, and a transfer impact assessment | R4 | Owner, **CHW-359** | Planned |
| M2 | Copy the nightly backup **off the hosting account, encrypted** (key not on the server) | R1, R5 | **CHW-361** | Planned |
| M3 | **Move FitPal Coach to its own hosting account**, separate from FIT'ONE | R1 | **CHW-362** | Planned |
| M4 | Encrypt progress photos at rest in the application | R1 | Recommended, not planned | Open |
| M5 | Coach guidance in the app and the terms: keep health answers in the app, not in chats | R8 | **CHW-363** | Planned |
| M6 | **Explicit consent before a client's first body measurement or photo** (Art. 9(2)(a)) | R9 | **CHW-360** | Planned |
| M7 | Self-service account deletion for clients | R11, R13 | **CHW-363** | Planned |
| M8 | Yearly review of these measures, the tenancy tests and this DPIA (promised in the coach terms Annex 2) | All | Owner | Every November |

### 4.3 Residual risk

| ID | After | L | S | Score | Level | Justification |
|---|---|---|---|---|---|---|
| R1 | M2, M3 | 2 | 4 | 8 | **High** | Separate account and off-site encrypted backups narrow the attack surface. The live server still holds unencrypted photos; M4 would lower this further. Accepted because the service is small, the target is unattractive, and severity cannot be lowered without M4. |
| R2 | — | 2 | 3 | 6 | Medium | Tests on every change. |
| R3 | — | 2 | 3 | 6 | Medium | Passkeys preferred. |
| R4 | M1 | 1–2 | 3 | 3–6 | Low–Medium | Depends on the TIA's conclusion. |
| R5 | M2 | 1 | 2 | 2 | Low | |
| R8 | M5 | 2 | 2 | 4 | Medium | |
| R9 | M6 | 1 | 2 | 2 | Low | Lawful once consent is collected. |
| R10 | — | 2 | 3 | 6 | Medium | Coach terms carry the duty for invited minors. |
| R11 | M7 | 2 | 2 | 4 | Medium | |
| R13 | M7 | 1 | 2 | 2 | Low | |
| Others | — | as 4.1 | | | Low–Medium | |

**No risk remains Very High**, so Art. 36(1) prior consultation is not required. R1 remains High,
documented above. Morocco's CNDP authorisation (1.3) is separate, under law 09-08.

---

## 5. Interested parties

- **DPO:** none appointed. FitPal is a sole trader whose core activity is not large-scale Art. 9
  processing (Art. 37(1)(c) not met), and coaches are individuals. Recommended: a one-off review by
  a data-protection professional before relying on this DPIA.
- **Data subjects:** their views were not sought. Recommended: ask the first coaches and some of
  their clients how they understand the intake and consent text, during the founding-coaches
  programme.

---

## 6. Conclusion

**CONDITIONALLY APPROVED.** Coaching may continue, and the public "Ask to join" button may go live
for real coaches once these conditions are met:

1. **M1 / CHW-359:** processor DPAs on file, and the transfer impact assessment done.
2. **M6 / CHW-360:** explicit consent collected before health-revealing body data.
3. **CNDP (CHW-58):** the authorisation, or the position confirmed, for health data under law 09-08.
4. **M2 / CHW-361:** the nightly backup kept encrypted off the hosting account.

M3, M5 and M7 should follow within the next quarter; M4 is recommended. Review this DPIA in
November 2027, or earlier on any change to the intake, the hosting, the sub-processors, or a feature
that decides automatically (CHW-338 auto-accept).
