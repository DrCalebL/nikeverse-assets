# buybot assets

Graphics consumed by the [NikePig Buy Bot](https://github.com/DrCalebL/nikepig-buybot).

## Layout

```
buybot/
├── manifest.json   # list of files the bot will download at startup
├── images/         # PNG/JPG for small buys
└── gifs/           # GIF for whale alerts
```

## Adding new graphics

1. Drop the file in `images/` or `gifs/`.
2. Add its relative path to `manifest.json` under the matching array.
3. Commit to `main`. The bot picks up changes on next restart.

The bot fetches files via `raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/buybot/...`, so any change on `main` is live without a code deploy.
