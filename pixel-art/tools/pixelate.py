#!/usr/bin/env python3
"""Transform Nikeverse nike art (1024x1024 RGB renders from the
nikeverse-assets repo) into 64x64 pixel-art battle sprites.

Pipeline per image (at 256px working resolution):
  1. Border-ring uniformity test: only attempt background removal when the
     outer ring is ~uniform (a flat studio backdrop). Complex scene
     backgrounds skip straight to card-style.
  2. Flood-fill background removal from corner seed colors (FIXED refs —
     a drifting reference crawls through anti-aliased edges).
  3. Sanity check: the surviving foreground must be one dominant connected
     blob of sane size, else fall back to card-style.
  4. Crop to content, downscale longest side to 64px, quantize to a
     24-color adaptive palette (render with nearest-neighbor upscaling).
  5. Card-style fallback: full art, rounded corners + dark border, so
     scene renders read as intentional framed portraits.

Usage: python3 pixelate.py <src_dir> <dst_dir>
"""
import os, sys
from collections import deque
from PIL import Image, ImageDraw

SIZE = 64
PALETTE_COLORS = 24
TOLERANCE = 40
WORK = 256


def ring_refs(px, w, h):
    seeds = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2),
             (w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)]
    return [px[s] for s in seeds], seeds


def close_to(p, refs, tol2):
    r, g, b = p
    for rr, rg, rb in refs:
        if (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2 <= tol2:
            return True
    return False


def ring_uniform(px, w, h, refs, tol2):
    total = hit = 0
    for x in range(0, w, 3):
        for y in (1, 3, 5, h - 6, h - 4, h - 2):
            total += 1
            if close_to(px[x, y], refs, tol2):
                hit += 1
    for y in range(0, h, 3):
        for x in (1, 3, 5, w - 6, w - 4, w - 2):
            total += 1
            if close_to(px[x, y], refs, tol2):
                hit += 1
    return hit / float(total) >= 0.93


def flood_remove_bg(im):
    """Returns (RGBA, ok) — ok False means use card-style fallback."""
    im = im.convert('RGB').resize((WORK, WORK), Image.LANCZOS)
    w, h = im.size
    px = im.load()
    tol2 = TOLERANCE * TOLERANCE * 3
    refs, seeds = ring_refs(px, w, h)

    if not ring_uniform(px, w, h, refs, tol2):
        return im.convert('RGBA'), False

    mask = bytearray(w * h)  # 1 = background
    q = deque()
    for sx, sy in seeds:
        if not mask[sy * w + sx] and close_to(px[sx, sy], refs, tol2):
            mask[sy * w + sx] = 1
            q.append((sx, sy))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and close_to(px[nx, ny], refs, tol2):
                mask[ny * w + nx] = 1
                q.append((nx, ny))

    fg = w * h - sum(mask)
    frac_fg = fg / float(w * h)
    if not (0.06 <= frac_fg <= 0.85):
        return im.convert('RGBA'), False

    # the creature occupies the center: if the fill ate most of the middle
    # (white creature on white bg), keying is hopeless — use card-style
    cx0, cx1 = int(w * 0.32), int(w * 0.68)
    cy0, cy1 = int(h * 0.32), int(h * 0.68)
    center_total = (cx1 - cx0) * (cy1 - cy0)
    center_removed = sum(mask[y * w + x] for y in range(cy0, cy1) for x in range(cx0, cx1))
    if center_removed > center_total * 0.5:
        return im.convert('RGBA'), False

    # largest connected foreground component must dominate (no shredded art)
    comp = bytearray(w * h)  # 0 unvisited, 1 visited
    best = 0
    for i in range(w * h):
        if mask[i] or comp[i]:
            continue
        size = 0
        q = deque([i])
        comp[i] = 1
        while q:
            j = q.popleft()
            size += 1
            x, y = j % w, j // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    k = ny * w + nx
                    if not mask[k] and not comp[k]:
                        comp[k] = 1
                        q.append(k)
        best = max(best, size)
    if best < fg * 0.55:
        return im.convert('RGBA'), False

    # edge-raggedness: shredded art (white creature eaten by white bg) has a
    # huge perimeter-to-area ratio; clean keys measure <= ~0.10
    perim = 0
    for y in range(h):
        base = y * w
        for x in range(w):
            if mask[base + x]:
                continue
            if (x == 0 or mask[base + x - 1]) or (x == w - 1 or mask[base + x + 1]) or \
               (y == 0 or mask[base - w + x]) or (y == h - 1 or mask[base + w + x]):
                perim += 1
    if perim / float(fg) > 0.115:
        return im.convert('RGBA'), False

    out = im.convert('RGBA')
    opx = out.load()
    for y in range(h):
        base = y * w
        for x in range(w):
            if mask[base + x]:
                opx[x, y] = (0, 0, 0, 0)
    return out, True


def quantize_keep_alpha(small):
    alpha = small.getchannel('A')
    rgb = small.convert('RGB').quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT).convert('RGB')
    out = rgb.convert('RGBA')
    out.putalpha(alpha.point(lambda a: 255 if a > 110 else 0))
    return out


def pixelate_keyed(im):
    bbox = im.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        m = max(2, (x1 - x0) // 40)
        bbox = (max(0, x0 - m), max(0, y0 - m), min(im.width, x1 + m), min(im.height, y1 + m))
        im = im.crop(bbox)
    w, h = im.size
    scale = SIZE / float(max(w, h))
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    small = im.resize((nw, nh), Image.LANCZOS)
    out = quantize_keep_alpha(small)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(out, ((SIZE - nw) // 2, SIZE - nh))
    return canvas


def pixelate_card(im):
    small = im.resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA')
    out = quantize_keep_alpha(small)
    # rounded corners + border so it reads as a framed portrait
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=8, fill=255)
    framed = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    framed.paste(out, (0, 0), mask)
    d2 = ImageDraw.Draw(framed)
    d2.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=8, outline=(32, 28, 48, 255), width=2)
    return framed


def slugify(fname):
    base = os.path.splitext(fname)[0].lower()
    for suffix in (' basic', ' corrupted', ' golden', ' nft'):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    out = []
    for ch in base:
        out.append(ch if ch.isalnum() else '_')
    s = ''.join(out)
    while '__' in s:
        s = s.replace('__', '_')
    return s.strip('_')


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    ok = card = 0
    for fname in sorted(os.listdir(src)):
        if not fname.lower().endswith('.png'):
            continue
        im = Image.open(os.path.join(src, fname))
        keyed, success = flood_remove_bg(im)
        if success:
            sprite = pixelate_keyed(keyed)
            ok += 1
        else:
            sprite = pixelate_card(keyed)
            card += 1
        sprite.save(os.path.join(dst, slugify(fname) + '.png'), optimize=True)
    print('%s -> %s : %d keyed, %d card-style' % (src, dst, ok, card))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
