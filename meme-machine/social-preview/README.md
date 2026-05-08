# Social Preview — Open Graph / Twitter Card thumbnails

Drop link-preview thumbnails here for `mememachine.nikepig.com`. These render
when the URL is pasted into Discord / WhatsApp / Telegram / X / Slack /
Facebook / LinkedIn / iMessage / Signal etc.

## Recommended canonical asset

- **`og-card.png`** (or `.jpg`) — **1200 × 630 px** (Open Graph + Twitter
  Card `summary_large_image` standard; Discord + WhatsApp + Telegram + X
  all consume this aspect ratio cleanly).

## Specs

- Aspect ratio **1.91 : 1** (1200 × 630). Other valid aspect ratios are
  accepted but 1200 × 630 is the universal sweet spot.
- Minimum **600 × 315**; under that, X falls back to no card.
- File size **under 5 MB** (X's hard cap; Discord/WhatsApp ~8 MB).
- PNG or JPEG (not WebP — Telegram + iMessage don't always render WebP
  previews reliably).
- Safe-zone the central ~80% of the canvas — Discord crops slightly on
  mobile + LinkedIn occasionally letterboxes.

## Optional variants

- **`og-card-square.png`** (1200 × 1200) — square fallback for surfaces
  that prefer 1:1 (Slack mobile, some chat clients). Optional; Open Graph
  consumers fall back gracefully without it.

## URL pattern (production reference)

After upload + merge to `main`:
```
https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/social-preview/og-card.png
```

This path is what `public/index.html`'s `<meta property="og:image">` +
`<meta name="twitter:image">` tags reference.
