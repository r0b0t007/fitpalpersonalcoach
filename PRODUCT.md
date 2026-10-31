# Product

Scope note: this file describes **fitpal.ma**, the marketing site for FitPal Coach
(`site-coach/`). It does not describe `site/` (gym.fitpal.ma, the white-label gym product) or
`website/` (upstream openGym's inherited site), which are separate surfaces with separate
audiences.

## Register

brand

## Users

Independent personal trainers who coach clients one to one, mostly online or in a gym they do
not own. They have somewhere between 5 and 40 clients. Today the business runs on Instagram
DMs, WhatsApp voice notes, and a spreadsheet per client, and the admin load is what caps how
many people they can take on.

Their context when they hit this page: evening, at home, doing programming for tomorrow, or
standing in a gym between sessions with ten minutes on their phone. They are skeptical of
software sold to them, because most of it is built for gyms with a front desk, not for one
person with a phone.

The job to be done: stop losing hours to admin, and look like a professional operation to the
people paying them.

## Product Purpose

FitPal Coach is the software a solo coach runs their roster on. Clients get a real training app
with their program in it. The coach gets a dashboard that shows who trained, who did not, and
who is about to quit.

The site exists to get a trainer to book a call. It is not a self-serve signup funnel yet, so the
page has to do the work a sales call would otherwise do: establish that this was built for a
solo operator, show the actual product, and remove the fear of moving a client roster onto
something new.

Prices are public (CHW-318): three plans by active-client count (Solo 10, Pro 30, Studio 75 at
€19, €39 and €79 a month, a year for ten months, VAT included, 14-day trial). "Price set on the
call" was the one answer this buyer could not get without picking up the phone, and it
contradicted a product that bills by plan. The call stays the conversion until online checkout
opens (CHW-302); then the plan table is where the "Start" links go.

Success is a booked call from someone who already understands what the product is.

## Brand Personality

Plain-spoken, equipped, exacting.

The voice of a good tool catalogue: it tells you the spec, it does not tell you how the tool
will change your life. Short declarative sentences. Numbers where numbers are the honest
answer. No motivational register, no exclamation marks, no promises about transformation.

The feeling to evoke is competence, not excitement. A trainer should finish the page thinking
"this was built by someone who has done this job," not "this looks impressive."

## Anti-references

- **Generic SaaS.** Purple and navy gradients, floating 3D shapes, repeated icon-heading-text
  card grids, "Trusted by" logo walls, "solutions" language.
- **Hype fitness.** Neon lime on black, all-caps motivational shouting, before/after physique
  photography, countdown timers, fake scarcity.
- **Editorial magazine.** Display serif italics, drop caps, broadsheet column rules, tiny
  tracked uppercase labels stacked above every section heading. This is the second-order
  reflex for a brand avoiding the first two, and it is not what this is.
- **fitpal.ma.** The sibling site sells a different product to a different buyer. Shared
  ownership should not read as a shared template. The bolt mark used to connect them; FitPal
  Coach now has its own One Spine symbol (`brand/logo-kit`), so only the FitPal gold does.

## Design Principles

1. **Show the product, do not describe it.** Every claim on the page is attached to a real
   screenshot of the real app. No invented UI, no mockups of screens that do not exist.
2. **Spec-sheet honesty.** Where a number is the truthful answer, print the number. Where
   something is not ready, say so. Credibility is the whole conversion mechanism when the
   CTA is a phone call.
3. **Built for one person, not a front desk.** Every feature is framed against the solo
   coach's constraint, which is time, not headcount.
4. **The page is equipment.** Rules, numbered sections, and tabular figures are the grammar.
   Structure is visible on purpose, the way it is on a laminated spec card.
5. **Motion acknowledges, it does not perform.** Entrance choreography once, on arrival.
   Nothing loops, nothing bounces, nothing animates to fill silence.

## Accessibility & Inclusion

WCAG 2.2 AA, verified rather than assumed:

- 4.5:1 minimum on body text, 3:1 on large text and UI boundaries, measured against the real
  token values and not estimated.
- Full keyboard path with a visible focus ring on every interactive element.
- `prefers-reduced-motion: reduce` removes all entrance and scroll motion, and is treated as a
  first-class state rather than an afterthought.
- Bilingual FR/EN with correct `lang` and `hreflang` wiring, so screen readers announce each
  locale in the right voice.
- Verified with an accesslint audit against the built pages before handover.
