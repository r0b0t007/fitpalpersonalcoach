# Product

Scope note: this file describes **fitpal.ma**, the marketing site for FitPal Coach
(`site-coach/`). It does not describe `site/` (gym.fitpal.ma, the white-label gym product) or
`website/` (upstream openGym's inherited site), which are separate surfaces with separate
audiences.

## Register

brand

## Users

Independent coaches who find their clients on Instagram. They post training content, followers
message them asking to be coached, and today the answer runs through DMs, WhatsApp voice notes
and a spreadsheet per client. They have anywhere from no paying clients yet to a few dozen, and
the admin of taking each new one on is what caps how many they say yes to.

Their context when they hit this page: on their phone, often having tapped a link inside
Instagram, between posts or between sessions. They are skeptical of software sold to them,
because most of it is built for gyms with a front desk, not for one person with a phone and an
audience.

The job to be done: turn a follower who asks into a client who is training, without a week of
back-and-forth in the DMs, and look like a professional operation while doing it.

## Product Purpose

FitPal Coach gives a coach one link for their Instagram bio. It opens the coach's public page; a
follower asks to join from it, answers a short intake and confirms their email with a code, and
the coach accepts (or lets the page accept on its own). The moment they are accepted, the
starter program the coach picked for the page is in the client's app, so workout 1 is there the
same day. After that the client trains in a real app and the coach sees who trained, who missed,
and who is drifting off.

The site exists to get a coach to **start free**. The Free plan (CHW-329) is self-serve: three
active clients, no card, an account made on `coach.fitpal.ma/#/start?plan=free`. It replaced the
14-day trial and the booked call; neither appears on the page any more. WhatsApp stays as the
second button, for the coach with a question, not as the conversion.

Prices are public and are the app's own (`backend/app/Domain/Plans.php`): Free 3 clients, Solo
10, Pro 30, Studio 75 at €0, €19, €39 and €79 a month, a year for ten months, VAT included.
Every plan has every feature; only the number of active clients changes. The paid plans' buttons
link straight to `/#/start?plan=<id>&period=month`, which `pickPlan()` in
`frontend/src/lib/billing.js` reads.

Success is a coach who starts free already understanding what the product is, and has their link
in their bio the same day.

## Brand Personality

Plain-spoken, equipped, exacting.

The voice of a good tool catalogue: it tells you the spec, it does not tell you how the tool
will change your life. Short declarative sentences. Numbers where numbers are the honest
answer. No motivational register, no exclamation marks, no promises about transformation.

The feeling to evoke is competence, not excitement. A coach should finish the page thinking
"this was built by someone who knows how I get clients," not "this looks impressive."

What it does not do is brag in spec-sheet terms the buyer does not care about: the progression
algorithms, the size of the exercise library and the sign-in technology are true and stay off
the page. The spec this buyer reads is the path from a follower's tap to their first set.

## Anti-references

- **Generic SaaS.** Purple and navy gradients, floating 3D shapes, repeated icon-heading-text
  card grids, "Trusted by" logo walls, "solutions" language.
- **Hype fitness.** Neon lime on black, all-caps motivational shouting, before/after physique
  photography, countdown timers, fake scarcity.
- **Creator-economy hype.** "Grow your audience 10x", follower counts, revenue screenshots,
  income claims. The coach's audience is theirs; the page talks about what happens after a
  follower asks.
- **Editorial magazine.** Display serif italics, drop caps, broadsheet column rules, tiny
  tracked uppercase labels stacked above every section heading. This is the second-order
  reflex for a brand avoiding the first two, and it is not what this is.
- **gym.fitpal.ma.** The sibling site sells a different product to a different buyer. Shared
  ownership should not read as a shared template. FitPal Coach has its own One Spine symbol
  (`brand/logo-kit`); only the FitPal gold is shared.

## Design Principles

1. **Show the product, do not describe it.** Every claim on the page is attached to a real
   screenshot of the real app. No invented UI, no mockups of screens that do not exist, and no
   HTML drawing of a phone screen standing in for a capture.
2. **Spec-sheet honesty.** Where a number is the truthful answer, print the number. Where
   something is not ready, say so. Every claim is checked against the code before it ships: who
   hosts the data, what works inside Instagram's browser, when the morning summary is sent.
   Credibility is the conversion mechanism when the buyer can sign up without talking to anyone.
3. **Built for one person, not a front desk.** Every feature is framed against the solo
   coach's constraint, which is time, not headcount.
4. **The page is equipment.** Rules, numbered sections, and tabular figures are the grammar.
   Structure is visible on purpose, the way it is on a laminated spec card.
5. **Motion acknowledges, it does not perform.** Entrance choreography once, on arrival.
   Nothing loops, nothing bounces, nothing animates to fill silence. The demo film plays only
   when pressed.
6. **No photograph endorses anything.** The people in the photographs, and the demo coach in the
   captures, are not FitPal clients or coaches, and the footer says so. No name, quote or result
   is ever attached to a face.

## Accessibility & Inclusion

WCAG 2.2 AA, verified rather than assumed:

- 4.5:1 minimum on body text, 3:1 on large text and UI boundaries, measured against the real
  token values and not estimated.
- Full keyboard path with a visible focus ring on every interactive element.
- `prefers-reduced-motion: reduce` removes all entrance and scroll motion, and is treated as a
  first-class state rather than an afterthought.
- French, Spanish and English, with correct `lang` and `hreflang` wiring, so screen readers
  announce each locale in the right voice. No Darija: the site's languages are those three.
- Verified with an accesslint audit against the built pages before handover.
