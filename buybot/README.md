# buybot assets

Graphics consumed by the [NikePig Buy Bot](https://github.com/DrCalebL/nikepig-buybot). The bot fetches everything in this folder at startup and uses random selections for Discord buy alerts.

## Layout

```
buybot/
├── manifest.json   # the list of files the bot will download
├── images/         # PNG / JPG — used for normal buys
└── gifs/           # GIF — used for whale alerts (above BIG_BUY_THRESHOLD_ADA)
```

The bot does **not** scan these folders automatically — it reads `manifest.json` and downloads only the files listed there. Any file you upload but forget to add to the manifest will be silently ignored.

## Adding new graphics

### Quick version
1. Upload the file into `buybot/images/` or `buybot/gifs/`.
2. Add its relative path (e.g. `images/new-pig.png`) to the right array in `manifest.json`.
3. Commit + push to `main`.
4. Restart the bot on Railway (or wait for the next auto-deploy if you're pushing buybot changes too).

### Bulk upload via GitHub web UI
1. Open the [`buybot/images`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/images) or [`buybot/gifs`](https://github.com/DrCalebL/nikeverse-assets/tree/main/buybot/gifs) folder on GitHub.
2. Click **Add file → Upload files** and drag-drop everything in.
3. In the same commit (or a follow-up), edit `manifest.json` and append each new file's path to `images` or `gifs`.
4. Commit to `main`.

### Bulk upload via git
```bash
git clone git@github.com:DrCalebL/nikeverse-assets.git
cd nikeverse-assets
cp ~/Downloads/pigs/*.png buybot/images/
cp ~/Downloads/whales/*.gif buybot/gifs/
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
const list = (d, exts) =>
  fs.readdirSync(p.join("buybot", d))
    .filter(f => exts.some(e => f.toLowerCase().endsWith(e)))
    .sort()
    .map(f => `${d}/${f}`);
const manifest = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  description: "Asset manifest for the NikePig buy bot.",
  version: 1,
  images: list("images", [".png", ".jpg", ".jpeg"]),
  gifs: list("gifs", [".gif"]),
};
fs.writeFileSync("buybot/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
'
```

## File rules

| Rule | Why |
|------|-----|
| **Images:** `.png`, `.jpg`, `.jpeg` only | The bot's regex filter ignores everything else |
| **GIFs:** `.gif` only | Same reason |
| **Filenames:** alphanumeric, dashes, underscores | Spaces and special chars survive URLs but cause friction; safer to avoid |
| **Per-file size:** keep under 8 MB | Discord's default upload cap for non-Nitro servers. Boosted servers go higher but 8 MB is the safe ceiling |
| **Recommended dimensions:** 1024×1024 to 2048×2048 | Discord embeds render best around this size; the bot stamps text on top, so leave the corners reasonably clean |

The bot doesn't resize or compress — what you upload is what gets posted.

## How the bot consumes this folder

At startup the bot hits `https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/buybot/manifest.json`, then downloads every listed file from the same `main` branch into a local `cache/` directory. A bot restart is needed to pick up new files.
