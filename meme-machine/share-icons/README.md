# Share Icons

Brand logos for the ShareBar component's channel buttons in `nikepig-meme-machine`.

## Expected files

Per the ShareBar's 6 URL-share channels (Wave 7.13.30):

| Filename | Channel | Notes |
|---|---|---|
| `x.svg` (or `.png`) | X / Twitter | Black-on-transparent recommended |
| `telegram.svg` | Telegram | Brand blue paper-plane |
| `farcaster.svg` | Farcaster | Purple cast-iron skillet (brand mark) |
| `reddit.svg` | Reddit | Orange Snoo head |
| `whatsapp.svg` | WhatsApp | Green speech-bubble-with-handset |
| `line.svg` | LINE | Green chat-bubble |
| `native.svg` | Web Share API native button | Generic share icon (square + up-arrow) — only shown on mobile |

Plus optional secondary actions:

| Filename | Action |
|---|---|
| `copy-image.svg` | Copy meme image to clipboard |
| `copy-link.svg` | Copy meme URL to clipboard |

## Format guidelines

- **SVG preferred** (vector, scales perfectly at any size)
- If raster: PNG with transparent background, 64×64 minimum (icons render at ~24-36px CSS in the bar)
- Brand colors per each platform's official media kit
- Square aspect ratio, content centered

## Usage

These will be served via the existing wsrv.nl proxy pattern:
`https://raw.githubusercontent.com/DrCalebL/nikeverse-assets/main/meme-machine/share-icons/<file>`

The ShareBar component (`public/index.html`) currently uses emoji placeholders:
- 𝕏 → x.svg
- ✈️ → telegram.svg
- 🟪 → farcaster.svg
- 🔻 → reddit.svg
- 💬 → whatsapp.svg
- 💚 → line.svg
- 📲 → native.svg

A follow-up commit in `nikepig-meme-machine` will swap the emojis for `<img>` tags pointing at these assets once they're uploaded.
