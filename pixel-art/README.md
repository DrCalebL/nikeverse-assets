# Nikeverse pixel art

The complete pixel sprite set for NIKEVERSE — Dimensional Walker (the
browser game in `nikeverse-discord-game/web-game/`), in three sets:

## `nikes/` — adapted pixel sprites (the game's canonical art)
292 basic + 42 corrupted. NOT crops of the renders: each nike is an
authored 64px pixel adaptation — pot-bellied pig-folk drawn on a 32x32
grid at 2x, with the palette sampled from that nike's original 1024px
render and 1-3 costume features mapped from its name (viking horns +
axe, chef toque + pan, angel wings + halo, cyberpunk visor + mohawk...).
Corrupted variants shift the palette toward void-purple with glowing
eyes and corruption wisps. Generated deterministically by
`tools/gen_nikes.mjs` (168-feature library, per-key mapping table).

## `nikes-cutouts/` — background-removed render cutouts
The previous generation: each 1024px render reduced to a 64px quantized
cutout with the background fully segmented away (adaptive flood fill +
border-histogram keying + center-prior classification + 35 hand-tuned
per-image overrides — `tools/pixelate.py`). No longer used in-game, but
useful for Discord/community contexts where the literal render look is
wanted.

## `creatures/` — the 144 non-nike creatures
Wild beasts, Retnuhxed, elementals and spirits that have no NFT render:
name-matched archetype pixel sprites (quadruped wolves, winged
phoenixes, serpent hydras, mech titans, ghost wraiths...) from
`tools/gen_creatures.mjs`'s 24 archetype painters + 40-rule keyword
classifier.

All sprites: 64x64 PNG, transparent background, bottom-anchored,
1px outline, deterministic across runs. Render scaled up with
nearest-neighbor (`image-rendering: pixelated`).

Regenerate (from the game repo, with @napi-rs/canvas available):

```bash
cd nikeverse-discord-game/web-game
node tools/gen_nikes.mjs          # adapted nikes
node tools/gen_creatures.mjs      # archetype creatures
python3 tools/pixelate.py ../../nikeverse-assets/assets/nikes/basic out/   # cutouts
python3 tools/export_data.py      # refresh the game's sprite manifest
```
