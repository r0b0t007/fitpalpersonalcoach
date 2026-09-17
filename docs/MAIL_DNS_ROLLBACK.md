# Mail for fitpal.ma — current state, restore point, and the traps

Last verified against a public resolver: **2026-09-17**.

`fitpal.ma` mail moved from **Namecheap Private Email** to **Cloudflare Email Routing** on
2026-09-17. This file is the restore point and the record of what bit during the migration.

Scope note: this is `fitpal.ma` only. Mail for other domains on the same cPanel account
(`pawpawcare.app`) is unaffected and works differently — see "The trap that cost the most time".

---

## Current state (live)

**Delivery**: Cloudflare Email Routing. Forward-only — it can receive, it **cannot send**.

```
MX   fitpal.ma   59   route1.mx.cloudflare.net
MX   fitpal.ma   52   route2.mx.cloudflare.net
MX   fitpal.ma   22   route3.mx.cloudflare.net

TXT  fitpal.ma   "v=spf1 include:_spf.mx.cloudflare.net include:spf.web-hosting.com ~all"
```

**Routing rules** (Cloudflare dashboard → Email Routing → fitpal.ma):

| Rule | Action | Status |
|---|---|---|
| `contact@fitpal.ma` | send to `ahmedchioua@gmail.com` | Active |
| Catch-all | send to `ahmedchioua@gmail.com` | Active |

The catch-all forwards rather than drops **on purpose**. Once MX points at Cloudflare, only
addresses with a rule are accepted and everything else is rejected. Nobody had enumerated what
else existed on Private Email for this domain, so the catch-all is the insurance against a
forgotten address dying silently. The cost is that spam to any address at the domain also
arrives in that Gmail.

### Two things the dashboard reports that are expected, not faults

**"DNS records: Not configured" / "Routing status: Disabled".** The three MX records were added
**by hand**, not by Cloudflare's own "Add missing records" button, so Cloudflare does not count
them as managed records and reports them Missing even though they are live and resolving. Verify
with a resolver, not the dashboard.

**The SPF shows Missing too, and must stay that way.** Cloudflare wants exactly
`v=spf1 include:_spf.mx.cloudflare.net ~all`. The live record is a **merge** that also keeps
`include:spf.web-hosting.com`, in case anything on the cPanel box ever sends as `@fitpal.ma`.
**Do not click "Add missing records" to satisfy it** — that appends a second SPF TXT, and two
SPF records on one domain is a `permerror` that fails authentication for every message.
One record, both includes. That is the correct state.

A **DKIM** record (`cf2024-1._domainkey.fitpal.ma`) is also listed as Missing and genuinely is.
Adding it improves deliverability of forwarded mail. It can be added by hand from the value in
Email Routing → Settings → DNS records, but see the SPF warning before using the bulk button.

---

## Restore point — going back to Namecheap Private Email

Cloudflare has **no zone-level undo**. To revert, delete the Cloudflare MX records and recreate
these exactly, all **DNS-only (grey cloud)**, never proxied:

```
MX   fitpal.ma    5   mx1-hosting.jellyfish.systems
MX   fitpal.ma   10   mx2-hosting.jellyfish.systems
MX   fitpal.ma   20   mx3-hosting.jellyfish.systems

TXT  fitpal.ma   "v=spf1 +a +mx +ip4:198.54.114.94 include:spf.web-hosting.com ~all"
```

Those MX hosts resolve to `162.255.118.28/29` — Namecheap **Private Email**, which is a paid
product (from $11.88/yr, 30-day trial). Reverting only restores delivery to whatever mailboxes
still exist in that subscription; it does not recreate mailboxes.

Note the old SPF is reproduced verbatim for fidelity, but two of its mechanisms were already
wrong when it was captured: `+a` resolved to the Cloudflare **Pages** IPs (a leftover of the
website's migration to Pages, noted in `site/README.md`), and `+ip4:198.54.114.94` does not match
the hosting box, which is `198.54.114.222`. Prefer the merged form above if restoring.

---

## The trap that cost the most time

**A cPanel forwarder for `fitpal.ma` does nothing, and cPanel will still tell you it worked.**

A forwarder was created in cPanel first. cPanel returned a green *"All email sent to
contact@fitpal.ma will now be copied to ahmedchioua@gmail.com"* — and it was inert, because
`fitpal.ma`'s MX pointed away from that box. It was deleted again.

The contrast on the same cPanel account is the thing to remember:

| Domain | MX → | Resolves to | cPanel forwarders? |
|---|---|---|---|
| `pawpawcare.app` | `mail.pawpawcare.app` | the hosting box | **yes, they work** |
| `fitpal.ma` | Cloudflare (was Private Email) | elsewhere | **no, inert** |

Do not generalise from one domain on this account to another. The quickest check is cPanel →
Email Routing: it reports `fitpal.ma` as *Automatically Detect Configuration : **Remote***, which
is correct and means cPanel knows the mail is handled elsewhere.

## Other things that bit, worth knowing before touching this again

- **Cloudflare refuses to overwrite foreign MX records.** "Add missing records" fails with
  *"Existing non-Cloudflare MX records conflict with Email Routing"*. The old records must be
  deleted by hand first, which opens a real gap where the domain has no MX at all.
- **"Add missing records" then failed silently three times** with no error and no change. The
  records were added manually instead. **Trust a resolver, not the dashboard.**
- **A destination address must be verified before a rule can use it.** Cloudflare emails the
  destination a link; until it is clicked the rule cannot be saved at all.
- Stale cPanel service records (`autoconfig`, `autodiscover`, `mail`, `webmail`) still point at
  `198.54.116.94`. They are harmless but will send a mail client that autodiscovers to a box with
  no mailboxes for this domain.

## Verify

```bash
nslookup -type=MX  fitpal.ma 8.8.8.8     # expect route1/2/3.mx.cloudflare.net
nslookup -type=TXT fitpal.ma 8.8.8.8     # expect EXACTLY ONE v=spf1 line
```

Then send a message from an outside address to `contact@fitpal.ma` and confirm it reaches the
Gmail **inbox**, not spam. Cloudflare → Email Routing → **Activity log** shows whether a message
was received and what it did with it; that log is the authoritative answer to "is this working",
not the Configuration summary.
