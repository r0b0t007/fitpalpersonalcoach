# Coach interviews and mystery-shop: the kit, then the results

Written 2026-11-06 for CHW-344 (growth plan §4, weeks 1–2). Sections 1–5 are the kit: what we
want to learn, how to recruit, the interview guide in French and Spanish, the mystery-shop and
how notes are kept. Section 6 is where the results go: tables with no names in them, and the
decisions they change. The founder runs it. Nothing here is automated.

**What stays out of this repo:** names, handles, phone numbers and the raw notes. They live in a
private Google Doc (§5). Only the anonymous tables in §6 come back here, because the repo is
public.

## 1. What we are trying to prove wrong

Each assumption below is one the plan already rests on. An interview is useful when it can break
one, so each comes with the answer that would break it.

| # | The plan assumes | It's wrong if most coaches say… | It decides |
|---|---|---|---|
| A1 | They deliver programs as a PDF or a Sheet over WhatsApp | they already use an app, or deliver in calls or in person | the "contre le PDF" angle (messaging §4) |
| A2 | Admin time limits them, not demand | they want more clients, not less admin | the pitch's order: proof 4 (done for you) first or the bio link first |
| A3 | Instagram is where they sell | most sign-ups come from WhatsApp, TikTok or word of mouth | where the Reels and DMs go (CHW-351, CHW-347) |
| A4 | Clients pay them by transfer or cash, especially in Morocco | they already take cards online | proof 3 ("paid your own way") |
| A5 | Free up to 3 clients is enough to try it with real clients | they have 10+ clients and 3 is too few to judge | the Free cap: 3 or 5 (growth plan §5) |
| A6 | €19 / €39 / €79 a month is acceptable | Moroccan coaches can't or won't pay a euro card subscription, or find €19 too much against what they earn | a price in MAD (CHW-355) |
| A7 | Coaches want each follower to ask first | they would take anyone who asks, at once | whether auto-accept is on by default (growth plan §5) |

Ask about what they did, not what they would do. "Walk me through the last client you signed" is
evidence. "Would you use an app that…" isn't.

## 2. Recruiting the 20

**Who:** the same coaches as the outreach list (outreach doc §3): independent, 5k–100k followers,
coaching online or one to one. Ten in Morocco, five in France or Belgium, five in Spain.

**Where from, in this order:**
1. **Coaches who answered a French outreach DM,** whatever they said, "no" excepted.
2. **People who already know the founder:** coaches in their own network, and coaches those
   coaches name. End every interview with « Qui d'autre je devrais appeler ? ». Outside France,
   a coach who is named is contacted only through the person who named them: they pass on the
   message, or start a group with both of you. Nobody gets a DM out of the blue.
3. **A post on @fitpal.ma** and on the founder's own account, which coaches answer themselves:
   « On cherche 20 coachs en ligne pour 20 minutes de discussion sur leur façon de travailler.
   Pas de vente. En remerciement : 3 mois de Pro offerts et le résumé anonyme de ce que facturent
   les autres. Écris-moi en DM. »
4. **Trainer schools and coach groups** (growth plan §4, weeks 3–10), asking the school to pass
   the message on.

**Cold DMs to recruit go to France only, and not yet.** An interview request comes from a
business that wants to sell to them, so the outreach rules apply to it too. In Morocco, Spain and
Belgium a cold DM needs the coach's consent first
([LIA](../privacy/2026-11-08-lia-coach-prospecting.md) §4), so coaches there come through
channels 2–4, where they write first, know us or are introduced. Channel 1 is French only, like the
outreach itself, and waits for the outreach doc's "before the first send" list (§4): because the
sender is in Morocco, law 09-08 may require consent even for French coaches. Until then, recruit
through channels 2–4 everywhere.

**What they get for it:**
- **3 months of Pro free:** granted from the admin panel once they have an account, whenever
  they make it. To find the account, they tell you the e-mail they signed up with.
  - **It has no end date.** `Accounts::grant` makes a `manual` licence, valid until revoked. Put
    the revoke date in the founder's calendar, with the account's e-mail, and delete that entry
    once the licence is revoked.
  - **Tell the coach a week before it ends.** They then drop to Free, because production sets
    `FREE_CAP=3`: they keep every client they have, but take no new one while they have 3 or
    more. Check that `/api/config` still shows `free_cap: 3` before revoking, because without it
    a revoked coach is read-only while billing is on.
  - **A grant is refused (409)** for a coach whose Creem subscription can still bill. Billing is
    off today, so none can, but once it is on, a coach who already started a paid plan gets the
    3 months only after they cancel it in Creem, or doesn't get them.
- **The anonymous summary of §6** when it is done: what other coaches charge and how they work.

**The ask** (DM or WhatsApp, to someone who wrote first or was introduced):
- **FR:** Salut [prénom]. Je construis FitPal Coach, un outil pour les coachs en ligne, et avant d'aller plus loin j'aimerais comprendre comment tu travailles aujourd'hui : comment tu trouves tes clients, comment tu leur envoies leur programme, ce qui te prend du temps. 20 minutes en appel, quand tu veux cette semaine. Pas de vente. En remerciement, 3 mois de Pro offerts et le résumé anonyme de ce que facturent les 20 coachs que j'interroge. Ça te dit ?
- **ES:** Hola [prénom]. Estoy creando FitPal Coach, una herramienta para entrenadores online, y antes de seguir quiero entender cómo trabajas hoy: cómo encuentras clientes, cómo les mandas el programa, qué te quita tiempo. 20 minutos de llamada, cuando te venga bien esta semana. Sin venta. Como agradecimiento, 3 meses de Pro gratis y el resumen anónimo de lo que cobran los 20 entrenadores con los que hablo. ¿Te animas?

## 3. The interview: 20 minutes

**Rules for the founder:**
- **No pitch before minute 15.** Don't explain FitPal, don't defend it, don't correct them.
- **Their last real case, not their opinion.** When they generalise ("en général…"), ask for the
  last time it happened.
- **Ask why, two or three times,** until the answer is about money, time or how they feel.
- **Write their exact words** for anything that hurts or that they love. Those are the quotes in
  §6, and later the copy.
- **Show the product only to the last 10** (§3, step 6), so the first 10 aren't steered by it.
- **Order the calls so the last 10 hold 5 Moroccan coaches,** 3 from France or Belgium and 2
  from Spain. The price and cap rules in §6 read step 6's answers, and Morocco is where the
  price question is open.

**The guide** (FR, then ES). The numbers match the columns in §6.

0. **Opening, 1 min.** Read the notice (§5) and ask whether notes are OK.
   - FR: « Merci. Je prends des notes pour moi, sans enregistrer, et ce que je garde est anonyme. Ça te va ? »
   - ES: «Gracias. Tomo notas para mí, sin grabar, y lo que guardo es anónimo. ¿Te parece bien?»
1. **How the last client arrived, 4 min** (A3, A2).
   - FR: « Raconte-moi ton dernier client : comment il t'a trouvé, ce qu'il t'a écrit, ce qui s'est passé jusqu'à sa première séance. »
   - ES: «Cuéntame tu último cliente: cómo te encontró, qué te escribió, qué pasó hasta su primer entreno.»
   - Then: where most of their clients come from (Instagram, TikTok, WhatsApp, word of mouth), and what is in their bio link today.
2. **How the program reaches the client, 3 min** (A1).
   - FR: « Comment il reçoit son programme ? Et quand il a une question en pleine séance, ou qu'il l'a perdu ? »
   - ES: «¿Cómo recibe su programa? ¿Y cuando tiene una duda en mitad del entreno, o lo ha perdido?»
3. **Numbers, 3 min** (A5, A6, A4).
   - FR: « Combien de clients tu suis en ce moment ? Combien de nouveaux par mois ? Tu factures combien, et ils te paient comment ? »
   - ES: «¿Cuántos clientes llevas ahora? ¿Cuántos nuevos al mes? ¿Cuánto cobras, y cómo te pagan?»
   - Note the price exactly, with its currency and period (a month, 12 weeks, a one-off program).
4. **The worst hour, 3 min** (A2).
   - FR: « Sur la semaine dernière, quelle heure de travail tu aurais voulu ne pas faire ? Pourquoi ? »
   - ES: «De la semana pasada, ¿qué hora de trabajo habrías querido no hacer? ¿Por qué?»
5. **Tools and money, 2 min** (A1, A6).
   - FR: « Tu as déjà essayé une app de coaching ? Pourquoi tu l'as gardée, ou arrêtée ? Tu paies quoi aujourd'hui pour ton activité (Canva, CapCut, une app…), et comment, par carte ? »
   - ES: «¿Has probado alguna app de coaching? ¿Por qué la sigues usando, o por qué la dejaste? ¿Qué pagas hoy para tu negocio (Canva, CapCut, una app…), y cómo, con tarjeta?»
6. **The product, only for the last 10, 3 min** (A7, A5, A6). Show the demo film
   (`renders/demo-fr-v.mp4` or `demo-es-v.mp4`, as in the content calendar R01) on your phone,
   then the coach's page and the requests inbox on the demo instance. Say nothing while they
   watch. Note every place they frown, ask something, or get it wrong.
   - FR: « Qu'est-ce que tu as compris ? Qu'est-ce qui te gênerait ? »
   - FR: « Quand quelqu'un demande à s'entraîner avec toi, tu préfères accepter chaque personne, ou laisser entrer tout le monde directement ? »
   - FR: « À quel prix par mois tu trouverais ça trop cher pour l'essayer ? Et à quel prix ce serait une évidence ? »
   - FR: « C'est gratuit jusqu'à 3 clients. Avec 3 clients, tu saurais si ça te convient, ou il t'en faudrait plus pour juger ? »
   - ES: «¿Qué has entendido? ¿Qué te molestaría?» · «Cuando alguien pide entrenar contigo, ¿prefieres aceptar a cada persona o dejar entrar a todos directamente?» · «¿A qué precio al mes te parecería demasiado caro para probarlo? ¿Y a qué precio sería obvio?» · «Es gratis hasta 3 clientes. ¿Con 3 clientes sabrías si te sirve, o necesitarías más para juzgarlo?»
7. **Close, 1 min.**
   - FR: « Qui d'autre je devrais appeler ? » Then say when the summary and the 3 months of Pro will arrive.
   - ES: «¿Con quién más debería hablar?»

The first 10 get steps 0–5 and 7, in about 17 minutes. If time is short, cut step 2, not step 3.

## 4. The mystery-shop: 20 more coaches

The aim is what coaches charge and how they deliver and get paid, in each market. In Morocco that
fills the growth plan's "300–800 MAD (est.)" gap.

**Public prices first.** Many coaches publish them: the bio link page (Linktree, Stan, a site), a
"Tarifs" highlight, a pinned post. Record what is published, and send nothing to that coach.

**Ask only where nothing is published,** as someone looking for coaching. The account matters:
- **Not the outreach account,** nor any account whose bio links to FitPal Coach. A coach who
  opens it would see who is asking, and the prices would be skewed.
- **A real person's own personal account,** never a made-up one: Instagram's rules forbid fake
  accounts.
- **Skip every coach already in the outreach tracker,** whatever their `outcome`. A coach who
  said no or stop gets nothing more from us, this included.

Keep it to one exchange:
- FR: « Salut, je cherche un coaching en ligne. C'est combien par mois, qu'est-ce qui est inclus, et comment on paie ? »
- ES: «Hola, busco un entrenamiento online. ¿Cuánto cuesta al mes, qué incluye y cómo se paga?»
- After their answer: « Merci, je réfléchis et je reviens vers toi. » / «Gracias, lo pienso y te digo.» Then stop: no call, no form, no payment, no follow-up, and don't answer a follow-up of theirs beyond « merci, pas pour le moment ».

This is a small white lie to a small business, so it stays this small: one question, one thank
you, no personal story, nothing that costs them more than a reply.

**Record, with no handle, no name and no screenshot:**
- country;
- followers band (5–20k, 20–50k, 50–100k);
- niche;
- price, currency and period;
- what is included;
- how the program is delivered;
- how clients pay;
- hours to answer;
- whether the price was published or asked.

Without a handle the row is not about anyone you can identify, which is why it can come into §6
as it is.

## 5. Notes and privacy

Not legal advice. Checked against the GDPR basics in lawve-ai/awesome-legal-skills
(privacy-compliance-advisor); the items marked "to verify" are for the owner.

- **What is kept:** for each interview, the coach's first name and handle, the date, the answers
  in notes, and whether they agreed to be contacted again. No recording, unless they agree to one
  first.
- **Where:** one Google Doc, private to the founder, not in this repo and not in the outreach
  Sheet. An interview is not a prospect row.
- **The basis:** they agree to the interview and to the notes (step 0), and they can stop at any
  time.
- **How long:** each interview's notes are deleted 60 days after that interview, once its row
  in §6 is written. What stays is that anonymous row. If they take the 3 months of Pro, the
  account's e-mail sits in the founder's calendar until the licence is revoked (§2), then goes.
- **Nothing moves to the outreach tracker.** An interviewee who wants to try FitPal gets the
  sign-up link at the end of the call. If they want to hear more later, they write to @fitpal.ma
  themselves. The tracker is for cold outreach, with its own notice and France-only rule, and an
  interview is neither.
- **The notice,** read at step 0 or sent before the call:
  - FR: « C'est moi, [nom], fondateur de FitPal Coach ([e-mail]), qui prends les notes, pour comprendre comment travaillent les coachs. Je note ton prénom, ton @ et tes réponses, sans enregistrer. Seul un résumé anonyme est gardé ; mes notes sont effacées dans les deux mois. Si tu prends les 3 mois de Pro, je garde l'e-mail de ton compte jusqu'à leur fin. Tu peux arrêter quand tu veux, et me demander de voir ou d'effacer mes notes. »
  - ES: «Soy yo, [nom], fundador de FitPal Coach ([e-mail]), quien toma las notas, para entender cómo trabajan los entrenadores. Apunto tu nombre, tu @ y tus respuestas, sin grabar. Solo se guarda un resumen anónimo; mis notas se borran en dos meses. Si aceptas los 3 meses de Pro, guardo el email de tu cuenta hasta que terminen. Puedes parar cuando quieras y pedirme ver o borrar mis notas.»
- **To verify:**
  - **Google as host:** the Doc may be stored outside the EU. This goes with the Google Sheet
    question in the outreach doc §4.
  - **Morocco:** whether interview notes about coaches there need anything under law 09-08
    beyond their consent. This goes with CHW-367.

## 6. Results

Fill in one row per interview and per mystery-shop, right after each one. Use IDs (I01–I20,
M01–M20), never names. This file is public, and in a small market a row with exact numbers can
point to one coach. So every row uses bands, and nothing more precise:
- **Followers:** 5–20k, 20–50k, 50–100k.
- **Clients:** 1–5, 6–15, 16–30, 30+. New per month: 0–2, 3–5, 6+.
- **Prices:** rounded to the nearest 50 MAD or €10.
- **Quotes:** no city, gym, niche detail or anything else that names them.
Before writing a row, ask: could someone find this coach from it? If yes, cut more.

### Interviews

| ID | Country | Followers | Clients now | New / month | Price (currency, period) | Clients pay by | Delivery today | Sells from | Tool paid today, how | Worst hour (quote) | Accept each or all | Too expensive / obvious | 3 enough to judge? | Confusion on the demo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | |

### Mystery-shop

| ID | Country | Followers | Niche | Price | Currency, period | Included | Delivery | Clients pay by | Hours to answer | Published or asked |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

### What it changes

After the 20 and 20, write one paragraph per assumption in §1: held, broken, or unclear, with the
count behind it (for example, "14 of 20 deliver by PDF or Sheet"). Then apply these rules and
update the growth plan's §5 (open tests) and the messaging doc where a rule says so:

- **The Free cap (A5):** keep 3 unless both are true: the median coach of the 20 has 10 or more
  clients, and half or more of the last 10 answered "3 enough to judge?" with no. Then test 5.
  If the median is under 5 clients, Free covers most of their business, and 3 stays whatever
  they say.
- **A price in MAD (A6):**
  - **Run the 149 / 299 MAD test (CHW-355)** if either is true:
    - half or more of the 10 Moroccan coaches have no card they use for subscriptions (step 5,
      asked to all 20);
    - the median "too expensive" of the 5 Moroccan coaches in the last 10 is under €19 (about
      200 MAD).
  - **Otherwise** keep euro prices for Morocco too, and close that half of CHW-355.
- **Auto-accept by default (A7):** on if most of the last 10 would let everyone in, off if most
  want to accept each person. If it's split, keep today's default.
- **The angles (A1–A4):** decide market by market. An assumption is broken in a market when
  most of its coaches break it: 6 of the 10 in Morocco, 3 of the 5 in France or Belgium, 3 of
  the 5 in Spain. Then that market's row in the messaging doc's §4 changes, with the DM scripts
  and Reels that follow from it. When 12 or more of the 20 break it, it changes for every
  market.
- **Moroccan prices:** replace "300–800 MAD (est.)" in the growth plan §1 with the mystery-shop
  median and range, and mark where it came from.

**Done when** (CHW-344): 20 interviews and 20 mystery-shops are in the tables, the paragraph
per assumption is written, and the growth plan's §5 is updated.
