# CNDP filing for FitPal Coach (CHW-367)

**Draft, 6 November 2026. Not legal advice**: have it reviewed before filing. It prepares FitPal
Coach's filing with the CNDP under law 09-08: the prior authorisation for health data (art. 12.1(a))
and the transfer of the data to the United States (art. 44.3). The reasons are in the
[TIA](2026-11-06-transfer-impact-assessment.md) §4 and the
[DPIA](2026-11-01-dpia-coaching-and-join-requests.md). The answers below are written in French, as
the forms are. `[à compléter]` marks a fact only the owner holds. Nothing here is invented to fill
a blank.

Forms (cndp.ma, *Procédures de notification*):
- **F-112**, demande d'autorisation préalable: https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Autorisation-Prealable-F112-20250910.pdf. It has its own section VIII on transfers abroad.
- **F-118**, demande de transfert de données à l'étranger: https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Transfert-Etranger-F118.pdf. It asks for the receipt numbers of the processing declared in Morocco (section III.8), so it comes **after** F-112.
- **F-211**, déclaration normale, for FitPal's own processing (section 3 bis): https://www.cndp.ma/wp-content/uploads/2023/06/CNDP-Declaration-Normale_F211_20210318_Fr.pdf (version of 18 March 2021). It sends transfers abroad to the F-118 too. **To verify:** a CNDP deliberation of 28 November 2025 (D-940-2025) mentions a CNDP-FORMS platform for declarations, so the PDF may no longer be the channel.

The CNDP's pages give no filing channel (portal, email or paper), only contact@cndp.ma, the 3020
line and the address in Rabat. Incomplete files are rejected. So the first step is the email in
section 1.

---

## 1. Email to the CNDP (send first)

**À :** contact@cndp.ma
**Objet :** Plateforme SaaS de coaching sportif : autorisation des données de santé et transfert vers les États-Unis (loi 09-08)

> Madame, Monsieur,
>
> J'exploite, en tant que personne physique établie à Tétouan, FitPal Coach
> (https://fitpal.ma), une application web que des coachs sportifs indépendants utilisent pour
> suivre leurs clients : programmes d'entraînement, séances, et, si le client le choisit, des
> données qui peuvent révéler sa santé (blessures signalées à l'inscription, bilans hebdomadaires,
> mensurations, photos de progression). Chaque coach est responsable du traitement des données de
> ses clients ; FitPal Coach en est le sous-traitant. L'application est hébergée aux États-Unis
> (Namecheap), les e-mails sont envoyés par Resend (États-Unis) et le trafic passe par Cloudflare
> (États-Unis) ; les sauvegardes, chiffrées, sont stockées dans l'Union européenne.
>
> Avant d'ouvrir le service à des coachs établis au Maroc, je souhaite déposer les formalités
> requises et vous remercie de bien vouloir m'indiquer :
>
> 1. si la plateforme peut déposer une seule demande d'autorisation (formulaire F-112) couvrant le
>    traitement qu'elle effectue pour l'ensemble des coachs, ou si chaque coach établi au Maroc,
>    responsable du traitement, doit déposer sa propre demande ;
> 2. si le transfert vers les États-Unis doit faire l'objet d'une demande distincte (F-118) ou
>    peut figurer dans la section VIII du F-112, sur la base des clauses contractuelles types des
>    prestataires (article 44.3 de la loi 09-08) ;
> 3. le mode de dépôt en vigueur (en ligne, par e-mail ou au bureau d'ordre) et les pièces
>    attendues pour une personne physique.
>
> Je reste à votre disposition pour tout complément.
>
> Ahmed Chioua
> FitPal Coach — contact@fitpal.ma — [téléphone à compléter]

---

## 2. Who files what (to confirm with the CNDP's answer)

| Processing | Controller | Filing |
|---|---|---|
| Coaching data of a coach's clients, health data included (intake, check-ins, measurements, photos) | **The coach** (FitPal is the processor) | F-112, by each coach in Morocco, **or once by FitPal** if the CNDP accepts it (question 1) |
| Coach accounts, plan, security log, fitpal.ma; the referral programme and its check on a referred coach's clients (CHW-350, CHW-372) | **FitPal Coach** | F-211 (déclaration normale), section 3 bis |
| Transfer of both to the United States | The controller of each | F-112 section VIII, or F-118 (question 2) |

If each coach must file, FitPal should give them a ready-made file: these answers, its terms (the
processor contract), and the security annex.

---

## 3. F-112: the answers

### Identification du responsable (section I)

**Do not file before the CNDP has answered question 1.** For the coaching data the controller is
the coach, and FitPal the processor (coach terms Part B, DPIA). So section I names:
- **if each coach files**: the coach, as controller, with FitPal Coach named as the processor
  (sous-traitant) wherever the form asks for one;
- **if the CNDP lets the platform file once**: FitPal Coach in the capacity the CNDP indicates, as
  processor for all the coaches, never as the controller of their clients' data.

FitPal's own processing (coach accounts, the security log, the referral programme and its check)
is the one where it is the controller, and goes on an F-211 (section 3 bis). Its identification, for either case:

- **Personne physique** : Ahmed Chioua, FitPal Coach (pas d'immatriculation commerciale : ni ICE
  ni RC).
- Adresse : Bureau 69, Wilaya Center, Tétouan, Maroc.
- Activité : édition et exploitation d'un logiciel en ligne de suivi pour coachs sportifs.
- E-mail : contact@fitpal.ma. Téléphone : [à compléter].
- Représentant légal : Ahmed Chioua. CNI n° : [à compléter].

### Cadre du traitement des données sensibles (section II)

- **Consentement exprès : oui.**
  - À l'inscription chez un coach, une case séparée, obligatoire pour envoyer les réponses sur les
    blessures ; l'âge est confirmé.
  - Avant la première saisie d'un bilan, d'une pesée, d'une mensuration, d'un repas ou d'une photo,
    l'application demande le consentement. Pour un client de moins de 16 ans, il vient d'un parent
    ou tuteur.
  - Le consentement est horodaté. Son retrait efface les données concernées.
- Données sensibles : relatives à la santé (blessures et douleurs déclarées ; sommeil, courbatures,
  stress, énergie ; poids, mensurations ; photos de progression ; repas).

### Caractéristiques du traitement (section VI)

1. **Dénomination :** FitPal Coach, suivi d'entraînement des clients de coachs sportifs.
2. **Description :** le coach reçoit les demandes de personnes qui souhaitent s'entraîner avec lui,
   les accepte, prépare leurs programmes et suit leurs séances et, si le client le choisit, ses
   bilans, mensurations et photos.
3. **Nombre approximatif de personnes concernées :** quelques centaines la première année
   (comptes de test uniquement à ce jour).
4. **Données anonymisées :** non.
5. **Outils de collecte :** l'application web (https://coach.fitpal.ma) et son formulaire
   d'inscription chez un coach.

**Données, origine, destinataires, durées** (dans le tableau du formulaire) :

| Données | Personnes | Origine | Destinataires | Durée |
|---|---|---|---|---|
| Nom (tel que saisi), e-mail | Clients | La personne | Son coach | Durée du compte |
| N° WhatsApp (facultatif) | Clients | La personne | Son coach | Comme l'inscription |
| Objectif, niveau, séances par semaine, équipement | Clients | La personne | Son coach | Comme l'inscription |
| **Blessures ou douleurs** (facultatif) | Clients | La personne | Son coach | Effacées au refus ou à l'expiration de la demande ; supprimées quand le lien avec le coach prend fin |
| Programmes, séances, charges | Clients | Coach et client | Client, coach | Durée du compte |
| **Poids, mensurations, photos, repas, bilans** (facultatifs) | Clients | La personne | Client, coach (après consentement) | Durée du compte ; effacés au retrait du consentement |

Les comptes des coachs eux-mêmes (nom, e-mail, offre), le journal de sécurité (sans adresse IP,
90 jours au plus), le programme de parrainage et sa vérification (qui lit, chez un coach parrainé,
les dates d'entraînement de ses clients pour n'en retenir qu'un oui ou un non) relèvent du
traitement propre de FitPal Coach, qui en est le responsable : ils se déclarent sur un F-211, et
non sur ce F-112.

Demandes non vérifiées supprimées sous 24 heures. Sauvegardes : 14 jours (chiffrées), 90 jours au
plus pour la copie faite avant une mise à jour.

### Transfert de données à l'étranger (section VIII)

| Destinataire | Pays | Rôle | Données | Garanties |
|---|---|---|---|---|
| Namecheap, Inc. | États-Unis (Phoenix, Arizona) | Hébergement de l'application et de la base | Toutes | Accord de traitement, clauses contractuelles types de la Commission européenne (décision 2021/914) |
| Resend | États-Unis | Envoi des e-mails | E-mail, prénom, message | Accord de traitement, clauses contractuelles types ; certifié Data Privacy Framework UE–États-Unis |
| Cloudflare, Inc. | États-Unis ; sauvegardes stockées dans l'UE | Acheminement du trafic ; stockage des sauvegardes | Trafic en transit ; sauvegardes chiffrées (Cloudflare n'a pas la clé) | Accord de traitement, clauses contractuelles types ; certifié Data Privacy Framework |
| Services de notification des navigateurs (Google, Apple, Mozilla) | États-Unis | Acheminement des notifications | Notifications chiffrées, qu'ils ne peuvent pas lire ; un identifiant d'abonnement | Aucun accord de traitement : le navigateur de la personne les choisit. **To verify (counsel):** whether the CNDP wants them listed as recipients. |

Base : article 44.3 (clauses contractuelles). Les accords de traitement sont joints (section 4).

### Droits des personnes (section XI)

Information par la page « Mentions légales » (https://fitpal.ma/mentions-legales) et dans
l'application. Accès, rectification et opposition auprès de contact@fitpal.ma. Le client peut aussi
supprimer lui-même son compte dans l'application.

### Mesures de sécurité (section XIII)

Celles de l'annexe 2 des conditions coachs (https://fitpal.ma/conditions#annexe-2) :
- HTTPS uniquement ;
- passkeys ou code à usage unique, aucun mot de passe client stocké ;
- cloisonnement entre coachs, vérifié par des tests automatisés ;
- minimisation et effacements automatiques ;
- accès de l'exploitant seul, par clés SSH ;
- sauvegarde chiffrée chaque nuit, copiée hors de l'hébergement dans l'UE, avec une restauration
  vérifiée ;
- revue annuelle.

---

## 3 bis. F-211 : le traitement propre de FitPal Coach

Added 7 November 2026, after the referral programme (CHW-350) and the coach terms 2026-11-07
(CHW-372). Here FitPal Coach is the **controller**: its own customers (the coaches), its security
log, and the referral programme. The referral check reads data about a referred coach's clients,
but only to answer yes or no, and FitPal is its controller (coach terms Part B §2; legal notice,
« Demander à s'entraîner avec un coach »). So it is declared here, not on the coaches' F-112. The
data it reads (dates of training) is not health data, so it needs no prior authorisation.

**Identification (section I) :** la même qu'à la section 3 (personne physique, Ahmed Chioua).

**Finalités :**
1. **Gestion des comptes des coachs :** inscription, connexion, offre souscrite, acceptation des
   conditions (version et date), page publique du coach, assistance.
2. **Journal de sécurité :** les opérations sensibles (connexions, changements de rôle, actions de
   l'exploitant), pour détecter et prouver les abus.
3. **Programme de parrainage :** enregistrer quel coach en a parrainé un autre, et lui créditer un
   mois offert (conditions coachs, partie A, section 4 bis).
4. **Vérification du parrainage :** pour un coach parrainé, vérifier si un client venu par sa page
   publique et accepté s'est entraîné depuis, pour créditer le coach qui l'a parrainé. Seul un oui
   ou un non en est retenu.

**To verify (counsel):** FitPal also processes, as controller, two things this declaration leaves
out. Both are in the legal notice since 8 November 2026:
- **coach prospecting on Instagram**: a list of coaches' public profile details in a local,
  encrypted spreadsheet on the owner's computer, not a Google Sheet since 14 November 2026
  (`docs/growth/2026-11-dm-outreach.md` §4);
- **the done-for-you setup over WhatsApp**: a coach's program, photo, bio and account e-mail,
  and their WhatsApp number and profile name. The files are kept until the setup is done (14 days
  if it stalls); the chat while the coach's account exists; the Setups tab of the same local
  file keeps their handle and notes 30 days, then times only (`docs/growth/done-for-you.md` §4
  and §5).

Whether they go on this F-211 as purposes 5 and 6 (with Meta and, for chat backups, Google or Apple as recipients; the list itself is no longer
transferred to the US), or on a declaration of their own. Counsel's answer of 14 November 2026
that law 09-08 does not apply to FitPal may make this moot (LIA §4.1).

**Données, origine, destinataires, durées :**

| Données | Personnes | Origine | Destinataires | Durée |
|---|---|---|---|---|
| Nom, e-mail, passkeys ou codes de connexion, offre, version et date d'acceptation des conditions | Coachs | Le coach | FitPal Coach | Durée du compte |
| Abonnement payant : identifiants client, abonnement et produit chez Creem, statut, période | Coachs | Creem, le coach | FitPal Coach ; Creem (vendeur officiel, qui encaisse et facture) | Durée du compte |
| Page publique : nom affiché, photo, présentation, n° WhatsApp (facultatif) | Coachs | Le coach | Public (c'est une page publique) | Jusqu'à ce que le coach la modifie ou ferme son compte |
| Inscription en attente : e-mail, nom, langue, version des conditions affichées, empreinte du code envoyé, nombre d'essais, et la page du coach parrain si l'inscription vient d'un lien de parrainage | Coachs | Le coach | FitPal Coach | 24 heures au plus |
| Journal de sécurité : l'action, l'heure, le compte qui agit et le compte visé (identifiants et noms), une note brève (par exemple celle de l'exploitant quand il utilise un mois offert) ; **sans adresse IP**. Pour le parrainage, il note qu'un coach s'est inscrit par le lien d'un autre, et qu'un mois a été crédité | Coachs, clients, exploitant | Le système | FitPal Coach | 90 jours au plus ; les sauvegardes quotidiennes en gardent une copie 14 jours de plus (leur copie hors de l'hébergement jusqu'à un jour de plus), et chaque copie faite avant une mise à jour 90 jours au plus |
| Coach qui a parrainé (identifiant) | Coachs parrainés | Le lien de parrainage suivi | FitPal Coach | Durée du compte du coach parrainé, ou jusqu'à son opposition |
| Mois offerts : coach crédité, coach parrainé, date, date et mode d'utilisation | Coachs | Le système, l'exploitant | FitPal Coach ; le coach crédité voit des **nombres** seulement, jamais lesquels | Durée du compte du coach crédité. Le coach parrainé n'y est plus nommé après son opposition. Aujourd'hui la ligne disparaît aussi si le compte du coach parrainé est supprimé (voir la note en fin de section) |
| **Lu sans être conservé** pour la vérification : l'e-mail d'un client accepté (pour écarter les adresses des deux coachs), la date de son acceptation, s'il est toujours client de ce coach, la date de sa dernière séance et l'heure de sa première sauvegarde | Clients d'un coach parrainé | Le client (son application) | Personne : seul le oui ou le non sert | Rien n'est conservé au titre de ce traitement |

**Fondement (article 4 de la loi 09-08) :**
- finalité 1 : l'exécution du contrat avec le coach (les conditions coachs) ;
- finalité 2 : l'intérêt légitime de FitPal Coach à protéger le service et les comptes ;
- finalités 3 et 4 : l'intérêt légitime de FitPal Coach à se faire connaître par la recommandation
  de ses coachs, et celui du coach qui parraine. Le coach parrainé autorise la vérification dans
  les conditions (partie B, section 2) ; ce n'est pas un consentement au sens de la loi, et le
  fondement reste l'intérêt légitime. Le client en est informé (mentions légales) et peut s'y
  opposer.
- **To verify (counsel):** that article 4's exceptions to consent cover a legitimate interest as
  RGPD art. 6.1.f does, and that a written assessment of that interest is kept on file (an open
  CHW-350 item).

**Transferts à l'étranger :** les mêmes que pour le F-112 (section VIII ci-dessus) : Namecheap
(hébergement), Resend (e-mails), Cloudflare (trafic, sauvegardes chiffrées dans l'UE), et les
services de notification des navigateurs. S'y ajoute **Creem**, vendeur officiel des formules
payantes, quand la facturation est ouverte (elle ne l'est pas encore) : il reçoit les données de
paiement du coach directement, et l'identité du coach. **To verify:** Creem's country and transfer
basis. Sur le F-211, les transferts se déclarent par le F-118.

**Droits des personnes :** information dans les mentions légales (« Parrainage » ; « Demander à
s'entraîner avec un coach ») ; accès, rectification et opposition à contact@fitpal.ma. Sur une
opposition au parrainage, d'un coach parrainé ou d'un client, l'exploitant retire l'indication du
coach qui a parrainé (commande `fitpal:referral-forget`) : la vérification n'a plus lieu, et le mois
déjà crédité reste acquis. Les lignes du journal de sécurité qui notaient ce parrainage ne sont pas
retirées : elles s'effacent avec le journal, 90 jours au plus après avoir été écrites ; les
sauvegardes quotidiennes en gardent une copie 14 jours de plus (leur copie hors de l'hébergement
jusqu'à un jour de plus), et chaque copie faite avant une mise à jour 90 jours au plus. Les mentions
légales le disent, avec ces durées, depuis le 8 novembre 2026 (« Parrainage »).

**Mesures de sécurité :** celles de la section XIII ci-dessus.

**Not filed here (a gap the owner should know):** closing a coach's account is done by hand, on
request. If its last step deletes the coach's row, the database also deletes a month that coach
earned *for someone else* (`referral_credits.referred_id` cascades). Whoever writes that closing
procedure should first clear `referred_id`, as an objection does.

---

## 4. Pièces à joindre

1. **Document attestant du pouvoir de signature** : copie de la CNI, la personne physique signant
   pour elle-même [à préparer].
2. **Note d'information** : les mentions légales (FR), imprimées en PDF.
3. **Document de consentement** : captures des écrans de consentement (inscription chez un coach ;
   première saisie de données de santé).
4. **Contrats de sous-traitance** :
   - les conditions coachs, parties A et B (le contrat entre le coach, responsable, et FitPal,
     sous-traitant) ;
   - les accords de traitement de Namecheap, Resend et Cloudflare. Les copies datées sont gardées
     hors du dépôt Git, qui est public, dans `Code Projects/fitpal-legal/processor-agreements/`.
5. Pour le transfert : les clauses contractuelles, c'est-à-dire les mêmes accords, et l'analyse
   d'impact des transferts (TIA).
6. Pour le F-211 : les mentions légales (sections « Parrainage » et « Demander à s'entraîner avec
   un coach ») et les conditions coachs 2026-11-07 (partie A, section 4 bis ; partie B, section 2).
