# Reviewing API access before it went live

**The situation.** Two different Claude sessions, each working on a feature, handed me the same
block of configuration to paste into our production e-commerce admin: API permissions for a
client so they could read the product catalogue.

**What a third review caught, before anything was saved**

- **"Run any job."** The block granted permission to start *any* scheduled job on the production
  store — including inventory jobs — when the feature only needed one export job.
- **Saved customer payment cards.** It included read access to customers' stored payment
  instruments, for a research question nobody was currently working on.
- It confirmed the rest of the block preserved the two existing integrations byte-for-byte
  (comparing fingerprints of the live config and the proposed one), so pasting it wouldn't
  silently cut anything off.

**What we did.** Saved a read-only version, verified it with a script that prints only status
codes, then added back exactly one missing permission when product search turned out to need it
(the platform treats any POST — even a search — as a "write").

**Also.** When making this showcase public, a scan of our private working repo found real customer
emails and three leaked secrets from a prototype config. That repo stayed private, the secrets
were rotated, and this showcase was built fresh with no history and scanned before publishing.
