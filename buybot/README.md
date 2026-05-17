# buybot assets

Graphics consumed by the [NikePig Buy Bot](https://github.com/DrCalebL/nikepig-buybot). The bot fetches everything in this folder at startup and uses random selections for Discord buy alerts.

## Layout

```
buybot/
├── manifest.json   # auto-generated list of files the bot downloads (do not hand-edit)
├── regular/        # backgrounds for normal buys (small + medium ADA amounts)
├── nice/           # ~69 ADA buys — the meme tier (fires when displayed amount rounds to 69)
├── birthday/       # ~176 ADA buys — NikePig birthday (17 June, fires when rounds to 176)
├── four-twenty/    # ~420 ADA buys — get high like degens (fires when rounds to 420)
└── whales/         # backgrounds for whale alerts (above BIG_BUY_THRESHOLD_ADA)
```

All folders accept `.png`, `.jpg`, `.jpeg`, and `.gif`. GIFs are read as their first frame and stamped with the canvas template — the animation is not preserved, so prefer PNGs / JPGs unless you specifically want a GIF's first frame as a background.

The bot reads `manifest.json` at startup and downloads only the files listed there. A GitHub Action regenerates the manifest on every push to `main` that touches `buybot/{regular,nice,birthday,four-twenty,whales}/**`, so in normal use you just upload to a folder and push — no manual manifest edit needed.

**Tier precedence**: meme tiers (nice / birthday / four-twenty) win over whale; whale wins over regular. The meme tiers key off the *displayed* (rounded) ADA value, so a 175.6 ADA pool-net buy still triggers the birthday tier.

## Adding new graphics

### Quick version
1. Upload the file into `buybot/regular/`, `buybot/nice/`, or `buybot/whales/`.
2. Push to `main`. The [`regenerate-manifest`](../.github/workflows/regenerate-manifest.yml) GitHub Action rewrites `manifest.json` for you — no need to hand-edit it.
3. Restart the bot on Railway (or wait for the next auto-deploy if you're pushing buybot changes too) so it picks up the new files.

### Bulk upload via GitHub web UI
1. Open the [`buybot/regular`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/regular), [`buybot/nice`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/nice), or [`buybot/whales`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/whales) folder on GitHub.
2. Click **Add file → Upload files** and drag-drop everything in.
3. Commit to `main`. The auto-regen workflow handles `manifest.json`.

### Bulk upload via git
```bash
git clone git@github.com:DrCalebL/nikeverse-assets.git
cd nikeverse-assets
cp ~/Downloads/pigs/*.png buybot/regular/
cp ~/Downloads/sixty-nines/*.png buybot/nice/
cp ~/Downloads/birthday/*.png    buybot/birthday/
cp ~/Downloads/four-twenties/*.png buybot/four-twenty/
cp ~/Downloads/whales/*.png buybot/whales/
git add buybot/
git commit -m "feat(buybot): add more graphics"
git push
# manifest.json is regenerated automatically by the GitHub Action.
```

### Regenerating `manifest.json` manually
The GitHub Action does this on every push to `main` that touches `buybot/{regular,nice,birthday,four-twenty,whales}/**`. If you ever need to run it locally (e.g. to test offline), from the repo root:

```bash
node -e '
const fs = require("fs"), p = require("path");
const list = (d) => {
  const dir = p.join("buybot", d);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(png|jpe?g|gif)$/i.test(f))
    .sort()
    .map(f => `${d}/${f}`);
};
const manifest = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  description: "Asset manifest for the NikePig buy bot.",
  version: 4,
  regular: list("regular"),
  nice: list("nice"),
  birthday: list("birthday"),
  fourTwenty: list("four-twenty"),
  whales: list("whales"),
};
fs.writeFileSync("buybot/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
'
```

## File rules

| Rule | Why |
|------|-----|
| **Formats:** `.png`, `.jpg`, `.jpeg`, `.gif` | The bot's regex filter accepts these; everything else is silently ignored |
| **Filenames:** alphanumeric, dashes, underscores | Spaces and special chars survive URLs but cause friction; safer to avoid |
| **Per-file size:** keep under 8 MB | Discord's default upload cap for non-Nitro servers |
| **Recommended dimensions:** 1280×1280 or 1920×1080 or larger | The cluster scales down on smaller backgrounds; ≥1280 on the short side keeps it sharp |

The bot doesn't resize or compress — what you upload is what gets posted.

## How the bot consumes this folder

At startup the bot hits `https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/buybot/manifest.json`, then downloads every listed file from the same `main` branch into a local `cache/` directory. A bot restart is needed to pick up new files.
