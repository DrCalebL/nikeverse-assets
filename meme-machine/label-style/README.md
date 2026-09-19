# In-meme label style reference

This folder holds the **reference image for in-meme labels** — the short text
labels that the render model draws **inside** a meme, as opposed to the
top/bottom canvas captions (which are drawn separately by the server's caption
pipeline and are NOT affected by anything here).

## What renders in-meme labels today

In-image labels are drawn by the render model when a meme uses:
- one of the named viral templates (Distracted Boyfriend / Drake / Two Buttons /
  Expanding Brain / Spider-Man Pointing)
- a multi-panel meme
- a metaphor-object label (Copium tank, FOMO pill bottle, etc.)

These labels currently have **no enforced font/style** — the model picks
whatever it draws. The goal of this folder is to standardise that look.

## Drop your reference here

Filename: **`label-reference.png`**

The reference should clearly show the desired label style so it can be passed
to the render model as a visual style anchor. Suggested attributes to make
legible in the reference:
- **Font / weight** — e.g. bold condensed sans (to echo the canvas caption
  look) OR a clean rounded sans, whatever the brand wants
- **Color + outline** — e.g. white fill + black outline (high contrast, reads
  on any panel background), or a brand wheat/purple
- **Placement convention** — floating tag near the figure / top of the panel /
  inside a rounded label chip / etc.
- **Casing** — ALL CAPS vs sentence case
- A couple of example labels rendered in that style (e.g. "REJECT" / "APPROVE"
  for a Drake-style pair) so the model sees the style applied to real label text

## URL once uploaded

`https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/label-style/label-reference.png`

(The code wiring that consumes this reference is a **separate future change** —
this folder + README just establishes the drop point + the spec.)
