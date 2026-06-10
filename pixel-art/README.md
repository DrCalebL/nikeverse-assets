# Nikeverse pixel art

64×64 pixel-art battle sprites generated from the 1024×1024 nike renders in
`assets/nikes/`, used by the browser game in
`nikeverse-discord-game/web-game/`.

- `nikes/basic/` — 292 sprites from `assets/nikes/basic/`
- `nikes/corrupted_basic/` — 42 sprites from `assets/nikes/corrupted_basic/`

Filenames are slugs of the source names (`bear armour basic.png` →
`bear_armour.png`).

Two sprite styles, chosen automatically per image by `tools/pixelate.py`:

1. **Keyed** — flat studio backgrounds removed via corner flood-fill, content
   cropped, downscaled to 64px, quantized to a 24-color palette, transparent
   background, bottom-anchored (battle-sprite style).
2. **Framed portrait** — renders with scene backgrounds (or white-on-white
   art that can't be keyed safely) keep their full art inside a
   rounded-corner frame.

The keyed/framed decision uses three safety checks so creatures are never
shredded: border-ring uniformity (only key genuinely flat backdrops),
dominant-connected-component + center-coverage (the fill must not eat the
subject), and edge-raggedness (perimeter/area ≤ 0.115).

Regenerate:

```bash
python3 pixel-art/tools/pixelate.py assets/nikes/basic pixel-art/nikes/basic
python3 pixel-art/tools/pixelate.py assets/nikes/corrupted_basic pixel-art/nikes/corrupted_basic
```

Requires Pillow (`pip install pillow`). Render scaled-up with
nearest-neighbor (`image-rendering: pixelated`) to preserve the pixel look.
