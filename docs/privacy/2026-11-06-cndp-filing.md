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
| Coach accounts, plan, security log, fitpal.ma | **FitPal Coach** | F-211 (déclaration normale) |
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

FitPal's own processing (coach accounts, the security log) is the one where it is the controller,
and goes on an F-211. Its identification, for either case:

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

Les comptes des coachs eux-mêmes (nom, e-mail, offre) et le journal de sécurité (sans adresse IP,
90 jours au plus) relèvent du traitement propre de FitPal Coach, qui en est le responsable : ils se
déclarent sur un F-211, et non sur ce F-112.

Demandes non vérifiées supprimées sous 24 heures. Sauvegardes : 14 jours (chiffrées), 90 jours au
plus pour la copie faite avant une mise à jour.

### Transfert de données à l'étranger (section VIII)

| Destinataire | Pays | Rôle | Données | Garanties |
|---|---|---|---|---|
| Namecheap, Inc. | États-Unis (Phoenix, Arizona) | Hébergement de l'application et de la base | Toutes | Accord de traitement, clauses contractuelles types de la Commission européenne (décision 2021/914) |
| Resend | États-Unis | Envoi des e-mails | E-mail, prénom, message | Accord de traitement, clauses contractuelles types ; certifié Data Privacy Framework UE–États-Unis |
| Cloudflare, Inc. | États-Unis ; sauvegardes stockées dans l'UE | Acheminement du trafic ; stockage des sauvegardes | Trafic en transit ; sauvegardes chiffrées (Cloudflare n'a pas la clé) | Accord de traitement, clauses contractuelles types ; certifié Data Privacy Framework |

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
