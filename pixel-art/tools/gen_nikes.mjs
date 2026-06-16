#!/usr/bin/env node
// NIKEVERSE — gen_nikes.mjs
// True pixel-art ADAPTATIONS for the 292 "nike" pig-folk creatures
// (creature.isNike === true in data/creatures.js), replacing the old
// 64px cutouts of their 1024px NFT renders.
//
//   node tools/gen_nikes.mjs
//
// Style matches tools/gen_creatures.mjs: 32x32 logical grid scaled 2x to
// 64x64, transparent bg, bottom-anchored, auto top-light/bottom-dark
// shading, 1px grown dark outline, sub-cell pupil dots, rarity glow
// garnish. Fully deterministic (fnv1a + mulberry32, zero Math.random).
//
// What keeps each adaptation recognizable as ITS render:
//  1. PALETTE EXTRACTION — dominant colors are clustered out of the
//     ORIGINAL cutout PNG (read from the pinned git blob so re-runs stay
//     sha256-identical after the files are overwritten) and mapped to
//     skin / outfit / accent slots.
//  2. FEATURE LIBRARY — every nike name is explicitly mapped to 1-3
//     features (headgear, held items, wings/capes, face gear, body
//     overlays) in the NIKES table below. Plain names get palette + a
//     seeded chest pattern.
//
// Output: assets/sprites/<key>.png for all 292 nikes (overwrites the
// cutouts; git history preserves them) + assets/sprites-corrupt/<key>.png
// corrupted variants for the 42 keys that have one. QC sheets + audit go
// to /tmp/nv-nikes/. Never touches the 144 generated non-nike sprites.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('/tmp/node_modules/@napi-rs/canvas');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, '..');
const ROOT = path.resolve(WEB, '..');
const SPRITE_DIR = path.join(WEB, 'assets', 'sprites');
const CORRUPT_DIR = path.join(WEB, 'assets', 'sprites-corrupt');
const BACK_DIR = path.join(WEB, 'assets', 'sprites-back');
const SHEET_DIR = '/tmp/nv-nikes2';
const BACK_SHEET_DIR = '/tmp/nv-backs';

// Pinned commit whose blobs hold the ORIGINAL 64px cutouts. Reading the
// originals from git (not the working tree) keeps palette extraction —
// and therefore the whole generation — byte-stable across runs even after
// this script has overwritten the files.
const PIN = 'c6b9545874ce2312a4288385f6879f5ace6de8b8';

// ---------- data ----------
globalThis.window = globalThis.window || {};
require(path.join(WEB, 'data', 'creatures.js'));
const CREATURES = globalThis.window.NIKEVERSE_DATA.creatures;

// ---------- determinism ----------
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------- color ----------
const TYPE_COLORS = {
  Arcane: '#a050c8', Beast: '#a07850', Blaze: '#e86830', Brawler: '#c83838',
  Cosmic: '#6858c8', Frost: '#70c8e0', Gale: '#90b8e8', Mind: '#e870a8',
  Neutral: '#a8a098', Nexus: '#40b0a0', Oddity: '#b8a838', Radiant: '#f0d048',
  Shadow: '#504868', Sonic: '#48c8c8', Terra: '#b89048', Tide: '#4878e8',
  Volt: '#f0c818', Wild: '#68b848',
};
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const BLACK = [10, 8, 18], WHITE_RGB = [255, 255, 255];
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const chroma = (c) => Math.max(...c) - Math.min(...c);
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// color slot ids stored in the grid
const C = {
  OUT: 1, XDARK: 2,
  SKIN: 3, SKIN_L: 4, SKIN_D: 5, SNOUT: 6, BELLY: 7,
  CLOTH: 8, CLOTH_L: 9, CLOTH_D: 10,
  ACC: 11, ACC_L: 12, ACC2: 13,
  EYE: 14, PUPIL: 15, GLOW: 16,
  WHITE: 17, GREY: 18, GREY_D: 19, GOLD: 20, GOLD_D: 21, WOOD: 22, RED: 23, DARK: 24,
  SNOUT_D: 25,
};

// ---------- original cutout access (pinned git blobs) ----------
function origPngBuffer(spriteKey) {
  for (const ref of [PIN, 'HEAD']) {
    try {
      return execSync(`git -C "${ROOT}" cat-file blob ${ref}:web-game/assets/sprites/${spriteKey}.png`,
        { maxBuffer: 1 << 24 });
    } catch { /* fall through */ }
  }
  return fs.readFileSync(path.join(SPRITE_DIR, spriteKey + '.png')); // last resort
}

// ---------- palette extraction ----------
// Cluster the cutout's opaque pixels (4-bit/channel frequency bins, greedy
// merge) and map the dominant colors to slots. Skin gets the strongest
// of the top clusters (frequency x colorfulness) so the pig's face carries
// the render's signature color; the rest become outfit + accents.
async function extractPalette(spriteKey) {
  const img = await loadImage(origPngBuffer(spriteKey));
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    let b = bins.get(key);
    if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, b); }
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    total++;
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n)
    .map((b) => ({ n: b.n, c: [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)] }));
  // greedy merge of near-identical bins into clusters
  const clusters = [];
  for (const s of sorted) {
    const hit = clusters.find((cl) => dist(cl.c, s.c) < 90);
    if (hit) {
      const w = hit.n / (hit.n + s.n);
      hit.c = [0, 1, 2].map((i) => Math.round(hit.c[i] * w + s.c[i] * (1 - w)));
      hit.n += s.n;
    } else if (clusters.length < 10) clusters.push({ n: s.n, c: s.c.slice() });
  }
  // usable clusters: big enough, not outline-black
  const usable = clusters.filter((cl) => cl.n >= total * 0.02 && lum(cl.c) > 26);
  return { usable, total };
}

function assignSlots(cre, usable) {
  const typeBase = hex2rgb(TYPE_COLORS[cre.type] || TYPE_COLORS.Neutral);
  const typeAcc = hex2rgb(TYPE_COLORS[cre.type2] || TYPE_COLORS[cre.type] || TYPE_COLORS.Neutral);
  if (usable.length < 2) {                                  // degenerate -> type colors
    return { skin: typeBase, cloth: mix(typeBase, BLACK, 0.25), acc: typeAcc, acc2: mix(typeAcc, WHITE_RGB, 0.35), src: 'fallback' };
  }
  // skin: strongest of the top 3 by frequency x colorfulness (favors the
  // render's signature hue over big grey/armor masses when it's prominent)
  const top = usable.slice(0, 4);
  let skinI = 0, best = -1;
  for (let i = 0; i < Math.min(3, top.length); i++) {
    const cl = top[i];
    const score = cl.n * (0.4 + Math.min(140, chroma(cl.c)) / 140) * (lum(cl.c) > 235 ? 0.55 : 1);
    if (score > best) { best = score; skinI = i; }
  }
  const rest = usable.filter((_, i) => i !== skinI);
  const skin = usable[skinI].c;
  const cloth = rest[0] ? rest[0].c : mix(skin, typeAcc, 0.5);
  const acc = rest[1] ? rest[1].c : typeAcc;
  const acc2 = rest[2] ? rest[2].c : mix(acc, WHITE_RGB, 0.35);
  return { skin, cloth, acc, acc2, src: 'extract' };
}

function buildPalette(slots) {
  let { skin, cloth, acc, acc2 } = slots;
  // floors so the pig never goes invisible-dark
  const floor = (c, f) => (lum(c) < f ? mix(c, WHITE_RGB, (f - lum(c)) / 255 + 0.08) : c);
  skin = floor(skin, 46); cloth = floor(cloth, 40); acc = floor(acc, 56); acc2 = floor(acc2, 56);
  // snout disc: stays in the skin's hue family but always reads against it
  // (light skins get a darker warm disc, dark skins a lighter one)
  const snout = lum(skin) > 165
    ? mix(mix(skin, BLACK, 0.18), [255, 150, 160], 0.3)
    : mix(mix(skin, WHITE_RGB, 0.34), [255, 150, 160], 0.28);
  return {
    [C.OUT]: mix(skin, BLACK, 0.74),
    [C.XDARK]: mix(skin, BLACK, 0.82),
    [C.SKIN]: skin,
    [C.SKIN_L]: mix(skin, WHITE_RGB, 0.32),
    [C.SKIN_D]: mix(skin, BLACK, 0.28),
    [C.SNOUT]: snout,
    [C.SNOUT_D]: mix(snout, BLACK, 0.5),
    [C.BELLY]: mix(skin, WHITE_RGB, 0.42),
    [C.CLOTH]: cloth,
    [C.CLOTH_L]: mix(cloth, WHITE_RGB, 0.32),
    [C.CLOTH_D]: mix(cloth, BLACK, 0.3),
    [C.ACC]: acc,
    [C.ACC_L]: mix(acc, WHITE_RGB, 0.4),
    [C.ACC2]: acc2,
    [C.EYE]: [246, 246, 250],
    [C.PUPIL]: [22, 20, 36],
    [C.GLOW]: mix(acc, WHITE_RGB, 0.68),
    [C.WHITE]: [240, 240, 244],
    [C.GREY]: [152, 158, 172],
    [C.GREY_D]: [92, 96, 114],
    [C.GOLD]: [232, 188, 82],
    [C.GOLD_D]: [164, 122, 44],
    [C.WOOD]: [124, 84, 50],
    [C.RED]: [206, 64, 56],
    [C.DARK]: [44, 42, 58],
  };
}

// Per-key palette corrections where frequency clustering picks the wrong
// slot (e.g. an aura or armor mass winning over the actual skin).
const PALETTE_OVERRIDES = {
  chef: { skin: '#6b8a4a' },                                // green pig, red apron stays in cloth
  emo: { skin: '#4c5557', cloth: '#2b2d34', acc: '#d1393e' }, // dark pig, red aura accent
  gladiator: { skin: '#279471' },                           // teal pig under the gold armor
  geisha: { skin: '#e8c9a0', cloth: '#a83440', acc: '#d2a563' }, // cream face, red kimono
  peter_porker: { skin: '#2c4886', cloth: '#a82e2a' },      // blue limbs, red mask/suit
  shrine_maiden: { skin: '#ecd9c4', cloth: '#b93b32' },     // pale face, red miko robe
  porker: { skin: '#cbd2cc', cloth: '#5a3494', acc: '#2fa05a' }, // pale face, purple suit, green hair
  ninja: { skin: '#3a3648', cloth: '#26232f', acc: '#3f8f9f' }, // all-black, teal glints
  jedi: { acc: '#2f9e4f' },                                 // green lightsaber glow
  cosmic: { skin: '#3b3470', acc: '#e470c8', acc2: '#70d8e8' }, // dark nebula body, pink/cyan glow
  matrix: { acc: '#3fae62' },                               // digital-rain green visor/circuit
  archon: { acc: '#9b86e8' },                               // arcane orb glow (extracted acc was near-black)
};
function applyOverrides(key, slots) {
  const ov = PALETTE_OVERRIDES[key];
  if (!ov) return slots;
  const out = { ...slots, src: 'override' };
  for (const k of ['skin', 'cloth', 'acc', 'acc2']) if (ov[k]) out[k] = hex2rgb(ov[k]);
  return out;
}

function corruptPalette(pal) {
  const P = hex2rgb('#5a1e82');
  const out = {};
  for (const k of Object.keys(pal)) {
    const ki = +k;
    if (ki === C.EYE) out[k] = [58, 12, 66];
    else if (ki === C.PUPIL) out[k] = [255, 92, 240];
    else if (ki === C.GLOW) out[k] = [228, 110, 255];
    else out[k] = mix(mix(pal[k], BLACK, 0.22), P, 0.38);
  }
  return out;
}

// ---------- 32x32 pixel grid ----------
const N = 32;
class Grid {
  constructor() { this.g = new Uint8Array(N * N); this.dots = []; }
  set(x, y, c) { x |= 0; y |= 0; if (x >= 0 && x < N && y >= 0 && y < N) this.g[y * N + x] = c; }
  get(x, y) { return x < 0 || x >= N || y < 0 || y >= N ? 0 : this.g[(y | 0) * N + (x | 0)]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  disc(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.45), dy = (y - cy) / (ry + 0.45);
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  line(x0, y0, x1, y1, c, w = 1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) this.set(x0 + i, y0 + j, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  eye(x, y) {                                              // white cell + centered sub-cell pupil
    this.set(x, y, C.EYE);
    this.dots.push([x * 2, y * 2 + 1, C.PUPIL], [x * 2 + 1, y * 2 + 1, C.PUPIL]);
  }
  glowEye(x, y) { this.set(x, y, C.GLOW); this.dots.push([x * 2 + 1, y * 2 + 1, C.PUPIL]); }
  clearDotsRect(gx0, gy0, gx1, gy1) {                      // grid-coord rect, removes pupil dots
    this.dots = this.dots.filter(([x, y]) => {
      const gx = x / 2, gy = y / 2;
      return !(gx >= gx0 && gx < gx1 + 1 && gy >= gy0 && gy < gy1 + 1);
    });
  }
  bbox() {
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (this.g[y * N + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }
  shift(dx, dy) {
    const old = this.g; this.g = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = old[y * N + x];
      if (v) this.set(x + dx, y + dy, v);
    }
    this.dots = this.dots.map(([x, y, c]) => [x + dx * 2, y + dy * 2, c]);
  }
  clone() {
    const g2 = new Grid();
    g2.g = this.g.slice(); g2.dots = this.dots.map((d) => d.slice());
    return g2;
  }
}

// ---------- post passes ----------
const SHADE_UP = { [C.SKIN]: C.SKIN_L, [C.CLOTH]: C.CLOTH_L, [C.ACC]: C.ACC_L };
const SHADE_DOWN = { [C.SKIN]: C.SKIN_D, [C.CLOTH]: C.CLOTH_D };
function shadePass(g) {
  const src = g.g.slice();
  const at = (x, y) => (x < 0 || x >= N || y < 0 || y >= N ? 0 : src[y * N + x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = src[y * N + x];
    if (SHADE_UP[v] && !at(x, y - 1)) g.set(x, y, SHADE_UP[v]);
    else if (SHADE_DOWN[v] && !at(x, y + 1)) g.set(x, y, SHADE_DOWN[v]);
  }
}
function outlinePass(g) {
  const src = g.g.slice();
  const at = (x, y) => (x < 0 || x >= N || y < 0 || y >= N ? 0 : src[y * N + x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (src[y * N + x]) continue;
    if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) g.set(x, y, C.OUT);
  }
}
function anchorPass(g) {
  const b = g.bbox();
  if (b.x1 < 0) return { dx: 0, dy: 0 };
  const dx = 16 - Math.round((b.x0 + b.x1) / 2), dy = 30 - b.y1;
  g.shift(dx, dy);
  return { dx, dy };
}
function garnishPass(g, r, rarity) {
  if (rarity !== 'Ultra Rare' && rarity !== 'Legendary') return;
  const b = g.bbox();
  const cx = Math.round((b.x0 + b.x1) / 2);
  const n = rarity === 'Legendary' ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const x = cx + ri(r, -7, 7), y = b.y0 - ri(r, 1, 4);
    if (!g.get(x, y)) g.set(x, y, C.GLOW);
  }
  if (rarity === 'Legendary') {
    const tx = cx, ty = Math.max(1, b.y0 - 2);
    if (!g.get(tx, ty - 1)) g.set(tx, ty - 1, C.GLOW);
    if (!g.get(tx - 1, ty)) g.set(tx - 1, ty, C.GLOW);
    if (!g.get(tx + 1, ty)) g.set(tx + 1, ty, C.GLOW);
  }
}

// ---------- render ----------
function renderPNG(g, pal) {
  const cv = createCanvas(64, 64);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(64, 64);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = g.g[y * N + x];
    if (!v) continue;
    const [R, G2, B] = pal[v];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const o = ((y * 2 + j) * 64 + x * 2 + i) * 4;
      img.data[o] = R; img.data[o + 1] = G2; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  for (const [x, y, c] of g.dots) {
    if (x < 0 || x > 63 || y < 0 || y > 63) continue;
    const o = (y * 64 + x) * 4;
    if (img.data[o + 3] === 0) continue;
    const [R, G2, B] = pal[c];
    img.data[o] = R; img.data[o + 1] = G2; img.data[o + 2] = B; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// =====================================================================
// NIKE BASE TEMPLATES — pot-bellied pig-folk on the 32x32 grid.
// Three stances: 'biped' (default standing), 'chunky' (wide heavyweight),
// 'piglet' (small round). Seeded proportion wobble. Returns metrics used
// by every feature painter.
// =====================================================================
function planBase(r, stance, compact) {
  if (stance === 'chunky') {
    const brx = ri(r, 8, 9), bry = 7 - (compact ? 1 : 0);
    const hw = ri(r, 5, 6);
    return {
      stance, hx: 16, hy: 9 + (compact ? 1 : 0), hw, hh: 4, bx: 16, by: 21 + (compact ? 1 : 0), brx, bry,
      shoulderY: 16 + (compact ? 1 : 0), armW: 3, legW: 3,
      handL: [16 - brx - 2, 22], handR: [16 + brx + 1, 22],
    };
  }
  if (stance === 'piglet') {
    const hw = ri(r, 4, 5), brx = ri(r, 5, 6);
    return {
      stance, hx: 16, hy: 15, hw, hh: 4, bx: 16, by: 24, brx, bry: 4.5,
      shoulderY: 22, armW: 2, legW: 2,
      handL: [16 - brx - 2, 26], handR: [16 + brx + 1, 26],
    };
  }
  const hw = ri(r, 5, 6), brx = ri(r, 6, 7);
  const sq = compact ? 1 : 0;                              // squash for tall headgear
  return {
    stance: 'biped', hx: 16, hy: 10 + sq * 2, hw, hh: 4.5 - sq * 0.5, bx: 16, by: 21 + sq, brx, bry: 6 - sq,
    shoulderY: 17 + sq, armW: 2, legW: 3,
    handL: [16 - brx - 2, 23], handR: [16 + brx + 1, 23],
  };
}

function drawPig(g, r, m) {
  const { hx, hy, hw, hh, bx, by, brx, bry, shoulderY, armW, legW } = m;
  const headTop = Math.round(hy - hh);
  m.headTop = headTop;
  m.eyeY = hy - 1;
  m.eyeDX = Math.max(2, Math.round(hw * 0.55));
  m.snoutY = hy + 2;
  // ears — small triangular flaps tilted outward and DROOPING down (pig,
  // not calf: they rise at most 1px above the scalp and the tip folds
  // below the head top, outside the head silhouette)
  const earLX = hx - hw + 1, earRX = hx + hw - 2;
  m.earLX = earLX; m.earRX = earRX;
  for (const ex of [earLX, earRX]) {
    const dir = ex < hx ? -1 : 1;
    g.set(ex, headTop - 1, C.SKIN);                        // root, 1px rise
    g.set(ex + dir, headTop - 1, C.SKIN);
    g.set(ex + dir, headTop, C.SNOUT);                     // inner-ear fold
    g.set(ex + dir * 2, headTop, C.SKIN);                  // tip leans out...
    g.set(ex + dir * 2, headTop + 1, C.SKIN_D);            // ...and droops
  }
  // body + neck + head
  g.disc(bx, by, brx, bry, C.SKIN);
  g.rect(hx - 2, Math.round(hy + hh) - 2, 5, 3, C.SKIN);   // neck bridge
  g.disc(hx, hy, hw, hh, C.SKIN);
  // belly
  g.disc(bx, by + 1, Math.max(3, brx - 2.5), Math.max(2.5, bry - 2), C.BELLY);
  // curly tail (screen-right)
  g.set(bx + brx, by - 1, C.SKIN); g.set(bx + brx + 1, by - 2, C.SKIN); g.set(bx + brx + 1, by - 3, C.SKIN_D);
  // arms
  g.line(bx - brx + 1, shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.SKIN, armW);
  g.line(bx + brx - armW, shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.SKIN, armW);
  g.rect(m.handL[0], m.handL[1], 2, 1, C.SKIN_D);          // trotters
  g.rect(m.handR[0], m.handR[1], 2, 1, C.SKIN_D);
  // legs + feet
  const legY = Math.round(by + bry) - 2;
  const legLX = bx - Math.max(3, Math.round(brx * 0.55)) - (legW - 2);
  const legRX = bx + Math.max(3, Math.round(brx * 0.55)) - 1;
  m.legY = legY; m.legLX = legLX; m.legRX = legRX;
  g.rect(legLX, legY, legW, 30 - legY, C.SKIN);
  g.rect(legRX, legY, legW, 30 - legY, C.SKIN);
  g.rect(legLX, 30, legW, 1, C.SKIN_D);
  g.rect(legRX, 30, legW, 1, C.SKIN_D);
  // face: eyes, then the signature pig snout — a FLAT ROUND DISC sitting
  // center-low on the face with two CLEAR full-cell nostril dots
  g.eye(hx - m.eyeDX, m.eyeY); g.eye(hx + m.eyeDX, m.eyeY);
  g.disc(hx, m.snoutY, m.stance === 'piglet' ? 2.1 : 2.6, 1.5, C.SNOUT);
  g.set(hx - 1, m.snoutY, C.SNOUT_D);                      // nostrils
  g.set(hx + 1, m.snoutY, C.SNOUT_D);
}

// =====================================================================
// FEATURE LIBRARY — each feature: { layer, draw(g, r, m, o) }.
// Layers paint in order: back -> (pig) -> body -> head -> face -> held
// -> post (post-outline garnish, airy, no outline).
// =====================================================================
const FEATS = {};
const F = (name, layer, draw, tall) => { FEATS[name] = { layer, draw, tall }; };

// --- helper: repaint skin-family cells inside a rect (clothing) ---
const SKIN_FAM = new Set([C.SKIN, C.SKIN_L, C.SKIN_D, C.BELLY]);
function clothe(g, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (SKIN_FAM.has(g.get(x, y))) g.set(x, y, c);
}

// ============================ BACK ============================
F('wings', 'back', (g, r, m, o) => {
  const y0 = m.by - m.bry + 1;
  const flame = o.flame, bat = o.bat;
  for (const s of [-1, 1]) {
    const x0 = m.bx + s * (m.brx - 2);
    if (bat) {                                             // membrane triangles
      g.line(x0, y0, x0 + s * 6, y0 - 6, C.CLOTH_D, 2);
      g.line(x0 + s * 6, y0 - 6, x0 + s * 9, y0 - 1, C.CLOTH_D, 1);
      g.line(x0 + s * 9, y0 - 1, x0 + s * 5, y0 + 1, C.CLOTH_D, 1);
      g.line(x0 + s * 3, y0 - 2, x0 + s * 7, y0 - 2, C.CLOTH_D, 1);
      g.set(x0 + s * 6, y0 - 7, C.ACC);
    } else {
      const main = flame ? C.ACC : C.WHITE, edge = flame ? C.GLOW : C.GREY;
      g.line(x0, y0, x0 + s * 5, y0 - 5, main, 2);
      g.line(x0 + s * 5, y0 - 5, x0 + s * 9, y0 - 6, main, 2);
      g.line(x0 + s * 2, y0 + 1, x0 + s * 7, y0 - 3, main, 2);
      g.set(x0 + s * 9, y0 - 7, edge);
      g.set(x0 + s * 4, y0 - 3, edge);
      if (o.four) {                                        // seraph lower pair
        g.line(x0, y0 + 3, x0 + s * 6, y0 + 5, main, 2);
        g.set(x0 + s * 7, y0 + 5, edge);
      }
    }
  }
}, true);
F('cape', 'back', (g, r, m) => {
  const y0 = m.by - m.bry;
  for (let y = y0; y <= 29; y++) {
    const w = m.brx + 1 + Math.min(3, Math.floor((y - y0) * 0.35));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH_D);
  }
  g.rect(m.bx - m.brx - 1, y0 - 1, 3, 1, C.CLOTH_D);       // shoulder hooks
  g.rect(m.bx + m.brx - 1, y0 - 1, 3, 1, C.CLOTH_D);
});
F('jetpack', 'back', (g, r, m) => {
  const y0 = m.by - m.bry + 2;
  for (const s of [-1, 1]) {
    const x = m.bx + s * (m.brx + 1);
    g.rect(x - 1, y0, 2, 6, C.GREY);
    g.set(x - 1, y0 + 6, C.GREY_D); g.set(x, y0 + 6, C.GREY_D);
    g.set(x - 1, y0 + 7, C.ACC); g.set(x, y0 + 8, C.GLOW);
  }
});
F('backpack', 'back', (g, r, m) => {
  const y0 = m.by - m.bry;
  g.disc(m.bx - m.brx - 1, y0 + 4, 2.4, 3.4, C.WOOD);
  g.disc(m.bx + m.brx + 1, y0 + 4, 2.4, 3.4, C.WOOD);
  g.rect(m.bx - 4, y0 - 2, 9, 2, C.WOOD);                  // bedroll on top
  g.set(m.bx - 4, y0 - 2, C.GOLD_D); g.set(m.bx + 4, y0 - 2, C.GOLD_D);
});
F('flameCrest', 'back', (g, r, m) => {
  const top = m.headTop - 1;
  for (const [dx, h] of [[-3, 3], [0, 4], [3, 3]]) {
    g.line(m.hx + dx, top, m.hx + dx + 1, top - h, C.ACC, 1);
    g.set(m.hx + dx + 1, top - h - 1, C.GLOW);
  }
}, true);
F('snake', 'back', (g, r, m) => {
  // coiled around the torso; head pops over the shoulder
  const y0 = m.by - m.bry + 2;
  g.line(m.bx - m.brx - 1, y0 + 4, m.bx + m.brx + 1, y0 + 2, C.ACC2, 2);
  g.line(m.bx - m.brx, m.by + 2, m.bx + m.brx, m.by + 3, C.ACC2, 2);
  g.disc(m.bx + m.brx, y0 - 1, 1.6, 1.4, C.ACC2);
  g.glowEye(m.bx + m.brx, y0 - 1);
  g.set(m.bx + m.brx + 2, y0 - 1, C.RED);                  // tongue
});
F('tentacles', 'back', (g, r, m) => {
  const y0 = m.by - m.bry + 1;
  for (const [s, h] of [[-1, 7], [-1.6, 4], [1, 7], [1.6, 4]]) {
    const x0 = m.bx + Math.round(s * (m.brx - 1));
    const xt = m.bx + Math.round(s * (m.brx + 2.5));
    g.line(x0, y0 + 2, xt, y0 - h + 3, C.CLOTH_D, 2);
    g.set(xt + (s > 0 ? 1 : -1), y0 - h + 2, C.CLOTH_D);
    g.set(xt, y0 - h + 4, C.ACC);                          // sucker
  }
});
F('hydraHeads', 'back', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x0 = m.bx + s * (m.brx - 1), xt = m.bx + s * (m.brx + 4);
    g.line(x0, m.by - m.bry + 2, xt, m.headTop, C.ACC2, 2);
    g.disc(xt, m.headTop - 1, 1.8, 1.5, C.ACC2);
    g.rect(xt + s, m.headTop - 1, 2, 1, C.ACC2);
    g.glowEye(xt, m.headTop - 2);
  }
}, true);
F('spiderLegs', 'back', (g, r, m) => {
  const y0 = m.by - 1;
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const x0 = m.bx + s * (m.brx - 1);
      g.line(x0, y0 - i, x0 + s * (4 + i * 2), y0 - 4 - i, C.DARK, 1);
      g.line(x0 + s * (4 + i * 2), y0 - 4 - i, x0 + s * (6 + i * 2), 29, C.DARK, 1);
    }
  }
});
F('shadowTwin', 'back', (g, r, m) => {
  g.disc(m.bx + 4, m.by - 1, m.brx - 1, m.bry - 1, C.XDARK);
  g.disc(m.hx + 5, m.hy - 1, m.hw - 1, m.hh - 1, C.XDARK);
  g.glowEye(m.hx + 4, m.hy - 2); g.glowEye(m.hx + 7, m.hy - 2);
});
F('ring', 'post', (g, r, m) => {
  // orbit/accretion ring: front arc drawn OVER the body, back arc only
  // where the grid is empty (occluded by the pig)
  const cy = m.by - 1, rx = m.brx + 4;
  for (let t = 0; t < 80; t++) {
    const th = (t / 80) * Math.PI * 2;
    const x = m.bx + Math.round(Math.cos(th) * rx);
    const y = cy + Math.round(Math.sin(th) * 2.4);
    if (Math.sin(th) >= -0.05) g.set(x, y, Math.abs(Math.cos(th)) > 0.85 ? C.ACC : C.GLOW);
    else if (!g.get(x, y)) g.set(x, y, C.ACC);
  }
});
F('finBack', 'back', (g, r, m) => {
  const y0 = m.by - m.bry;
  g.line(m.bx - 1, y0, m.bx - 3, y0 - 4, C.ACC, 1);
  g.line(m.bx - 3, y0 - 4, m.bx - 4, y0 - 1, C.ACC, 1);
  g.set(m.bx - 2, y0 - 2, C.ACC);
  g.line(m.bx + m.brx + 1, m.by + 1, m.bx + m.brx + 3, m.by - 2, C.ACC, 1); // tail fin
  g.line(m.bx + m.brx + 1, m.by + 1, m.bx + m.brx + 3, m.by + 3, C.ACC, 1);
}, true);
F('sack', 'back', (g, r, m) => {
  g.disc(m.bx + m.brx + 1, m.shoulderY - 2, 2.8, 3.2, C.WOOD);
  g.set(m.bx + m.brx, m.shoulderY + 1, C.GOLD_D);
  g.line(m.bx + m.brx, m.shoulderY + 1, m.bx + 2, m.shoulderY + 2, C.GOLD_D, 1);
}, true);

// ============================ BODY ============================
F('armor', 'body', (g, r, m, o) => {
  const main = o.gold ? C.GOLD : C.GREY, dark = o.gold ? C.GOLD_D : C.GREY_D;
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + 2, main);
  g.rect(m.bx - m.brx + 1, m.by + 2, m.brx * 2 - 1, 1, dark); // belt
  g.set(m.bx, m.by + 2, C.ACC);
  g.disc(m.bx - m.brx + 1, m.shoulderY - 1, 1.8, 1.4, dark);  // pauldrons
  g.disc(m.bx + m.brx - 1, m.shoulderY - 1, 1.8, 1.4, dark);
  g.rect(m.bx - 1, m.by - m.bry + 1, 3, 1, dark);             // collar seam
});
F('robe', 'body', (g, r, m) => {
  const ty = m.by - m.bry;
  for (let y = ty; y <= 30; y++) {
    const w = Math.min(m.brx + 2, 4 + Math.floor((y - ty) * 0.5));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH);
  }
  g.line(m.bx - m.brx + 1, m.shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.CLOTH, m.armW); // sleeves
  g.line(m.bx + m.brx - m.armW, m.shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.CLOTH, m.armW);
  g.rect(m.bx - 3, m.by + 1, 7, 1, C.ACC);                 // sash
});
F('kimono', 'body', (g, r, m) => {
  const ty = m.by - m.bry;
  for (let y = ty; y <= 30; y++) {
    const w = Math.min(m.brx + 2, 4 + Math.floor((y - ty) * 0.45));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH);
  }
  g.line(m.bx - 2, ty, m.bx + 1, ty + 4, C.WHITE, 1);      // collar V
  g.line(m.bx + 2, ty, m.bx - 1, ty + 4, C.WHITE, 1);
  g.rect(m.bx - m.brx, m.by + 1, m.brx * 2 + 1, 2, C.GOLD); // obi
  g.line(m.bx - m.brx - 1, m.shoulderY, m.bx - m.brx - 3, m.shoulderY + 4, C.CLOTH, 3); // wide sleeves
  g.line(m.bx + m.brx - 1, m.shoulderY, m.bx + m.brx + 1, m.shoulderY + 4, C.CLOTH, 3);
});
F('apron', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE); // jacket
  g.rect(m.bx - 3, m.by - m.bry + 2, 7, m.bry * 2 - 2, C.CLOTH); // apron panel
  g.set(m.bx - 1, m.by - m.bry + 1, C.CLOTH); g.set(m.bx + 1, m.by - m.bry + 1, C.CLOTH); // straps
  g.rect(m.bx - 2, m.by + 1, 5, 1, C.CLOTH_D);             // pocket seam
});
F('overalls', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - 1, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  g.rect(m.legLX, m.legY, m.legW, 3, C.CLOTH);
  g.rect(m.legRX, m.legY, m.legW, 3, C.CLOTH);
  g.line(m.bx - 3, m.by - m.bry + 1, m.bx - 3, m.by - 1, C.CLOTH, 1); // straps
  g.line(m.bx + 3, m.by - m.bry + 1, m.bx + 3, m.by - 1, C.CLOTH, 1);
  g.set(m.bx - 3, m.by - 1, C.GOLD); g.set(m.bx + 3, m.by - 1, C.GOLD); // buttons
});
F('suitTie', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  const ty = m.by - m.bry;
  g.line(m.bx - 2, ty, m.bx, ty + 2, C.WHITE, 1);          // shirt V
  g.line(m.bx + 2, ty, m.bx, ty + 2, C.WHITE, 1);
  g.line(m.bx, ty + 1, m.bx, ty + 5, C.ACC, 1);            // tie
  g.set(m.bx, ty + 6, C.ACC);
});
F('toga', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE);
  g.line(m.bx + m.brx - 1, m.by - m.bry, m.bx - m.brx + 1, m.by + m.bry - 1, C.GOLD, 1); // trim drape
  // one bare shoulder
  g.rect(m.bx + 2, m.by - m.bry, m.brx - 2, 2, C.SKIN);
});
F('gi', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry - 1, C.WHITE);
  const ty = m.by - m.bry;
  g.line(m.bx - 3, ty, m.bx, ty + 4, C.GREY, 1);           // lapels
  g.line(m.bx + 3, ty, m.bx, ty + 4, C.GREY, 1);
  g.rect(m.bx - 2, ty, 5, 1, C.SKIN);                      // open chest
  g.rect(m.bx - m.brx + 1, m.by + 1, m.brx * 2 - 1, 1, C.DARK); // belt
  g.set(m.bx, m.by + 2, C.DARK);
});
F('hoodieBody', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  g.rect(m.bx - 3, m.by + 1, 7, 1, C.CLOTH_D);             // pocket
  g.set(m.bx - 1, m.by - m.bry + 1, C.WHITE); g.set(m.bx + 1, m.by - m.bry + 1, C.WHITE); // drawstrings
});
F('sailorShirt', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry - 1, C.WHITE);
  for (let y = m.by - m.bry + 1; y <= m.by + m.bry - 2; y += 2)
    for (let x = m.bx - m.brx; x <= m.bx + m.brx; x++)
      if (g.get(x, y) === C.WHITE) g.set(x, y, C.ACC);
});
F('bandages', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE);
  for (let y = m.by - m.bry + 1; y <= m.by + m.bry; y += 2)
    g.line(m.bx - m.brx, y, m.bx + m.brx, y - 1, C.GREY, 1);
  // head wrap leaving the face open
  g.rect(m.hx - m.hw + 1, m.headTop, m.hw * 2 - 1, 2, C.WHITE);
  g.line(m.hx - m.hw + 1, m.headTop + 1, m.hx + m.hw - 1, m.headTop, C.GREY, 1);
  g.set(m.hx + m.hw, m.headTop + 1, C.WHITE); g.set(m.hx + m.hw + 1, m.headTop + 2, C.WHITE); // loose end
});
F('rags', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry + 1, m.bx + m.brx, m.by + m.bry - 2, C.CLOTH_D);
  for (let x = m.bx - m.brx + 1; x <= m.bx + m.brx - 1; x += 2)
    g.set(x, m.by + m.bry - 1, C.CLOTH_D);                 // ragged hem
  g.set(m.bx - 2, m.by - 1, C.CLOTH); g.set(m.bx + 2, m.by + 1, C.CLOTH); // patches
});
F('chains', 'body', (g, r, m) => {
  for (let i = 0; i <= m.brx * 2; i += 2)
    g.set(m.bx - m.brx + i, m.by - 2 + (i % 4 === 0 ? 0 : 1), C.GREY);
  g.set(m.handL[0], m.handL[1] - 1, C.GREY);               // cuffs
  g.set(m.handR[0] + 1, m.handR[1] - 1, C.GREY);
});
F('circuit', 'body', (g, r, m) => {
  const ty = m.by - m.bry + 1;
  g.line(m.bx - 2, ty, m.bx - 2, ty + 5, C.GLOW, 1);
  g.line(m.bx - 2, ty + 5, m.bx + 2, ty + 5, C.GLOW, 1);
  g.line(m.bx + 2, ty + 1, m.bx + 2, ty + 3, C.GLOW, 1);
  g.set(m.bx + 2, ty, C.ACC); g.set(m.bx - 2, ty + 6 > m.by + 2 ? m.by + 2 : ty + 6, C.ACC);
});
F('runesBody', 'body', (g, r, m) => {
  for (const [dx, dy] of [[-2, -2], [2, -1], [0, 1], [-3, 2], [3, 3]])
    g.set(m.bx + dx, m.by + dy, C.GLOW);
});
F('furBody', 'body', (g, r, m) => {
  for (let y = m.by - m.bry + 1; y <= m.by + m.bry - 1; y += 2)
    for (let x = m.bx - m.brx + 1 + (y % 4 === 0 ? 1 : 0); x <= m.bx + m.brx - 1; x += 3)
      if (SKIN_FAM.has(g.get(x, y))) g.set(x, y, C.SKIN_D);
  for (let x = m.bx - m.brx + 2; x <= m.bx + m.brx - 2; x += 2) // shoulder ruff
    g.set(x, m.by - m.bry, C.SKIN_L);
});
F('leafBody', 'body', (g, r, m) => {
  for (const s of [-1, 1]) {                               // shoulder fronds
    g.set(m.bx + s * (m.brx - 1), m.by - m.bry - 1, C.ACC2);
    g.set(m.bx + s * (m.brx - 2), m.by - m.bry - 2, C.ACC2);
    g.set(m.bx + s * m.brx, m.by - m.bry, C.ACC2);
  }
  g.line(m.bx, m.by - m.bry + 1, m.bx - 1, m.by + 2, C.ACC2, 1); // vine
  g.set(m.bx + 1, m.by, C.ACC2); g.set(m.bx - 2, m.by + 1, C.ACC2);
});
F('rockBody', 'body', (g, r, m) => {
  g.line(m.bx - 3, m.by - 2, m.bx - 1, m.by + 1, C.XDARK, 1); // cracks
  g.line(m.bx + 2, m.by - 1, m.bx + 3, m.by + 2, C.XDARK, 1);
  g.set(m.bx - m.brx + 2, m.by - m.bry + 1, C.SKIN_D);
  g.set(m.bx + m.brx - 2, m.by, C.SKIN_D);
  g.set(m.hx - 2, m.headTop + 1, C.SKIN_D);                // brow chip
});
F('iceBody', 'body', (g, r, m) => {
  for (const s of [-1, 1]) {                               // shoulder icicles
    g.line(m.bx + s * (m.brx - 1), m.by - m.bry, m.bx + s * (m.brx - 1), m.by - m.bry - 2, C.WHITE, 1);
    g.set(m.bx + s * (m.brx - 1), m.by - m.bry - 3, C.GLOW);
    g.set(m.bx + s * (m.brx - 3), m.by - m.bry - 1, C.WHITE);
  }
  g.set(m.bx - 1, m.by, C.WHITE); g.set(m.bx + 2, m.by - 2, C.WHITE); // facets
}, true);
F('lavaCracks', 'body', (g, r, m) => {
  g.line(m.bx - 2, m.by - 2, m.bx, m.by + 1, C.GLOW, 1);
  g.line(m.bx + 1, m.by - 1, m.bx + 3, m.by + 1, C.ACC, 1);
  g.set(m.bx - m.brx + 2, m.by, C.ACC);
  g.set(m.hx + 2, m.headTop + 2, C.ACC);
});
F('muscles', 'body', (g, r, m) => {
  g.line(m.bx - 3, m.by - m.bry + 2, m.bx + 3, m.by - m.bry + 2, C.SKIN_D, 1); // pec line
  g.set(m.bx, m.by - m.bry + 3, C.SKIN_D);
  for (let i = 0; i < 2; i++) {                            // abs
    g.set(m.bx - 1, m.by + i * 2 - 1, C.SKIN_D); g.set(m.bx + 1, m.by + i * 2 - 1, C.SKIN_D);
  }
  g.line(m.bx - m.brx + 1, m.shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.SKIN, 3); // beefy arms
  g.line(m.bx + m.brx - 3, m.shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.SKIN, 3);
});
F('webSuit', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  g.line(m.bx, m.by - m.bry, m.bx, m.by + 2, C.XDARK, 1);
  g.line(m.bx - 4, m.by - 1, m.bx + 4, m.by - 1, C.XDARK, 1);
  g.line(m.bx - 3, m.by - m.bry + 1, m.bx + 3, m.by + 1, C.XDARK, 1);
  g.line(m.bx + 3, m.by - m.bry + 1, m.bx - 3, m.by + 1, C.XDARK, 1);
});
F('yinyang', 'body', (g, r, m) => {
  g.disc(m.bx, m.by, 2.6, 2.6, C.WHITE);
  for (let y = -3; y <= 3; y++) for (let x = 1; x <= 3; x++)
    if (g.get(m.bx + x, m.by + y) === C.WHITE) g.set(m.bx + x, m.by + y, C.DARK);
  g.set(m.bx, m.by - 1, C.DARK); g.set(m.bx + 1, m.by + 1, C.WHITE);
});
F('cross', 'body', (g, r, m) => {
  g.rect(m.bx, m.by - 2, 1, 5, C.RED);
  g.rect(m.bx - 2, m.by, 5, 1, C.RED);
});
F('gem', 'body', (g, r, m) => {
  g.set(m.bx, m.by - 2, C.GREY); g.set(m.bx - 1, m.by - 1, C.GREY); g.set(m.bx + 1, m.by - 1, C.GREY);
  g.disc(m.bx, m.by - 1, 1.2, 1.2, C.GLOW);
  g.set(m.bx, m.by - 1, C.ACC_L);
});
F('bricks', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  for (let y = m.by - m.bry + 1; y <= m.by + m.bry; y += 2) {
    for (let x = m.bx - m.brx; x <= m.bx + m.brx; x++) if (g.get(x, y) === C.CLOTH) g.set(x, y, C.CLOTH_D);
    for (let x = m.bx - m.brx + ((y / 2) % 2 ? 1 : 3); x <= m.bx + m.brx; x += 4)
      if (g.get(x, y - 1) === C.CLOTH) g.set(x, y - 1, C.CLOTH_D);
  }
});
F('paperFolds', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE);
  g.line(m.bx - m.brx + 1, m.by + 2, m.bx, m.by - m.bry + 1, C.GREY, 1);
  g.line(m.bx, m.by - m.bry + 1, m.bx + m.brx - 1, m.by + 1, C.GREY, 1);
  g.line(m.bx - 2, m.by + m.bry - 1, m.bx + 3, m.by, C.GREY, 1);
});
F('drips', 'body', (g, r, m) => {
  for (const [dx, len] of [[-m.brx + 1, 2], [-2, 3], [3, 2], [m.brx - 1, 3]]) {
    g.line(m.bx + dx, m.by + m.bry, m.bx + dx, m.by + m.bry + len, C.SKIN, 1);
    g.set(m.bx + dx, m.by + m.bry + len + 1, C.SKIN_D);
  }
  g.set(m.bx - m.brx - 2, 30, C.SKIN_D); g.set(m.bx + m.brx + 2, 30, C.SKIN_D); // puddle
});
F('split', 'body', (g, r, m) => {
  for (let y = 0; y < N; y++) for (let x = m.bx + 1; x < N; x++) {
    const v = g.get(x, y);
    if (SKIN_FAM.has(v) || v === C.SNOUT) g.set(x, y, C.DARK); // hard shadow half
  }
});
F('mawashi', 'body', (g, r, m) => {
  g.rect(m.bx - m.brx + 1, m.by + 2, m.brx * 2 - 1, 2, C.DARK);
  g.rect(m.bx - 1, m.by + 2, 3, Math.round(m.bry) + 1, C.DARK); // front flap
});
F('scales', 'body', (g, r, m) => {
  for (let y = m.by - m.bry + 2; y <= m.by + 2; y += 2)
    for (let x = m.bx - m.brx + 2 + (y % 4 === 0 ? 1 : 0); x <= m.bx + m.brx - 2; x += 3)
      if (SKIN_FAM.has(g.get(x, y))) g.set(x, y, C.ACC);
  g.disc(m.bx - 2, m.by, 1.4, 1.2, C.WHITE);               // koi patch
});
F('extraEyes', 'body', (g, r, m) => {
  g.eye(m.hx - 1, m.headTop + 1); g.eye(m.hx + 2, m.headTop + 1);
});
F('shoulderSpikes', 'body', (g, r, m, o) => {
  const col = o.green ? C.ACC2 : C.ACC;
  for (const s of [-1, 1]) {
    const x = m.bx + s * (m.brx - 1);
    g.line(x, m.by - m.bry, x + s, m.by - m.bry - 2, col, 1);
    g.set(x - s * 2, m.by - m.bry - 1, col);
  }
}, true);
F('labCoat', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE);
  g.rect(m.bx - 1, m.by - m.bry, 3, m.bry * 2, C.CLOTH);   // shirt gap
  g.line(m.bx - 3, m.by - m.bry, m.bx - 2, m.by + 1, C.GREY, 1); // lapels
  g.line(m.bx + 3, m.by - m.bry, m.bx + 2, m.by + 1, C.GREY, 1);
});
F('chestPattern', 'body', (g, r, m) => {
  const kind = pick(r, ['diamond', 'star', 'stripe', 'dots', 'crescent', 'zigzag']);
  const cx = m.bx, cy = m.by;
  if (kind === 'diamond') { g.set(cx, cy - 1, C.ACC); g.set(cx - 1, cy, C.ACC); g.set(cx + 1, cy, C.ACC); g.set(cx, cy + 1, C.ACC); }
  else if (kind === 'star') { g.set(cx, cy - 1, C.ACC); g.set(cx, cy + 1, C.ACC); g.set(cx - 1, cy, C.ACC); g.set(cx + 1, cy, C.ACC); g.set(cx, cy, C.ACC_L); }
  else if (kind === 'stripe') g.rect(cx - 2, cy, 5, 1, C.ACC);
  else if (kind === 'dots') { g.set(cx - 2, cy, C.ACC); g.set(cx, cy - 1, C.ACC); g.set(cx + 2, cy, C.ACC); }
  else if (kind === 'crescent') { g.set(cx - 1, cy - 1, C.ACC); g.set(cx - 2, cy, C.ACC); g.set(cx - 1, cy + 1, C.ACC); }
  else { g.set(cx - 2, cy, C.ACC); g.set(cx - 1, cy - 1, C.ACC); g.set(cx, cy, C.ACC); g.set(cx + 1, cy - 1, C.ACC); g.set(cx + 2, cy, C.ACC); }
});

// ============================ HEAD ============================
F('hornHelm', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY);
  g.set(m.hx, m.headTop - 2, C.GREY_D);
  for (const s of [-1, 1]) {
    const x = m.hx + s * (m.hw - 1);
    g.line(x, m.headTop - 1, x + s * 2, m.headTop - 3, C.WHITE, 1);
    g.set(x + s * 2, m.headTop - 4, C.WHITE);
  }
}, true);
F('wingHelm', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY);
  for (const s of [-1, 1]) {
    const x = m.hx + s * m.hw;
    g.line(x, m.headTop, x + s * 2, m.headTop - 3, C.WHITE, 1);
    g.set(x + s, m.headTop - 1, C.WHITE);
  }
}, true);
F('toque', 'head', (g, r, m) => {
  g.rect(m.hx - 3, m.headTop - 4, 7, 4, C.WHITE);
  g.disc(m.hx - 2, m.headTop - 4, 1.4, 1.2, C.WHITE);
  g.disc(m.hx + 2, m.headTop - 4, 1.4, 1.2, C.WHITE);
  g.rect(m.hx - 3, m.headTop, 7, 1, C.GREY);
}, true);
F('crown', 'head', (g, r, m) => {
  g.rect(m.hx - 3, m.headTop - 1, 7, 2, C.GOLD);
  g.set(m.hx - 3, m.headTop - 2, C.GOLD); g.set(m.hx, m.headTop - 2, C.GOLD); g.set(m.hx + 3, m.headTop - 2, C.GOLD);
  g.set(m.hx, m.headTop - 1, C.ACC);
}, true);
F('wizardHat', 'head', (g, r, m) => {
  for (let i = 0; i < 4; i++) g.rect(m.hx - 1 - i, m.headTop - 4 + i, 3 + i * 2 - (i === 0 ? 1 : 0), 1, C.CLOTH);
  g.rect(m.hx - m.hw - 1, m.headTop, m.hw * 2 + 3, 1, C.CLOTH); // brim
  g.rect(m.hx - 2, m.headTop - 1, 5, 1, C.ACC);            // band
  g.set(m.hx, m.headTop - 5, C.GLOW);                      // tip star
}, true);
F('hoodMask', 'head', (g, r, m) => {
  // full ninja cowl: cover head + snout, leave the eye row
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      if (y === m.eyeY && x >= m.hx - m.eyeDX - 1 && x <= m.hx + m.eyeDX + 1) continue;
      const v = g.get(x, y);
      if (v && v !== C.OUT) g.set(x, y, C.DARK);
    }
  g.set(m.hx + m.hw + 1, m.headTop + 2, C.DARK);           // knot tail
  g.set(m.hx + m.hw + 2, m.headTop + 3, C.DARK);
});
F('kabuto', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY_D);
  g.set(m.hx - m.hw, m.headTop + 1, C.GREY_D); g.set(m.hx + m.hw, m.headTop + 1, C.GREY_D); // flared flaps
  g.set(m.hx - m.hw, m.headTop + 2, C.GREY_D); g.set(m.hx + m.hw, m.headTop + 2, C.GREY_D);
  for (const s of [-1, 1]) g.line(m.hx + s, m.headTop - 2, m.hx + s * 3, m.headTop - 4, C.GOLD, 1); // crest V
}, true);
F('halo', 'head', (g, r, m) => {
  g.rect(m.hx - 2, m.headTop - 4, 5, 1, C.GOLD);
  g.set(m.hx - 3, m.headTop - 3, C.GOLD); g.set(m.hx + 3, m.headTop - 3, C.GOLD);
}, true);
F('cowboyHat', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw - 1, m.headTop, m.hw * 2 + 3, 1, C.WOOD);
  g.set(m.hx - m.hw - 1, m.headTop - 1, C.WOOD); g.set(m.hx + m.hw + 1, m.headTop - 1, C.WOOD); // upturned brim
  g.rect(m.hx - 3, m.headTop - 3, 7, 3, C.WOOD);
  g.rect(m.hx - 3, m.headTop - 1, 7, 1, C.GOLD_D);         // band
  g.set(m.hx, m.headTop - 3, C.GOLD_D);                    // crease
}, true);
F('nightcap', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.CLOTH);
  g.line(m.hx + 1, m.headTop - 2, m.hx + m.hw + 2, m.headTop - 1, C.CLOTH, 2);
  g.disc(m.hx + m.hw + 3, m.headTop, 1.2, 1.2, C.WHITE);   // pompom
  g.rect(m.hx - m.hw + 1, m.headTop, m.hw * 2 - 1, 1, C.WHITE); // trim
}, true);
F('santaHat', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 1, C.WHITE);
  g.rect(m.hx - m.hw + 2, m.headTop - 3, m.hw * 2 - 3, 2, C.RED);
  g.line(m.hx + 1, m.headTop - 3, m.hx + m.hw + 1, m.headTop - 2, C.RED, 2);
  g.disc(m.hx + m.hw + 2, m.headTop - 1, 1.2, 1.2, C.WHITE);
}, true);
F('galea', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY);
  g.set(m.hx - m.hw + 1, m.headTop + 1, C.GREY); g.set(m.hx + m.hw - 1, m.headTop + 1, C.GREY); // cheek guards
  g.rect(m.hx - 1, m.headTop - 3, 3, 2, C.ACC);            // crest brush
  g.rect(m.hx - 2, m.headTop - 2, 5, 1, C.ACC);
}, true);
F('gladHelm', 'head', (g, r, m) => {
  for (let y = m.headTop - 1; y <= m.eyeY - 1; y++)
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.GOLD);
    }
  g.rect(m.hx - m.hw, m.eyeY - 1, 1, 3, C.GOLD); g.rect(m.hx + m.hw, m.eyeY - 1, 1, 3, C.GOLD);
  g.set(m.hx, m.eyeY, C.GOLD);                             // nose bar between the eyes
  g.line(m.hx - 2, m.headTop - 2, m.hx + 2, m.headTop - 2, C.GOLD_D, 1); // crest arc
}, true);
F('knightHelm', 'head', (g, r, m) => {
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh) - 1; y++)
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      if (y === m.eyeY && x >= m.hx - m.eyeDX - 1 && x <= m.hx + m.eyeDX + 1) continue;
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.GREY);
    }
  for (let x = m.hx - m.eyeDX - 1; x <= m.hx + m.eyeDX + 1; x++)
    if (g.get(x, m.eyeY) && g.get(x, m.eyeY) !== C.OUT && g.get(x, m.eyeY) !== C.EYE) g.set(x, m.eyeY, C.XDARK);
  g.clearDotsRect(m.hx - m.hw, m.eyeY, m.hx + m.hw, m.eyeY);
  g.set(m.hx - m.eyeDX, m.eyeY, C.GLOW); g.set(m.hx + m.eyeDX, m.eyeY, C.GLOW); // visor glow
  g.set(m.hx, m.headTop - 2, C.GREY_D);                    // ridge
}, true);
F('hood', 'head', (g, r, m) => {
  for (let y = m.headTop - 2; y <= m.hy + 1; y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const inFace = y >= m.eyeY - 1 && x >= m.hx - m.hw + 1 && x <= m.hx + m.hw - 1;
      const v = g.get(x, y);
      if (!inFace && ((v && v !== C.OUT) || y <= m.headTop)) g.set(x, y, C.CLOTH_D);
    }
  g.rect(m.bx - 3, m.by - m.bry, 7, 1, C.CLOTH_D);         // drape on shoulders
});
F('mohawk', 'head', (g, r, m) => {
  // smooth fin crest sitting ON the scalp — tallest at center (a crown's
  // alternating spikes are exactly what this must NOT look like)
  const hts = [2, 3, 4, 3, 2];
  for (let i = -2; i <= 2; i++)
    g.rect(m.hx + i, m.headTop - hts[i + 2], 1, hts[i + 2] + 1, C.ACC);
}, true);
F('spaceHelm', 'head', (g, r, m) => {
  const rx = m.hw + 1.6, ry = m.hh + 1.6;
  for (let t = 0; t < 72; t++) {
    const th = (t / 72) * Math.PI * 2;
    g.set(m.hx + Math.round(Math.cos(th) * rx), m.hy + Math.round(Math.sin(th) * ry), C.WHITE);
  }
  g.set(m.hx - m.hw, m.headTop - 1, C.GLOW);               // glass shine
}, true);
F('laurel', 'head', (g, r, m) => {
  for (const s of [-1, 1]) {                               // imperial gold wreath
    g.set(m.hx + s * 2, m.headTop - 1, C.GOLD);
    g.set(m.hx + s * 3, m.headTop, C.GOLD);
    g.set(m.hx + s * (m.hw - 1), m.headTop + 1, C.GOLD_D);
  }
}, true);
F('strawHat', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw - 2, m.headTop, m.hw * 2 + 5, 1, C.GOLD);
  g.rect(m.hx - 3, m.headTop - 2, 7, 2, C.GOLD);
  g.rect(m.hx - 3, m.headTop - 1, 7, 1, C.GOLD_D);
}, true);
F('minerHelm', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.GOLD);
  g.set(m.hx, m.headTop - 2, C.GLOW);                      // lamp
  g.set(m.hx, m.headTop - 1, C.GREY);
}, true);
F('beanie', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.CLOTH);
  g.rect(m.hx - m.hw + 1, m.headTop, m.hw * 2 - 1, 1, C.CLOTH_D);
  g.set(m.hx, m.headTop - 3, C.ACC);                       // pom
}, true);
F('headphones', 'head', (g, r, m) => {
  g.line(m.hx - m.hw, m.headTop - 1, m.hx + m.hw, m.headTop - 1, C.GREY, 1);
  g.disc(m.hx - m.hw, m.hy - 1, 1.2, 1.6, C.ACC);
  g.disc(m.hx + m.hw, m.hy - 1, 1.2, 1.6, C.ACC);
}, true);
F('topknot', 'head', (g, r, m) => {
  g.disc(m.hx, m.headTop - 2, 1.3, 1.1, C.DARK);
  g.rect(m.hx - 1, m.headTop - 1, 3, 1, C.DARK);
}, true);
F('bunHair', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.DARK);
  g.disc(m.hx + 2, m.headTop - 2, 1.4, 1.1, C.DARK);
  g.line(m.hx + 3, m.headTop - 3, m.hx + 5, m.headTop - 4, C.GOLD, 1); // kanzashi pin
}, true);
F('mikoBow', 'head', (g, r, m) => {
  const x = m.hx + m.hw, y = m.headTop;
  g.set(x, y, C.RED); g.set(x + 1, y - 1, C.RED); g.set(x + 1, y + 1, C.RED);
  g.set(x + 2, y - 1, C.RED); g.set(x + 2, y + 1, C.RED);
}, true);
F('flower', 'head', (g, r, m) => {
  const x = m.hx + m.hw - 1, y = m.headTop - 2;
  g.set(x, y - 1, C.ACC2); g.set(x - 1, y, C.ACC2); g.set(x + 1, y, C.ACC2); g.set(x, y + 1, C.ACC2);
  g.set(x, y, C.GLOW);
}, true);
F('clownWig', 'head', (g, r, m) => {
  g.disc(m.hx - m.hw, m.headTop + 1, 1.8, 1.8, C.ACC);
  g.disc(m.hx + m.hw, m.headTop + 1, 1.8, 1.8, C.ACC);
  g.disc(m.hx, m.headTop - 1, 2, 1.2, C.ACC);
}, true);
F('devilHorns', 'head', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.hx + s * (m.hw - 2);
    g.line(x, m.headTop - 1, x + s, m.headTop - 3, C.RED, 1);
    g.set(x + s * 2, m.headTop - 4, C.RED);
  }
}, true);
F('batEars', 'head', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.hx + s * (m.hw - 2);
    g.rect(x, m.headTop - 3, 1, 3, C.SKIN);
    g.set(x + s, m.headTop - 2, C.SKIN); g.set(x, m.headTop - 4, C.SKIN_D);
  }
}, true);
F('pelt', 'head', (g, r, m) => {
  // beast-head hood with snarling muzzle + drape down the back
  g.rect(m.hx - m.hw, m.headTop - 2, m.hw * 2 + 1, 2, C.CLOTH_D);
  g.rect(m.hx - 3, m.headTop - 3, 7, 1, C.CLOTH_D);
  g.set(m.hx - m.hw + 1, m.headTop - 3, C.CLOTH_D); g.set(m.hx + m.hw - 1, m.headTop - 3, C.CLOTH_D); // pelt ears
  g.set(m.hx - 2, m.headTop - 2, C.WHITE); g.set(m.hx + 2, m.headTop - 2, C.WHITE); // fangs on the brow
  g.set(m.hx - 1, m.headTop - 3, C.XDARK); g.set(m.hx + 1, m.headTop - 3, C.XDARK); // pelt eyes
  g.rect(m.bx - m.brx - 1, m.shoulderY - 1, 2, 5, C.CLOTH_D); // drape
  g.rect(m.bx + m.brx, m.shoulderY - 1, 2, 5, C.CLOTH_D);
}, true);
F('fedora', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw - 1, m.headTop, m.hw * 2 + 3, 1, C.DARK);
  g.rect(m.hx - 3, m.headTop - 2, 7, 2, C.DARK);
  g.rect(m.hx - 3, m.headTop - 1, 7, 1, C.GREY_D);         // band
}, true);
F('kasa', 'head', (g, r, m) => {
  g.set(m.hx, m.headTop - 3, C.GOLD_D);
  g.rect(m.hx - 2, m.headTop - 2, 5, 1, C.GOLD);
  g.rect(m.hx - m.hw - 1, m.headTop - 1, m.hw * 2 + 3, 1, C.GOLD);
}, true);
F('emoFringe', 'head', (g, r, m, o) => {
  const col = o.acc ? C.ACC : C.DARK;
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 1, col);
  for (let y = m.headTop; y <= m.eyeY; y++)                // swoop over the left eye
    g.rect(m.hx - m.hw, y, m.eyeDX + (m.headTop + 1 - y) + 2, 1, col);
  g.clearDotsRect(m.hx - m.hw, m.eyeY, m.hx - m.eyeDX + 1, m.eyeY);
}, true);
F('pompadour', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 2, C.GOLD);
  g.rect(m.hx - m.hw - 1, m.headTop - 2, 2, 1, C.GOLD);    // forward swoosh
  g.set(m.hx - m.hw - 2, m.headTop - 1, C.GOLD);
}, true);
F('melonHelm', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.ACC2);
  for (let x = m.hx - m.hw + 2; x <= m.hx + m.hw - 2; x += 2)
    g.rect(x, m.headTop - 2, 1, 3, C.CLOTH_D);             // rind stripes
}, true);
F('lighthouseHat', 'head', (g, r, m) => {
  g.rect(m.hx - 2, m.headTop - 4, 5, 4, C.WHITE);
  g.rect(m.hx - 2, m.headTop - 2, 5, 1, C.RED);
  g.rect(m.hx - 1, m.headTop - 5, 3, 1, C.RED);            // roof
  g.set(m.hx, m.headTop - 4, C.GLOW);                      // lamp
  g.set(m.hx - 3, m.headTop - 4, C.GLOW); g.set(m.hx + 3, m.headTop - 4, C.GLOW); // beam hints
}, true);
F('turban', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.CLOTH);
  g.line(m.hx - m.hw + 1, m.headTop, m.hx + m.hw - 1, m.headTop - 1, C.CLOTH_L, 1);
  g.set(m.hx, m.headTop - 1, C.ACC);                       // jewel
}, true);
F('pikaEars', 'head', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.hx + s * (m.hw - 1);
    g.rect(x, m.headTop - 3, 1, 3, C.SKIN);
    g.set(x + s, m.headTop - 4, C.SKIN);
    g.set(x + s, m.headTop - 5, C.DARK); g.set(x, m.headTop - 4, C.DARK); // black tips
  }
}, true);
F('leafHead', 'head', (g, r, m) => {
  g.set(m.hx, m.headTop - 1, C.ACC2);
  g.set(m.hx + 1, m.headTop - 2, C.ACC2); g.set(m.hx + 2, m.headTop - 2, C.ACC2);
  g.set(m.hx + 1, m.headTop - 3, C.ACC2);
}, true);
F('headband', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw, m.headTop + 1, m.hw * 2 + 1, 1, C.RED);
  g.set(m.hx + m.hw + 1, m.headTop + 2, C.RED); g.set(m.hx + m.hw + 2, m.headTop + 3, C.RED); // knot tails
});
F('goggles', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw, m.headTop, m.hw * 2 + 1, 1, C.GREY_D);
  g.rect(m.hx - 3, m.headTop - 1, 2, 2, C.GLOW); g.rect(m.hx + 2, m.headTop - 1, 2, 2, C.GLOW);
  g.set(m.hx - 1, m.headTop, C.GREY_D); g.set(m.hx, m.headTop, C.GREY_D); g.set(m.hx + 1, m.headTop, C.GREY_D);
}, true);

// ============================ FACE ============================
F('glasses', 'face', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.hx + s * m.eyeDX;
    g.set(x - 1, m.eyeY, C.GREY); g.set(x + 1, m.eyeY, C.GREY);
    g.set(x, m.eyeY - 1, C.GREY);
  }
  g.set(m.hx, m.eyeY, C.GREY);                             // bridge
});
F('sunglasses', 'face', (g, r, m) => {
  g.rect(m.hx - m.eyeDX - 1, m.eyeY, m.eyeDX * 2 + 3, 1, C.DARK);
  g.set(m.hx - m.eyeDX, m.eyeY + 1, C.DARK); g.set(m.hx + m.eyeDX, m.eyeY + 1, C.DARK);
  g.clearDotsRect(m.hx - m.eyeDX - 1, m.eyeY, m.hx + m.eyeDX + 1, m.eyeY + 1);
});
F('visor', 'face', (g, r, m, o) => {
  // cyberpunk visor: one SOLID dark horizontal band wrapping the whole
  // face across the eye rows, with a bright glow strip inside it
  const col = o.red ? C.RED : C.GLOW;
  g.rect(m.hx - m.hw, m.eyeY - 1, m.hw * 2 + 1, 2, C.DARK);
  g.rect(m.hx - m.eyeDX - 1, m.eyeY, m.eyeDX * 2 + 3, 1, col);
  g.clearDotsRect(m.hx - m.hw, m.eyeY - 1, m.hx + m.hw, m.eyeY);
});
F('eyepatch', 'face', (g, r, m) => {
  g.set(m.hx + m.eyeDX, m.eyeY, C.DARK);
  g.line(m.hx + m.eyeDX - 2, m.eyeY - 2, m.hx + m.eyeDX + 2, m.eyeY - 1, C.DARK, 1);
  g.clearDotsRect(m.hx + m.eyeDX, m.eyeY, m.hx + m.eyeDX, m.eyeY);
});
F('beard', 'face', (g, r, m, o) => {
  const col = o.white ? C.WHITE : C.WOOD;                  // brown default — CLOTH_D vanished on dark outfits
  const y0 = m.snoutY + 1;
  g.rect(m.hx - 3, y0, 7, 2, col);
  g.rect(m.hx - 2, y0 + 2, 5, 1, col);
  if (o.white) g.rect(m.hx - 1, y0 + 3, 3, 1, col);
  g.set(m.hx - 3, m.snoutY, col); g.set(m.hx + 3, m.snoutY, col); // mustache flanks
});
F('maskMuzzle', 'face', (g, r, m) => {
  g.rect(m.hx - 3, m.snoutY - 1, 7, 3, C.GREY);
  for (let x = m.hx - 2; x <= m.hx + 2; x += 2) g.rect(x, m.snoutY - 1, 1, 3, C.GREY_D); // slits
  g.set(m.hx - 4, m.eyeY + 1, C.GREY_D); g.set(m.hx + 4, m.eyeY + 1, C.GREY_D); // straps
});
F('clownNose', 'face', (g, r, m) => {
  g.disc(m.hx, m.snoutY, 1.3, 1.1, C.RED);
});
F('facePaint', 'face', (g, r, m, o) => {
  if (o.kabuki) {
    g.set(m.hx - m.eyeDX - 1, m.eyeY - 1, C.RED); g.set(m.hx + m.eyeDX + 1, m.eyeY - 1, C.RED);
    g.set(m.hx - m.eyeDX, m.eyeY - 2, C.RED); g.set(m.hx + m.eyeDX, m.eyeY - 2, C.RED);
    g.set(m.hx - m.eyeDX - 1, m.eyeY + 1, C.RED); g.set(m.hx + m.eyeDX + 1, m.eyeY + 1, C.RED);
  } else {                                                 // war stripes under one eye
    g.set(m.hx - m.eyeDX - 1, m.eyeY + 1, C.ACC); g.set(m.hx - m.eyeDX, m.eyeY + 1, C.ACC);
    g.set(m.hx + m.eyeDX, m.eyeY + 1, C.ACC); g.set(m.hx + m.eyeDX + 1, m.eyeY + 1, C.ACC);
  }
});
F('thirdEye', 'face', (g, r, m) => {
  g.eye(m.hx, m.eyeY - 2);
});
F('monocle', 'face', (g, r, m) => {
  g.set(m.hx + m.eyeDX - 1, m.eyeY, C.GOLD); g.set(m.hx + m.eyeDX + 1, m.eyeY, C.GOLD);
  g.set(m.hx + m.eyeDX, m.eyeY - 1, C.GOLD); g.set(m.hx + m.eyeDX, m.eyeY + 1, C.GOLD);
  g.set(m.hx + m.eyeDX + 1, m.eyeY + 2, C.GOLD);           // chain
});
F('snoutRing', 'face', (g, r, m) => {
  g.set(m.hx, m.snoutY + 1, C.GOLD); g.set(m.hx, m.snoutY + 2, C.GOLD);
});
F('tusks', 'face', (g, r, m) => {
  for (const s of [-1, 1]) {
    g.set(m.hx + s * 3, m.snoutY + 1, C.WHITE);
    g.set(m.hx + s * 4, m.snoutY, C.WHITE);
    g.set(m.hx + s * 4, m.snoutY - 1, C.WHITE);
  }
});
F('fangs', 'face', (g, r, m) => {
  g.set(m.hx - 2, m.snoutY + 1, C.WHITE); g.set(m.hx + 2, m.snoutY + 1, C.WHITE);
});
F('closedEyes', 'face', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.hx + s * m.eyeDX;
    g.set(x, m.eyeY, C.SKIN); g.set(x - 1, m.eyeY, C.SKIN); g.set(x + 1, m.eyeY, C.SKIN);
    g.set(x - 1, m.eyeY, C.XDARK); g.set(x, m.eyeY, C.XDARK); g.set(x + 1, m.eyeY, C.XDARK);
  }
  g.clearDotsRect(m.hx - m.hw, m.eyeY, m.hx + m.hw, m.eyeY);
});
F('stitches', 'face', (g, r, m) => {
  g.line(m.hx - m.hw + 1, m.headTop + 1, m.hx - m.hw + 3, m.headTop + 1, C.XDARK, 1);
  g.set(m.hx - m.hw + 2, m.headTop, C.XDARK); g.set(m.hx - m.hw + 2, m.headTop + 2, C.XDARK);
  g.line(m.bx + 1, m.by - 2, m.bx + 3, m.by - 2, C.XDARK, 1);
  g.set(m.bx + 2, m.by - 3, C.XDARK); g.set(m.bx + 2, m.by - 1, C.XDARK);
});
F('bandaid', 'face', (g, r, m) => {
  g.rect(m.hx + m.eyeDX, m.eyeY - 2, 2, 1, C.GOLD);
});
F('tears', 'face', (g, r, m) => {
  g.set(m.hx - m.eyeDX, m.eyeY + 1, C.GLOW); g.set(m.hx + m.eyeDX, m.eyeY + 2, C.GLOW);
});
F('cheekDots', 'face', (g, r, m) => {
  g.set(m.hx - m.eyeDX - 1, m.eyeY + 1, C.RED); g.set(m.hx + m.eyeDX + 1, m.eyeY + 1, C.RED);
});
F('spideyEyes', 'face', (g, r, m) => {
  // full mask + big teardrop lenses
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.CLOTH);
    }
  g.clearDotsRect(m.hx - m.hw, m.headTop, m.hx + m.hw, m.hy + m.hh);
  for (const s of [-1, 1]) {
    g.set(m.hx + s * 2, m.eyeY, C.WHITE); g.set(m.hx + s * 3, m.eyeY, C.WHITE);
    g.set(m.hx + s * 3, m.eyeY - 1, C.WHITE);
  }
  g.line(m.hx, m.headTop, m.hx, m.headTop + 2, C.XDARK, 1); // web hint
});
F('luchaMask', 'face', (g, r, m) => {
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      if (y === m.eyeY && Math.abs(x - m.hx) >= m.eyeDX - 1 && Math.abs(x - m.hx) <= m.eyeDX + 1) continue;
      if (y >= m.snoutY - 1 && Math.abs(x - m.hx) <= 2) continue; // snout window
      const v = g.get(x, y); if (v && v !== C.OUT && v !== C.SNOUT) g.set(x, y, C.ACC);
    }
  g.set(m.hx, m.headTop - 1, C.ACC_L);                     // crest seam
});
F('scarf', 'face', (g, r, m) => {
  const y = Math.round(m.hy + m.hh) - 1;
  g.rect(m.hx - m.hw + 1, y, m.hw * 2 - 1, 2, C.ACC);
  g.line(m.hx - m.hw, y + 1, m.hx - m.hw - 3, y + 4, C.ACC, 2); // flying tail
  g.set(m.hx - m.hw - 4, y + 5, C.ACC_L);
});
F('towelNeck', 'face', (g, r, m) => {
  const y = Math.round(m.hy + m.hh) - 1;
  g.rect(m.bx - m.brx + 1, y, 3, 4, C.WHITE);
  g.rect(m.bx + m.brx - 3, y, 3, 4, C.WHITE);
  g.rect(m.bx - 2, y, 5, 1, C.WHITE);
});
F('bandana', 'face', (g, r, m) => {
  const y = Math.round(m.hy + m.hh) - 1;
  g.rect(m.hx - 3, y, 7, 1, C.RED);
  g.set(m.hx - 1, y + 1, C.RED); g.set(m.hx, y + 1, C.RED); g.set(m.hx + 1, y + 1, C.RED);
  g.set(m.hx, y + 2, C.RED);
});

// ============================ HELD ============================
F('axe', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp - 1, hyp - 9, C.WOOD, 1);
  g.rect(hxp - 4, hyp - 10, 3, 3, C.GREY);                 // head
  g.rect(hxp - 5, hyp - 10, 1, 3, C.WHITE);                // edge
  g.set(hxp - 1, hyp - 10, C.GREY_D);
}, true);
F('sword', 'held', (g, r, m, o) => {
  const [hxp, hyp] = m.handR;
  const top = o.big ? hyp - 13 : hyp - 10;
  g.line(hxp + 1, hyp - 2, hxp + 1, top, C.GREY, o.big ? 2 : 1);
  g.set(hxp + 1, top - 1, C.WHITE);
  g.line(hxp + 1, top + 2, hxp + 1, top + 5, C.WHITE, 1);  // edge shine
  g.rect(hxp - 1, hyp - 2, o.big ? 5 : 4, 1, C.GOLD);      // crossguard
  g.set(hxp + 1, hyp - 1, C.WOOD);
}, true);
F('katana', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handR;
  g.line(hxp, hyp - 1, hxp + 6, hyp - 9, C.GREY, 1);
  g.line(hxp + 1, hyp - 3, hxp + 5, hyp - 8, C.WHITE, 1);
  g.set(hxp, hyp - 2, C.GOLD);                             // tsuba
  g.set(hxp - 1, hyp, C.WOOD);
}, true);
F('saber', 'held', (g, r, m, o) => {
  const [hxp, hyp] = m.handR;
  const col = o.red ? C.RED : C.ACC;
  g.rect(hxp, hyp - 2, 2, 2, C.GREY);                      // hilt
  g.line(hxp, hyp - 3, hxp, hyp - 11, col, 2);
  g.line(hxp + 1, hyp - 4, hxp + 1, hyp - 10, C.WHITE, 1); // hot core
  g.set(hxp + 1, hyp - 12, col); g.set(hxp, hyp - 12, col);
}, true);
F('pan', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp + 1, hyp, hxp - 2, hyp - 2, C.WOOD, 1);
  g.disc(hxp - 4, hyp - 4, 2.4, 2.2, C.GREY);
  g.disc(hxp - 4, hyp - 4, 1.2, 1, C.GREY_D);
});
F('staffOrb', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp + 5 > 29 ? 29 : hyp + 5, hxp, m.headTop - 1, C.WOOD, 1);
  g.disc(hxp, m.headTop - 3, 1.5, 1.5, C.ACC);
  g.set(hxp, m.headTop - 3, C.GLOW);
}, true);
F('walkingStick', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, 29, hxp, m.eyeY - 2, C.WOOD, 1);
  g.set(hxp, m.eyeY - 3, C.WOOD); g.set(hxp + 1, m.eyeY - 3, C.WOOD); // knob
}, true);
F('hammer', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp - 1, hyp - 8, C.WOOD, 1);
  g.rect(hxp - 4, hyp - 11, 6, 3, C.GREY);
  g.rect(hxp - 4, hyp - 11, 6, 1, C.GREY_D);
}, true);
F('book', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.rect(hxp - 3, hyp - 4, 5, 4, C.ACC);
  g.rect(hxp - 2, hyp - 3, 3, 2, C.WHITE);                 // pages
  g.set(hxp - 1, hyp - 2, C.ACC2);                         // glyph
});
F('lantern', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.set(hxp, hyp - 5, C.GREY);
  g.rect(hxp - 1, hyp - 4, 3, 3, C.GREY_D);
  g.set(hxp, hyp - 3, C.GLOW);
});
F('mic', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp + 1, hyp - 1, hxp - 1, hyp - 4, C.GREY_D, 1);
  g.disc(hxp - 2, hyp - 5, 1.3, 1.3, C.DARK);
  g.set(hxp - 2, hyp - 6, C.GREY);
  g.set(hxp - 2, hyp - 5, C.WHITE);                        // glint so it reads on dark suits
});
F('shield', 'held', (g, r, m, o) => {
  const [hxp, hyp] = m.handL;
  if (o.round) {
    g.disc(hxp - 1, hyp - 3, 3, 3.4, C.ACC);
    g.disc(hxp - 1, hyp - 3, 1.2, 1.2, C.GREY);
    for (let t = 0; t < 24; t++) {
      const th = (t / 24) * Math.PI * 2;
      g.set(hxp - 1 + Math.round(Math.cos(th) * 3), hyp - 3 + Math.round(Math.sin(th) * 3.4), C.GREY_D);
    }
  } else {
    g.rect(hxp - 3, hyp - 6, 5, 8, C.GREY);
    g.rect(hxp - 3, hyp - 6, 5, 1, C.GREY_D);               // full dark rim so the
    g.rect(hxp - 3, hyp + 1, 5, 1, C.GREY_D);               // shield doesn't merge
    g.rect(hxp - 3, hyp - 5, 1, 6, C.GREY_D);               // into grey armor
    g.rect(hxp + 1, hyp - 5, 1, 6, C.GREY_D);
    g.set(hxp - 1, hyp - 3, C.ACC);
  }
});
F('spear', 'held', (g, r, m) => {
  const [hxp] = m.handL;
  g.line(hxp, 29, hxp, m.headTop - 3, C.WOOD, 1);
  g.set(hxp, m.headTop - 4, C.GREY);
  g.set(hxp, m.headTop - 5, C.WHITE);
}, true);
F('trident', 'held', (g, r, m) => {
  const [hxp] = m.handL;
  g.line(hxp, 29, hxp, m.headTop - 2, C.WOOD, 1);
  g.rect(hxp - 2, m.headTop - 3, 5, 1, C.GOLD);
  for (const dx of [-2, 0, 2]) { g.set(hxp + dx, m.headTop - 4, C.GOLD); g.set(hxp + dx, m.headTop - 5, C.GOLD); }
}, true);
F('net', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handR;
  for (let i = 0; i < 4; i++) {
    g.set(hxp + 1 + (i % 3), hyp + 1 + i, C.GREY);
    g.set(hxp + 3 - (i % 3), hyp + 1 + i, C.GREY);
  }
  g.set(hxp + 2, hyp + 5, C.GREY_D);
});
F('guitar', 'held', (g, r, m) => {
  g.disc(m.bx + 2, m.by + 2, 2.6, 2.2, C.WOOD);
  g.disc(m.bx + 2, m.by + 2, 1, 1, C.DARK);
  g.line(m.bx, m.by, m.bx - 5, m.by - 5, C.WOOD, 2);       // neck
  g.rect(m.bx - 6, m.by - 7, 2, 2, C.DARK);                // headstock
  g.line(m.bx + 2, m.by + 1, m.bx - 4, m.by - 5, C.WHITE, 1); // strings
});
F('pickaxe', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp - 1, hyp - 8, C.WOOD, 1);
  g.line(hxp - 4, hyp - 8, hxp + 2, hyp - 10, C.GREY, 1);
  g.set(hxp - 5, hyp - 7, C.GREY); g.set(hxp + 3, hyp - 9, C.GREY);
}, true);
F('coin', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 1.6, 1.6, C.GOLD);
  g.set(hxp - 1, hyp - 4, C.GOLD_D);                       // mark
  g.dots.push([(hxp - 2) * 2 + 1, (hyp - 5) * 2, C.WHITE]); // glint
});
F('fan', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  for (let i = 0; i < 3; i++) g.line(hxp, hyp - 1, hxp - 4 + i * 2, hyp - 5, i === 1 ? C.WHITE : C.GOLD, 1);
  g.rect(hxp - 4, hyp - 6, 7, 1, C.GOLD);
});
F('balloon', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp - 2, hyp - 6, C.GREY, 1);
  g.disc(hxp - 2, hyp - 9, 2.2, 2.6, C.RED);
  g.set(hxp - 3, hyp - 10, C.WHITE);
}, true);
F('pokeball', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 1.8, 1.8, C.WHITE);
  for (let x = -3; x <= 1; x++) if (g.get(hxp - 1 + x + 1, hyp - 5)) g.set(hxp - 1 + x + 1, hyp - 5, C.RED);
  g.set(hxp - 1, hyp - 5, C.RED); g.set(hxp - 2, hyp - 5, C.RED); g.set(hxp, hyp - 5, C.RED);
  g.set(hxp - 1, hyp - 4, C.DARK);
});
F('boxGloves', 'held', (g, r, m) => {
  g.disc(m.handL[0], m.handL[1] - 1, 1.9, 1.9, C.RED);
  g.disc(m.handR[0] + 1, m.handR[1] - 1, 1.9, 1.9, C.RED);
  g.set(m.handL[0], m.handL[1] - 2, C.WHITE); g.set(m.handR[0] + 1, m.handR[1] - 2, C.WHITE);
});
F('lightningBolt', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 2, hxp - 2, hyp - 5, C.GOLD, 2);
  g.line(hxp - 2, hyp - 5, hxp, hyp - 7, C.GOLD, 2);
  g.line(hxp, hyp - 7, hxp - 2, hyp - 10, C.GOLD, 2);
  g.set(hxp - 2, hyp - 11, C.WHITE); g.set(hxp - 1, hyp - 11, C.WHITE);
  g.set(hxp - 1, hyp - 4, C.WHITE); g.set(hxp, hyp - 6, C.WHITE);
}, true);
F('torch', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp, hyp - 5, C.WOOD, 1);
  g.disc(hxp, hyp - 7, 1.4, 1.8, C.ACC);
  g.set(hxp, hyp - 7, C.GLOW);
}, true);
F('oar', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 8, hxp + 1, 29, C.WOOD, 1);
  g.rect(hxp - 1, hyp - 11, 3, 4, C.WOOD);
}, true);
F('broom', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 8, hxp, 27, C.WOOD, 1);
  for (let i = -1; i <= 1; i++) g.line(hxp, 27, hxp + i, 30, C.GOLD, 1);
}, true);
F('whip', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.set(hxp, hyp - 1, C.WOOD);
  g.line(hxp - 1, hyp - 2, hxp - 4, hyp - 6, C.CLOTH_D, 1);
  g.line(hxp - 4, hyp - 6, hxp - 6, hyp - 3, C.CLOTH_D, 1);
  g.set(hxp - 6, hyp - 2, C.ACC);
});
F('flag', 'held', (g, r, m) => {
  const [hxp] = m.handL;
  g.line(hxp, 29, hxp, m.headTop - 4, C.WOOD, 1);
  g.rect(hxp + 1, m.headTop - 4, 6, 4, C.RED);
  g.rect(hxp + 1, m.headTop - 3, 6, 1, C.WHITE);
  g.rect(hxp + 1, m.headTop - 1, 6, 1, C.WHITE);
}, true);
F('orb', 'held', (g, r, m) => {
  g.disc(m.bx, m.by + m.bry - 1, 2, 2, C.ACC);
  g.set(m.bx - 1, m.by + m.bry - 2, C.GLOW);
});
F('drumstick', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 1.8, 2.2, C.WOOD);
  g.set(hxp, hyp - 1, C.WHITE); g.set(hxp - 1, hyp - 1, C.WHITE); // bone end
  g.set(hxp - 2, hyp - 5, C.GOLD);                         // crispy shine
});
F('appleHeld', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 1.6, 1.6, C.GOLD);
  g.set(hxp - 1, hyp - 6, C.WOOD);
  g.set(hxp, hyp - 6, C.ACC2);
});
F('melonSlice', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 2.2, 1.4, C.RED);
  g.rect(hxp - 3, hyp - 3, 5, 1, C.ACC2);
  g.dots.push([(hxp - 1) * 2, (hyp - 4) * 2, C.PUPIL], [(hxp - 1) * 2 + 3, (hyp - 4) * 2 + 1, C.PUPIL]); // seeds
});
F('bellHeld', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.set(hxp, hyp - 6, C.WOOD);
  g.rect(hxp - 1, hyp - 5, 3, 2, C.GOLD);
  g.rect(hxp - 2, hyp - 3, 5, 1, C.GOLD);
  g.set(hxp, hyp - 2, C.GOLD_D);                           // clapper
});
F('dowsingRod', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp, hyp - 4, C.WOOD, 1);
  g.line(hxp, hyp - 4, hxp - 2, hyp - 7, C.WOOD, 1);
  g.line(hxp, hyp - 4, hxp + 2, hyp - 7, C.WOOD, 1);
}, true);
F('dumbbell', 'held', (g, r, m) => {
  const y = m.handL[1];
  g.line(m.handL[0], y - 1, m.handR[0] + 1, y - 1, C.GREY, 1);
  g.rect(m.handL[0] - 2, y - 3, 2, 4, C.GREY_D);
  g.rect(m.handR[0] + 2, y - 3, 2, 4, C.GREY_D);
});
F('bomb', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.disc(hxp - 1, hyp - 4, 1.9, 1.9, C.DARK);
  g.set(hxp - 2, hyp - 5, C.GREY);
  g.set(hxp - 1, hyp - 6, C.WOOD);                         // fuse
  g.set(hxp, hyp - 7, C.GLOW);                             // spark
}, true);
F('magnet', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.rect(hxp - 3, hyp - 7, 2, 4, C.RED); g.rect(hxp, hyp - 7, 2, 4, C.RED);
  g.rect(hxp - 3, hyp - 8, 5, 2, C.RED);
  g.set(hxp - 3, hyp - 3, C.WHITE); g.set(hxp - 2, hyp - 3, C.WHITE);
  g.set(hxp, hyp - 3, C.WHITE); g.set(hxp + 1, hyp - 3, C.WHITE);
}, true);
F('gauntlet', 'held', (g, r, m) => {
  g.disc(m.handL[0], m.handL[1] - 1, 2.1, 2.1, C.GOLD);
  for (const [dx, dy, c] of [[-1, -2, C.ACC], [0, -2, C.GLOW], [1, -2, C.ACC2], [-1, 0, C.RED]])
    g.dots.push([(m.handL[0] + dx) * 2 + 1, (m.handL[1] - 1 + dy) * 2 + 1, c]);
});
F('signCard', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp - 1, hyp - 5, C.WOOD, 1);
  g.rect(hxp - 3, hyp - 10, 5, 5, C.WHITE);
  g.rect(hxp - 2, hyp - 9, 1, 3, C.RED);                   // "1"
}, true);
F('scroll', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.rect(hxp - 3, hyp - 4, 6, 2, C.WHITE);
  g.set(hxp - 4, hyp - 4, C.WOOD); g.set(hxp - 4, hyp - 3, C.WOOD);
  g.set(hxp + 3, hyp - 4, C.WOOD); g.set(hxp + 3, hyp - 3, C.WOOD);
});
F('key', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.set(hxp - 1, hyp - 6, C.GOLD); g.set(hxp - 2, hyp - 7, C.GOLD); g.set(hxp, hyp - 7, C.GOLD); g.set(hxp - 1, hyp - 8, C.GOLD);
  g.line(hxp - 1, hyp - 5, hxp - 1, hyp - 2, C.GOLD, 1);
  g.set(hxp, hyp - 2, C.GOLD); g.set(hxp, hyp - 3, C.GOLD);
}, true);
F('rocket', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.rect(hxp - 1, hyp - 7, 2, 4, C.GREY);
  g.set(hxp - 1, hyp - 8, C.RED); g.set(hxp, hyp - 8, C.RED);
  g.set(hxp - 1, hyp - 3, C.GLOW); g.set(hxp, hyp - 3, C.ACC);
}, true);
F('mirror', 'held', (g, r, m) => {
  const [hxp, hyp] = m.handL;
  g.line(hxp, hyp - 1, hxp, hyp - 3, C.WOOD, 1);
  g.disc(hxp - 1, hyp - 5, 1.8, 2.2, C.GREY);
  g.disc(hxp - 1, hyp - 5, 0.9, 1.2, C.GLOW);
}, true);

// ============================ POST (no outline; airy garnish) ============================
F('stars', 'post', (g, r, m) => {
  for (let i = 0; i < 5; i++) {
    const x = m.bx + ri(r, -9, 9), y = ri(r, Math.max(1, m.headTop - 4), m.by);
    if (!g.get(x, y)) g.set(x, y, i % 2 ? C.GLOW : C.ACC_L);
  }
});
F('wisps', 'post', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.bx + s * (m.brx + 2);
    if (!g.get(x, m.by - 2)) g.set(x, m.by - 2, C.ACC_L);
    if (!g.get(x + s, m.by - 5)) g.set(x + s, m.by - 5, C.GLOW);
    if (!g.get(x, m.by - 8)) g.set(x, m.by - 8, C.ACC_L);
  }
});
F('sparkBolts', 'post', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.bx + s * (m.brx + 2), y = m.by - 4;
    if (!g.get(x, y)) g.set(x, y, C.GLOW);
    if (!g.get(x + s, y + 2)) g.set(x + s, y + 2, C.GLOW);
    if (!g.get(x, y + 4)) g.set(x, y + 4, C.ACC_L);
  }
});
F('raindrops', 'post', (g, r, m) => {
  for (let i = 0; i < 6; i++) {
    const x = m.bx + ri(r, -9, 9), y = ri(r, 6, 26);
    if (!g.get(x, y) && !g.get(x, y + 1)) { g.set(x, y, C.ACC_L); }
  }
});
F('soundArcs', 'post', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x0 = m.hx + s * (m.hw + 2);
    // small arc
    for (const [dx, dy] of [[0, -1], [s, 0], [0, 1]])
      if (!g.get(x0 + dx, m.hy + dy)) g.set(x0 + dx, m.hy + dy, C.ACC_L);
    // big arc
    for (const [dx, dy] of [[2, -2], [3, -1], [3, 0], [3, 1], [2, 2]])
      if (!g.get(x0 + s * dx, m.hy + dy)) g.set(x0 + s * dx, m.hy + dy, C.GLOW);
  }
});
F('musicNotes', 'post', (g, r, m) => {
  for (const [dx, dy] of [[m.hw + 3, -3], [-m.hw - 4, -1]]) {
    const x = m.hx + dx, y = m.hy + dy;
    if (g.get(x, y)) continue;
    g.set(x, y, C.GLOW); g.set(x + 1, y - 1, C.GLOW); g.set(x + 1, y - 2, C.GLOW);
  }
});
F('speedLines', 'post', (g, r, m) => {
  for (const [dy, len] of [[-2, 3], [1, 4], [4, 3]]) {
    const y = m.by + dy;
    for (let i = 0; i < len; i++)
      if (!g.get(m.bx + m.brx + 3 + i, y)) g.set(m.bx + m.brx + 3 + i, y, C.ACC_L);
  }
});
F('swirl', 'post', (g, r, m) => {
  for (let t = 0; t < 44; t++) {
    const th = t * 0.42, rad = 2.2 + t * 0.26;
    const x = m.bx + Math.round(Math.cos(th) * rad * 1.35), y = m.by - 2 + Math.round(Math.sin(th) * rad * 0.75);
    if (!g.get(x, y)) g.set(x, y, t % 3 ? C.ACC_L : C.GLOW);
  }
});
F('windLines', 'post', (g, r, m) => {
  for (const [dy, len] of [[-4, 5], [0, 6], [4, 4]]) {
    const y = m.by + dy;
    for (let i = 0; i < len; i++) {
      const x = m.bx - m.brx - 3 - i;
      if (!g.get(x, y + (i > 2 ? -1 : 0))) g.set(x, y + (i > 2 ? -1 : 0), C.ACC_L);
    }
  }
});
F('zzz', 'post', (g, r, m) => {
  let x = m.hx + m.hw + 2, y = m.headTop - 1;
  for (const s of [1, 0.7]) {
    g.set(x, y, C.GLOW); g.set(x + 1, y, C.GLOW); g.set(x, y + 1, C.GLOW); g.set(x - 1 + 2, y - 1, C.GLOW);
    x += 3; y -= 3;
  }
});
F('qmark', 'post', (g, r, m) => {
  const x = m.hx + m.hw + 3, y = m.headTop - 3;
  g.set(x, y, C.GLOW); g.set(x + 1, y - 1, C.GLOW); g.set(x + 1, y + 1, C.GLOW);
  g.set(x + 1, y + 2, C.GLOW); g.set(x + 1, y + 4, C.GLOW);
});
F('sunrays', 'post', (g, r, m) => {
  for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1.4, 0], [1.4, 0]]) {
    const x = m.hx + Math.round(dx * (m.hw + 3)), y = m.headTop - 2 + Math.round(dy * 3) + 2;
    if (!g.get(x, y)) g.set(x, y, C.GOLD);
    if (!g.get(x + Math.sign(dx), y + dy)) g.set(x + Math.sign(dx), y + dy - 1, C.GLOW);
  }
});
F('glitchPix', 'post', (g, r, m) => {
  for (let i = 0; i < 5; i++) {
    const x = m.bx + ri(r, -m.brx - 3, m.brx + 3), y = ri(r, m.headTop, m.by + 4);
    if (!g.get(x, y)) g.rect(x, y, 2, 1, i % 2 ? C.ACC : C.GLOW);
  }
});

// =====================================================================
// BACK VIEW — battle sprites of the player's own team, seen from behind
// (Pokemon convention). NOT a mirror flip: a dedicated rear template plus
// a per-feature back-variant table. Reuses the SAME per-key palette, the
// SAME stance/proportion seed (planBase replays identically off
// fnv('nv-nike:'+key)) and the SAME feature mapping, so front and back
// are visibly one character.
//
// Template: back of the round head (no face/eyes/snout), droopy ears in
// outer-ear color only, shoulders/back/pot-belly silhouette from the
// rear, stubby legs, and the signature PINK CURLY TAIL center-low. The
// tail uses SNOUT/SNOUT_D (outside SKIN_FAM) so clothe()-style costumes
// leave it poking through a tail hole; full-length robes/capes drawn as
// unconditional rows cover it, which is costume-accurate. The head sits
// 1px right of the spine as a 3/4 hint toward the enemy platform
// (upper-right). Light stays top-left (shared shadePass).
//
// Feature back-variants (BACKS): every FEATS key must map to a painter
// or an explicit 'hidden' marker — enforced at startup. Conventions:
//  - back items (wings/capes/jetpacks/backpacks/guitars/sacks/shields)
//    become FOREGROUND and dominate the back view
//  - held items are drawn on the 'back' layer so the body occludes them
//    naturally and only tips peek past the silhouette edge; hand-held
//    painters are mirrored around the body axis (BACK_MIRRORED below) so
//    the item stays in the same hand seen from behind
//  - face gear is hidden except side hints (visor strap, glasses arms,
//    tusk tips, beard tufts)
//  - chest patterns are replaced by a subtle seeded back-of-outfit
//    detail (yoke/stripe/patch in the front pattern's accent color)
// =====================================================================
const BACKS = {};
const BB = (name, layer, draw) => { BACKS[name] = { layer, draw }; };
const BHIDE = (name) => { BACKS[name] = 'hidden'; };
// reuse the front painter (geometry already reads correctly from behind),
// optionally on a different layer (held items -> 'back' for occlusion)
const BSAME = (name, layer) => {
  BACKS[name] = { layer: layer || FEATS[name].layer, draw: FEATS[name].draw };
};

// ---------- rear base template ----------
function drawTailCurl(g, m) {
  // signature curly tail, center-low on the rump. Pink (snout family) so
  // it pops against any skin and survives clothe()-based costumes.
  const tx = m.bx, ty = Math.round(m.by + m.bry) - 4;
  g.set(tx - 1, ty - 2, C.SNOUT); g.set(tx, ty - 2, C.SNOUT);   // top arc
  g.set(tx + 1, ty - 1, C.SNOUT); g.set(tx + 1, ty, C.SNOUT);   // right
  g.set(tx, ty + 1, C.SNOUT_D); g.set(tx - 1, ty + 1, C.SNOUT_D); // bottom (shaded)
  g.set(tx - 2, ty, C.SNOUT_D); g.set(tx - 2, ty - 1, C.SNOUT); // left
  g.set(tx - 1, ty - 1, C.SNOUT_D);                             // inner curl tip
}

function drawPigBack(g, r, m) {
  const { hx, hy, hw, hh, bx, by, brx, bry, shoulderY, armW, legW } = m;
  const headTop = Math.round(hy - hh);
  // ears from behind: outer-ear color only (no inner-ear fold), same
  // droopy silhouette as the front
  const earLX = hx - hw + 1, earRX = hx + hw - 2;
  m.earLX = earLX; m.earRX = earRX;
  for (const ex of [earLX, earRX]) {
    const dir = ex < hx ? -1 : 1;
    g.set(ex, headTop - 1, C.SKIN);
    g.set(ex + dir, headTop - 1, C.SKIN);
    g.set(ex + dir, headTop, C.SKIN);                      // outer ear, no SNOUT fold
    g.set(ex + dir * 2, headTop, C.SKIN);
    g.set(ex + dir * 2, headTop + 1, C.SKIN_D);
  }
  // body + neck + back of head (no belly disc — this is the back)
  g.disc(bx, by, brx, bry, C.SKIN);
  g.rect(hx - 2, Math.round(hy + hh) - 2, 5, 3, C.SKIN);
  g.disc(hx, hy, hw, hh, C.SKIN);
  // shoulder-blade hints
  g.set(bx - 3, shoulderY + 1, C.SKIN_D); g.set(bx - 2, shoulderY + 1, C.SKIN_D);
  g.set(bx + 2, shoulderY + 1, C.SKIN_D); g.set(bx + 3, shoulderY + 1, C.SKIN_D);
  // arms
  g.line(bx - brx + 1, shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.SKIN, armW);
  g.line(bx + brx - armW, shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.SKIN, armW);
  g.rect(m.handL[0], m.handL[1], 2, 1, C.SKIN_D);
  g.rect(m.handR[0], m.handR[1], 2, 1, C.SKIN_D);
  // legs + feet
  const legY = Math.round(by + bry) - 2;
  const legLX = bx - Math.max(3, Math.round(brx * 0.55)) - (legW - 2);
  const legRX = bx + Math.max(3, Math.round(brx * 0.55)) - 1;
  m.legY = legY; m.legLX = legLX; m.legRX = legRX;
  g.rect(legLX, legY, legW, 30 - legY, C.SKIN);
  g.rect(legRX, legY, legW, 30 - legY, C.SKIN);
  g.rect(legLX, 30, legW, 1, C.SKIN_D);
  g.rect(legRX, 30, legW, 1, C.SKIN_D);
  // the signature curly tail (after the body so it sits on the rump)
  drawTailCurl(g, m);
  // NO face: no eyes, no snout.
}

// ---------- back items: now FOREGROUND, drawn large ----------
BB('wings', 'held', (g, r, m, o) => {
  const yA = m.shoulderY - 1;                              // shoulder-blade anchor
  if (o.bat) {
    for (const s of [-1, 1]) {
      const x0 = m.bx + s * 2;
      g.line(x0, yA, x0 + s * 7, yA - 7, C.CLOTH_D, 2);    // wing arm
      g.set(x0 + s * 8, yA - 8, C.ACC);                    // claw
      const scallop = [1, 3, 2, 4, 3, 4, 2];               // membrane columns
      for (let d = 1; d <= 7; d++) {
        const x = x0 + s * d;
        for (let y = yA - d; y <= yA + scallop[d - 1]; y++) g.set(x, y, C.CLOTH_D);
      }
      g.line(x0 + s * 2, yA - 1, x0 + s * 2, yA + 2, C.DARK, 1); // ribs
      g.line(x0 + s * 5, yA - 4, x0 + s * 5, yA + 3, C.DARK, 1);
    }
  } else {
    const main = o.flame ? C.ACC : C.WHITE, edge = o.flame ? C.GLOW : C.GREY;
    // [rise above anchor, column length] per column out from the spine
    const prof = [[1, 5], [3, 6], [5, 7], [6, 7], [7, 6], [7, 5], [6, 4], [4, 2]];
    for (const s of [-1, 1]) {
      const x0 = m.bx + s * 2;
      for (let d = 0; d < prof.length; d++) {
        const [rise, len] = prof[d];
        const x = x0 + s * d;
        g.rect(x, yA - rise, 1, len, main);
        g.set(x, yA - rise + len, edge);                   // feather tip
      }
      if (o.four) {                                        // seraph lower pair
        g.line(x0 + s, yA + 5, x0 + s * 6, yA + 8, main, 2);
        g.set(x0 + s * 7, yA + 9, edge);
      }
    }
  }
});
BB('cape', 'body', (g, r, m) => {
  // the cape IS the back view: full drape from the shoulders to the boots
  const y0 = m.shoulderY - 2;
  for (let y = y0; y <= 29; y++) {
    const w = Math.min(m.brx + 3, 2 + Math.floor((y - y0) * 0.6));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH_D);
  }
  g.rect(m.bx - 4, y0 - 1, 9, 1, C.CLOTH_D);               // collar
  g.set(m.bx - 4, y0 - 1, C.GOLD); g.set(m.bx + 4, y0 - 1, C.GOLD); // clasps
  g.line(m.bx - 2, y0 + 4, m.bx - 3, 28, C.XDARK, 1);      // fold creases
  g.line(m.bx + 2, y0 + 4, m.bx + 3, 28, C.XDARK, 1);
});
BB('jetpack', 'held', (g, r, m) => {
  for (const s of [-1, 1]) {
    const x = m.bx + s * 2;
    g.rect(x - 1, m.shoulderY - 1, 3, 7, C.GREY);
    g.rect(x - 1, m.shoulderY, 1, 5, C.WHITE);             // left-lit cylinder highlight
    g.rect(x - 1, m.shoulderY - 1, 3, 1, C.WHITE);         // top cap
    g.rect(x - 1, m.shoulderY + 6, 3, 1, C.GREY_D);        // nozzle
    g.set(x, m.shoulderY + 7, C.ACC); g.set(x, m.shoulderY + 8, C.GLOW); // exhaust
  }
  g.rect(m.bx - 1, m.shoulderY + 1, 3, 1, C.GREY_D);       // center brace
});
BB('backpack', 'held', (g, r, m) => {
  const x0 = m.bx - 4, y0 = m.shoulderY - 2;
  g.rect(x0 - 1, y0 - 2, 11, 2, C.WOOD);                   // bedroll on top
  g.set(x0 - 1, y0 - 2, C.GOLD_D); g.set(x0 + 9, y0 - 2, C.GOLD_D); // roll ties
  g.rect(x0, y0, 9, 8, C.WOOD);                            // big pack body
  g.rect(x0, y0 + 2, 9, 1, C.GOLD_D);                      // flap seam
  g.set(m.bx, y0 + 3, C.GOLD);                             // buckle
  g.set(x0, y0 + 5, C.GOLD_D); g.set(x0 + 8, y0 + 5, C.GOLD_D); // side straps
});
BB('flameCrest', 'head', FEATS.flameCrest.draw);           // crest reads the same from behind
BB('snake', 'held', (g, r, m) => {
  const y0 = m.by - m.bry + 2;
  g.line(m.bx - m.brx, y0 + 4, m.bx + m.brx, y0 + 2, C.ACC2, 2); // coils across the back
  g.line(m.bx - m.brx + 1, m.by + 2, m.bx + m.brx - 1, m.by + 3, C.ACC2, 2);
  g.disc(m.bx + m.brx - 1, y0 - 1, 1.6, 1.4, C.ACC2);      // head over the shoulder,
  g.set(m.bx + m.brx - 1, y0 - 3, C.ACC2);                 // facing away (no eye)
});
BB('tentacles', 'held', FEATS.tentacles.draw);             // sprout from the back, toward viewer
BB('hydraHeads', 'held', (g, r, m) => {
  for (const s of [-1, 1]) {                               // necks from the back; heads
    const x0 = m.bx + s * (m.brx - 2);                     // face away (no eyes)
    const xt = m.bx + s * (m.brx + 3);
    g.line(x0, m.by - m.bry + 2, xt, m.headTop + 1, C.ACC2, 2);
    g.disc(xt, m.headTop, 1.8, 1.5, C.ACC2);
    g.set(xt, m.headTop - 2, C.ACC2);                      // crest nub
  }
});
BB('spiderLegs', 'held', FEATS.spiderLegs.draw);           // legs arch over the back
BB('shadowTwin', 'back', (g, r, m) => {
  // twin peeks from the OTHER side from behind; it faces away too (no eyes)
  g.disc(m.bx - 4, m.by - 1, m.brx - 1, m.bry - 1, C.XDARK);
  g.disc(m.hx - 5, m.hy - 1, m.hw - 1, m.hh - 1, C.XDARK);
});
BB('ring', 'post', FEATS.ring.draw);                       // occlusion-aware orbit
BB('finBack', 'held', (g, r, m) => {
  // dorsal fin runs down the spine — center stage from behind
  const x = m.bx, y0 = m.by - m.bry;
  g.set(x, y0 - 4, C.ACC);
  g.rect(x - 1, y0 - 3, 2, 1, C.ACC);
  g.rect(x - 1, y0 - 2, 3, 1, C.ACC);
  g.rect(x - 2, y0 - 1, 4, 1, C.ACC);
  g.set(x, y0 + 2, C.ACC); g.set(x, y0 + 4, C.ACC);        // spine ridge bumps
  g.line(m.bx + m.brx + 1, m.by + 1, m.bx + m.brx + 3, m.by - 2, C.ACC, 1); // tail fin
  g.line(m.bx + m.brx + 1, m.by + 1, m.bx + m.brx + 3, m.by + 3, C.ACC, 1);
});
BB('sack', 'held', (g, r, m) => {
  // the merchant's sack, slung over the shoulder — front and center now
  const cx = m.bx + 3, cy = m.shoulderY + 2;
  g.disc(cx, cy, 4.2, 4.6, C.WOOD);
  g.line(cx + 2, cy - 4, m.bx + m.brx, m.shoulderY - 2, C.WOOD, 2); // tied neck
  g.set(m.bx + m.brx, m.shoulderY - 3, C.GOLD_D);          // knot
  g.set(cx - 2, cy, C.GOLD_D); g.set(cx, cy - 2, C.GOLD_D); // patch stitches
  g.set(cx + 1, cy + 2, C.GOLD_D);
});

// ---------- body: back of the outfit ----------
BB('armor', 'body', (g, r, m, o) => {
  const main = o.gold ? C.GOLD : C.GREY, dark = o.gold ? C.GOLD_D : C.GREY_D;
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + 2, main);
  g.rect(m.bx - m.brx + 1, m.by + 2, m.brx * 2 - 1, 1, dark); // belt
  g.disc(m.bx - m.brx + 1, m.shoulderY - 1, 1.8, 1.4, dark);  // pauldrons
  g.disc(m.bx + m.brx - 1, m.shoulderY - 1, 1.8, 1.4, dark);
  for (let y = m.by - m.bry + 1; y <= m.by + 1; y++)          // backplate seam
    if (g.get(m.bx, y) === main) g.set(m.bx, y, dark);
  g.rect(m.bx - 2, m.by - m.bry + 1, 5, 1, dark);             // collar rim
});
BB('robe', 'body', (g, r, m) => {
  const ty = m.by - m.bry;
  for (let y = ty; y <= 30; y++) {
    const w = Math.min(m.brx + 2, 4 + Math.floor((y - ty) * 0.5));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH);
  }
  g.line(m.bx - m.brx + 1, m.shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.CLOTH, m.armW);
  g.line(m.bx + m.brx - m.armW, m.shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.CLOTH, m.armW);
  g.line(m.bx, ty + 2, m.bx, 29, C.CLOTH_D, 1);            // center back seam
  g.rect(m.bx - 3, ty + 1, 7, 1, C.CLOTH_D);               // yoke
});
BB('kimono', 'body', (g, r, m) => {
  const ty = m.by - m.bry;
  for (let y = ty; y <= 30; y++) {
    const w = Math.min(m.brx + 2, 4 + Math.floor((y - ty) * 0.45));
    g.rect(m.bx - w, y, w * 2 + 1, 1, C.CLOTH);
  }
  g.line(m.bx - m.brx - 1, m.shoulderY, m.bx - m.brx - 3, m.shoulderY + 4, C.CLOTH, 3); // wide sleeves
  g.line(m.bx + m.brx - 1, m.shoulderY, m.bx + m.brx + 1, m.shoulderY + 4, C.CLOTH, 3);
  g.rect(m.bx - m.brx, m.by + 1, m.brx * 2 + 1, 2, C.GOLD); // obi
  g.rect(m.bx - 2, m.by - 2, 5, 3, C.GOLD);                 // taiko knot on the back
  g.rect(m.bx - 1, m.by - 1, 3, 1, C.GOLD_D);               // knot crease
});
BB('apron', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE); // jacket back
  const ty = m.by - m.bry;
  g.line(m.bx - 3, ty + 1, m.bx + 2, m.by, C.CLOTH, 1);    // strings crossing the back
  g.line(m.bx + 3, ty + 1, m.bx - 2, m.by, C.CLOTH, 1);
  g.rect(m.bx - m.brx + 2, m.by + 1, m.brx * 2 - 3, 1, C.CLOTH); // waist tie
  g.set(m.bx - 2, m.by + 1, C.CLOTH_D); g.set(m.bx + 2, m.by + 1, C.CLOTH_D); // bow loops
  g.set(m.bx - 3, m.by + 2, C.CLOTH); g.set(m.bx + 3, m.by + 2, C.CLOTH);     // dangling ends
});
BB('overalls', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - 1, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  g.rect(m.legLX, m.legY, m.legW, 3, C.CLOTH);
  g.rect(m.legRX, m.legY, m.legW, 3, C.CLOTH);
  g.line(m.bx - 3, m.by - m.bry + 1, m.bx + 3, m.by - 1, C.CLOTH, 1); // straps cross
  g.line(m.bx + 3, m.by - m.bry + 1, m.bx - 3, m.by - 1, C.CLOTH, 1); // in an X
  g.set(m.bx, m.by - 3, C.GOLD);                            // cross-point button
});
BB('suitTie', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  g.rect(m.bx - 2, m.by - m.bry, 5, 1, C.CLOTH_D);          // collar
  g.line(m.bx, m.by + 1, m.bx, m.by + m.bry - 1, C.CLOTH_D, 1); // jacket vent
});
BB('toga', 'body', FEATS.toga.draw);                        // drape + bare shoulder read from behind
BB('gi', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry - 1, C.WHITE);
  g.line(m.bx, m.by - m.bry + 1, m.bx, m.by, C.GREY, 1);    // back seam
  g.rect(m.bx - m.brx + 1, m.by + 1, m.brx * 2 - 1, 1, C.DARK); // belt
});
BB('hoodieBody', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.CLOTH);
  const ty = m.by - m.bry;
  g.rect(m.bx - 3, ty - 1, 7, 2, C.CLOTH_D);                // hood hanging on the back
  g.rect(m.bx - 2, ty + 1, 5, 1, C.CLOTH_D);
  g.set(m.bx, ty + 2, C.CLOTH_D);                           // hood point
});
BB('sailorShirt', 'body', FEATS.sailorShirt.draw);          // stripes wrap around
BB('bandages', 'body', FEATS.bandages.draw);                // wraps read from any side
BB('rags', 'body', FEATS.rags.draw);
BB('chains', 'body', FEATS.chains.draw);                    // chain wraps the torso
BB('circuit', 'body', FEATS.circuit.draw);                  // traces on the back plate
BB('runesBody', 'body', FEATS.runesBody.draw);
BB('furBody', 'body', FEATS.furBody.draw);
BB('leafBody', 'body', FEATS.leafBody.draw);
BB('rockBody', 'body', FEATS.rockBody.draw);
BB('iceBody', 'body', FEATS.iceBody.draw);
BB('lavaCracks', 'body', FEATS.lavaCracks.draw);
BB('muscles', 'body', (g, r, m) => {
  g.line(m.bx - 3, m.by - m.bry + 2, m.bx, m.by - m.bry + 4, C.SKIN_D, 1); // shoulder blades
  g.line(m.bx + 3, m.by - m.bry + 2, m.bx, m.by - m.bry + 4, C.SKIN_D, 1);
  g.line(m.bx, m.by - m.bry + 4, m.bx, m.by - 1, C.SKIN_D, 1); // spine furrow
  g.line(m.bx - m.brx + 1, m.shoulderY, m.handL[0] + 1, m.handL[1] - 1, C.SKIN, 3); // beefy arms
  g.line(m.bx + m.brx - 3, m.shoulderY, m.handR[0] - 1, m.handR[1] - 1, C.SKIN, 3);
});
BB('webSuit', 'body', FEATS.webSuit.draw);                  // webbing continues on the back
BB('yinyang', 'body', FEATS.yinyang.draw);                  // back print
BB('cross', 'body', FEATS.cross.draw);                      // medic back print
BB('gem', 'body', FEATS.gem.draw);                          // crystal embedded in the back
BB('bricks', 'body', FEATS.bricks.draw);
BB('paperFolds', 'body', FEATS.paperFolds.draw);
BB('drips', 'body', FEATS.drips.draw);
BB('split', 'body', FEATS.split.draw);                      // hard shadow half works generically
BB('mawashi', 'body', (g, r, m) => {
  g.rect(m.bx - m.brx + 1, m.by + 2, m.brx * 2 - 1, 2, C.DARK);
  g.rect(m.bx - 1, m.by, 3, 2, C.DARK);                     // back knot above the belt
  g.set(m.bx - 1, m.by + 4, C.DARK); g.set(m.bx + 1, m.by + 4, C.DARK); // hanging ends
});
BB('scales', 'body', FEATS.scales.draw);
BHIDE('extraEyes');                                         // forehead eyes face away
BB('shoulderSpikes', 'body', FEATS.shoulderSpikes.draw);
BB('labCoat', 'body', (g, r, m) => {
  clothe(g, m.bx - m.brx, m.by - m.bry, m.bx + m.brx, m.by + m.bry, C.WHITE);
  g.rect(m.bx - 2, m.by - m.bry, 5, 1, C.GREY);             // collar
  g.line(m.bx, m.by - 1, m.bx, m.by + m.bry - 1, C.GREY, 1); // coat vent
});
// chest patterns are invisible from behind -> subtle seeded back detail
BB('chestPattern', 'body', (g, r, m) => {
  const kind = pick(r, ['yoke', 'stripe', 'patch']);
  if (kind === 'yoke') {
    g.rect(m.bx - 2, m.shoulderY, 5, 1, C.ACC);
    g.set(m.bx - 3, m.shoulderY + 1, C.ACC); g.set(m.bx + 3, m.shoulderY + 1, C.ACC);
  } else if (kind === 'stripe') {
    g.rect(m.bx, m.by - m.bry + 2, 1, Math.max(2, Math.round(m.bry) - 2), C.ACC);
  } else {                                                  // patch (small diamond)
    g.set(m.bx, m.by - 3, C.ACC); g.set(m.bx - 1, m.by - 2, C.ACC);
    g.set(m.bx + 1, m.by - 2, C.ACC); g.set(m.bx, m.by - 1, C.ACC);
  }
});

// ---------- head: headgear from behind ----------
BB('hornHelm', 'head', FEATS.hornHelm.draw);                // band + horns visible from the rear
BB('wingHelm', 'head', FEATS.wingHelm.draw);
BB('toque', 'head', (g, r, m) => {                          // plain cylinder from behind
  g.rect(m.hx - 3, m.headTop - 4, 7, 4, C.WHITE);
  g.rect(m.hx - 3, m.headTop, 7, 1, C.GREY);
});
BB('crown', 'head', (g, r, m) => {                          // band + points, no front jewel
  g.rect(m.hx - 3, m.headTop - 1, 7, 2, C.GOLD);
  g.set(m.hx - 3, m.headTop - 2, C.GOLD); g.set(m.hx, m.headTop - 2, C.GOLD);
  g.set(m.hx + 3, m.headTop - 2, C.GOLD);
});
BB('wizardHat', 'head', FEATS.wizardHat.draw);              // symmetric cone
BB('hoodMask', 'head', (g, r, m) => {
  // ninja cowl covers the head fully from behind; the knot is center-stage
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const v = g.get(x, y);
      if (v && v !== C.OUT) g.set(x, y, C.DARK);
    }
  g.rect(m.hx - 1, m.eyeY, 3, 1, C.XDARK);                  // knot
  g.set(m.hx, m.eyeY, C.GREY_D);                            // knot highlight
  g.set(m.hx - 1, m.eyeY + 1, C.GREY_D); g.set(m.hx + 1, m.eyeY + 2, C.GREY_D); // tails
});
BB('kabuto', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY_D);
  for (const s of [-1, 1]) {                                // flared side flaps
    g.set(m.hx + s * m.hw, m.headTop + 1, C.GREY_D);
    g.set(m.hx + s * m.hw, m.headTop + 2, C.GREY_D);
  }
  g.rect(m.hx - 3, Math.round(m.hy + m.hh) - 1, 7, 2, C.GREY_D); // shikoro neck guard
  g.set(m.hx - 2, m.headTop - 3, C.GOLD); g.set(m.hx + 2, m.headTop - 3, C.GOLD); // crest tips peek
});
BB('halo', 'head', FEATS.halo.draw);                        // still floats
BB('cowboyHat', 'head', FEATS.cowboyHat.draw);
BB('nightcap', 'head', FEATS.nightcap.draw);                // droop + pompom visible
BB('santaHat', 'head', FEATS.santaHat.draw);
BB('galea', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw + 1, m.headTop - 1, m.hw * 2 - 1, 2, C.GREY);
  g.rect(m.hx - 2, Math.round(m.hy + m.hh) - 1, 5, 1, C.GREY); // neck guard
  g.rect(m.hx, m.headTop - 3, 1, 3, C.ACC);                 // crest seen end-on
});
BB('gladHelm', 'head', (g, r, m) => {
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh) - 1; y++)
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.GOLD);
    }
  g.line(m.hx - 2, m.headTop - 2, m.hx + 2, m.headTop - 2, C.GOLD_D, 1); // crest arc
});
BB('knightHelm', 'head', (g, r, m) => {
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh) - 1; y++)
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.GREY);
    }
  g.line(m.hx, m.headTop - 2, m.hx, m.eyeY, C.GREY_D, 1);   // ridge down the back
});
BB('hood', 'head', (g, r, m) => {
  // from behind the hood covers the whole head — no face window
  for (let y = m.headTop - 2; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const v = g.get(x, y);
      if ((v && v !== C.OUT) || y <= m.headTop) g.set(x, y, C.CLOTH_D);
    }
  g.set(m.hx, m.headTop - 3, C.CLOTH_D);                    // peak
  g.rect(m.bx - 3, m.by - m.bry, 7, 1, C.CLOTH_D);          // drape on shoulders
});
BB('mohawk', 'head', (g, r, m) => {
  // edge-on fin: a thin strip over the crown running down the back of
  // the scalp — exactly what a mohawk looks like from behind
  g.rect(m.hx, m.headTop - 4, 1, 5, C.ACC);
  g.rect(m.hx, m.headTop + 1, 1, Math.max(1, m.eyeY - m.headTop), C.ACC);
});
BB('spaceHelm', 'head', FEATS.spaceHelm.draw);              // glass dome all around
BB('laurel', 'head', FEATS.laurel.draw);                    // wreath wraps the head
BB('strawHat', 'head', FEATS.strawHat.draw);
BB('minerHelm', 'head', (g, r, m) => {                      // helm without the front lamp
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.GOLD);
  g.rect(m.hx - m.hw + 1, m.headTop, m.hw * 2 - 1, 1, C.GOLD_D);
});
BB('beanie', 'head', FEATS.beanie.draw);
BB('headphones', 'head', FEATS.headphones.draw);            // band + cups from behind
BB('topknot', 'head', FEATS.topknot.draw);
BB('bunHair', 'head', (g, r, m) => {
  // hair covers the back of the head; the bun is now front and center
  for (let y = m.headTop - 1; y <= m.eyeY + 1; y++)
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.DARK);
    }
  g.disc(m.hx, m.headTop - 1, 1.6, 1.3, C.DARK);            // bun
  g.line(m.hx + 1, m.headTop - 3, m.hx + 3, m.headTop - 4, C.GOLD, 1); // kanzashi pin
});
BB('mikoBow', 'head', FEATS.mikoBow.draw);                  // side bow visible from rear
BB('flower', 'head', FEATS.flower.draw);
BB('clownWig', 'head', FEATS.clownWig.draw);                // puffs all around
BB('devilHorns', 'head', FEATS.devilHorns.draw);
BB('batEars', 'head', FEATS.batEars.draw);
BB('pelt', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw, m.headTop - 2, m.hw * 2 + 1, 2, C.CLOTH_D); // pelt cap
  g.rect(m.hx - 3, m.headTop - 3, 7, 1, C.CLOTH_D);
  g.set(m.hx - m.hw + 1, m.headTop - 3, C.CLOTH_D); g.set(m.hx + m.hw - 1, m.headTop - 3, C.CLOTH_D); // ears
  g.rect(m.bx - 2, m.shoulderY - 1, 5, 6, C.CLOTH_D);       // pelt drapes down the back
  g.rect(m.bx - m.brx - 1, m.shoulderY - 1, 2, 5, C.CLOTH_D); // side paws
  g.rect(m.bx + m.brx, m.shoulderY - 1, 2, 5, C.CLOTH_D);
  g.set(m.bx - 1, m.shoulderY + 5, C.CLOTH_D); g.set(m.bx + 1, m.shoulderY + 5, C.CLOTH_D); // ragged hem
});
BB('fedora', 'head', FEATS.fedora.draw);
BB('kasa', 'head', FEATS.kasa.draw);                        // conical, same all around
BB('emoFringe', 'head', (g, r, m, o) => {
  const col = o.acc ? C.ACC : C.DARK;
  for (let y = m.headTop - 1; y <= m.eyeY; y++)             // hair covers the back of the head
    for (let x = m.hx - m.hw; x <= m.hx + m.hw; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, col);
    }
  for (let x = m.hx - m.hw + 1; x <= m.hx + m.hw - 1; x += 2) // ragged bottom edge
    g.set(x, m.eyeY + 1, col);
  g.set(m.hx - m.hw - 1, m.headTop + 2, col);               // spikes jut past the
  g.set(m.hx + m.hw + 1, m.headTop + 1, col);               // silhouette edge
  g.set(m.hx - m.hw, m.headTop - 2, col);
  g.set(m.hx + 2, m.headTop - 2, col);
});
BB('pompadour', 'head', (g, r, m) => {                      // quiff from behind, no swoosh
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 2, C.GOLD);
  g.set(m.hx, m.headTop - 3, C.GOLD);
});
BB('melonHelm', 'head', FEATS.melonHelm.draw);              // rind stripes wrap around
BB('lighthouseHat', 'head', FEATS.lighthouseHat.draw);      // tower glows all around
BB('turban', 'head', (g, r, m) => {                         // wrap without the front jewel
  g.rect(m.hx - m.hw + 1, m.headTop - 2, m.hw * 2 - 1, 3, C.CLOTH);
  g.line(m.hx - m.hw + 1, m.headTop - 1, m.hx + m.hw - 1, m.headTop, C.CLOTH_L, 1);
});
BB('pikaEars', 'head', FEATS.pikaEars.draw);
BB('leafHead', 'head', FEATS.leafHead.draw);
BB('headband', 'head', (g, r, m) => {
  g.rect(m.hx - m.hw, m.headTop + 1, m.hw * 2 + 1, 1, C.RED);
  g.set(m.hx, m.headTop + 2, C.RED);                        // knot at the back
  g.set(m.hx - 1, m.headTop + 3, C.RED); g.set(m.hx + 1, m.headTop + 3, C.RED); // tails
  g.set(m.hx - 1, m.headTop + 4, C.RED);
});
BB('goggles', 'head', (g, r, m) => {                        // strap around the back of the head
  g.rect(m.hx - m.hw, m.headTop, m.hw * 2 + 1, 1, C.GREY_D);
  g.set(m.hx, m.headTop, C.GREY);                           // buckle
});

// ---------- face gear: hidden except side hints ----------
BB('glasses', 'face', (g, r, m) => {                        // temple arms only
  g.set(m.hx - m.hw, m.eyeY, C.GREY); g.set(m.hx + m.hw, m.eyeY, C.GREY);
});
BB('sunglasses', 'face', (g, r, m) => {
  g.set(m.hx - m.hw, m.eyeY, C.DARK); g.set(m.hx + m.hw, m.eyeY, C.DARK);
});
BB('visor', 'face', (g, r, m, o) => {
  // strap band wrapping the back of the head + glow spill at the edges
  const col = o.red ? C.RED : C.GLOW;
  g.rect(m.hx - m.hw, m.eyeY - 1, m.hw * 2 + 1, 2, C.DARK);
  g.set(m.hx - m.hw, m.eyeY, col); g.set(m.hx + m.hw, m.eyeY, col);
});
BB('eyepatch', 'face', (g, r, m) => {                       // strap across the back of the head
  g.line(m.hx - m.hw, m.eyeY - 1, m.hx + m.hw, m.eyeY - 2, C.DARK, 1);
});
BB('beard', 'face', (g, r, m, o) => {                       // tufts peek past the jaw
  const col = o.white ? C.WHITE : C.WOOD;
  g.set(m.hx - m.hw - 1, m.snoutY, col); g.set(m.hx + m.hw + 1, m.snoutY, col);
  g.set(m.hx - m.hw - 1, m.snoutY + 1, col); g.set(m.hx + m.hw + 1, m.snoutY + 1, col);
});
BB('maskMuzzle', 'face', (g, r, m) => {                     // twin straps around the head
  g.rect(m.hx - m.hw, m.eyeY + 1, m.hw * 2 + 1, 1, C.GREY_D);
});
BHIDE('clownNose');
BHIDE('facePaint');
BHIDE('thirdEye');
BHIDE('monocle');
BHIDE('snoutRing');
BB('tusks', 'face', (g, r, m) => {                          // tips curl past the cheeks
  for (const s of [-1, 1]) {
    g.set(m.hx + s * (m.hw + 1), m.snoutY, C.WHITE);
    g.set(m.hx + s * (m.hw + 2), m.snoutY - 1, C.WHITE);
  }
});
BHIDE('fangs');
BHIDE('closedEyes');
BB('stitches', 'face', FEATS.stitches.draw);                // scalp + body stitches visible
BHIDE('bandaid');
BHIDE('tears');
BHIDE('cheekDots');
BB('spideyEyes', 'face', (g, r, m) => {                     // full mask: back of the head webbed
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.CLOTH);
    }
  g.line(m.hx, m.headTop, m.hx, m.eyeY + 2, C.XDARK, 1);    // web meridian
  g.line(m.hx - 3, m.eyeY, m.hx + 3, m.eyeY, C.XDARK, 1);   // web ring
});
BB('luchaMask', 'face', (g, r, m) => {                      // mask back + lace seam
  for (let y = m.headTop - 1; y <= Math.round(m.hy + m.hh); y++)
    for (let x = m.hx - m.hw - 1; x <= m.hx + m.hw + 1; x++) {
      const v = g.get(x, y); if (v && v !== C.OUT) g.set(x, y, C.ACC);
    }
  g.line(m.hx, m.headTop - 1, m.hx, m.eyeY + 1, C.ACC_L, 1); // crest seam
  g.set(m.hx, m.eyeY + 2, C.WHITE);                          // lace knot
});
BB('scarf', 'face', FEATS.scarf.draw);                      // wrap + flying tail
BB('towelNeck', 'face', FEATS.towelNeck.draw);              // towel over the shoulders
BB('bandana', 'face', (g, r, m) => {                        // the knot faces the camera now
  const y = Math.round(m.hy + m.hh) - 1;
  g.rect(m.hx - 3, y, 7, 1, C.RED);
  g.set(m.hx, y + 1, C.RED);                                // knot
  g.set(m.hx - 1, y + 2, C.RED); g.set(m.hx + 1, y + 2, C.RED); // tails
});

// ---------- held items: behind the body, tips peek past the edge ----------
BSAME('axe', 'back');                                       // axe head over the shoulder
BSAME('sword', 'back');                                     // blade above the shoulder line
BB('katana', 'held', (g, r, m) => {
  // strapped across the back — saya low-left, tsuka above the right shoulder
  g.line(m.bx - 4, m.by + 3, m.bx + 4, m.by - 5, C.DARK, 2); // saya
  g.line(m.bx - 3, m.by + 3, m.bx + 3, m.by - 3, C.GREY, 1); // lacquer shine
  g.set(m.bx - 5, m.by + 4, C.DARK);                         // saya tip past the hip
  g.set(m.bx + 5, m.by - 5, C.GOLD);                         // tsuba
  g.line(m.bx + 6, m.by - 6, m.bx + 7, m.by - 8, C.WOOD, 1); // tsuka over the shoulder
});
BSAME('saber', 'back');
BSAME('pan', 'back');                                       // pan disc peeks past the edge
BSAME('staffOrb', 'back');                                  // orb floats above the head
BSAME('walkingStick', 'back');
BSAME('hammer', 'back');
BSAME('book', 'back');
BSAME('lantern', 'back');
BSAME('mic', 'back');
BB('shield', 'held', (g, r, m, o) => {
  // slung on the back — the painted face toward the camera, dominant
  if (o.round) {
    const cx = m.bx, cy = m.by - 1;
    g.disc(cx, cy, 4.4, 4.8, C.ACC);
    for (let t = 0; t < 40; t++) {
      const th = (t / 40) * Math.PI * 2;
      g.set(cx + Math.round(Math.cos(th) * 4.4), cy + Math.round(Math.sin(th) * 4.8), C.GREY_D);
    }
    g.disc(cx, cy, 1.4, 1.4, C.GREY);                       // boss
    g.line(cx - 3, cy - 3, cx - 1, cy - 1, C.ACC_L, 1);     // plank highlight
  } else {
    g.rect(m.bx - 3, m.shoulderY - 2, 7, 10, C.GREY);
    g.rect(m.bx - 3, m.shoulderY - 2, 7, 1, C.GREY_D);      // rims
    g.rect(m.bx - 3, m.shoulderY + 7, 7, 1, C.GREY_D);
    g.rect(m.bx - 3, m.shoulderY - 1, 1, 8, C.GREY_D);
    g.rect(m.bx + 3, m.shoulderY - 1, 1, 8, C.GREY_D);
    g.set(m.bx, m.shoulderY + 2, C.ACC);                    // emblem
  }
});
BSAME('spear', 'back');
BSAME('trident', 'back');
BSAME('net', 'back');
BB('guitar', 'held', (g, r, m) => {
  // slung across the back, big — neck up-left, body over the hip
  g.disc(m.bx + 2, m.by + 1, 3, 2.6, C.WOOD);
  g.disc(m.bx + 2, m.by + 1, 1.2, 1, C.DARK);
  g.line(m.bx, m.by - 1, m.bx - 6, m.by - 7, C.WOOD, 2);    // neck
  g.rect(m.bx - 8, m.by - 9, 2, 2, C.DARK);                 // headstock
  g.line(m.bx + 2, m.by, m.bx - 5, m.by - 7, C.WHITE, 1);   // strings
  g.line(m.bx - m.brx + 1, m.shoulderY - 1, m.bx + 1, m.by - 1, C.GOLD_D, 1); // strap
});
BSAME('pickaxe', 'back');
BSAME('coin', 'back');
BSAME('fan', 'back');
BSAME('balloon', 'back');                                   // floats high past the shoulder
BSAME('pokeball', 'back');
BB('boxGloves', 'held', FEATS.boxGloves.draw);              // hands sit outside the silhouette
BSAME('lightningBolt', 'back');                             // bolt blazes past the shoulder
BSAME('torch', 'back');
BSAME('oar', 'back');
BSAME('broom', 'back');
BSAME('whip', 'back');
BSAME('flag', 'back');                                      // banner high above
BSAME('orb', 'back');                                       // mostly eclipsed by the body
BSAME('drumstick', 'back');
BSAME('appleHeld', 'back');
BSAME('melonSlice', 'back');
BSAME('bellHeld', 'back');
BSAME('dowsingRod', 'back');
BSAME('dumbbell', 'back');                                  // plates peek at both sides
BSAME('bomb', 'back');                                      // fuse spark over the shoulder
BSAME('magnet', 'back');
BB('gauntlet', 'held', FEATS.gauntlet.draw);                // fist outside the silhouette
BSAME('signCard', 'back');                                  // card held high
BSAME('scroll', 'back');
BSAME('key', 'back');
BSAME('rocket', 'back');
BSAME('mirror', 'back');

// ---------- post garnish: ambient, reads from any side ----------
BB('stars', 'post', (g, r, m) => {
  for (let i = 0; i < 5; i++) {                             // ambient sparkle (as front)
    const x = m.bx + ri(r, -9, 9), y = ri(r, Math.max(1, m.headTop - 4), m.by);
    if (!g.get(x, y)) g.set(x, y, i % 2 ? C.GLOW : C.ACC_L);
  }
  for (const [dx, dy] of [[-2, -4], [2, -2], [0, 0], [-3, -1]]) { // starfield speckle
    const x = m.bx + dx, y = m.by + dy;                     // on the back itself
    const v = g.get(x, y);
    if (v && v !== C.OUT && v !== C.SNOUT && v !== C.SNOUT_D) g.set(x, y, dx % 2 ? C.ACC_L : C.GLOW);
  }
});
BSAME('wisps');
BSAME('sparkBolts');
BSAME('raindrops');
BSAME('soundArcs');
BSAME('musicNotes');
BSAME('speedLines');
BSAME('swirl');
BSAME('windLines');
BSAME('zzz');
BSAME('qmark');
BSAME('sunrays');
BSAME('glitchPix');

// ---------- back generation ----------
// Hand-held items must MIRROR around the body axis in the back view: an
// item drawn at handR (screen-right = the pig's LEFT hand from the front)
// has to appear screen-LEFT from behind or the character switches hands
// between views. Painters listed here render into a scratch grid that is
// blitted mirrored (cells around column bx, sub-cell dots included).
// Slung/back-mounted custom painters (katana, shield, guitar, sack, snake)
// and body-centered/symmetric ones (orb, boxGloves) stay unmirrored.
const BACK_MIRRORED = new Set([
  'axe', 'sword', 'saber', 'pan', 'staffOrb', 'walkingStick', 'hammer',
  'book', 'lantern', 'mic', 'spear', 'trident', 'net', 'pickaxe', 'coin',
  'fan', 'balloon', 'pokeball', 'lightningBolt', 'torch', 'oar', 'broom',
  'whip', 'flag', 'drumstick', 'appleHeld', 'melonSlice', 'bellHeld',
  'dowsingRod', 'dumbbell', 'bomb', 'magnet', 'signCard', 'scroll', 'key',
  'rocket', 'mirror', 'gauntlet',
]);
function drawBackFeat(g, r, m, f) {
  if (!BACK_MIRRORED.has(f.name)) { f.b.draw(g, r, m, f.o); return; }
  const tmp = new Grid();
  f.b.draw(tmp, r, m, f.o);                                // same r stream
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = tmp.g[y * N + x];
    if (v) g.set(2 * m.bx - x, y, v);                      // mirror around bx
  }
  for (const [dx, dy, c] of tmp.dots) g.dots.push([4 * m.bx + 1 - dx, dy, c]);
}

function generateBackGrid(key, cre, def) {
  // SAME seed string as the front so planBase replays the identical
  // proportion wobble — front and back share stance, head size, belly.
  const r = mulberry32(fnv('nv-nike:' + key));
  const g = new Grid();
  const feats = def.f.map(parseFeat);
  if (!def.plain && !feats.some((f) => BODY_LAYER.has(f.name)))
    feats.push({ name: 'chestPattern', o: {} });            // -> back detail variant
  const tall = feats.some((f) => FEATS[f.name].tall);
  const m = planBase(r, def.s || 'biped', tall && (def.s || 'biped') === 'biped');
  m.hx += 1;                                                // 3/4 hint: facing upper-right
  // derived metrics BEFORE any painter (back-layer held items need them)
  m.headTop = Math.round(m.hy - m.hh);
  m.eyeY = m.hy - 1;
  m.eyeDX = Math.max(2, Math.round(m.hw * 0.55));
  m.snoutY = m.hy + 2;
  const resolved = feats
    .map((f) => ({ ...f, b: BACKS[f.name] }))
    .filter((f) => f.b && f.b !== 'hidden');
  const byLayer = (layer) => resolved.filter((f) => f.b.layer === layer);
  for (const f of byLayer('back')) drawBackFeat(g, r, m, f);
  drawPigBack(g, r, m);
  for (const layer of ['body', 'head', 'face', 'held'])
    for (const f of byLayer(layer)) drawBackFeat(g, r, m, f);
  shadePass(g);
  const { dx, dy } = anchorPass(g);
  m.hx += dx; m.hy += dy; m.bx += dx; m.by += dy; m.headTop += dy; m.eyeY += dy; m.snoutY += dy;
  m.handL = [m.handL[0] + dx, m.handL[1] + dy]; m.handR = [m.handR[0] + dx, m.handR[1] + dy];
  outlinePass(g);
  for (const f of byLayer('post')) f.b.draw(g, r, m, f.o);
  garnishPass(g, r, cre.rarity);
  return { g, m };
}

// ---------- back QC sheets: front | back pairs ----------
function makeBackSheets(entries, perSheet = 20) {
  const paths = [];
  const COLS = 4, SCALE = 2;
  const TILE_W = 64 * SCALE * 2 + 28, TILE_H = 64 * SCALE + 40;
  for (let s = 0; s * perSheet < entries.length; s++) {
    const chunk = entries.slice(s * perSheet, (s + 1) * perSheet);
    const rows = Math.ceil(chunk.length / COLS);
    const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    chunk.forEach((e, i) => {
      const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
      ctx.fillStyle = '#1c1c2c';
      ctx.fillRect(cx + 4, cy + 4, TILE_W - 8, 64 * SCALE + 4);
      ctx.drawImage(e.canvas, cx + 6, cy + 6, 64 * SCALE, 64 * SCALE);
      ctx.drawImage(e.back, cx + 64 * SCALE + 18, cy + 6, 64 * SCALE, 64 * SCALE);
      ctx.fillStyle = '#e8e8f0'; ctx.font = '11px "Liberation Sans"'; ctx.textAlign = 'center';
      ctx.fillText(e.key + '  (front | back)', cx + TILE_W / 2, cy + 64 * SCALE + 22);
      ctx.fillStyle = '#9090b0'; ctx.font = '9px "Liberation Sans"';
      ctx.fillText(e.featStr.slice(0, 34), cx + TILE_W / 2, cy + 64 * SCALE + 34);
    });
    const p = path.join(BACK_SHEET_DIR, `backs-${String(s + 1).padStart(2, '0')}.png`);
    fs.writeFileSync(p, cv.toBuffer('image/png'));
    paths.push(p);
  }
  return paths;
}

function makeBackCalloutSheet(entries, names) {
  const wanted = names.map((n) => entries.find((e) => e.key === n)).filter(Boolean);
  const COLS = 3, SCALE = 3, TILE_W = 64 * SCALE * 2 + 36, TILE_H = 64 * SCALE + 44;
  const rows = Math.ceil(wanted.length / COLS);
  const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  wanted.forEach((e, i) => {
    const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
    ctx.fillStyle = '#1c1c2c';
    ctx.fillRect(cx + 6, cy + 6, 64 * SCALE + 4, 64 * SCALE + 4);
    ctx.fillRect(cx + 64 * SCALE + 22, cy + 6, 64 * SCALE + 4, 64 * SCALE + 4);
    ctx.drawImage(e.canvas, cx + 8, cy + 8, 64 * SCALE, 64 * SCALE);
    ctx.drawImage(e.back, cx + 64 * SCALE + 24, cy + 8, 64 * SCALE, 64 * SCALE);
    ctx.fillStyle = '#e8e8f0'; ctx.font = '13px "Liberation Sans"'; ctx.textAlign = 'center';
    ctx.fillText(e.key + '  (front | back)', cx + TILE_W / 2, cy + 64 * SCALE + 26);
    ctx.fillStyle = '#9090b0'; ctx.font = '10px "Liberation Sans"';
    ctx.fillText(e.featStr.slice(0, 44), cx + TILE_W / 2, cy + 64 * SCALE + 38);
  });
  const p = path.join(BACK_SHEET_DIR, 'backs-callouts.png');
  fs.writeFileSync(p, cv.toBuffer('image/png'));
  return p;
}

// =====================================================================
// THE ROSTER — explicit per-name mapping for ALL 292 nikes.
// s: stance ('biped' default, 'chunky', 'piglet'); f: features (1-3,
// '#opt' suffixes); plain: skip even the seeded chest pattern.
// =====================================================================
const NIKES = {
  aberration: { f: ['extraEyes', 'wisps'] },
  ambassador: { f: ['suitTie', 'monocle'] },
  angel: { f: ['wings', 'halo'] },
  anomaly: { f: ['wisps', 'glitchPix'] },
  anthem: { f: ['flag', 'musicNotes'] },
  archivist: { f: ['book', 'scroll', 'glasses'] },
  archon: { f: ['robe', 'crown', 'staffOrb'] },
  ascendant: { f: ['halo', 'sunrays'] },
  ashigaru: { f: ['kasa', 'spear'] },
  astronaut: { f: ['spaceHelm', 'jetpack'] },
  avalanche: { s: 'chunky', f: ['iceBody'] },
  backup: { f: ['circuit'] },
  balance: { f: ['yinyang', 'closedEyes'] },
  bane: { f: ['maskMuzzle', 'muscles'] },
  bastion: { f: ['shield', 'armor'] },
  batpig: { f: ['batEars', 'wings#bat'] },
  beacon: { f: ['sailorShirt', 'lantern'] },
  bear_armour: { f: ['pelt', 'armor'] },
  beast_master: { f: ['whip', 'pelt'] },
  berjador: { s: 'chunky', f: ['fangs', 'shoulderSpikes', 'sparkBolts'] },
  berserker: { f: ['axe', 'facePaint'] },
  bertus_maximus: { s: 'chunky', f: ['armor', 'snoutRing', 'shoulderSpikes'] },
  bike_courier: { f: ['beanie', 'backpack'] },
  black_hole: { f: ['ring', 'stars'] },
  blank: { plain: 1, f: [] },
  bomberpig: { f: ['bomb', 'goggles'] },
  boom: { f: ['soundArcs'] },
  boulder: { s: 'chunky', f: ['rockBody'] },
  bruiser: { f: ['boxGloves', 'snoutRing'] },
  caldera: { s: 'chunky', f: ['rockBody', 'lavaCracks', 'flameCrest'] },
  cardano_trader: { f: ['suitTie', 'coin'] },
  cardano_whale: { s: 'chunky', f: ['finBack', 'coin'] },
  centurion: { f: ['galea', 'armor', 'sword'] },
  chariot: { f: ['wingHelm', 'speedLines'] },
  chef: { f: ['toque', 'apron', 'pan'] },
  chime: { s: 'piglet', f: ['bellHeld', 'musicNotes'] },
  chrome: { f: ['armor', 'visor'] },
  cinder: { s: 'piglet', f: ['flameCrest'] },
  cipher: { f: ['runesBody', 'qmark'] },
  clown: { f: ['clownWig', 'clownNose', 'balloon'] },
  codex: { f: ['book', 'runesBody'] },
  colossal_nike: { s: 'chunky', f: ['muscles'] },
  comet: { f: ['stars', 'speedLines'] },
  corey_hort: { f: ['katana', 'suitTie'] },
  cornerman: { f: ['towelNeck', 'boxGloves'] },
  corona: { f: ['sunrays'] },
  corp_executive: { f: ['suitTie', 'sunglasses'] },
  cosmic: { f: ['stars', 'thirdEye'] },
  cowboy: { f: ['cowboyHat', 'bandana'] },
  crescendo: { f: ['mic', 'musicNotes'] },
  crucible: { f: ['armor', 'lavaCracks'] },
  cryogenic: { f: ['iceBody', 'visor'] },
  cutman: { f: ['bandaid', 'towelNeck'] },
  cyberpunk: { f: ['visor', 'circuit', 'mohawk'] },
  daimyo: { f: ['kabuto', 'kimono'] },
  darth_moink: { f: ['knightHelm', 'cape', 'saber#red'] },
  data_miner: { f: ['minerHelm', 'pickaxe'] },
  deluge: { f: ['raindrops'] },
  depthcall: { f: ['finBack', 'soundArcs'] },
  despair: { f: ['tears', 'wisps'] },
  detonation: { f: ['bomb', 'flameCrest'] },
  devil: { f: ['devilHorns', 'wings#bat', 'trident'] },
  diamond: { f: ['gem'] },
  diplomat: { f: ['suitTie', 'scroll'] },
  doppelganger: { f: ['shadowTwin'] },
  dowser: { f: ['dowsingRod', 'strawHat'] },
  dr_caleb: { f: ['labCoat', 'glasses'] },
  dragon: { f: ['wings#bat', 'fangs'] },
  draugr: { f: ['hornHelm', 'rags'] },
  drizzle: { s: 'piglet', f: ['raindrops'] },
  dune: { f: ['turban'] },
  dynamo: { f: ['sparkBolts'] },
  elbonzys: { f: ['wings#bat', 'flameCrest'] },
  elon: { f: ['suitTie', 'rocket'] },
  emo: { f: ['emoFringe#acc', 'hoodieBody', 'tears'] },
  emperor: { f: ['laurel', 'toga', 'cape'] },
  enigma: { f: ['hood', 'qmark'] },
  explorer: { f: ['cowboyHat', 'backpack', 'lantern'] },
  farmer: { f: ['strawHat', 'overalls'] },
  fimbulwinter: { s: 'chunky', f: ['iceBody', 'hornHelm'] },
  fire: { f: ['flameCrest', 'armor'] },
  firestorm: { f: ['flameCrest', 'windLines'] },
  firewall: { f: ['bricks', 'flameCrest'] },
  fixer: { f: ['fedora', 'sunglasses'] },
  floral: { f: ['flower', 'leafBody'] },
  fortune_god: { f: ['robe', 'coin'] },
  fren: { f: [] },
  frequency: { f: ['sparkBolts', 'soundArcs'] },
  furnace: { s: 'chunky', f: ['lavaCracks', 'flameCrest'] },
  fuse: { f: ['bomb', 'sparkBolts'] },
  gaia: { f: ['leafBody', 'flower', 'stars'] },
  galeforce: { f: ['windLines'] },
  gatekeeper: { f: ['ring', 'key'] },
  geisha: { f: ['bunHair', 'kimono', 'fan'] },
  glacial: { s: 'chunky', f: ['iceBody'] },
  gladiator: { f: ['gladHelm', 'armor#gold', 'sword'] },
  glitch: { f: ['glitchPix'] },
  glowing: { f: ['stars'] },
  glutton: { s: 'chunky', f: ['drumstick'] },
  golden_apple: { f: ['appleHeld', 'robe'] },
  gravity: { f: ['ring'] },
  grimoire: { f: ['book', 'wisps'] },
  guardian_protocol: { f: ['armor', 'circuit', 'shield'] },
  guthix: { f: ['hood', 'runesBody'] },
  hacker: { f: ['hood', 'glasses'] },
  hailstone: { f: ['iceBody', 'raindrops'] },
  halo: { f: ['halo', 'stars'] },
  hamibel_lecter: { f: ['maskMuzzle'] },
  harmony: { f: ['musicNotes', 'halo'] },
  healer: { f: ['robe', 'cross'] },
  heisenboar: { f: ['fedora', 'sunglasses', 'beard'] },
  hexwire: { f: ['circuit', 'sparkBolts'] },
  hobbit: { s: 'piglet', f: ['walkingStick', 'backpack'] },
  hologram_star: { f: ['mic', 'glitchPix'] },
  hooligan: { f: ['beanie', 'scarf'] },
  hosky: { f: ['hoodieBody'] },
  hurricane: { f: ['swirl', 'windLines'] },
  huskarl: { f: ['shield#round', 'axe'] },
  hydra: { s: 'chunky', f: ['hydraHeads'] },
  icy: { f: ['iceBody'] },
  ironpig: { f: ['armor', 'gem'] },
  jarl: { f: ['crown', 'beard#white', 'pelt'] },
  jedi: { f: ['robe', 'saber'] },
  jelly: { s: 'piglet', f: ['drips'] },
  jinx: { f: ['qmark', 'sparkBolts'] },
  juggernaut: { s: 'chunky', f: ['armor', 'shoulderSpikes'] },
  jupiter: { f: ['lightningBolt', 'laurel', 'toga'] },
  kabuki: { f: ['facePaint#kabuki', 'kimono'] },
  kickboxer: { f: ['boxGloves', 'headband'] },
  kindling: { s: 'piglet', f: ['leafHead', 'flameCrest'] },
  koi: { s: 'piglet', f: ['finBack', 'scales'] },
  kraken: { s: 'chunky', f: ['tentacles'] },
  kunoichi: { f: ['hoodMask', 'katana'] },
  legionnaire: { f: ['galea', 'shield', 'spear'] },
  lighthouse: { f: ['lighthouseHat', 'lantern'] },
  lisan_oink_gaib: { f: ['armor', 'visor'] },
  lodestone: { f: ['rockBody', 'sparkBolts'] },
  longship: { f: ['hornHelm', 'shield#round', 'oar'] },
  lunar_new_year: { f: ['robe', 'lantern'] },
  maelstrom: { s: 'chunky', f: ['swirl'] },
  magma: { f: ['rockBody', 'lavaCracks'] },
  magnet: { f: ['magnet', 'sparkBolts'] },
  mammoth: { s: 'chunky', f: ['tusks', 'furBody'] },
  matrix: { f: ['visor', 'circuit'] },
  mcjared: { f: ['robe', 'glasses'] },
  melon: { f: ['melonHelm', 'melonSlice'] },
  memory: { f: ['qmark', 'wisps'] },
  merchant: { f: ['sack', 'coin'] },
  meteor: { f: ['rockBody', 'flameCrest'] },
  midnike: { f: ['cape', 'stars'] },
  mirror: { f: ['mirror'] },
  mistral: { f: ['scarf', 'windLines'] },
  mma: { f: ['boxGloves', 'gi'] },
  monk_pig: { f: ['kasa', 'robe', 'broom'] },
  monolith: { s: 'chunky', f: ['rockBody', 'runesBody'] },
  monsoon: { f: ['raindrops', 'windLines'] },
  mummy: { f: ['bandages'] },
  murmillo: { f: ['gladHelm', 'armor', 'shield'] },
  muscular: { f: ['muscles', 'dumbbell'] },
  nature: { f: ['leafBody'] },
  nebula: { s: 'chunky', f: ['stars', 'wisps'] },
  nel: { f: ['batEars', 'wisps'] },
  netrunner: { f: ['visor', 'circuit'] },
  nightmare: { f: ['wisps', 'fangs'] },
  nike_tyson: { f: ['boxGloves', 'facePaint'] },
  ninja: { f: ['hoodMask', 'katana'] },
  obelisk: { f: ['rockBody', 'runesBody'] },
  obsidian_knight: { f: ['knightHelm', 'armor', 'sword#big'] },
  og_nike: { plain: 1, f: ['stars'] },
  oinkachu: { s: 'piglet', f: ['pikaEars', 'pokeball', 'cheekDots'] },
  olecram: { s: 'chunky', f: ['scarf'] },
  omniscient: { f: ['thirdEye', 'stars'] },
  onmyoji: { f: ['wizardHat', 'robe', 'scroll'] },
  oracle: { f: ['robe', 'thirdEye'] },
  origami: { f: ['paperFolds'] },
  overclock: { f: ['circuit', 'speedLines'] },
  overgrowth: { s: 'chunky', f: ['leafBody'] },
  paladin: { f: ['knightHelm', 'armor#gold', 'sword'] },
  paradox: { f: ['swirl', 'shadowTwin'] },
  patriot: { f: ['flag', 'facePaint'] },
  pebble: { s: 'piglet', f: ['rockBody'] },
  penumbra: { f: ['split', 'wisps'] },
  permafrost: { f: ['iceBody', 'rockBody'] },
  peter_porker: { f: ['webSuit', 'spideyEyes'] },
  phoenix: { f: ['wings#flame', 'flameCrest'] },
  piglet: { s: 'piglet', f: ['flower'] },
  pigrun: { f: ['speedLines', 'headband'] },
  pigsterio: { f: ['guitar', 'cape'] },
  pilgrim: { f: ['hood', 'walkingStick'] },
  ping: { s: 'piglet', f: ['soundArcs'] },
  ponder: { f: ['orb'] },
  porker: { f: ['suitTie', 'emoFringe#acc'] },
  praetorian: { f: ['galea', 'armor', 'spear'] },
  professor_nike: { f: ['glasses', 'book', 'suitTie'] },
  promoter: { f: ['suitTie', 'mic'] },
  psychedelic: { f: ['sunglasses', 'swirl'] },
  puddle: { s: 'piglet', f: ['drips'] },
  pulsar: { f: ['stars', 'sparkBolts'] },
  pumba: { f: ['tusks', 'mohawk'] },
  punk: { f: ['mohawk', 'shoulderSpikes', 'chains'] },
  pyre: { f: ['robe', 'torch'] },
  quantum: { f: ['stars', 'glitchPix'] },
  quirk: { s: 'piglet', f: ['wings#bat'] },
  requiem: { f: ['hood', 'musicNotes'] },
  researcher: { f: ['labCoat', 'glasses'] },
  resonance: { f: ['gem', 'soundArcs'] },
  retiarius: { f: ['trident', 'net'] },
  ring_girl: { f: ['signCard', 'mikoBow'] },
  riptide: { f: ['swirl', 'finBack'] },
  rocker: { f: ['guitar', 'sunglasses'] },
  rogue_ai: { f: ['circuit', 'visor#red'] },
  root_access: { f: ['hood', 'circuit'] },
  royal: { f: ['crown', 'cape'] },
  runesmith: { f: ['hammer', 'runesBody'] },
  santa: { f: ['santaHat', 'beard#white', 'sack'] },
  satoshi: { f: ['hood', 'coin'] },
  savant: { f: ['glasses', 'stars'] },
  scholar: { f: ['scroll', 'glasses'] },
  scrapper: { f: ['boxGloves', 'bandaid'] },
  senator: { f: ['toga', 'laurel', 'scroll'] },
  sensei: { f: ['beard#white', 'gi'] },
  seraph: { f: ['wings#four', 'halo', 'stars'] },
  shieldmaiden: { f: ['shield#round', 'sword'] },
  shogun: { f: ['kabuto', 'armor', 'katana'] },
  showboat: { f: ['cape', 'mic', 'sunglasses'] },
  shrine_maiden: { f: ['mikoBow', 'kimono'] },
  sigil: { f: ['runesBody'] },
  singularity: { f: ['ring', 'stars'] },
  sirocco: { f: ['turban', 'windLines'] },
  sizzle: { f: ['soundArcs', 'flameCrest'] },
  skald: { f: ['guitar', 'beard'] },
  slave: { f: ['chains', 'rags'] },
  sleepy: { f: ['nightcap', 'zzz'] },
  sleet: { f: ['raindrops', 'scarf'] },
  smuggler: { f: ['bandana', 'sack', 'eyepatch'] },
  snek: { s: 'piglet', f: ['snake'] },
  snoinklax: { s: 'chunky', f: ['closedEyes', 'zzz'] },
  solaris: { f: ['sunrays'] },
  sonar: { f: ['headphones', 'soundArcs'] },
  sonic: { f: ['speedLines', 'soundArcs'] },
  sovereign: { f: ['crown', 'trident'] },
  speedster: { f: ['speedLines', 'goggles'] },
  spindrift: { f: ['windLines', 'raindrops'] },
  sprout: { s: 'piglet', f: ['leafHead'] },
  stalwart: { f: ['armor', 'shield'] },
  starborn: { f: ['stars'] },
  stoic: { s: 'chunky', f: ['closedEyes'] },
  stormgrove: { f: ['leafBody', 'sparkBolts'] },
  street_samurai: { f: ['katana', 'visor'] },
  sumo: { s: 'chunky', f: ['topknot', 'mawashi'] },
  sunforge: { f: ['hammer', 'sunrays'] },
  synth: { f: ['headphones', 'visor'] },
  taiga: { f: ['furBody', 'leafHead'] },
  tanuki: { f: ['leafHead', 'furBody'] },
  tarantula: { s: 'chunky', f: ['spiderLegs', 'extraEyes'] },
  tectonic: { s: 'chunky', f: ['rockBody', 'split'] },
  terminator: { f: ['visor#red', 'armor'] },
  thanos: { s: 'chunky', f: ['gauntlet', 'armor'] },
  thermal: { f: ['flameCrest', 'windLines'] },
  thicket: { f: ['leafBody', 'shoulderSpikes#green'] },
  thrall: { f: ['chains', 'rags'] },
  thunderclap: { f: ['lightningBolt', 'soundArcs'] },
  thundergod: { f: ['lightningBolt', 'wings#bat'] },
  thunderroot: { f: ['leafBody', 'lightningBolt'] },
  timeline: { f: ['ring', 'shadowTwin'] },
  torrent: { f: ['swirl', 'drips'] },
  transcendent: { f: ['halo', 'stars', 'wisps'] },
  traveler: { f: ['backpack', 'walkingStick', 'cowboyHat'] },
  tribune: { f: ['galea', 'toga', 'scroll'] },
  trump: { f: ['pompadour', 'suitTie'] },
  tundra: { f: ['furBody', 'iceBody'] },
  ulfhednar: { f: ['pelt', 'axe', 'facePaint'] },
  underdog: { f: ['boxGloves', 'bandaid', 'headband'] },
  valkyrie: { f: ['wingHelm', 'wings', 'spear'] },
  venom: { f: ['fangs', 'drips'] },
  vestal: { f: ['robe', 'torch', 'laurel'] },
  victor_oink_doom: { f: ['knightHelm', 'cape'] },
  viking: { f: ['hornHelm', 'axe', 'beard'] },
  warlord: { f: ['shoulderSpikes', 'armor', 'sword#big'] },
  watcher: { s: 'chunky', f: ['thirdEye', 'wisps'] },
  waterspout: { f: ['swirl', 'raindrops'] },
  wavelength: { f: ['visor', 'soundArcs'] },
  wellspring: { f: ['drips', 'raindrops'] },
  wen: { s: 'piglet', f: ['qmark'] },
  wildfire: { f: ['flameCrest', 'wisps'] },
  wizard: { f: ['wizardHat', 'robe', 'staffOrb'] },
  wolf_mode: { s: 'chunky', f: ['pelt', 'furBody', 'fangs'] },
  wrestler: { f: ['luchaMask', 'muscles'] },
  zen: { f: ['closedEyes', 'robe'] },
  zephyr: { f: ['windLines'] },
  ziggurat: { s: 'chunky', f: ['rockBody', 'gem'] },
  zombie: { f: ['rags', 'stitches'] },
};

const BODY_LAYER = new Set(Object.keys(FEATS).filter((k) => FEATS[k].layer === 'body'));
const LAYER_ORDER = ['back', 'body', 'head', 'face', 'held', 'post'];

function parseFeat(spec) {
  const [name, ...opts] = spec.split('#');
  const o = {};
  for (const op of opts) o[op] = 1;
  if (!FEATS[name]) throw new Error('unknown feature: ' + name);
  return { name, o };
}

// ---------- generation ----------
function generateGrid(key, cre, def) {
  const r = mulberry32(fnv('nv-nike:' + key));
  const g = new Grid();
  const feats = def.f.map(parseFeat);
  // plain pigs get a seeded chest pattern (unless explicitly plain)
  if (!def.plain && !feats.some((f) => BODY_LAYER.has(f.name)))
    feats.push({ name: 'chestPattern', o: {} });
  const tall = feats.some((f) => FEATS[f.name].tall);
  const m = planBase(r, def.s || 'biped', tall && (def.s || 'biped') === 'biped');
  const byLayer = (layer) => feats.filter((f) => FEATS[f.name].layer === layer);
  for (const f of byLayer('back')) FEATS[f.name].draw(g, r, m, f.o);
  drawPig(g, r, m);
  for (const layer of ['body', 'head', 'face', 'held'])
    for (const f of byLayer(layer)) FEATS[f.name].draw(g, r, m, f.o);
  shadePass(g);
  const { dx, dy } = anchorPass(g);
  // translate metrics for post-outline painters
  m.hx += dx; m.hy += dy; m.bx += dx; m.by += dy; m.headTop += dy; m.eyeY += dy; m.snoutY += dy;
  m.handL = [m.handL[0] + dx, m.handL[1] + dy]; m.handR = [m.handR[0] + dx, m.handR[1] + dy];
  outlinePass(g);
  for (const f of byLayer('post')) FEATS[f.name].draw(g, r, m, f.o);
  garnishPass(g, r, cre.rarity);
  return { g, m, feats };
}

function corruptGrid(key, g, m) {
  const r = mulberry32(fnv('nv-nike-corrupt:' + key));
  const g2 = g.clone();
  const n = ri(r, 2, 3);
  for (let i = 0; i < n; i++) {                            // corruption wisps
    const x = m.hx + ri(r, -m.hw - 3, m.hw + 3), y = m.headTop - ri(r, 1, 5);
    if (!g2.get(x, y)) g2.set(x, y, C.GLOW);
  }
  return g2;
}

// ---------- QC sheets ----------
function makeSheets(entries, perSheet = 40) {
  const paths = [];
  const COLS = 8, SCALE = 2, TILE_W = 140, TILE_H = 172;
  for (let s = 0; s * perSheet < entries.length; s++) {
    const chunk = entries.slice(s * perSheet, (s + 1) * perSheet);
    const rows = Math.ceil(chunk.length / COLS);
    const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    chunk.forEach((e, i) => {
      const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
      ctx.fillStyle = '#1c1c2c';
      ctx.fillRect(cx + 4, cy + 4, TILE_W - 8, 64 * SCALE + 4);
      ctx.drawImage(e.canvas, cx + (TILE_W - 64 * SCALE) / 2, cy + 6, 64 * SCALE, 64 * SCALE);
      ctx.fillStyle = '#e8e8f0';
      ctx.font = '11px "Liberation Sans"';
      ctx.textAlign = 'center';
      ctx.fillText(e.cre.name.replace(/ Nike$/, ''), cx + TILE_W / 2, cy + 64 * SCALE + 22);
      ctx.fillStyle = '#9090b0';
      ctx.font = '9px "Liberation Sans"';
      ctx.fillText(e.featStr.slice(0, 26), cx + TILE_W / 2, cy + 64 * SCALE + 34);
    });
    const p = path.join(SHEET_DIR, `sheet-${s + 1}.png`);
    fs.writeFileSync(p, cv.toBuffer('image/png'));
    paths.push(p);
  }
  return paths;
}

async function makeCalloutSheet(entries, names) {
  // side-by-side: original cutout (left) vs adaptation (right), 3x
  const wanted = names.map((n) => entries.find((e) => e.key === n)).filter(Boolean);
  const COLS = 3, SCALE = 3, TILE_W = 64 * SCALE * 2 + 36, TILE_H = 64 * SCALE + 44;
  const rows = Math.ceil(wanted.length / COLS);
  const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < wanted.length; i++) {
    const e = wanted[i];
    const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
    const orig = await loadImage(origPngBuffer(e.key));
    ctx.fillStyle = '#1c1c2c';
    ctx.fillRect(cx + 6, cy + 6, 64 * SCALE + 4, 64 * SCALE + 4);
    ctx.fillRect(cx + 64 * SCALE + 22, cy + 6, 64 * SCALE + 4, 64 * SCALE + 4);
    ctx.drawImage(orig, cx + 8, cy + 8, 64 * SCALE, 64 * SCALE);
    ctx.drawImage(e.canvas, cx + 64 * SCALE + 24, cy + 8, 64 * SCALE, 64 * SCALE);
    ctx.fillStyle = '#e8e8f0'; ctx.font = '13px "Liberation Sans"'; ctx.textAlign = 'center';
    ctx.fillText(e.cre.name + '  (orig | new)', cx + TILE_W / 2, cy + 64 * SCALE + 26);
    ctx.fillStyle = '#9090b0'; ctx.font = '10px "Liberation Sans"';
    ctx.fillText(e.featStr.slice(0, 44), cx + TILE_W / 2, cy + 64 * SCALE + 38);
  }
  const p = path.join(SHEET_DIR, 'sheet-callouts.png');
  fs.writeFileSync(p, cv.toBuffer('image/png'));
  return p;
}

function makeCorruptSheet(pairs) {
  // normal | corrupted side by side
  const COLS = 6, SCALE = 2, TILE_W = 64 * SCALE * 2 + 24, TILE_H = 64 * SCALE + 34;
  const rows = Math.ceil(pairs.length / COLS);
  const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  pairs.forEach((e, i) => {
    const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
    ctx.fillStyle = '#1c1c2c';
    ctx.fillRect(cx + 4, cy + 4, TILE_W - 8, 64 * SCALE + 4);
    ctx.drawImage(e.canvas, cx + 6, cy + 6, 64 * SCALE, 64 * SCALE);
    ctx.drawImage(e.corrupt, cx + 64 * SCALE + 16, cy + 6, 64 * SCALE, 64 * SCALE);
    ctx.fillStyle = '#e8e8f0'; ctx.font = '10px "Liberation Sans"'; ctx.textAlign = 'center';
    ctx.fillText(e.key, cx + TILE_W / 2, cy + 64 * SCALE + 22);
  });
  const p = path.join(SHEET_DIR, 'sheet-corrupt.png');
  fs.writeFileSync(p, cv.toBuffer('image/png'));
  return p;
}

// ---------- main ----------
async function main() {
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  fs.mkdirSync(BACK_SHEET_DIR, { recursive: true });
  fs.mkdirSync(BACK_DIR, { recursive: true });
  const nikes = Object.entries(CREATURES).filter(([, c]) => c.isNike === true);
  console.log(`nikes: ${nikes.length} of ${Object.keys(CREATURES).length} creatures`);

  // coverage check: every nike must be in the table, every table key must be a nike
  const spriteKeys = new Set(nikes.map(([, c]) => c.sprite));
  const missing = [...spriteKeys].filter((k) => !NIKES[k]);
  const extra = Object.keys(NIKES).filter((k) => !spriteKeys.has(k));
  if (missing.length || extra.length) {
    console.error('MAPPING GAP — missing:', missing, 'extra:', extra);
    process.exit(1);
  }
  // back-variant coverage: every feature needs a back painter or an
  // explicit 'hidden' marker
  const noBack = Object.keys(FEATS).filter((k) => !BACKS[k]);
  if (noBack.length) {
    console.error('BACK GAP — features without a back variant:', noBack);
    process.exit(1);
  }
  const backStats = { custom: 0, reused: 0, hidden: 0 };
  for (const k of Object.keys(BACKS)) {
    if (BACKS[k] === 'hidden') backStats.hidden++;
    else if (BACKS[k].draw === FEATS[k].draw) backStats.reused++;
    else backStats.custom++;
  }
  console.log(`back variants: ${backStats.custom} custom, ${backStats.reused} reused-as-is, ${backStats.hidden} hidden`);

  const corruptKeys = new Set(
    fs.readdirSync(CORRUPT_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));

  const entries = [];
  const audit = [];
  for (const [key, cre] of nikes) {
    const sk = cre.sprite;
    const def = NIKES[sk];
    const { usable } = await extractPalette(sk);
    const slots = applyOverrides(sk, assignSlots(cre, usable));
    const pal = buildPalette(slots);
    const { g, m, feats } = generateGrid(sk, cre, def);
    const canvas = renderPNG(g, pal);
    fs.writeFileSync(path.join(SPRITE_DIR, sk + '.png'), canvas.toBuffer('image/png'));
    const featStr = (def.s && def.s !== 'biped' ? def.s + ':' : '') +
      (feats.map((f) => f.name + (Object.keys(f.o).length ? '#' + Object.keys(f.o).join('#') : '')).join(',') || 'plain');
    const hexOf = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    audit.push([sk.padEnd(20), (def.s || 'biped').padEnd(7), featStr.padEnd(44),
      `skin=${hexOf(slots.skin)} cloth=${hexOf(slots.cloth)} acc=${hexOf(slots.acc)} acc2=${hexOf(slots.acc2)}`,
      slots.src].join(' | '));
    const entry = { key: sk, cre, canvas, featStr };
    // back-view battle sprite (player team is seen from behind). No
    // corrupted back variants — the player's nikes are purified.
    const { g: bgGrid } = generateBackGrid(sk, cre, def);
    const backCanvas = renderPNG(bgGrid, pal);
    fs.writeFileSync(path.join(BACK_DIR, sk + '.png'), backCanvas.toBuffer('image/png'));
    entry.back = backCanvas;
    if (corruptKeys.has(sk)) {
      const cg = corruptGrid(sk, g, m);
      const cc = renderPNG(cg, corruptPalette(pal));
      fs.writeFileSync(path.join(CORRUPT_DIR, sk + '.png'), cc.toBuffer('image/png'));
      entry.corrupt = cc;
    }
    entries.push(entry);
  }
  fs.writeFileSync(path.join(SHEET_DIR, 'audit.txt'), audit.sort().join('\n') + '\n');
  console.log(`wrote ${entries.length} sprites + ${entries.filter((e) => e.corrupt).length} corrupted variants`);
  console.log(`audit: ${path.join(SHEET_DIR, 'audit.txt')}`);

  entries.sort((a, b) => a.key.localeCompare(b.key));
  const sheets = makeSheets(entries);
  const callouts = ['piglet', 'emo', 'chef', 'viking', 'ninja', 'angel',
    'cyberpunk', 'gladiator', 'merchant', 'healer', 'thundergod', 'cosmic'];
  const cp = await makeCalloutSheet(entries, callouts);
  const corruptSheet = makeCorruptSheet(entries.filter((e) => e.corrupt));
  console.log('sheets:', [...sheets, cp, corruptSheet].join(' '));
  const backSheets = makeBackSheets(entries);
  const backCallouts = makeBackCalloutSheet(entries, callouts);
  console.log('back sheets:', [...backSheets, backCallouts].join(' '));
}

main();
