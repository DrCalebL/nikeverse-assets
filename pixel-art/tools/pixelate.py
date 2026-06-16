#!/usr/bin/env python3
"""Transform Nikeverse nike art (1024x1024 RGB renders from the
nikeverse-assets repo) into 64x64 pixel-art battle sprites with the
background fully removed — just the nike (cutout for EVERY image; the
old framed-card fallback is gone by design).

Segmentation strategy per image (at 256px working resolution):
  PASS A — adaptive corner flood fill: try several tolerances; among the
    candidates that keep the image center intact, prefer the one that
    removes the most background with acceptable edge raggedness.
  PASS B — border-histogram keying (for scene backgrounds the flood
    fill can't eat): quantize colors, collect the border ring's color
    histogram, flood from the border across border-colored pixels only,
    then drop small floating foreground fragments away from the center.
  PASS C — center-prior color classifier (for full scene backgrounds):
    build a quantized color histogram of the border ring (background
    evidence) and of the central box (subject evidence), classify every
    pixel by likelihood ratio (with nearest-centroid fallback for unseen
    gradient colors), then enforce connectivity: background must connect
    to the border (enclosed misclassified pixels flip back to subject)
    and floating foreground scraps away from the center are dropped.
  Pick the best candidate overall; the subject's center must survive,
  prefer maximal background removal, and the result is ALWAYS a cutout.

PER-IMAGE OVERRIDES: stubborn images get an entry in OVERRIDES
(slug -> dict; corrupted variants override via 'corrupted/<slug>').
Supported keys:
  method     force candidate family: 'prior' | 'hist' | 'flood'
  k          prior classifier bg/subject likelihood ratio (default 1.0;
             lower = more aggressive background keying)
  box        fractional subject-evidence box (x0, y0, x1, y1)
  crop       fractional pre-crop (x0, y0, x1, y1) applied before
             segmentation; for subjects far off-center in a busy scene
  seeds      fractional (x, y) points known to be INSIDE the subject:
             they add subject color evidence and their connected
             component is always kept
  bgseeds    fractional points known to be BACKGROUND: add bg evidence
  flood_tol  custom flood tolerance list
  pad_bottom subject is cut by the frame at the bottom; keep anchored

Then: crop to content, downscale longest side to 64px, quantize to a
24-color adaptive palette, bottom-anchor on a transparent 64x64 square.

Usage: python3 pixelate.py <src_dir> <dst_dir> [only_slug ...]
"""
import os, sys
from collections import deque
from PIL import Image

SIZE = 64
PALETTE_COLORS = 24
WORK = 256


# ------------------------------------------------------------- overrides
# slug -> options dict (see module docstring).  'corrupted/<slug>' keys
# take precedence when processing the corrupted_basic source dir.
OVERRIDES = {
    # --- scene backgrounds the auto-ranker still leaves behind ---
    'cornerman': {'method': 'prior', 'k': 0.45,
                  'box': (0.2, 0.1, 0.6, 0.8),
                  'seeds': ((0.45, 0.42), (0.5, 0.6)),
                  'bgseeds': ((0.82, 0.15), (0.18, 0.12), (0.75, 0.2),
                              (0.8, 0.35), (0.9, 0.35), (0.8, 0.52),
                              (0.9, 0.54), (0.06, 0.43), (0.13, 0.93))},
    'corp_executive': {'crop': (0.5, 0.12, 0.85, 0.82),
                       'method': 'prior', 'k': 0.8,
                       'box': (0.25, 0.2, 0.65, 0.85),
                       'seeds': ((0.4, 0.25), (0.38, 0.45), (0.45, 0.75)),
                       'bgseeds': ((0.1, 0.15), (0.85, 0.1), (0.9, 0.5),
                                   (0.08, 0.85), (0.6, 0.08), (0.3, 0.1),
                                   (0.15, 0.35), (0.2, 0.7), (0.35, 0.85),
                                   (0.05, 0.5), (0.25, 0.64), (0.45, 0.66),
                                   (0.3, 0.03), (0.62, 0.03))},
    'data_miner': {'method': 'prior', 'k': 0.45,
                   'seeds': ((0.5, 0.42), (0.5, 0.58)),
                   'bgseeds': ((0.1, 0.32), (0.9, 0.32), (0.5, 0.07))},
    'fixer': {'crop': (0.0, 0.1, 0.7, 1.0),
              'method': 'prior', 'k': 1.0,
              'box': (0.25, 0.25, 0.8, 0.8),
              'seeds': ((0.5, 0.35), (0.55, 0.6), (0.45, 0.75)),
              'bgseeds': ((0.1, 0.08), (0.5, 0.06), (0.9, 0.9), (0.07, 0.5),
                          (0.93, 0.12))},
    'kunoichi': {'method': 'prior', 'k': 0.45,
                 'seeds': ((0.5, 0.42), (0.5, 0.65)),
                 'bgseeds': ((0.14, 0.3), (0.86, 0.3), (0.5, 0.05), (0.2, 0.85))},
    'netrunner': {'method': 'prior', 'k': 0.45,
                  'seeds': ((0.5, 0.62), (0.5, 0.75)),
                  'bgseeds': ((0.14, 0.25), (0.86, 0.25), (0.5, 0.07))},
    'obelisk': {'method': 'prior', 'k': 0.45,
                'box': (0.28, 0.2, 0.52, 0.95),
                'seeds': ((0.40, 0.3), (0.40, 0.5), (0.40, 0.75)),
                'bgseeds': ((0.75, 0.3), (0.65, 0.12), (0.8, 0.8), (0.1, 0.3),
                            (0.9, 0.55), (0.6, 0.95), (0.55, 0.18), (0.6, 0.28),
                            (0.7, 0.2), (0.55, 0.35))},
    'wrestler': {'method': 'prior', 'k': 0.45,
                 'seeds': ((0.5, 0.3), (0.5, 0.5)),
                 'bgseeds': ((0.06, 0.78), (0.94, 0.78), (0.1, 0.93), (0.9, 0.93))},
    'timeline': {'method': 'prior', 'k': 0.45,
                 'box': (0.38, 0.30, 0.62, 0.65),
                 'seeds': ((0.5, 0.42), (0.5, 0.55)),
                 'bgseeds': ((0.15, 0.2), (0.85, 0.2), (0.2, 0.8), (0.8, 0.8))},
    'ziggurat': {'method': 'prior', 'k': 1.0,
                 'seeds': ((0.5, 0.2), (0.5, 0.45), (0.5, 0.65),
                           (0.22, 0.38), (0.78, 0.38)),
                 'bgseeds': ((0.08, 0.85), (0.92, 0.85), (0.9, 0.12), (0.1, 0.12),
                             (0.5, 0.04), (0.3, 0.95), (0.7, 0.95))},
    'corey_hort': {'method': 'prior', 'k': 0.8,
                   'seeds': ((0.45, 0.5), (0.5, 0.65), (0.52, 0.3)),
                   'bgseeds': ((0.15, 0.2), (0.85, 0.2), (0.85, 0.75), (0.12, 0.75),
                               (0.25, 0.18), (0.6, 0.1))},
    'anomaly': {'method': 'prior', 'k': 0.45,
                'seeds': ((0.5, 0.42), (0.5, 0.6)),
                'bgseeds': ((0.15, 0.88), (0.85, 0.88), (0.12, 0.3), (0.88, 0.3),
                            (0.86, 0.62), (0.88, 0.78))},
    'hacker': {'method': 'prior', 'k': 0.45,
               'box': (0.36, 0.45, 0.64, 0.8),
               'seeds': ((0.45, 0.6), (0.55, 0.75)),
               'bgseeds': ((0.88, 0.3), (0.12, 0.3), (0.5, 0.06), (0.3, 0.12),
                           (0.75, 0.2), (0.2, 0.3), (0.4, 0.1), (0.6, 0.15))},
    'balance': {'method': 'prior', 'k': 0.45,
                'seeds': ((0.5, 0.42), (0.5, 0.55)),
                'bgseeds': ((0.2, 0.92), (0.8, 0.92), (0.08, 0.5), (0.92, 0.5))},
    'wavelength': {'method': 'prior', 'k': 0.45,
                   'seeds': ((0.5, 0.45), (0.5, 0.6)),
                   'bgseeds': ((0.06, 0.06), (0.94, 0.06), (0.06, 0.94), (0.94, 0.94),
                               (0.12, 0.45), (0.88, 0.4), (0.3, 0.08), (0.7, 0.08))},
    # --- subject shares the background palette: be conservative ---
    'cyberpunk': {'method': 'prior', 'k': 1.0,
                  'seeds': ((0.5, 0.35), (0.5, 0.55), (0.5, 0.7)),
                  'bgseeds': ((0.12, 0.1), (0.88, 0.1))},
    'firewall': {'method': 'prior', 'k': 1.0,
                 'seeds': ((0.5, 0.4), (0.5, 0.6)),
                 'bgseeds': ((0.1, 0.12), (0.9, 0.12))},
    'memory': {'method': 'prior', 'k': 1.2,
               'box': (0.32, 0.3, 0.66, 0.85),
               'seeds': ((0.45, 0.4), (0.5, 0.55), (0.45, 0.7)),
               'bgseeds': ((0.1, 0.15), (0.9, 0.15), (0.5, 0.95), (0.85, 0.3),
                           (0.08, 0.6))},
    'nightmare': {'crop': (0.08, 0.18, 1.0, 1.0),
                  'method': 'prior', 'k': 1.5,
                  'seeds': ((0.5, 0.55), (0.35, 0.5), (0.65, 0.5)),
                  'bgseeds': ((0.3, 0.05), (0.7, 0.05), (0.9, 0.08))},
    'smuggler': {'method': 'prior', 'k': 1.2,
                 'seeds': ((0.55, 0.35), (0.55, 0.6), (0.5, 0.8)),
                 'bgseeds': ((0.08, 0.3), (0.12, 0.7), (0.9, 0.1), (0.5, 0.04),
                             (0.3, 0.08), (0.45, 0.05), (0.2, 0.15))},
    'sovereign': {'method': 'prior', 'k': 2.0,
                  'seeds': ((0.5, 0.35), (0.5, 0.55)),
                  'bgseeds': ((0.88, 0.55), (0.82, 0.75), (0.1, 0.4), (0.12, 0.75))},
    'cardano_trader': {'method': 'prior', 'k': 2.0,
                       'seeds': ((0.5, 0.42), (0.5, 0.62)),
                       'bgseeds': ((0.1, 0.88), (0.9, 0.15), (0.08, 0.2))},
    'ascendant': {'method': 'prior', 'k': 2.0,
                  'seeds': ((0.5, 0.4), (0.5, 0.6))},
    'crescendo': {'method': 'prior', 'k': 2.5,
                  'seeds': ((0.45, 0.62), (0.5, 0.75), (0.55, 0.55))},
    'tarantula': {'method': 'prior', 'k': 1.5,
                  'seeds': ((0.5, 0.4), (0.5, 0.6))},
    # --- corrupted variants ---
    'corrupted/black_hole': {'method': 'prior', 'k': 2.0,
                             'seeds': ((0.5, 0.3), (0.5, 0.5))},
    'corrupted/gravity': {'method': 'prior', 'k': 2.0,
                          'seeds': ((0.5, 0.45), (0.5, 0.55))},
    'corrupted/paradox': {'method': 'prior', 'k': 2.0,
                          'seeds': ((0.5, 0.45), (0.5, 0.6))},
    'corrupted/ascendant': {'method': 'prior', 'k': 2.0,
                            'seeds': ((0.5, 0.45), (0.5, 0.65))},
    'corrupted/enigma': {'method': 'prior', 'k': 2.0,
                         'seeds': ((0.5, 0.4), (0.5, 0.6))},
    'corrupted/kraken': {'method': 'prior', 'k': 1.0,
                         'seeds': ((0.5, 0.45), (0.5, 0.6)),
                         'bgseeds': ((0.06, 0.5), (0.94, 0.5), (0.5, 0.04))},
    'corrupted/obsidian_knight': {'method': 'prior', 'k': 1.0,
                                  'seeds': ((0.5, 0.4), (0.5, 0.6)),
                                  'bgseeds': ((0.1, 0.18), (0.9, 0.14), (0.1, 0.85))},
    'corrupted/transcendent': {'method': 'prior', 'k': 2.0,
                               'seeds': ((0.5, 0.45), (0.5, 0.6))},
    'corrupted/hexwire': {'method': 'prior', 'k': 2.0,
                          'seeds': ((0.5, 0.45), (0.45, 0.6))},
    'corrupted/aberration': {'method': 'prior', 'k': 2.0,
                             'seeds': ((0.5, 0.5), (0.5, 0.65))},
}


# ---------------------------------------------------------------- helpers
def ring_seeds(w, h):
    return [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2),
            (w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)]


def close_to(p, refs, tol2):
    r, g, b = p
    for rr, rg, rb in refs:
        if (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2 <= tol2:
            return True
    return False


def mask_metrics(mask, w, h, cbox=None):
    """(bg_frac, center_removed_frac, perim_over_fg)"""
    total = w * h
    removed = sum(mask)
    fg = total - removed
    if cbox:
        cx0, cx1 = int(w * cbox[0]), int(w * cbox[2])
        cy0, cy1 = int(h * cbox[1]), int(h * cbox[3])
    else:
        cx0, cx1 = int(w * 0.32), int(w * 0.68)
        cy0, cy1 = int(h * 0.32), int(h * 0.68)
    c_total = (cx1 - cx0) * (cy1 - cy0)
    c_removed = sum(mask[y * w + x] for y in range(cy0, cy1) for x in range(cx0, cx1))
    perim = 0
    if fg:
        for y in range(h):
            base = y * w
            for x in range(w):
                if mask[base + x]:
                    continue
                if (x == 0 or mask[base + x - 1]) or (x == w - 1 or mask[base + x + 1]) or \
                   (y == 0 or mask[base - w + x]) or (y == h - 1 or mask[base + w + x]):
                    perim += 1
    return (removed / total,
            c_removed / max(1, c_total),
            (perim / fg) if fg else 9.9)


def flood_mask(px, w, h, refs, tol2):
    mask = bytearray(w * h)
    q = deque()
    for sx, sy in ring_seeds(w, h):
        if not mask[sy * w + sx] and close_to(px[sx, sy], refs, tol2):
            mask[sy * w + sx] = 1
            q.append((sx, sy))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and close_to(px[nx, ny], refs, tol2):
                mask[ny * w + nx] = 1
                q.append((nx, ny))
    return mask


def component_filter(mask, w, h, keep_pts=()):
    """Drop floating foreground scraps away from the center; components
    containing a keep point are always kept."""
    comp_id = [0] * (w * h)
    comps = []
    cur = 0
    cx0, cx1 = int(w * 0.30), int(w * 0.70)
    cy0, cy1 = int(h * 0.30), int(h * 0.70)
    keep_idx = set(int(py * h) * w + int(px_ * w) for px_, py in keep_pts)
    for i in range(w * h):
        if mask[i] or comp_id[i]:
            continue
        cur += 1
        size = 0
        central = False
        seeded = False
        q = deque([i])
        comp_id[i] = cur
        cells = []
        while q:
            j = q.popleft()
            size += 1
            cells.append(j)
            if j in keep_idx:
                seeded = True
            x, y = j % w, j // w
            if cx0 <= x < cx1 and cy0 <= y < cy1:
                central = True
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    k = ny * w + nx
                    if not mask[k] and not comp_id[k]:
                        comp_id[k] = cur
                        q.append(k)
        comps.append((size, central, seeded, cells))
    if comps:
        biggest = max(c[0] for c in comps)
        for size, central, seeded, cells in comps:
            keep = central or size >= biggest * 0.30
            if size < (w * h) * 0.004:
                keep = False
            if size == biggest or seeded:
                keep = True
            if not keep:
                for j in cells:
                    mask[j] = 1
    return mask


def histogram_mask(px, w, h):
    """Key out border-histogram colors connected to the border, then drop
    floating foreground fragments far from the center."""
    def qz(p):
        return (p[0] >> 4, p[1] >> 4, p[2] >> 4)

    ring = {}
    ring_n = 0
    for x in range(w):
        for y in (0, 1, 2, 3, h - 4, h - 3, h - 2, h - 1):
            ring[qz(px[x, y])] = ring.get(qz(px[x, y]), 0) + 1
            ring_n += 1
    for y in range(h):
        for x in (0, 1, 2, 3, w - 4, w - 3, w - 2, w - 1):
            ring[qz(px[x, y])] = ring.get(qz(px[x, y]), 0) + 1
            ring_n += 1
    bg_colors = set(c for c, n in ring.items() if n >= ring_n * 0.01)

    mask = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y * w + x] and qz(px[x, y]) in bg_colors:
                mask[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y * w + x] and qz(px[x, y]) in bg_colors:
                mask[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and qz(px[nx, ny]) in bg_colors:
                mask[ny * w + nx] = 1
                q.append((nx, ny))
    return component_filter(mask, w, h)


def prior_mask(px, w, h, k=1.0, box=None, seeds=(), bgseeds=()):
    """Center-prior color classifier.

    Border ring colors = background evidence; central-box colors =
    subject evidence.  Every pixel is classified by likelihood ratio
    (nearest-centroid fallback for colors seen in neither histogram).
    Background must connect to the border; enclosed 'background' pixels
    flip back to subject.  Floating subject scraps are dropped."""
    def qz(p):
        return (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4)

    B = {}
    btot = 0
    rw = 8
    for y in range(h):
        if y < rw or y >= h - rw:
            xs = range(w)
        else:
            xs = list(range(rw)) + list(range(w - rw, w))
        for x in xs:
            c = qz(px[x, y])
            B[c] = B.get(c, 0) + 1
            btot += 1
    for fx, fy in bgseeds:
        sx, sy = int(fx * w), int(fy * h)
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                nx, ny = sx + dx, sy + dy
                if 0 <= nx < w and 0 <= ny < h:
                    c = qz(px[nx, ny])
                    B[c] = B.get(c, 0) + 6
                    btot += 6

    if box is None:
        box = (0.34, 0.32, 0.66, 0.68)
    cx0, cx1 = int(w * box[0]), int(w * box[2])
    cy0, cy1 = int(h * box[1]), int(h * box[3])
    S = {}
    stot = 0
    for y in range(cy0, cy1):
        for x in range(cx0, cx1):
            c = qz(px[x, y])
            S[c] = S.get(c, 0) + 1
            stot += 1
    for fx, fy in seeds:
        sx, sy = int(fx * w), int(fy * h)
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                nx, ny = sx + dx, sy + dy
                if 0 <= nx < w and 0 <= ny < h:
                    c = qz(px[nx, ny])
                    S[c] = S.get(c, 0) + 8
                    stot += 8
    btot = max(1, btot)
    stot = max(1, stot)

    # centroid lists for the unseen-color fallback (gradients)
    def centroids(hist, tot, n=20):
        out = []
        for c, cnt in sorted(hist.items(), key=lambda kv: -kv[1])[:n]:
            if cnt < tot * 0.002:
                break
            out.append(((c >> 8 & 15) * 17 + 8, (c >> 4 & 15) * 17 + 8, (c & 15) * 17 + 8))
        return out
    bc = centroids(B, btot)
    sc = centroids(S, stot)

    def nearest2(p, refs):
        best = 1 << 30
        r, g, b = p
        for rr, rg, rb in refs:
            d = (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2
            if d < best:
                best = d
        return best

    isbg = bytearray(w * h)
    cache = {}
    for y in range(h):
        base = y * w
        for x in range(w):
            p = px[x, y]
            c = (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4)
            v = cache.get(c)
            if v is None:
                pB = B.get(c, 0) / btot
                pS = S.get(c, 0) / stot
                if pB > 0.0004 or pS > 0.0004:
                    v = 1 if pB > k * pS else 0
                elif bc:
                    dB = nearest2(p, bc)
                    dS = nearest2(p, sc) if sc else (1 << 30)
                    v = 1 if dB * 1.15 < dS else 0
                else:
                    v = 0
                cache[c] = v
            if v:
                isbg[base + x] = 1

    # connectivity: background must reach the border
    mask = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if isbg[i] and not mask[i]:
                mask[i] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if isbg[i] and not mask[i]:
                mask[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if isbg[i] and not mask[i]:
                    mask[i] = 1
                    q.append((nx, ny))
    return component_filter(mask, w, h, keep_pts=seeds)


def build_candidates(px, w, h, opts):
    refs = [px[s] for s in ring_seeds(w, h)]
    for fx, fy in opts.get('bgseeds', ()):
        refs.append(px[int(fx * w), int(fy * h)])
    candidates = []   # (mask, bg_frac, center_removed, raggedness, tag)
    cbox = opts.get('box')
    for tol in opts.get('flood_tol', (28, 36, 44, 52, 60)):
        m = flood_mask(px, w, h, refs, tol * tol * 3)
        bgf, cr, rag = mask_metrics(m, w, h, cbox)
        candidates.append((m, bgf, cr, rag, 'flood%d' % tol))
    m = histogram_mask(px, w, h)
    bgf, cr, rag = mask_metrics(m, w, h, cbox)
    candidates.append((m, bgf, cr, rag, 'hist'))
    ks = [opts['k']] if 'k' in opts else [1.0, 0.45]
    for k in ks:
        m = prior_mask(px, w, h, k=k, box=opts.get('box'),
                       seeds=opts.get('seeds', ()), bgseeds=opts.get('bgseeds', ()))
        bgf, cr, rag = mask_metrics(m, w, h, cbox)
        candidates.append((m, bgf, cr, rag, 'prior%g' % k))
    return candidates


def segment(im, opts=None):
    """Return the best background mask for the image (always a cutout)."""
    opts = opts or {}
    im = im.convert('RGB')
    if 'crop' in opts:
        cx0, cy0, cx1, cy1 = opts['crop']
        im = im.crop((int(im.width * cx0), int(im.height * cy0),
                      int(im.width * cx1), int(im.height * cy1)))
    im = im.resize((WORK, WORK), Image.LANCZOS)
    w, h = im.size
    px = im.load()
    candidates = build_candidates(px, w, h, opts)

    method = opts.get('method')
    if method:
        forced = [c for c in candidates if c[4].startswith(method)]
        if forced:
            # trust the hand-tuning: center must mostly survive, max bg gone
            ok = [c for c in forced if c[2] <= opts.get('max_center_removed', 0.60)
                  and 0.04 <= 1 - c[1] <= 0.96]
            pool = ok or forced
            best = max(pool, key=lambda c: c[1])
            return im, best[0], best[4] + '-forced'

    # rank: among center-safe + smooth candidates, max background removed
    good = [c for c in candidates if c[2] <= 0.45 and c[3] <= 0.13 and 0.05 <= 1 - c[1] <= 0.95]
    if good:
        best = max(good, key=lambda c: c[1])
        return im, best[0], best[4]
    # relaxed: center mostly intact, prefer least center damage then most bg gone
    okay = [c for c in candidates if c[2] <= 0.60 and (1 - c[1]) >= 0.04]
    if okay:
        best = min(okay, key=lambda c: (c[2], -c[1]))
        return im, best[0], best[4] + '-relaxed'
    # last resort: most background removed while any subject remains (cutout
    # no matter what)
    any_fg = [c for c in candidates if (1 - c[1]) >= 0.03]
    pool = any_fg or candidates
    best = max(pool, key=lambda c: c[1])
    return im, best[0], best[4] + '-forcedlast'


def apply_mask(im, mask):
    out = im.convert('RGBA')
    opx = out.load()
    w, h = im.size
    for y in range(h):
        base = y * w
        for x in range(w):
            if mask[base + x]:
                opx[x, y] = (0, 0, 0, 0)
    return out


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


def lookup_overrides(slug, src):
    variant = 'corrupted' if 'corrupted' in os.path.basename(os.path.normpath(src)) else 'basic'
    return OVERRIDES.get('%s/%s' % (variant, slug)) or OVERRIDES.get(slug) or {}


def main(src, dst, only=()):
    os.makedirs(dst, exist_ok=True)
    tags = {}
    for fname in sorted(os.listdir(src)):
        if not fname.lower().endswith('.png'):
            continue
        slug = slugify(fname)
        if only and slug not in only:
            continue
        im = Image.open(os.path.join(src, fname))
        opts = lookup_overrides(slug, src)
        work, mask, tag = segment(im, opts)
        tags[tag.split('-')[0]] = tags.get(tag.split('-')[0], 0) + 1
        sprite = pixelate_keyed(apply_mask(work, mask))
        sprite.save(os.path.join(dst, slug + '.png'), optimize=True)
        if only:
            print('  %-24s %s' % (slug, tag))
    print('%s -> %s : %s' % (src, dst, ', '.join('%s=%d' % kv for kv in sorted(tags.items()))))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], set(sys.argv[3:]))
