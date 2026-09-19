# brand-logos/

Brand and logo reference assets used by the meme engine when a meme's topic mentions a recognized brand and the rendered image needs to show the brand mark accurately.

## How these are used

The render model takes these PNGs as **reference images** alongside the meme's primary character references. When the scene calls for a Cardano-labeled token, a Midnight Network badge, etc., the reference lets the render show the mark accurately.

## File spec

- **Format**: PNG (JPG works too — transparency is not required)
- **Canvas**: square, ≥512×512px (1024×1024 preferred for crisp small renders)
- **Logo**: clearly visible against any solid background (white / black / brand-matching backdrop are all fine)
- **Filename**: lowercase, hyphen-separated if multi-word
  - `cardano.png`
  - `midnight.png` (file name; trigger is multi-word "Midnight Network")
  - future: `bitcoin.png`, `ethereum.png`, `solana.png`, `hosky.png`, etc.

## Trigger registration

A logo file in this folder is half the wiring. The other half is server-side:

1. Register the logo URL in the brand-logo config.
2. Add a trigger term so the brand is detected in a meme's topic.
3. The reference is then attached automatically when the trigger fires.

## Current trigger semantics (locked at operator request)

- `cardano.png` → `\bcardano\b` (case-insensitive)
- `midnight.png` → `\bmidnight network\b` (case-insensitive, multi-word — bare "midnight" / "midnight snack" / etc. do NOT trigger)

## URL pattern

`https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/brand-logos/<filename>.png`

Use `?v=N` cache-bust query parameter when re-uploading a logo (CDN caches the URL aggressively).
