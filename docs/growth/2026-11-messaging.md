# FitPal Coach: positioning and messaging

Written 2026-11-03 for CHW-343. Every C3 asset is written from this page: the site (CHW-342), the
DM scripts (CHW-347), the Reels (CHW-351), the demo video (CHW-346), the SEO pages (CHW-352) and the
app's empty states. The market figures behind it are in `2026-11-funnel-and-promotion.md` §1 and
the spec's appendices (`docs/superpowers/specs/2026-11-01-creator-coach-design.md`).

**Three languages: French, Spanish and English.** French leads (Morocco, France, Belgium), Spanish
is for Spain, and English is for coaches who post in English and for fitpal.ma's `/en/` pages.
There is no Darija copy (owner, 2026-11-03): a Moroccan coach is written to in French.

## 1. The core line

| | |
|---|---|
| **FR** | Un lien dans ta bio. Tes abonnés demandent à s'entraîner avec toi, tu acceptes, leur première séance est prête le jour même. Gratuit jusqu'à 3 clients. |
| **ES** | Un enlace en tu bio. Tus seguidores piden entrenar contigo, aceptas, y su primer entreno está listo ese mismo día. Gratis hasta 3 clientes. |
| **EN** | One link in your bio. Followers ask to train with you, you accept, and their first workout is ready that day. Free up to 3 clients. |

**Short form** (a Reel caption, a site hero, the opening line of a DM):
FR "Un lien dans ta bio, et leur première séance est prête le jour même." · ES "Un enlace en tu
bio, y su primer entreno está listo ese mismo día." · EN "One link in your bio, and their first
workout is ready that day." The workout is ready that day; whether the client trains that day is
theirs (§6).

## 2. Who it is for, and who it is not for

**For:** an independent coach with 5k–100k followers who coaches online, one to one, and today
sends a PDF or a Google Sheet over WhatsApp. They sell through DMs, a "comment KEYWORD" post or a
Linktree. Their limit is admin time, not demand.

**Not for** (say so and move on, don't bend the pitch):
- **Gyms with a front desk**, class bookings and memberships. That is FitPal (gym.fitpal.ma), a
  different product.
- **A coach who wants clients to pay inside the app.** FitPal never takes the money (§3, proof 3).
- **Group classes and challenges.** Today a program goes to each client separately.

## 3. Four proof points

Each one is a fact about the product today. The lines under it are what to say. Don't stretch it.

1. **It works inside Instagram.** The follower taps the link in the bio, asks to train with you
   and signs in with a 6-digit code sent by email. There is no store app to download and no
   password. Inside Instagram's browser, a prompt offers to open the page in Safari or Chrome so
   it can be added to the home screen (CHW-332).
   - FR: « Ton abonné demande depuis Instagram. Un code par e-mail, et il est dedans. Pas d'app à télécharger. »
   - ES: «Tu seguidor lo pide desde Instagram. Un código por email y ya está dentro. Sin descargar ninguna app.»
   - EN: "Your follower asks from Instagram. One code by email and they're in. No app to download."
2. **One price, no add-ons.**
   - **Free:** up to 3 active clients at a time, no card, for as long as you like (production
     sets `FREE_CAP=3`: coach.fitpal.ma's `/api/config` answered `free_cap: 3` on 2026-11-03). Release a
     client who stopped training and the place is free again. Say "jusqu'à 3" / "hasta 3" /
     "up to 3", never "tes 3 premiers" / "your first 3": Free is not a one-off allowance.
   - **Paid plans:** Solo (10 clients) €19, Pro (30) €39, Studio (75) €79 a month, VAT included,
     or €190, €390 and €790 a year (a year costs ten months).
   - **Every plan has everything:** the public page, auto-accept, check-ins, replies, photos,
     macros, the client's charts and WhatsApp buttons. Plans differ only by how many clients
     they hold.
   - **One condition, from the law:** the coach sees a client's check-ins, weight and photos only
     once the client agrees to share them in the app (CHW-360). Say "tu vois ses bilans dès
     qu'il accepte de les partager", never "dès le premier jour".
   - **Competitors' add-ons:** Trainerize sells payments ($10 a month) and nutrition ($20–45) on
     top ([Trainerize pricing](https://www.trainerize.com/pricing/)). Everfit's Autoflow is $29
     per 30 clients ([Everfit pricing](https://everfit.io/pricing)). Recheck both on those pages
     before a number goes into a post.
   - FR: « Un seul prix. Tout est dedans. Pas d'options payantes en plus. »
   - ES: «Un solo precio. Todo incluido. Sin extras de pago.»
   - EN: "One price. Everything's in it. No paid extras."
3. **You get paid your own way.** FitPal never handles the client's money and takes no cut.
   Transfer, cash, CashPlus or your own Stripe: it's between you and your client. In Morocco this
   matters most: Stripe reportedly doesn't onboard companies registered there.
   - FR: « Tes clients te paient comme d'habitude. FitPal ne touche pas à ton argent. »
   - ES: «Tus clientes te pagan como siempre. FitPal no toca tu dinero.»
   - EN: "Your clients pay you the way they always have. FitPal never touches your money."
4. **Done for you within 24 hours.** Send your PDF, Sheet or photos of your program on WhatsApp,
   plus a photo, a bio and your handle. We enter your programs and set up your page. This is a
   promise made by people, not a feature (see §7).
   - FR: « Envoie-moi ton PDF ou ton Sheet sur WhatsApp, je te mets tout sur l'app en 24 h. Gratuit. »
   - ES: «Mándame tu PDF o tu Sheet por WhatsApp y te lo paso todo a la app en 24 h. Gratis.»
   - EN: "Send me your PDF or your Sheet on WhatsApp and I'll put it all in the app within 24 hours. Free."

Behind these four sit the details, for when the coach asks "and then what?":
- **Starter program:** with a starter program set on the page, workout 1 is on the client's
  phone the day the coach accepts them. With auto-accept on too, that is the day they ask.
  This is what "le jour même" in the core line stands on, which is why the setup (proof 4, or a
  template) always includes a starter program.
- **The coach is told:** the coach gets a push for each new request, and for a fresh check-in
  from a client who has agreed to share their health data (CHW-360). Without that consent the
  coach sees none of that client's check-ins and gets no push for them. A morning digest counts the requests waiting, the check-ins overdue and the sessions
  missed over the last week.
- **Replies:** a check-in or a logged workout gets a reply in the app, and a WhatsApp button
  covers everything else.
- **Templates:** five ready-made programs (CHW-345), including a Ramadan one, for a coach with
  nothing written down yet.

## 4. Per-market angles

| Market | Lead with | Then | Don't |
|---|---|---|---|
| **Morocco** (FR) | Paid your own way: no Stripe, cash and CashPlus are fine (proof 3) | The WhatsApp button, the Ramadan template | Quote a price in MAD before the price test (growth plan §5) |
| **France, Belgium** (FR) | Against the PDF and the Sheet: "tes clients ne perdent plus leurs séances" | A client app that shows the client their program: the coached app hides the planning tools (the exercise library, plan editing, imports, the recovery and effort panels), so a client follows the coach's program instead of rewriting it. One price with no add-ons (proof 2) | Name a competitor in an ad, a Reel or a DM opener |
| **Spain** (ES) | Free up to 3 clients, with no card | Set up in a day (proof 4) | Name a competitor in an ad, a Reel or a DM opener |
| **English-speaking coaches** (EN) | One link in the bio, and the first workout that day (the core line) | One price with no add-ons (proof 2), paid your own way (proof 3) | Name a competitor in an ad, a Reel or a DM opener |

**Competitors by name** go in two places only: the comparison pages (CHW-352: Trainerize,
Everfit, Harbiz), and an answer when the coach names one first (§5). Every price quoted there is
checked on the competitor's own page that week. Harbiz's "€14–19 for 5" is a third-party figure:
check it on harbiz.io first.

## 5. Objections and answers

Answer in one or two sentences, then go back to the offer. The three languages say the same thing.

**"My clients won't install an app."**
- FR: Ils n'installent rien : ils tapent sur ton lien, reçoivent un code par e-mail, et leur séance est là. S'ils veulent l'avoir comme une app, ils l'ouvrent dans Safari ou Chrome et l'ajoutent à l'écran d'accueil ; l'app leur montre comment.
- ES: No instalan nada: tocan tu enlace, reciben un código por email y su entreno ya está ahí. Si lo quieren como una app, lo abren en Safari o Chrome y lo añaden a la pantalla de inicio; la app les enseña cómo.
- EN: They don't install anything: they tap your link, get a code by email, and their workout is there. If they want it like an app, they open it in Safari or Chrome and add it to the home screen; the app shows them how.

**"I already use Trainerize."**
- FR: Garde-le pour tes clients actuels et essaie FitPal avec les 3 prochains, c'est gratuit. On compare au bout d'un mois.
- ES: Quédatelo para tus clientes actuales y prueba FitPal con los 3 próximos, es gratis. Comparamos en un mes.
- EN: Keep it for your current clients and try FitPal with your next 3. It's free. Compare them after a month.

**"My clients pay me in cash."**
- FR: Parfait, FitPal ne touche pas aux paiements. Ils te paient comme avant ; toi, tu acceptes ou tu libères la place.
- ES: Perfecto, FitPal no toca los pagos. Te pagan como siempre; tú aceptas o liberas la plaza.
- EN: Good, FitPal stays out of payments. They pay you as before; you accept them, or free up the place.

**"What about my data?"**
- FR: On ne vend rien à personne et il n'y a pas de pub. Chaque client peut exporter ses séances et supprimer son compte lui-même. Les données sont hébergées chez Namecheap, aux États-Unis : c'est écrit dans les conditions.
- ES: No vendemos nada a nadie y no hay anuncios. Cada cliente puede exportar sus entrenos y borrar su cuenta él mismo. Los datos están alojados en Namecheap, en Estados Unidos: está en las condiciones.
- EN: We sell nothing to anyone and there are no ads. Each client can export their workouts and delete their own account. The data is hosted with Namecheap in the United States; the terms say so.

The data answer must stay true. If the hosting moves (CHW-362) or the transfer terms change
(CHW-359), update it the same day in all three languages.

## 6. Voice

`PRODUCT.md` sets the brand: plain-spoken, equipped, exacting. Short declarative sentences,
numbers where numbers are the honest answer, no motivational register. Its "Product Purpose"
section predates Free and still describes the booked call. CHW-342 rewrites it with the site.

**Words and forms:**
- **Tu / tú in marketing:** the copy speaks to the coach as "tu" (FR) and "tú" (ES), the register
  of a creator's DMs. English is "you", in the same plain register.
- **The app's own voice:** the app UI keeps "vous" in French (`scripts/french-vous.mjs`). Don't
  carry marketing "tu" into `frontend/src/locales/fr.js`.
- **Use:** lien, bio, demande, accepter, séance, programme, client, abonné. ES: enlace, bio,
  solicitud, aceptar, entreno, programa, cliente, seguidor. EN: link, bio, request, accept,
  workout, program, client, follower.
- **Avoid:** "révolutionner", "booster", "transformation", "solution", "plateforme tout-en-un"
  and their equivalents ("revolutionize", "game-changer", "all-in-one platform"), exclamation
  marks, emoji strings, before/after bodies, and fake scarcity ("plus que 3 places").
- **Claims:** no claim without the product fact behind it in §3. "Le jour même" / "ese mismo
  día" / "that day" means the day the coach accepts, and holds because of the starter program
  (§3, the details). Don't promise "en 5 minutes" for the client: the follower's speed depends on
  when they open the email. Don't count taps ("en deux gestes"): from Instagram it takes a
  browser switch first.

**Glossary** (one word per thing, everywhere):

| Thing | FR | ES | EN |
|---|---|---|---|
| The coach's public page | ta page | tu página | your page |
| The follower's ask | la demande | la solicitud | the request |
| Taking them on | accepter | aceptar | accept |
| The 3, 10, 30 or 75 | places (clients) | plazas (clientes) | places (clients) |
| One logged workout | une séance | un entreno | a workout |
| What the coach sends | un programme | un programa | a program |

## 7. What we can't claim yet

- **Paid plans can't be bought online yet.** Checkout opens with CHW-302. Until then, a coach past
  3 clients asks us and we grant the plan from the admin panel. Don't say "upgrade in one tap".
- **A coach can't export their roster.** A client exports their own data (Settings, JSON), but
  there is no export of all your clients from the coach app. Today's fitpal.ma claims one in five
  places, which CHW-342 corrects (or a coach export is built first):
  - `site-coach/index.html`: the Export spec row and "Exportables en JSON à tout moment";
  - `site-coach/en/index.html`: "Exportable as JSON at any time";
  - `site-coach/es/index.html`: "Exportables en JSON en cualquier momento";
  - `site-coach/mentions-legales.html`: "exportables en JSON à tout moment sur simple demande".
    That one says "on request": it stays only if we can actually send a coach their data when
    asked, which CHW-342 checks first.
- **"Within 24 hours" is a founder's promise.** It holds only while one person can keep it. The
  how-to is CHW-348, and the DMs stop offering it if the queue goes past a day.
- **No testimonials, no client counts, no "X coaches already".** There are no real coaches yet.
  Social proof waits for the Founding Coaches (CHW-349).
- **No prices in MAD** until the price test (CHW-355).
- **No free trial.** Free replaced the 14-day trial (CHW-329), but today's fitpal.ma still says
  "14 jours d'essai" in its plan cards, its JSON-LD offers and its FAQ, and its CTA is a booked
  call. CHW-342 removes both.
- **No "Coaché avec FitPal" success stories** until a real coach agrees to be quoted.

## 8. Where each piece goes

| Asset | Uses |
|---|---|
| fitpal.ma hero (CHW-342) | the short form, then the core line, then the four proofs as the page's sections, in FR, ES and EN |
| DM opener and offer (CHW-347) | a personal line about one of their posts, then proof 4, then the core line's last sentence |
| DM follow-ups, day 3 and day 7 | proof 1 (day 3), proof 3 in Morocco or proof 2 elsewhere (day 7) |
| Reels (CHW-351) | one proof per Reel, shown on a real phone, never described |
| Demo video (CHW-346) | the core line, acted out: link, request, accept, workout 1 |
| App empty states | the app's own voice ("vous" in French, "tú" in Spanish), the same facts |
