# meme-machine/ui-icons/

UI icon assets for the meme-machine SPA toggle buttons + similar in-app controls.

**Scope**: in-app UI icons rendered next to button labels — distinct from `cast/` (character reference PNGs read by Seedream / GPT Image 2 at render time), `classic-nike/` (Nike photo templates), and `social-preview/` (og-card + apple-touch-icon for OG/Twitter Card thumbnails).

## Current files

| File | Used at | Purpose |
|---|---|---|
| `cartoon-nike-icon.png` _(to upload)_ | Nike tab top toggle (left button) | Replaces 🎨 emoji — distinguishes Cartoon Nike mode |
| `classic-nike-icon.png` _(to upload)_ | Nike tab top toggle (right button) | Replaces 📷 emoji — distinguishes Classic Nike mode |

## Spec

- **Format**: PNG with transparent background (buttons have a purple/wheat gradient backdrop)
- **Size**: 128×128 px minimum (renders at ~24-32px in UI; 2-3× headroom for retina + future use)
- **File size**: <50KB each
- **Visual**: must read clearly at 24-32px — the actual UI render size

## URL pattern

```
https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/ui-icons/<filename>.png
```

Append `?v=N` query-param cache-bust on subsequent edits to force CDN refresh (same convention as `social-preview/og-card.png?v=1` from Wave-19.Z23).

## Adding a new UI icon

1. Drop the PNG into this folder on a branch
2. Open a PR to main
3. Once merged, wire the URL into `src/App.jsx` at the consumer site
4. Document the file → consumer mapping in the table above
