# In-meme label style reference

This folder holds the **reference image for in-meme labels** — the short text
labels that the image model (GPT Image 2) renders **inside** a meme, as opposed
to the top/bottom canvas captions (which are drawn separately in the **Anton**
font by the server's `renderStyledCaption` pipeline and are NOT affected by
anything here).

## What renders in-meme labels today

In-image labels are produced by **GPT Image 2** when a meme uses:
- the 5 named viral templates (Distracted Boyfriend / Drake / Two Buttons /
  Expanding Brain / Spider-Man Pointing) — `buildViralTemplateOverride`
- any **multi-panel Wing It meme** (Wave-25.27) — `buildMultiPanelOverride`
- a metaphor-object label (Copium tank, FOMO pill bottle, etc.) — Wave-19.Z19

These labels currently have **no enforced font/style** — the model picks
whatever it draws. The goal of this folder is to standardise that look.

## Drop your reference here

Filename: **`label-reference.png`**

The reference should clearly show the desired label style so it can be passed
to GPT Image 2 as a visual style anchor. Suggested attributes to make legible
in the reference:
- **Font / weight** — e.g. bold condensed sans (to echo the Anton canvas
  caption look) OR a clean rounded sans, whatever the brand wants
- **Color + outline** — e.g. white fill + black outline (high contrast, reads
  on any panel background), or a brand wheat/purple
- **Placement convention** — floating tag near the figure / top of the panel /
  inside a rounded label chip / etc.
- **Casing** — ALL CAPS vs sentence case
- A couple of example labels rendered in that style (e.g. "REJECT" / "APPROVE"
  for a Drake-style pair) so the model sees the style applied to real label text

## URL once uploaded

`https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/label-style/label-reference.png`

(The code wiring that consumes this reference is a **separate future wave** —
this folder + README just establishes the drop point + the spec.)
