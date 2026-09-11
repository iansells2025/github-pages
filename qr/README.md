# QR Links

Permanent QR codes whose destination you can change at any time, with an
optional landing page and optional email capture in front of it.

The QR image encodes a short link on this site — never the destination — so
once a code is printed, edit the destination here and every existing copy of
that QR starts pointing somewhere new.

```
scan  →  /qr/r/?c=CODE  →  [ email form ]  →  [ landing page ]  →  destination
```

Both middle steps are per-link options. Turn both off and the scan redirects
immediately.

## Layout

| Path | What it is |
| --- | --- |
| `qr/index.html` | The manager — create links, preview and download QR codes |
| `qr/r/` | The redirector visitors land on when they scan |
| `qr/links.json` | Every link and its settings. This is the source of truth |
| `qr/vendor/qrcode.js` | QR encoder ([kazuhikoarase/qrcode-generator], MIT) |

## Setting it up

1. **Enable GitHub Pages** for this repository (Settings → Pages → deploy from
   the `main` branch).
2. Open `https://<owner>.github.io/<repo>/qr/`.
3. Create a link: paste a destination, give it a short code, press **Add link**.
4. Press **Publish to GitHub** to write `qr/links.json` back to the repository.
   Pages takes a minute or so to rebuild before the change is live.

Edits are held in your browser until you publish, so you can stage several
changes and push them in one go. The **Unsaved changes** badge tells you when
something is still local; unpublished work survives a page reload.

### Publishing without a token

Publishing straight from the browser is optional. **Download links.json**,
then commit the file yourself — the result is identical.

### Publishing with a token

Until a token is set, the manager shows a **one-time setup** panel and the
publish button reads *Connect GitHub to publish* — links you create are held in
your browser but are not live. The panel walks through it:

- Create a [fine-grained personal access token], limited to **only this
  repository**, with **Repository permissions → Contents: Read and write**.
- Nothing else is needed. Give it a short expiry.
- Paste it into the panel and press **Connect**. The token is checked
  immediately, and anything pending is published straight away.

The header pill shows the current state — *GitHub not connected*, or the repo
and branch being published to. **Settings → Test connection** re-checks the
whole chain (token, repository, branch, write permission, file) and names
whichever part is wrong.

The token is kept in this browser's local storage and is only ever sent to
`api.github.com`. Anyone holding it can write to the repository, so don't set
one up on a shared machine — use **Forget token** when you're done.

Note that the manager page itself is public, like everything else on a Pages
site. Visitors can read it (`links.json` is public regardless), but without a
token nobody can change anything.

## Collecting email addresses

GitHub Pages is static hosting — there is no server and no database, so
addresses have to be posted to something that can store them. Pick one under
**Email capture → Send addresses to**:

| Option | Endpoint to paste | Notes |
| --- | --- | --- |
| **Formspree** | `https://formspree.io/f/xxxxxxxx` | Simplest. Free tier covers small volumes; confirms delivery |
| **Webhook** | Zapier / Make / n8n catch-hook URL | Sends JSON. Route it to a spreadsheet, CRM, or mailing list |
| **Google Form** | the form's `…/formResponse` URL | Also set the field name to the email question's `entry.123456789` |
| **Nowhere** | — | The form still gates the redirect, but nothing is recorded |

Webhook and Formspree receive a JSON body:

```json
{
  "email": "buyer@example.com",
  "code": "spring25",
  "title": "Spring flyer",
  "destination": "https://example.com/promo",
  "pageUrl": "https://…/qr/r/?c=spring25",
  "submittedAt": "2026-09-10T12:00:00.000Z"
}
```

If the endpoint can't be reached, the visitor is told and offered a link
through to the destination anyway — a broken form never traps someone holding
a phone. The address is also kept in that visitor's own browser storage as a
fallback record.

**Ask only once** remembers, per visitor and per link, that an address was
already given, so repeat scans go straight through.

## Link settings

| Setting | Effect |
| --- | --- |
| **Destination URL** | Where the scan ends up. Change it whenever you like |
| **Short code** | The `?c=` value baked into the QR. Permanent once printed |
| **Active** | Turn off to show a "paused" notice instead of redirecting |
| **Landing page** | Headline, message, button text, accent colour, logo |
| **Auto-continue after** | Seconds until it forwards on its own. `0` waits for a tap |
| **Show where the link goes** | Displays the destination's domain, so a scan doesn't feel like a trap |
| **Email capture** | Ask for an address first; can be required or skippable |

## Printing

**PNG** gives a 1024px image with a quiet zone, suitable for print. **SVG**
scales to any size. Both encode the short link only.

Keep the quiet zone (the white border) intact and print at least 2 cm square
for a code scanned from arm's length — larger if it will be read from further
away.

## What this does not do

- **No scan counts.** Static hosting can't record a hit. If you need analytics,
  point the destination at a URL carrying UTM parameters, or send the scan
  through a link shortener that counts for you.
- **Deleting a link breaks its printed codes.** They will show "Link not
  found". Prefer switching a link to inactive.
- **Changes are not instant.** GitHub Pages rebuilds after a commit, usually
  within a minute or two.

[kazuhikoarase/qrcode-generator]: https://github.com/kazuhikoarase/qrcode-generator
[fine-grained personal access token]: https://github.com/settings/personal-access-tokens/new
