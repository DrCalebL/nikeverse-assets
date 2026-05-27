# brand-logos/

Brand and logo reference assets used by the meme engine when a meme's topic mentions a recognized brand and the rendered image needs to show the brand mark accurately.

## How these are used

The render model (GPT Image 2) takes these PNGs as **reference images** alongside the meme's primary character refs. When the meme's `image_brief` describes a Cardano-labeled token, a Midnight Network badge, etc., the render model uses the reference to learn what the logo looks like + reproduces it from scratch into the new scene.

This is the **same mechanism** as character refs in `cast/` — visual identity anchoring via cross-image-consistency, NOT programmatic compositing. The model never stamps these PNGs onto the output; it learns the mark and re-draws it.

## File spec

- **Format**: PNG (JPG works too — transparency is not required because there's no compositing)
- **Canvas**: square, ≥512×512px (1024×1024 preferred for crisp small renders)
- **Logo**: clearly visible against any solid background (white / black / brand-matching backdrop are all fine)
- **Filename**: lowercase, hyphen-separated if multi-word
  - `cardano.png`
  - `midnight.png` (file name; trigger is multi-word "Midnight Network")
  - future: `bitcoin.png`, `ethereum.png`, `solana.png`, `hosky.png`, etc.

## Trigger registration

A logo file in this folder is half the wiring. The other half lives in `server.js`:

1. Add the logo URL to a `BRAND_LOGO_REFS` registry (parallel to `CAST_REFS`).
2. Add a trigger regex to a brand-detection helper (parallel to `detectCastRefs` / `detectPublicFigures`).
3. Inject the ref into the per-render `image_urls` array when the trigger fires.
4. Add a Layer-1 prompt-side directive telling the LLM the brand-logo PNG is available so it can describe the meme using the named brand confidently.

See CLAUDE.md "Adding a new CAST CHARACTER" section in the meme-machine repo for the parallel pattern.

## Current trigger semantics (locked at operator request)

- `cardano.png` → `\bcardano\b` (case-insensitive)
- `midnight.png` → `\bmidnight network\b` (case-insensitive, multi-word — bare "midnight" / "midnight snack" / etc. do NOT trigger)

## URL pattern

`https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/brand-logos/<filename>.png`

Use `?v=N` cache-bust query parameter when re-uploading a logo (CDN caches the URL aggressively).
