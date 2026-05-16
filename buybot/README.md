# buybot assets

Graphics consumed by the [NikePig Buy Bot](https://github.com/DrCalebL/nikepig-buybot). The bot fetches everything in this folder at startup and uses random selections for Discord buy alerts.

## Layout

```
buybot/
├── manifest.json   # the list of files the bot will download
├── regular/        # backgrounds for normal buys (small + medium ADA amounts)
├── nice/           # backgrounds for 69 ADA buys specifically (the meme tier)
└── whales/         # backgrounds for whale alerts (above BIG_BUY_THRESHOLD_ADA)
```

Both folders accept `.png`, `.jpg`, `.jpeg`, and `.gif`. GIFs are read as their first frame and stamped with the canvas template — the animation is not preserved, so prefer PNGs / JPGs unless you specifically want a GIF's first frame as a background.

The bot does **not** scan these folders automatically — it reads `manifest.json` and downloads only the files listed there. Any file you upload but forget to add to the manifest will be silently ignored.

## Adding new graphics

### Quick version
1. Upload the file into `buybot/regular/` or `buybot/whales/`.
2. Add its relative path (e.g. `regular/new-pig.png`) to the right array in `manifest.json`.
3. Commit + push to `main`.
4. Restart the bot on Railway (or wait for the next auto-deploy if you're pushing buybot changes too).

### Bulk upload via GitHub web UI
1. Open the [`buybot/regular`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/regular) or [`buybot/whales`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/whales) folder on GitHub.
2. Click **Add file → Upload files** and drag-drop everything in.
3. In the same commit (or a follow-up), edit `manifest.json` and append each new file's path to `regular` or `whales`.
4. Commit to `main`.

### Bulk upload via git
```bash
git clone git@github.com:DrCalebL/nikeverse-assets.git
cd nikeverse-assets
cp ~/Downloads/pigs/*.png buybot/regular/
cp ~/Downloads/whales/*.png buybot/whales/
# regenerate manifest.json (see snippet below) or hand-edit it
git add buybot/
git commit -m "feat(buybot): add more graphics"
git push
```

### Regenerating `manifest.json` automatically
From the repo root, this one-liner rebuilds the manifest from whatever is on disk:

```bash
node -e '
const fs = require("fs"), p = require("path");
const list = (d) =>
  fs.readdirSync(p.join("buybot", d))
    .filter(f => /\.(png|jpe?g|gif)$/i.test(f))
    .sort()
    .map(f => `${d}/${f}`);
const manifest = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  description: "Asset manifest for the NikePig buy bot.",
  version: 2,
  regular: list("regular"),
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
