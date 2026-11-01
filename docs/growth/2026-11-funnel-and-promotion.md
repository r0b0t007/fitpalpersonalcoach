# FitPal Coach: funnel and 90-day promotion plan

Written 2026-11-01, alongside `docs/superpowers/specs/2026-11-01-creator-coach-design.md`. The
work is tracked in the Linear milestone "C3 — Go-to-market: creator coaches" (CHW-343 to CHW-355). Numbers marked
*(est.)* are our own estimates. Every other number links its source.

## 1. Who we sell to

Independent fitness coaches with 5k–100k followers on Instagram or TikTok. They coach clients
online, one to one. Today they deliver PDFs or Google Sheets over WhatsApp and sell through a
"comment KEYWORD" DM or a Linktree.

| Market | What a client pays the coach | Competitors already there | Our angle |
|---|---|---|---|
| Morocco | 300–800 MAD/month *(est.: no published data, to be checked by mystery-shopping)* | No local B2B tool. Global ones need Stripe, which reportedly doesn't onboard companies registered in Morocco ([Kolonell](https://kolonell.com/fr/blog/paiement-en-ligne-pme-maroc-cmi-ou-stripe-2026)). | French and Darija, no Stripe needed, the coach is paid however they like, free for 3 clients |
| France, Belgium | €30–150/month ([coachway FR](https://coachway.io/fr/combien-coute-un-coach-sportif-en-ligne/)) | Hexfit €19–29, AZEOO €9, Fit'Distance €13 ([coachway FR](https://coachway.io/fr/logiciel-coach-sportif/)) | One link in the bio, one price with no add-ons, a client app that works inside Instagram |
| Spain | €50–150/month ([FitGeneration](https://fitgeneration.es/cuanto-vale-un-entrenador-personal-al-mes/)) | Harbiz €14–19 for 5 clients | Free for 3 clients, set up in a day, a simpler client app |

**Positioning:** "Un lien dans ta bio. Tes abonnés demandent à s'entraîner avec toi, tu acceptes,
leur première séance est prête le jour même. Gratuit pour tes 3 premiers clients."
In Spanish: "Un enlace en tu bio. Tus seguidores piden entrenar contigo, aceptas, y su primer
entreno está listo ese mismo día."

## 2. The funnel

### Coach side (our revenue)

| Stage | Event (`audit_events`) | Target |
|---|---|---|
| Visit | fitpal.ma page view (site analytics) | — |
| Sign-up | `coach.signup` with its plan (a new event, added with CHW-329; today a self-serve coach shows only as `auth.register.ok`) | 8% of visits *(est.)* |
| Page published | `coach.page.save` with `open` on | 70% of sign-ups |
| First request | first `join.request` | 50% of sign-ups within 7 days |
| **Activated** | a client accepted *and* that client logs workout 1 | 50% of sign-ups within 7 days |
| Habit | 3 or more clients training every week at day 30 | 60% of activated coaches |
| Paid | upgrade when the coach hits the 3-client cap | 25–35% of activated coaches |
| Referral | a referred coach activates | 0.3 per paying coach |

### Follower side (the coach's funnel, which we make easy)

The stages are page view → request → code verified → accepted → first set logged. The number we
optimise is the **time from the first tap to the first logged set**. Target: under 24 hours when
the coach accepts by hand, under 10 minutes with auto-accept.

### Loops

1. **"Coaché avec FitPal"** appears on every coach page and every share-kit post. Followers who
   are coaches themselves see it.
2. **Referral:** a coach gets one free month for each coach they refer who activates. Coaches
   with 10k+ followers get 20% recurring as affiliates (the model Stan uses, see
   [Sacra](https://sacra.com/chat/h/7ca39735-0ffb-42a2-919b-80bca1932b5a)).
3. **Coaches as content:** each activated coach is a case study ("from PDF to app in 1 day").

## 3. Offers that remove the "no time" objection

- **Done-for-you import within 24 hours.** The coach sends their PDF or Sheet and we enter the
  program and their page for them. This is the hook in every DM.
- **Five ready-made programs in FR and ES:** full-body beginner, PPL, home with no equipment,
  glutes and legs, and a lighter Ramadan program.
- **Founding Coaches:** 10 coaches get Pro free for life in exchange for a video testimonial and a
  story mentioning FitPal.

## 4. The 90 days

**Weeks 1–2: groundwork**
- Interview 20 coaches (10 in Morocco, 5 in France or Belgium, 5 in Spain): their tools today,
  what they charge, what they would pay for this.
- Mystery-shop 20 coaches' prices by DM, posing as a prospective client.
- Build the five template programs and shoot a 60-second demo video of the link, the request,
  the accept and workout 1.
- Write the DM scripts in French, Darija and Spanish. Build a tracker sheet of 300 coaches
  (country, followers, niche, tool used today).

**Weeks 3–6: founder-led sales**
- Send 30 personal DMs a day, rotating countries, offering the free setup.
- Hold 10 onboarding calls a week.
- Post 3 Reels a week on @fitpal. Ideas: "du PDF à l'app en 5 minutes", "un lien dans ta bio",
  "comment X gère 30 clients", "tes clients ne perdent plus leurs séances".
- Goal: 30 activated coaches.

**Weeks 5–8: social proof**
- Recruit the 10 Founding Coaches and launch referrals.
- Co-host 2 Instagram Lives on the business of online coaching with Founding Coaches.

**Weeks 7–10: partnerships**
- Morocco: certification schools IREPS (Salé), INSEP Maroc, Centre Atlantique (Rabat) and Sport
  Leader Academy ([SNRT](https://snrtnews.com/fr/article/sport-leader-academy-la-plateforme-digitale-qui-revolutionne-la-formation-des-coachs)).
  The offer: free Pro for 6 months for new graduates, plus a guest module on launching online
  coaching.
- France and Spain: personal-trainer schools and gyms whose coaches also coach online.

**Weeks 9–12: amplify**
- Run Meta retargeting of video viewers and site visitors only, at 50–100 MAD or €10 a day.
  Morocco CPC is about $0.23 (from a single vendor,
  [eGrow](https://www.egrow.com/en/blog/facebook-meta-ads-cod-ecommerce-morocco-2026)).
- SEO in French: "logiciel coach sportif", "application coaching sportif", "suivi clients coach",
  "alternative Trainerize". In Spanish: "software entrenador personal", "alternativa a Harbiz".
  Add comparison pages against Trainerize, Everfit and Harbiz.
- Start a "comment APP" DM automation on @fitpal once there is enough reach. Manual replies are
  fine before that.

**Every week:**
- 150 DMs, 3 Reels, 1 Live or case study, onboarding calls.
- Monday review: DM reply rate, sign-up → activation, activation → day-30 habit, paid.

**Day-90 targets:** 100 sign-ups, 50 activated, 20 paying, 10 video testimonials.

## 5. Open tests

- **A price in MAD** (149 / 299 MAD a month) against EUR pricing for Morocco.
- **The free cap:** 3 vs 5 clients (Everfit and Wazen give 5).
- **Auto-accept on by default** vs off: speed against seat control.
- **Things to check before spending on them:**
  - search volumes for the French and Spanish keywords;
  - whether CMI or Payzone can bill monthly;
  - current Trainerize and Kahunas prices on their own pages.
