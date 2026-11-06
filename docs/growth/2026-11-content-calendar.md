# @fitpal content: the 12-week calendar, the Reels and the "Commente APP" flow

Written 2026-11-06 for CHW-351, from `2026-11-messaging.md`. That page decides what may be
claimed, and this one decides what gets posted, when, and how it is counted. The DMs a coach gets
from the founder are `2026-11-dm-outreach.md` (CHW-347). This page covers the ones @fitpal sends
because someone asked.

Four places where this page differs from the issue's text, and why:
- **No Darija versions.** The owner dropped Darija copy on 2026-11-03 (messaging, intro). French
  comes first, and the best performers get Spanish and English versions.
- **"Du PDF à l'app en 24 h", not "en 5 minutes".** The 24 hours is the done-for-you promise
  (proof 4). Nothing measures five minutes, and the messaging doc rules out speed claims it can't
  stand behind (§6).
- **"How a Founding Coach runs 30 clients" waits for one.** There are no real coaches yet, and no
  client counts may be shown before then (messaging §7). That theme starts in week 7 if a
  Founding Coach (CHW-349) has signed the agreement, with their real numbers. Until then its
  slots answer an objection (messaging §5).
- **UTM tags would be read by nothing.** fitpal.ma runs no analytics and sets no cookies (its
  legal page says so), so a tagged bio link counts nothing. §6 says what is counted instead.

**Nothing is posted until join requests are on in production.** Most Reels show a follower
asking to train with a coach, and the core line promises it, but on 2026-11-06 coach.fitpal.ma's
`/api/config` answered `join_requests: false`. The form is switched off until the CNDP and
processor questions are settled (CHW-359, CHW-367; CHW-366 closes once it is on). Check
`/api/config` again before week 1, and film the request flow on the demo instance only.

## 1. Rules for every Reel

1. **One proof per Reel, shown on a real phone, never described** (messaging §8). The screen does
   the explaining. The voice or the text names what is on it.
2. **Film the demo instance, never a real client.** The accounts are Karim and Sara in French,
   Javier and Lucía in Spanish, and Jake and Emma in English (`site-coach/README.md`, demo
   accounts). A real client's name, photo or check-in never appears on screen, even blurred.
3. **The first 1.5 seconds carry the hook as on-screen text.** Most people watch muted, so every
   spoken line is also burned in as a subtitle.
4. **15 to 30 seconds.** One idea, then the call to action, then stop.
5. **The call to action depends on the platform.**
   - Instagram: « Commente APP, je t'envoie la démo. » / «Comenta APP y te mando la demo.» /
     "Comment APP and I'll send you the demo."
   - TikTok: « Lien dans la bio. » / «Enlace en la bio.» / "Link in bio." TikTok doesn't let an
     account DM everyone who comments, so the APP flow is Instagram's only.
6. **The messaging doc's words and limits.**
   - No competitor named, no client counts, no price in MAD, no "en 5 minutes".
   - No before/after bodies, no exclamation marks, no emoji strings, no fake scarcity.
   - "Le jour même" means the day the coach accepts (§6).
7. **Audio.** A business account can't use most popular tracks. Use the royalty-free audio
   Instagram and TikTok offer business accounts, or the voice alone.
8. **Captions:** the caption (§4), then 3–5 hashtags.
   - FR: #coachsportif #coachingenligne #coachenligne
   - ES: #entrenadorpersonal #entrenamientoonline
   - EN: #onlinecoach #personaltrainer

## 2. The five themes

| | Theme | Proof (messaging §3) | Mostly for |
|---|---|---|---|
| **A** | Du PDF à l'app en 24 h | 4, done for you | every market |
| **B** | Un lien dans ta bio | 1 and the core line | every market |
| **C** | Tes clients ne perdent plus leurs séances | the client app (§4, France/Belgium) | France, Belgium |
| **D** | Le business du coaching: prices, getting paid, January, Ramadan | 3, paid your own way; 2, one price | Morocco first |
| **E** | A Founding Coach's week, with their real numbers | all, through a real coach | every market, from week 7 |

Each week has three different themes, so no theme runs twice in a row. Over the 12 weeks A and B
get 8 Reels each, C and D get 7, and E gets 6. **E only runs with a signed CHW-349 agreement.**
Without one, its slot is the objection Reel named in the table below.

## 3. The calendar

Week 1 is the Monday after the accounts are set up (§6) and join requests are on. If that is **Monday 16 November 2026**,
week 6 starts on 21 December and week 11 on 25 January 2027. Two Reels are timed to dates, early
enough for a coach to set up before the date arrives:
- **R16, « Janvier arrive »,** on 21 December, eleven days before the January requests;
- **R33, Ramadan,** on 29 January, about ten days before Ramadan (it starts about 8 February
  2027; the exact date depends on the moon).

If the start moves, keep each one 10 days or more before its date by swapping it with another
Reel of the same theme (D) in the week it needs. Swapping two D Reels leaves every week's themes
as they are.

Post on Monday, Wednesday and Friday, in the evening. Once Insights shows when the followers are
online (Instagram: Insights › Total followers › Most active times), move the times to match.

| Week | Mon | Wed | Fri |
|---|---|---|---|
| 1 | **R01** B · Un lien dans ta bio: the demo film, cut to 25 s | **R02** A · Envoie ton PDF, reçois ton lien en 24 h | **R03** C · Ce que ton client voit en ouvrant l'app |
| 2 | **R04** D · Ton prix de coaching en ligne : 3 questions avant de le fixer | **R05** B · Il demande depuis Instagram avec un code par e-mail, tu acceptes | **R06** A · Ton Sheet, et la même semaine dans l'app |
| 3 | **R07** C · Il a fait sa séance : tu le vois, tu lui réponds | **R08** D · Payé à ta façon : FitPal ne touche pas à ton argent | **R09** B · Accepter à la main, ou l'acceptation automatique |
| 4 | **R10** A · Pas encore de programme écrit ? 5 modèles prêts | **R11** C · Fini le « tu peux me renvoyer le PDF ? » | **R12** D · Gratuit jusqu'à 3 clients : ce que ça veut dire |
| 5 | **R13** B · Ta page : photo, bio, et un bouton | **R14** A · Ce que je t'envoie, ce que tu me renvoies (the setup, step by step) | **R15** C · Le bilan de la semaine, sans WhatsApp |
| 6 | **R16** D · Janvier arrive : ton lien est prêt avant les demandes | **R17** B · Ton lien en story : copie-le, colle-le dans un sticker lien | **R18** A · Le programme de départ : la séance 1 est prête le jour où tu acceptes |
| 7 | **R19** E · La semaine d'un Founding Coach, or the objection « Mes clients n'installeront pas d'app » | **R20** D · Un client qui arrête : libère sa place | **R21** C · Son historique : chaque séance, chaque charge |
| 8 | **R22** B · Le lien dans ta bio, vu depuis le téléphone de ton abonné | **R23** E · Founding Coach, or the objection « Mes clients me paient en cash » | **R24** A · Photos de ton programme papier : ça marche aussi |
| 9 | **R25** C · Ses graphiques de progression, sur ton téléphone aussi | **R26** E · Founding Coach, or the objection « Et mes données ? » | **R27** D · Répondre à un bilan en 30 secondes |
| 10 | **R28** B · Ce que ton abonné voit après avoir demandé | **R29** A · 24 h plus tard : le lien qu'on te renvoie | **R30** E · Founding Coach, or the objection « J'utilise déjà une autre app » |
| 11 | **R31** C · Le bouton WhatsApp : pour tout le reste | **R32** E · Founding Coach, or the objection « Je n'ai pas le temps » (answer: proof 4) | **R33** D · Ramadan arrive : un programme après l'iftar (the template) |
| 12 | **R34** A · De zéro à ta page en ligne, en accéléré | **R35** B · Trois demandes ce matin : le résumé de 7 h | **R36** E · Founding Coach, or a recap of the 12 weeks' best Reel |

Every Reel is filmed in French first. **Make a Spanish and an English version of the two best
Reels of each two-week block**, judged by shares plus saves, then APP comments (§6). Post them on the same
account. The Spanish and English hooks and captions for weeks 1–4 are ready below.

## 4. Weeks 1–4, scripted

Each script gives the hook (on screen, 0–1.5 s), the shots and what is said, and the caption. A
Reel counts as produced once it is filmed, edited and scheduled.

### R01 · B · Un lien dans ta bio (week 1, Monday)

- **Hook:** « Un lien dans ta bio. C'est tout. »
- **The film:** post the demo film's vertical render, `renders/demo-fr-v.mp4` (1080x1920) in the
  `fitpal-coach-videos` repo (`videos/fitpal-coach-demo-join`), as it is: the bio link, Karim's
  page, the request, Accept and Sara's workout 1. It already has its voice-over and burned-in
  captions, so add no subtitles. Don't cut it to 30 s either, because that would cut the
  narration mid-sentence. R01 is the one Reel allowed past rule 4. The hook goes in as the
  cover text.
  Not `site-coach/assets/demo-fr.mp4`: that is the 16:9 web cut.
- **Caption FR:** Un lien dans ta bio, et leur première séance est prête le jour même. Gratuit jusqu'à 3 clients. Commente APP, je t'envoie la démo.
- **ES hook / caption:** «Un enlace en tu bio. Nada más.» / Un enlace en tu bio, y su primer entreno está listo ese mismo día. Gratis hasta 3 clientes. Comenta APP y te mando la demo. (`renders/demo-es-v.mp4`, as it is.)
- **EN hook / caption:** "One link in your bio. That's it." / One link in your bio, and their first workout is ready that day. Free up to 3 clients. Comment APP and I'll send you the demo. (No EN render exists: film the EN demo accounts first.)

### R02 · A · Envoie ton PDF, reçois ton lien en 24 h (week 1, Wednesday)

- **Hook:** « Ton programme est dans un PDF ? »
- **Shots:**
  - a PDF program on a phone, sent on WhatsApp;
  - the same week in the coach app (Programs);
  - the coach's page with its link.
  - Subtitles: « Envoie-le-moi sur WhatsApp. » « Je le mets sur l'app. » « Tu reçois ton lien en 24 h. Gratuit. »
- **Caption FR:** Envoie-moi ton PDF ou ton Sheet sur WhatsApp, je te mets tout sur l'app en 24 h. Gratuit. Commente APP.
- **ES:** «¿Tu programa está en un PDF?» / Mándame tu PDF o tu Sheet por WhatsApp y te lo paso todo a la app en 24 h. Gratis. Comenta APP.
- **EN:** "Is your program in a PDF?" / Send me your PDF or your Sheet on WhatsApp and I'll put it all in the app within 24 hours. Free. Comment APP.

### R03 · C · Ce que ton client voit en ouvrant l'app (week 1, Friday)

- **Hook:** « Ton client ouvre l'app. Voilà ce qu'il voit. »
- **Shots:**
  - Sara's home, with today's workout;
  - a tap, and the session with its sets;
  - one set logged;
  - the finished session.
  - Subtitles: « Sa séance du jour. » « Il note ses séries. » « Rien à chercher dans un PDF. »
- **Caption FR:** Ton client ouvre l'app : sa séance du jour est là. Il note ses séries, et toi tu vois qu'il s'est entraîné. Commente APP.
- **ES:** «Tu cliente abre la app. Esto es lo que ve.» / Tu cliente abre la app y su entreno del día está ahí. Apunta sus series, y tú ves que ha entrenado. Comenta APP.
- **EN:** "Your client opens the app. Here's what they see." / Your client opens the app and today's workout is there. They log their sets, and you see they trained. Comment APP.

### R04 · D · Ton prix de coaching en ligne : 3 questions (week 2, Monday)

Face to camera, no app on screen. It's advice, so no market figures unless a source backs them.

- **Hook:** « Tu fixes ton prix au hasard ? »
- **Said:**
  - « Un : combien de clients tu peux suivre vraiment bien ? »
  - « Deux : qu'est-ce qui est inclus, le programme seul ou aussi les bilans et les réponses ? »
  - « Trois : à quelle fréquence tu fais le point, chaque semaine ou chaque mois ? »
  - « Ton prix découle de ces trois réponses, pas de celui du voisin. »
- **Caption FR:** Trois questions avant de fixer ton prix de coaching en ligne. Tu en as une quatrième ? Dis-la en commentaire.
- **ES:** «¿Pones tu precio a ojo?» / Tres preguntas antes de fijar tu precio de entrenamiento online. ¿Tienes una cuarta? Dila en comentarios.
- **EN:** "Picking your price at random?" / Three questions before you set your online coaching price. Got a fourth? Say it in the comments.

The call to action here is a question, not APP: this Reel is for reach and comments.

### R05 · B · Il demande depuis Instagram : un code par e-mail (week 2, Wednesday)

- **Hook:** « Pas d'app à télécharger. »
- **Shots:**
  - Instagram, and a tap on Karim's link;
  - the request form;
  - the e-mail with the 6-digit code;
  - the code typed in, and the request sent.
  - Subtitles: « Il demande depuis Instagram. » « Un code par e-mail. » « Demande envoyée : à toi d'accepter. »
- **Caption FR:** Ton abonné demande depuis Instagram, avec un code reçu par e-mail. Pas d'app à télécharger, pas de mot de passe. Tu acceptes, et il est dedans. Commente APP.
- **ES:** «Sin descargar ninguna app.» / Tu seguidor lo pide desde Instagram, con un código que recibe por email. Sin descargar ninguna app ni contraseña. Aceptas y ya está dentro. Comenta APP.
- **EN:** "No app to download." / Your follower asks from Instagram, with a code sent by email. No app to download, no password. You accept, and they're in. Comment APP.

The code sends a request and makes no account: the account is made when the coach accepts (or
at once, with auto-accept). So the screen ends on "request sent", and "il est dedans" comes after
"tu acceptes".

Film it inside Instagram's own browser, on an iPhone and on an Android phone, before posting. If
the in-app prompt to open Safari or Chrome shows up, keep it in: it is part of the real path
(CHW-332).

### R06 · A · Ton Sheet, et la même semaine dans l'app (week 2, Friday)

- **Hook:** « Ton Google Sheet, et la même semaine dans l'app. »
- **Shots:** a split screen: on the left a Sheet with a week of sessions, on the right that week in the client app, scrolled together. Subtitles: « Même programme. » « Sauf qu'ici, il note ses séries. »
- **Caption FR:** Le même programme, sauf qu'ici ton client note ses séries et tu les vois. Envoie-moi ton Sheet, c'est sur l'app en 24 h. Commente APP.
- **ES:** «Tu Google Sheet, y la misma semana en la app.» / El mismo programa, pero aquí tu cliente apunta sus series y tú las ves. Mándame tu Sheet y en 24 h está en la app. Comenta APP.
- **EN:** "Your Google Sheet, and the same week in the app." / The same program, except here your client logs their sets and you see them. Send me your Sheet and it's in the app within 24 hours. Comment APP.

### R07 · C · Il a fait sa séance : tu le vois, tu lui réponds (week 3, Monday)

- **Hook:** « Il s'est entraîné ce matin ? »
- **Shots:**
  - the coach's Today screen with Sara's finished workout;
  - a tap, and the logged sets;
  - the coach types a comment and sends it;
  - on Sara's phone, the comment under her workout (CHW-340).
  - Subtitles: « Tu le vois. » « Tu lui réponds. » « Il le reçoit. »
- **Caption FR:** Ton client a fait sa séance : tu la vois, tu lui laisses un mot, il le reçoit. Commente APP.
- **ES:** «¿Ha entrenado esta mañana?» / Tu cliente hace su entreno: tú lo ves, le dejas un comentario y le llega. Comenta APP.
- **EN:** "Did they train this morning?" / Your client does their workout: you see it, leave them a note, and they get it. Comment APP.

Show workouts only. The coach sees a client's check-ins, weight and photos only once the client
agrees to share them (CHW-360), so this Reel doesn't show them.

### R08 · D · Payé à ta façon (week 3, Wednesday)

- **Hook:** « Qui touche à l'argent de tes clients ? Pas nous. »
- **Shots:** face to camera, then the Accept screen. Said: « Tes clients te paient comme d'habitude : virement, cash, CashPlus. » « FitPal ne touche pas aux paiements et ne prend rien dessus. » « Toi, tu acceptes, ou tu libères la place. »
- **Caption FR:** Tes clients te paient comme d'habitude. FitPal ne touche pas à ton argent. Commente APP.
- **ES:** «¿Quién toca el dinero de tus clientes? Nosotros no.» / Tus clientes te pagan como siempre. FitPal no toca tu dinero. Comenta APP.
- **EN:** "Who touches your clients' money? Not us." / Your clients pay you the way they always have. FitPal never touches your money. Comment APP.

### R09 · B · Accepter à la main, ou l'acceptation automatique (week 3, Friday)

- **Hook:** « Une demande arrive. Tu choisis. »
- **Shots:**
  - the request push on the coach's phone;
  - the request with its answers, and Accept;
  - the page editor's auto-accept switch, turned on;
  - workout 1 on the client's home.
  - Subtitles: « Tu acceptes à la main. » « Ou tu laisses entrer automatiquement. » « Dans les deux cas, la séance 1 est prête. »
- **Caption FR:** Accepte chaque demande à la main, ou laisse entrer automatiquement. Avec un programme de départ, la séance 1 est prête le jour même. Commente APP.
- **ES:** «Llega una solicitud. Tú decides.» / Acepta cada solicitud a mano o deja que entren solos. Con un programa de inicio, el entreno 1 está listo ese mismo día. Comenta APP.
- **EN:** "A request comes in. You choose." / Accept each request by hand, or let them in automatically. With a starter program, workout 1 is ready that day. Comment APP.

### R10 · A · Pas encore de programme écrit ? (week 4, Monday)

- **Hook:** « Pas encore de programme écrit ? »
- **Shots:**
  - Programs, and "from a template";
  - the five templates scrolled: full body for beginners, push / pull / legs, home with no equipment, glutes and legs, Ramadan after iftar;
  - one opened and copied.
  - Subtitles: « Cinq modèles prêts. » « Tu en copies un. » « Tu l'adaptes. »
- **Caption FR:** Cinq programmes prêts à copier : full body débutant, push/pull/legs, maison sans matériel, fessiers et jambes, Ramadan. Commente APP.
- **ES:** «¿Aún no tienes un programa escrito?» / Cinco programas listos para copiar: full body principiante, push/pull/legs, en casa sin material, glúteos y piernas, Ramadán. Comenta APP.
- **EN:** "No program written down yet?" / Five ready-made programs to copy: full body for beginners, push/pull/legs, home with no equipment, glutes and legs, Ramadan. Comment APP.

### R11 · C · Fini le « tu peux me renvoyer le PDF ? » (week 4, Wednesday)

- **Hook:** « "Tu peux me renvoyer le PDF ?" »
- **Shots:**
  - a WhatsApp chat with that message, scrolled up through old PDFs;
  - cut to the client app, with the program and the history.
  - Subtitles: « Son programme est dans l'app. » « Ses séances passées aussi. » « Tu n'envoies plus rien. »
- **Caption FR:** Son programme et ses séances sont dans l'app. Plus de PDF à renvoyer. Commente APP.
- **ES:** «"¿Me reenvías el PDF?"» / Su programa y sus entrenos están en la app. Se acabó reenviar PDFs. Comenta APP.
- **EN:** "\"Can you send me the PDF again?\"" / Their program and their workouts are in the app. No more PDFs to resend. Comment APP.

The WhatsApp chat is staged between two demo phones. Never use a real conversation.

### R12 · D · Gratuit jusqu'à 3 clients : ce que ça veut dire (week 4, Friday)

- **Hook:** « Gratuit. Pas un essai. »
- **Shots:**
  - the coach's Account screen on Free, with 3 places;
  - a client released, and the place free again;
  - the paid plans and their places: Solo 10, Pro 30, Studio 75.
  - Subtitles: « Jusqu'à 3 clients, sans carte, aussi longtemps que tu veux. » « Un client arrête ? Sa place se libère. » « Après, un seul prix. Tout est dedans. »
- **Caption FR:** Gratuit jusqu'à 3 clients, sans carte, aussi longtemps que tu veux. Au-delà, un seul prix, sans options payantes. Commente APP.
- **ES:** «Gratis. No es una prueba.» / Gratis hasta 3 clientes, sin tarjeta, todo el tiempo que quieras. Después, un solo precio, sin extras de pago. Comenta APP.
- **EN:** "Free. Not a trial." / Free up to 3 clients, no card, for as long as you like. After that, one price, no paid extras. Comment APP.

Don't say "upgrade in one tap": paid plans can't be bought online until CHW-302 (messaging §7).

## 5. "Commente APP"

**Manual first.** Reply by hand, from @fitpal, within 24 hours of the comment:
1. Answer under the comment publicly: « Envoyé en DM. » / «Enviado por DM.» / "Sent you a DM."
2. Send one DM, in the language of the comment, with the demo video attached
   (`demo-fr-v.mp4` or `demo-es-v.mp4`, as in R01; in English, link to `https://fitpal.ma/en/`
   until an English render exists).

- **FR:** Salut, merci pour ton commentaire. Voici la démo : ton abonné tape le lien de ta bio, demande, tu acceptes, et sa première séance est prête le jour même. Si tu veux que je m'occupe de tout, écris-moi sur WhatsApp ([WhatsApp]) : je te mets ton programme sur l'app en 24 h. Pour essayer toi-même, c'est gratuit jusqu'à 3 clients, sans carte :
  https://coach.fitpal.ma/#/start?plan=free
- **ES:** Hola, gracias por tu comentario. Aquí tienes la demo: tu seguidor toca el enlace de tu bio, lo pide, aceptas, y su primer entreno está listo ese mismo día. Si quieres que me encargue de todo, escríbeme por WhatsApp ([WhatsApp]) y te paso tu programa a la app en 24 h. Para probarlo tú, es gratis hasta 3 clientes, sin tarjeta:
  https://coach.fitpal.ma/#/start?plan=free
- **EN:** Hi, thanks for the comment. Here's the demo: your follower taps the link in your bio, asks, you accept, and their first workout is ready that day. If you'd like me to do it all, message me on WhatsApp ([WhatsApp]) and I'll put your program in the app within 24 hours. To try it yourself, it's free up to 3 clients, no card:
  https://coach.fitpal.ma/#/start?plan=free

**The link ends the message, on its own line.** Nothing goes after it, punctuation included. If
Instagram keeps a trailing full stop as part of the link, the Start page reads a plan called
"free." and falls back to another plan. While billing is off that is Free, the only plan on
offer, but once billing is on it would be paid Pro. `[WhatsApp]` is the founder's number, as in
the outreach doc. The setup itself starts there, with what `done-for-you.md` asks for.

**The rules for these DMs:**
- **One DM per comment and no follow-up.** They asked for the demo, not for a conversation. If
  they answer, carry on with the outreach doc's "When they say yes" (§2) and its objection
  answers.
- **No list of commenters.** Count the APP comments and the DMs sent each week (§6), and keep
  no handles. Commenters never go into the outreach tracker, even after they sign up: its rates
  divide sign-ups by DMs sent, and they would raise it with sign-ups the DMs didn't bring. A
  commenter who signs up is counted in the Content tab's `inbound_signups` for the week.
- **The 24 hours is the outreach doc's promise, with its limit:** drop that sentence from the DM
  while the setup queue is past a day (`done-for-you.md`).
- **Until CHW-368's phone test passes,** add the outreach doc's browser line to the link: three
  dots, then "Open in browser". Coach sign-up now uses an emailed code, which works inside
  Instagram's browser, but nobody has tested it on a real phone yet.

**Automation past about 20 APP comments a week needs a privacy check first.** A tool like
ManyChat keeps a contact record, with the handle and the messages, for everyone it replies to.
That breaks "no list of commenters", and it makes the tool a new processor of personal data,
which CHW-359 doesn't cover. Before switching:
- **Choose the tool and set its retention.** Prefer Meta's own comment-to-DM tool if it keeps
  nothing beyond the Instagram inbox. Otherwise set ManyChat's contacts to be deleted after a
  few days.
- **Check its processor terms and US transfers** the way CHW-359 checks Namecheap, Resend and
  Cloudflare.
- **Add it to the privacy page,** after a review with the legal skills.

Until all three are done, reply by hand. The automation sends the same DM, once, only to people
who commented the keyword, with no follow-up sequence. Meta lets an account send one private
reply to a comment, within a few days of it; check the exact window in Meta's documentation.
The outreach doc's rule 5 ("by hand, never automated") is about cold DMs to coaches, so it
doesn't forbid answering a comment that asked for the demo. The public reply stays manual. Note
the switch date in §7.

## 6. The accounts, and what is counted

**Setting up the accounts** is the owner's job, because only the owner can create them:
- **Handle:** @fitpal on Instagram and TikTok if it is free. Otherwise @fitpal.ma, then
  @fitpalcoach. Use the same handle on both platforms.
- **Type:** a professional account, set to Business. Name it "FitPal Coach".
- **Profile picture:** the C1 brand mark, gold on graphite (`site-coach/favicon.svg`, exported
  square).
- **Bio:** the link is `https://fitpal.ma` on both.
  - Instagram (150 characters): « Un lien dans ta bio, et leur première séance est prête le jour
    même. Gratuit jusqu'à 3 clients. »
  - TikTok (80 characters): « Un lien en bio, 1re séance prête le jour même. Gratuit jusqu'à 3
    clients. »
- **Highlights, as their Reels exist:**
  - « Comment ça marche »: R01, R05 and R09;
  - « Prix »: R12;
  - « Coachs »: the first Founding Coach Reel. Create it then, not empty before.

**Counted each week.** Add a "Content" tab to the outreach Sheet. Like the Totals tab it holds no
names, only counts, and it has two kinds of row, because the platforms report some numbers per
Reel and others only for the whole account:
- **One row per Reel:** `reel`, `lang`, `platform`, `posted`, `reach`, `plays`, `shares`,
  `saves`, `app_comments`, `dms_sent`.
- **One row per week and platform:** `week`, `platform`, `profile_visits`, `link_taps`,
  `inbound_signups`. `link_taps` is Instagram's "External link taps" (professional dashboard).
  On TikTok, use profile views and bio-link clicks from TikTok Analytics.

**Sign-ups per week** come from the admin panel's coach funnel (CHW-335). It counts every
self-serve coach, not only those the Reels brought, so read it beside the link taps; it isn't
caused by them. To credit a sign-up to the content, ask the coach who signs up « Tu nous as
connus comment ? » when they write. A coach from the outreach notes the answer in their tracker
row's `notes`. A commenter adds one to the week's `inbound_signups` (§5).

Real attribution needs a change to the product: the Start page would keep a short source from its
link (`#/start?plan=free&src=ig`) and the sign-up audit event would record it. That is a
separate issue, because it touches what the privacy page says is collected. Wait until there are
enough sign-ups to be worth splitting.

**At the Monday review** (outreach doc §5), after the DM totals:
- **The week's Reels:** reach, shares and saves, and APP comments, per theme. The account's
  link taps and inbound sign-ups come once for the week.
- **The best Reel:** the two-week block's top two by shares plus saves, then APP comments. Every
  Reel has those numbers, whatever its call to action. They get Spanish and English versions (§3).
- **The theme check:** a theme that comes last on shares plus saves for three blocks in a row
  gives up its slots to the best theme for the next block. Write it down in §7.

**Done when** (CHW-351): the 12 weeks are planned (§3), weeks 1–4 are produced (§4, filmed and
scheduled), and the weekly numbers are in the Monday review.

## 7. Changes

*(none yet)*
