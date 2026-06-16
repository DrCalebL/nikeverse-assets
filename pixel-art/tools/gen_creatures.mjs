#!/usr/bin/env node
// NIKEVERSE — gen_creatures.mjs
// Procedural pixel-art battle sprites for the 144 creatures with no NFT art
// (creature.sprite === null in data/creatures.js).
//
//   node tools/gen_creatures.mjs
//
// For each art-less creature: bucket its NAME into a visual archetype via the
// keyword table below, then paint a 64x64 PNG (32x32 logical grid, 2x chunky
// pixels, transparent background, bottom-anchored, 1px outline) seeded by an
// FNV-1a hash of the creature key. Fully deterministic — no Math.random.
//
// Output: assets/sprites/<key>.png (never overwrites art for creatures that
// HAVE sprites) + QC contact sheets in /tmp/nv-creatures/.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createCanvas } = require('/tmp/node_modules/@napi-rs/canvas');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, '..');
const SPRITE_DIR = path.join(WEB, 'assets', 'sprites');
const SHEET_DIR = '/tmp/nv-creatures';

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
const chance = (r, p) => r() < p;

// ---------- palette ----------
const TYPE_COLORS = {
  Arcane: '#a050c8', Beast: '#a07850', Blaze: '#e86830', Brawler: '#c83838',
  Cosmic: '#6858c8', Frost: '#70c8e0', Gale: '#90b8e8', Mind: '#e870a8',
  Neutral: '#a8a098', Nexus: '#40b0a0', Oddity: '#b8a838', Radiant: '#f0d048',
  Shadow: '#504868', Sonic: '#48c8c8', Terra: '#b89048', Tide: '#4878e8',
  Volt: '#f0c818', Wild: '#68b848',
};
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const BLACK = [10, 8, 18], WHITE = [255, 255, 255];

// color slot ids stored in the grid
const C = { OUT: 1, DARK: 2, BASE: 3, LITE: 4, ACC: 5, ACC_L: 6, GLOW: 7, EYE: 8, PUPIL: 9, XDARK: 10 };

function buildPalette(cre, f) {
  let base = hex2rgb(TYPE_COLORS[cre.type] || TYPE_COLORS.Neutral);
  let acc = hex2rgb(TYPE_COLORS[cre.type2] || TYPE_COLORS[cre.type] || TYPE_COLORS.Neutral);
  if (f.bone) base = mix(base, [232, 226, 206], 0.72);            // skeletal: bone-tinted
  if (!cre.type2 || cre.type2 === cre.type) acc = mix(base, WHITE, 0.35); // mono-type: pale self-accent
  return {
    [C.OUT]: mix(base, BLACK, 0.68),
    [C.DARK]: mix(base, BLACK, 0.32),
    [C.BASE]: base,
    [C.LITE]: mix(base, WHITE, 0.42),
    [C.ACC]: acc,
    [C.ACC_L]: mix(acc, WHITE, 0.45),
    [C.GLOW]: mix(acc, WHITE, 0.72),
    [C.EYE]: [246, 246, 250],
    [C.PUPIL]: [22, 20, 36],
    [C.XDARK]: mix(base, BLACK, 0.82),
  };
}

// ---------- 32x32 pixel grid ----------
const N = 32;
class Grid {
  constructor() { this.g = new Uint8Array(N * N); this.dots = []; } // dots: 1px sub-cell details in 64-space
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
  // eye: white cell + 1px pupil dot (sub-cell, drawn after upscale). dir: -1 pupil left, +1 right, 0 center
  eye(x, y, dir = 0) {
    this.set(x, y, C.EYE);
    const px = x * 2 + (dir < 0 ? 0 : dir > 0 ? 1 : 0.5), py = y * 2 + 1;
    this.dots.push([Math.round(px), py, C.PUPIL]);
  }
  glowEye(x, y) { this.set(x, y, C.GLOW); this.dots.push([x * 2 + 1, y * 2 + 1, C.PUPIL]); }
  bigEye(x, y) {                                                   // 2-cell-wide eye with a 2x2px pupil
    this.set(x, y, C.EYE); this.set(x + 1, y, C.EYE);
    this.dots.push([x * 2 + 1, y * 2, C.PUPIL], [x * 2 + 2, y * 2, C.PUPIL],
      [x * 2 + 1, y * 2 + 1, C.PUPIL], [x * 2 + 2, y * 2 + 1, C.PUPIL]);
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
}

// ---------- post passes ----------
function shadePass(g) {
  // light from above, shadow below — only auto-shade plain BASE / ACC cells
  const src = g.g.slice();
  const at = (x, y) => (x < 0 || x >= N || y < 0 || y >= N ? 0 : src[y * N + x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = src[y * N + x];
    if (v === C.BASE) {
      if (!at(x, y - 1)) g.set(x, y, C.LITE);
      else if (!at(x, y + 1)) g.set(x, y, C.DARK);
    } else if (v === C.ACC) {
      if (!at(x, y - 1)) g.set(x, y, C.ACC_L);
    }
  }
}
function outlinePass(g) {
  // grow a 1px dark outline outward around everything painted so far
  const src = g.g.slice();
  const at = (x, y) => (x < 0 || x >= N || y < 0 || y >= N ? 0 : src[y * N + x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (src[y * N + x]) continue;
    if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) g.set(x, y, C.OUT);
  }
}
function anchorPass(g, floaty) {
  const b = g.bbox();
  if (b.x1 < 0) return;
  const targetBottom = floaty ? 28 : 30;            // outline adds one more row below
  const cx = Math.round((b.x0 + b.x1) / 2);
  g.shift(16 - cx, targetBottom - b.y1);
}
function garnishPass(g, r, rarity) {
  if (rarity !== 'Ultra Rare' && rarity !== 'Legendary') return;
  const b = g.bbox();
  const cx = Math.round((b.x0 + b.x1) / 2);
  const n = rarity === 'Legendary' ? 6 : 4;
  for (let i = 0; i < n; i++) {                      // floating glow motes around the crown
    const x = cx + ri(r, -7, 7), y = b.y0 - ri(r, 1, 4);
    if (!g.get(x, y)) g.set(x, y, C.GLOW);
  }
  if (rarity === 'Legendary') {                      // tiny crest above the head
    const tx = cx, ty = Math.max(1, b.y0 - 2);
    g.set(tx, ty - 1, C.GLOW); g.set(tx - 1, ty, C.GLOW); g.set(tx + 1, ty, C.GLOW);
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
    if (img.data[o + 3] === 0) continue;             // pupil dots only over painted cells
    const [R, G2, B] = pal[c];
    img.data[o] = R; img.data[o + 1] = G2; img.data[o + 2] = B; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- archetype keyword table ----------
// Ordered rules; FIRST match wins. Each: [regex, archetype, extra features].
// Specific creature concepts come first so they aren't swallowed by broad
// buckets (e.g. "rift warden" is a humanoid keeper, "dimensional rift" a rift).
const RULES = [
  // --- one-of-a-kind concepts / literal objects ---
  [/sphinx/, 'sphinx', {}],
  [/butterfly|\bmoth\b/, 'butterfly', {}],
  [/scarecrow/, 'humanoid', { scarecrow: 1 }],
  [/watcher|all.?seeing/, 'eyeball', {}],
  [/\bai\b|mainframe/, 'corebot', {}],
  [/drone/, 'drone', {}],
  [/mimic/, 'mimic', {}],
  [/firewall/, 'wall', {}],
  [/\bloop\b/, 'ring', {}],
  [/hand\b/, 'hand', {}],
  [/\bhive\b|swarm/, 'hive', {}],
  [/anchor/, 'anchor', {}],
  [/dokuro|skeleton/, 'skeleton', {}],
  [/\brift\b(?!.*(warden|keeper))/, 'rift', {}],
  [/eater|devourer|\bmaw\b/, 'maw', {}],
  // --- named humanoid jobs (before beast/warrior buckets) ---
  [/keeper|warden|weaver/, 'humanoid', { robe: 1, staff: 1 }],
  [/shifter/, 'humanoid', { glitch: 1 }],
  [/harvester|reaper/, 'humanoid', { robe: 1, scythe: 1 }],
  [/puppeteer/, 'humanoid', { robe: 1, puppeteer: 1 }],
  [/binder/, 'humanoid', { robe: 1, chains: 1 }],
  [/reaver/, 'humanoid', { blades: 1 }],
  [/\bimp\b/, 'humanoid', { imp: 1 }],
  [/husk/, 'humanoid', { husk: 1 }],
  [/samurai|ronin/, 'humanoid', { katana: 1 }],
  [/tengu/, 'humanoid', { tengu: 1 }],
  [/incarnate|legionnaire|hoplite/, 'humanoid', { spear: 1, crest: 1 }],
  [/rider|surfer/, 'humanoid', { wave: 1 }],
  [/hoskinson/, 'humanoid', { charles: 1 }],
  // --- birds ---
  [/phoenix/, 'winged', { phoenix: 1 }],
  [/\browl\b|owl\b/, 'winged', { owl: 1 }],
  [/chicken|rooster|hen\b/, 'winged', { chicken: 1 }],
  [/\broc\b|hawk|eagle|raven|crow\b|falcon|vulture|condor|bird/, 'winged', { raptor: 1 }],
  // --- quadrupeds ---
  [/chimera/, 'quadruped', { chimera: 1 }],
  [/pegasus/, 'quadruped', { horse: 1, wings: 1 }],
  [/colt\b|horse|\bmare\b|stallion|unicorn/, 'quadruped', { horse: 1 }],
  [/wolf|fenrir/, 'quadruped', { canine: 1, wolf: 1 }],
  [/hound|\bdog\b|inugami|jackal/, 'quadruped', { canine: 1 }],
  [/kitsune/, 'quadruped', { fox: 1, tails: 3 }],
  [/\bfox\b/, 'quadruped', { fox: 1 }],
  [/stag|deer|elk\b|moose/, 'quadruped', { antlers: 1 }],
  [/\bcow\b|bull\b|bison|\box\b|yak\b/, 'quadruped', { cow: 1 }],
  [/mammoth|elephant/, 'quadruped', { mammoth: 1, big: 1 }],
  [/tortoise|turtle/, 'quadruped', { shell: 1 }],
  [/lion\b/, 'quadruped', { mane: 1 }],
  [/tanuki|raccoon|badger/, 'quadruped', { tanuki: 1 }],
  [/ferret|weasel|otter|stoat|mongoose/, 'quadruped', { longBody: 1 }],
  [/drake|wyvern/, 'quadruped', { drake: 1, wings: 1, horns: 1 }],
  [/howler/, 'quadruped', { canine: 1, wolf: 1, howl: 1 }],
  [/stalker|prowler|flayer|panther|dasher|apex\b/, 'quadruped', { predator: 1 }],
  [/minotaur/, 'biped', { bullHorns: 1 }],
  [/cyclops/, 'biped', { cyclops: 1 }],
  // --- serpents ---
  [/medusa/, 'serpent', { medusa: 1 }],
  [/onna/, 'serpent', { onna: 1 }],
  [/dragon/, 'serpent', { eastern: 1 }],
  [/nidhogg/, 'serpent', { horns: 1, big: 1 }],
  [/\bworm\b/, 'serpent', { worm: 1 }],
  [/wyrm/, 'serpent', { spikes: 1 }],
  [/tendril|tentacle/, 'serpent', { tendril: 1 }],
  [/serpent|snake|naga|cobra|viper|hydra|\beel\b/, 'serpent', {}],
  // --- aquatic ---
  [/leviathan/, 'aquatic', { leviathan: 1 }],
  [/kraken|horror\b|octopus/, 'aquatic', { kraken: 1 }],
  [/lurker/, 'aquatic', { lurker: 1 }],
  // --- insectoids ---
  [/jorogumo|spider|arachn|tarantula/, 'insectoid', { spider: 1 }],
  [/crawler|centipede|roach|beetle|scarab|mantis|insect/, 'insectoid', { crawler: 1 }],
  // --- hulking bipeds (before golem/warrior buckets) ---
  [/giant\b/, 'biped', { big: 1, belt: 1 }],
  [/troll|ogre/, 'biped', { tusks: 1 }],
  [/yeti|sasquatch/, 'biped', { fur: 1 }],
  [/\boni\b/, 'biped', { oniHorns: 1, club: 1 }],
  [/brute|juggernaut/, 'biped', { spikes: 1 }],
  [/abomination/, 'biped', { lumps: 1, extraEyes: 1 }],
  [/berserker/, 'biped', { oniHorns: 1, club: 1 }],
  // --- golems / constructs ---
  [/golem|colossus|guardian|sentinel|automaton|titan|construct/, 'golem', {}],
  // --- ghosts (after dragon/colossus/stalker so "spirit dragon" etc. resolve first) ---
  [/wraith|ghost|phantom|specter|spectre|shade\b|banshee|spirit|soul\b|echo\b|herald|wanderer|corruptor|draugr|tsukumogami|shadow\b/, 'ghost', {}],
  // --- generic warriors ---
  [/warrior|knight|gladiator|champion|fighter|duelist/, 'humanoid', { katana: 1 }],
  // --- elementals / blobs / anomalies ---
  [/sludge|ooze|slime\b/, 'elemental', { blob: 1, drips: 1 }],
  [/spawn\b/, 'elemental', { blob: 1, tendrils: 1, manyEyes: 1 }],
  [/virus|glitch|error/, 'elemental', { glitchy: 1 }],
  [/null\b/, 'elemental', { orb: 1 }],
  [/fragment|shard\b/, 'elemental', { fragments: 1 }],
  [/spark\b/, 'elemental', { spark: 1 }],
  [/wisp|sprite\b/, 'elemental', { wisp: 1 }],
  [/flame|ember|fire\b|vestal/, 'elemental', { flame: 1 }],
  [/glacier|\bice\b|frost.*elemental|crystal/, 'elemental', { crystal: 1 }],
  [/elemental|entity\b/, 'elemental', {}],
  [/\bvoid$/, 'elemental', { orb: 1, swirl: 1 }],
  // --- stragglers that still read as a beast ---
  [/beast\b|fang|claw\b/, 'quadruped', { predator: 1 }],
];

// per-key nudges for names whose flavor a keyword can't carry
const KEY_FEATURES = {
  bramble_beast: { thorns: 1 }, mirage_dasher: { lean: 1 }, retnuhxed_apex: { spikes: 1, big: 1 },
  retnuhxed_flayer: { claws: 1 }, dire_mammoth: {}, war_lion: { big: 1 },
  aqua_serpent: { fins: 1 }, tempest_wyrm: { fins: 1 }, data_serpent: { mech: 1 },
  abyssal_horror: { manyEyes: 1 }, swamp_lurker: { weeds: 1 },
  chrome_titan: { mech: 1, tall: 1 }, ref_automaton: { mech: 1, stripes: 1 },
  retnuhxed_sentinel: { mech: 1 }, core_guardian: { core: 1 }, corrupted_guardian: { cracks: 1, core: 1 },
  coral_guardian: { coral: 1 }, stone_guardian: { cracks: 1 }, pigment_shard_golem: { shards: 1 },
  apple_chip_golem: { chips: 1 }, paper_golem: { paper: 1 }, archive_golem: { book: 1 },
  rust_golem: { scrap: 1 }, scrap_golem: { scrap: 1 }, shadow_colossus: { tall: 1, core: 1 },
  retnuhxed_colossus: { tall: 1, spikes: 1 },
  champions_ghost: { crown: 1 }, colosseum_ghost: { crown: 1 }, retnuhxed_echo: { rings: 1 },
  senate_specter: { hood: 1 }, entropy_herald: { hood: 1, crest: 1 }, nolem_s_shadow: { big: 1 },
  draugr_horde: { horde: 1 }, tsukumogami: { object: 1 }, crowd_spirit: { horde: 1 },
  data_wraith: { glitchbits: 1 }, data_ghost: { glitchbits: 1 }, frost_wraith: { hood: 1 },
  nightmare_wraith: { hood: 1 }, retnuhxed_wraith: { hood: 1 }, retnuhxed_corruptor: { tendrils: 1 },
  bamboo_phantom: { stalks: 1 }, void_wanderer: { hood: 1 }, retnuhxed_shade: {},
  gashadokuro: { bone: 1 }, vestal_flame: { tall: 1 }, flame_sprite: { arms: 1 },
  memory_fragment: {}, origin_spark: {}, system_error: { bang: 1 },
  star_eater: { stars: 1 }, dimension_eater: { swirl: 1 }, retnuhxed_devourer: {},
  trophy_mimic: { cup: 1 }, retnuhxed_mimic: { chest: 1 },
  blizzard_wolf: {}, fenrir_spawn: { big: 1, spikes: 1 }, cyber_hound: { mech: 1 },
  neon_hound: { mech: 1 }, netrunner_ferret: { mech: 1 }, dimensional_cow: { patches: 1 },
  lava_tortoise: { magma: 1 }, super_chicken: { cape: 1 }, storm_roc: { big: 1 },
  mars_incarnate: { crest: 1 }, betting_imp: { coin: 1 }, reality_shifter: {},
  starweaver: { stars: 1 }, og_charles_hoskinson: { beard: 1 }, oni_berserker: {},
  yeti_warrior: {}, snow_troll: {}, frost_giant: { icy: 1 }, nure_onna: {},
  spirit_dragon: { whiskers: 1 }, megacorp_ai: {}, the_firewall: {}, time_loop: {},
  nexus_watcher: {}, security_drone: {}, nolem_s_hand: { claws: 1 },
  entropy_worm: { maw: 1 }, void_leviathan: { big: 1 }, retnuhxed_lurker: {},
  ice_drake: {}, mountain_drake: {}, medusa_serpent: {}, arena_serpent: {},
  nidhogg_serpent: {}, blackout_beast: { volt: 1 }, pit_beast: {}, nightmare_stalker: {},
  shadow_stalker: {}, retnuhxed_stalker: { lean: 1 }, retnuhxed_howler: {},
  inugami: { spirit: 1 }, samurai_fox: { foxfolk: 1 }, kitsune_sage: {}, yokai_tanuki: { leaf: 1 },
  virus_entity: {}, null_entity: {}, neon_elemental: { glow: 1 }, ice_elemental: { face: 1 },
  glacier_elemental: { big: 1, face: 1 }, retnuhxed_sludge: {}, retnuhxed_ember: {},
  retnuhxed_wisp: {}, corrupted_wisp: {}, arcane_wisp: {}, ember_wisp: {},
  void_spawn: {}, void_spawn_vb: {}, retnuhxed_void: {}, retnuhxed_hive: {},
  retnuhxed_binder: {}, retnuhxed_harvester: {}, retnuhxed_puppeteer: {}, retnuhxed_reaver: {},
  retnuhxed_brute: {}, retnuhxed_abomination: {}, retnuhxed_crawler: {}, jorogumo: {},
  retnuhxed_husk: {}, tidal_rider: {}, ronin_sentinel: {}, tengu_warrior: {},
  rift_warden: {}, nexus_keeper: {}, dimensional_rift: { eye: 1 }, reality_anchor: { runes: 1 },
  void_anchor: { chains: 1 }, crystal_stag: { crystalline: 1 }, desert_sphinx: {},
  aurora_phoenix: {}, barn_owl_guardian: {}, hologram_butterfly: {}, mystic_scarecrow: {},
  bronze_minotaur: {}, cyclops_sentinel: {}, terra_golem: {}, arena_golem: {},
  chimera_beast: {}, pegasus_colt: {}, war_golem: {}, retnuhxed_abyss: {},
};

function classify(key, name) {
  const n = name.toLowerCase();
  for (const [re, arche, feats] of RULES) {
    if (re.test(n)) return { arche, feats: { ...feats, ...(KEY_FEATURES[key] || {}) } };
  }
  return { arche: 'elemental', feats: { wisp: 1, ...(KEY_FEATURES[key] || {}) } }; // default per spec
}

const FLOATY = new Set(['ghost', 'eyeball', 'drone', 'butterfly', 'rift', 'ring', 'corebot']);

// =====================================================================
// PAINTERS — all draw on the 32x32 grid, roughly centered on x=16 with
// feet around y=29-30 (anchorPass trues this up afterwards).
// =====================================================================

function pQuadruped(g, r, f) {
  const long = f.longBody ? 3 : 0;
  const bw = (f.big ? 8 : ri(r, 6, 7)) + long;                     // body half-width
  const bh = (f.big ? 5 : ri(r, 3, 4)) - (f.lean || f.longBody ? 1 : 0);
  const legH = f.shell ? 3 : f.longBody ? 4 : f.horse || f.antlers ? 8 : f.mammoth ? 7 : ri(r, 5, 6);
  const by = 30 - legH - bh + 1;                                   // body center y
  const bx = 17;
  g.disc(bx, by, bw, bh, C.BASE);
  if (f.predator || f.wolf) g.disc(bx + bw - 3, by - 1, 4, bh, C.BASE); // haunch
  // legs
  const lw = f.mammoth || f.big ? 3 : 2;
  const ly = by + bh - 1;
  const xs = [bx - bw + 1, bx - bw + 4 + (long ? 1 : 0), bx + bw - 4 - lw + 1, bx + bw - 1 - lw + 1];
  for (const x of xs) { g.rect(x, ly, lw, 31 - ly, C.BASE); g.rect(x, 30, lw, 1, C.DARK); }
  // neck + head (facing left). Canines/predators carry the head LOW and
  // FORWARD (level with the back) — a tall vertical neck reads as a llama.
  const lowHead = f.canine || f.fox || f.predator || f.tanuki || f.mane;
  const hr = f.big || f.mammoth ? 4 : 3;
  let hx = bx - bw - 2, hy = by - bh - 3;
  if (lowHead) { hx = bx - bw - 3; hy = by - bh; }
  if (f.horse || f.antlers) hy -= 2;
  if (f.longBody || f.shell) { hx = bx - bw - 1; hy = by - 2; }
  if (f.howl) { hx = bx - bw + 1; hy = by - bh - 6; }
  g.line(bx - bw + 3, by - 1, hx + 2, hy + 1, C.BASE, f.big ? 4 : 3);
  g.disc(hx, hy, hr, hr - 1, C.BASE);
  if (f.wolf) g.disc(bx - bw + 3, by, 2.5, bh - 0.5, C.LITE);      // chest ruff
  // muzzle
  if (f.howl) {                                                    // snout points up-left, mouth open
    g.line(hx - 1, hy - 1, hx - 4, hy - 4, C.BASE, 2);
    g.set(hx - 4, hy - 3, C.XDARK); g.set(hx - 5, hy - 4, C.OUT);
  } else if (f.mammoth) {                                          // trunk
    g.line(hx - hr, hy + 1, hx - hr - 2, hy + 6, C.BASE, 2);
    g.set(hx - hr - 2, hy + 7, C.DARK);
    g.line(hx - hr + 1, hy + 2, hx - hr - 3, hy + 4, C.ACC, 1);    // tusk
    g.set(hx - hr - 4, hy + 4, C.ACC_L);
  } else {
    const ml = f.wolf ? 4 : f.canine || f.fox || f.predator ? 3 : 2;
    g.rect(hx - hr - ml + 1, hy, ml + 1, 2, C.BASE);
    g.set(hx - hr - ml + 1, hy, C.XDARK);                          // nose
    if (f.predator) g.set(hx - hr - 1, hy + 2, C.EYE);             // bared fang
  }
  // ears / horns / antlers
  if (f.canine || f.fox || f.predator || f.tanuki) {
    const eh = f.fox ? 3 : 2;
    g.line(hx - 2, hy - hr + 1, hx - 2, hy - hr - eh + 1, C.BASE, 1);
    g.line(hx + 1, hy - hr + 1, hx + 1, hy - hr - eh + 1, C.BASE, 1);
    if (f.fox) { g.set(hx - 2, hy - hr - eh, C.ACC); g.set(hx + 1, hy - hr - eh, C.ACC); }
  }
  if (f.horse) { g.set(hx, hy - hr, C.BASE); g.set(hx + 1, hy - hr - 1, C.BASE); }
  if (f.antlers) {                                                 // branching antlers
    for (const s of [-1, 2]) {
      const ax = hx + s;
      g.line(ax, hy - hr + 1, ax + 1, hy - hr - 3, C.ACC, 1);
      g.line(ax + 1, hy - hr - 3, ax - 1, hy - hr - 5, C.ACC, 1);
      g.set(ax + 2, hy - hr - 2, C.ACC); g.set(ax + 3, hy - hr - 4, C.ACC_L);
    }
  }
  if (f.cow) {                                                     // out-curved horns
    g.line(hx - 3, hy - hr + 1, hx - 5, hy - hr - 1, C.ACC_L, 1);
    g.line(hx + 2, hy - hr + 1, hx + 4, hy - hr - 1, C.ACC_L, 1);
    g.set(hx - 5, hy - hr - 2, C.EYE); g.set(hx + 4, hy - hr - 2, C.EYE);
  }
  if (f.horns || f.drake) {
    g.line(hx, hy - hr + 1, hx + 2, hy - hr - 2, C.ACC, 1);
    g.line(hx + 2, hy - hr + 1, hx + 4, hy - hr - 1, C.ACC, 1);
  }
  // tail
  const tx = bx + bw - 1, ty = by - 1;
  if (f.tails) {                                                   // kitsune fan
    for (let i = 0; i < f.tails; i++) {
      const a = -1 + i; g.line(tx, ty, tx + 4, ty - 4 + a * 3, C.BASE, 2);
      g.set(tx + 5, ty - 4 + a * 3, C.ACC_L);
    }
  } else if (f.chimera) {                                          // snake-head tail
    g.line(tx, ty, tx + 4, ty - 4, C.ACC, 2);
    g.disc(tx + 5, ty - 5, 1, 1, C.ACC); g.set(tx + 6, ty - 5, C.XDARK);
  } else if (f.fox || f.wolf || f.canine || f.tanuki) {            // bushy
    g.disc(tx + 2, ty - 2, 2, 3, C.BASE); g.set(tx + 3, ty - 4, C.ACC_L);
  } else if (f.horse) {
    g.line(tx, ty, tx + 2, ty + 5, C.ACC, 2);
  } else if (!f.shell) {
    g.line(tx, ty + 1, tx + 4, ty - 2, C.BASE, 1); g.set(tx + 5, ty - 3, C.DARK);
  }
  // back features
  if (f.shell) {                                                   // tortoise dome
    g.disc(bx, by - bh - 1, bw - 1, 4, C.ACC);
    g.disc(bx, by - bh - 1, bw - 3, 2, C.ACC_L);
    if (f.magma) for (let i = -2; i <= 2; i += 2) g.set(bx + i * 2, by - bh - 1, C.GLOW);
  }
  if (f.mane) { g.disc(hx + 2, hy + 1, hr + 2, hr + 2, C.ACC); g.disc(hx, hy, hr, hr - 1, C.BASE); g.rect(hx - hr - 2, hy, 3, 2, C.BASE); g.set(hx - hr - 2, hy, C.XDARK); }
  if (f.wings && !f.drake) {                                       // pegasus wing up from back
    g.line(bx - 1, by - bh, bx + 3, by - bh - 5, C.ACC_L, 2);
    g.line(bx + 3, by - bh - 5, bx + 7, by - bh - 6, C.ACC_L, 2);
    g.line(bx, by - bh + 1, bx + 5, by - bh - 2, C.EYE, 1);
  }
  if (f.drake) {                                                   // bat-ish wing
    g.line(bx, by - bh, bx + 4, by - bh - 6, C.ACC, 2);
    g.line(bx + 4, by - bh - 6, bx + 8, by - bh - 1, C.ACC, 1);
    g.line(bx + 4, by - bh - 5, bx + 2, by - bh, C.DARK, 1);
  }
  if (f.thorns || f.spikes) for (let i = -1; i <= 2; i++) g.set(bx + i * 3, by - bh - 1, C.ACC);
  if (f.chimera) {                                                 // second (goat) head
    g.disc(hx + 5, hy - 2, 2, 2, C.ACC);
    g.line(hx + 5, hy - 4, hx + 4, hy - 6, C.ACC_L, 1);
    g.line(hx + 6, hy - 4, hx + 7, hy - 6, C.ACC_L, 1);
    g.eye(hx + 4, hy - 2, -1);
  }
  if (f.patches) { g.disc(bx + 2, by, 2, 1, C.ACC); g.disc(bx - 3, by + 1, 1, 1, C.ACC); }
  if (f.crystalline) for (let i = -1; i <= 1; i++) g.set(bx + i * 3, by - bh, C.GLOW);
  if (f.mech) { g.set(bx, by, C.GLOW); g.set(bx + 3, by, C.GLOW); g.set(bx - 3, by, C.GLOW); }
  // eye
  if (!f.howl) g.eye(hx - 1, hy - 1, -1); else g.set(hx - 1, hy - 2, C.XDARK);
}

function pWinged(g, r, f) {
  const spread = f.phoenix || f.raptor || f.big ? 1 : 0;
  const bx = 16, brx = f.chicken ? 4 : 3 + (f.big ? 1 : 0), bry = ri(r, 4, 5);
  const by = 30 - 3 - bry;                                          // legs ~3
  g.disc(bx, by, brx, bry, C.BASE);                                 // body
  const hy = by - bry - 1, hr = f.owl ? 4 : 3;
  g.disc(bx, hy - hr + 2, hr, hr - 1, C.BASE);                      // head
  // legs
  for (const s of [-2, 2]) { g.line(bx + s, by + bry - 1, bx + s, 30, C.ACC, 1); g.set(bx + s - 1, 30, C.ACC); g.set(bx + s + 1, 30, C.ACC); }
  if (spread) {                                                     // big spread wings w/ feather notches
    for (const s of [-1, 1]) {
      const x0 = bx + s * brx;
      g.line(x0, by - 2, x0 + s * 5, by - 6, C.BASE, 2);
      g.line(x0 + s * 5, by - 6, x0 + s * 10, by - 8, C.BASE, 2);
      g.line(x0 + s * 1, by - 1, x0 + s * 6, by - 5, C.BASE, 2);    // wing underside (solid, no floaters)
      g.line(x0 + s * 4, by - 4, x0 + s * 9, by - 6, f.phoenix ? C.ACC : C.DARK, 1);
      for (let i = 3; i <= 9; i += 3) g.set(x0 + s * i, by - 3 + Math.floor(i / 4), C.DARK); // attached feather notches
      g.set(x0 + s * 10, by - 7, f.phoenix ? C.ACC_L : C.LITE);     // wingtip
    }
  } else {                                                          // folded wings on flanks
    for (const s of [-1, 1]) { g.disc(bx + s * (brx - 1), by, 2, bry - 1, C.DARK); g.set(bx + s * (brx - 1), by - bry + 2, C.ACC); }
  }
  // beak
  const bkY = hy - hr + 3;
  if (f.owl) { g.set(bx, bkY, C.ACC); g.set(bx, bkY + 1, C.XDARK); }
  else { g.set(bx - 1, bkY, C.ACC); g.set(bx, bkY, C.ACC); g.set(bx + 1, bkY, C.ACC); g.set(bx, bkY + 1, C.ACC); }
  // face
  if (f.owl) {                                                      // facial disc + ear tufts
    g.disc(bx - 2, hy - hr + 2, 1.6, 1.6, C.LITE); g.disc(bx + 2, hy - hr + 2, 1.6, 1.6, C.LITE);
    g.set(bx - hr, hy - hr - 1 + 2, C.BASE); g.set(bx + hr, hy - hr - 1 + 2, C.BASE);
    g.eye(bx - 2, hy - hr + 2, 0); g.eye(bx + 2, hy - hr + 2, 0);
  } else { g.eye(bx - 2, hy - hr + 2, -1); g.eye(bx + 2, hy - hr + 2, 1); }
  if (f.phoenix) {                                                  // crest + flowing tail plumes
    for (const [dx, dy] of [[-2, -3], [0, -4], [2, -3]]) g.line(bx + dx, hy - hr, bx + dx * 2, hy - hr + dy, C.ACC, 1);
    for (let i = 0; i < 3; i++) { g.line(bx - 1 + i, by + bry, bx - 4 + i * 4, 30, i === 1 ? C.ACC : C.ACC_L, 1); }
    g.set(bx - 4, 30, C.GLOW); g.set(bx + 4, 30, C.GLOW);
  }
  if (f.chicken) {                                                  // comb + wattle + cape
    for (let i = -1; i <= 1; i++) g.set(bx + i, hy - hr + (i === 0 ? -1 : 0), C.ACC);
    g.set(bx, bkY + 2, C.ACC);
    g.line(bx + brx, by - bry + 1, bx + brx + 3, by + bry + 1, C.ACC, 2); // cape
    g.line(bx + brx + 3, by + bry + 1, bx + brx + 1, by + bry + 2, C.ACC, 1);
  }
  if (f.raptor) { g.line(bx - 1, by + bry, bx - 3, by + bry + 2, C.DARK, 1); g.line(bx + 1, by + bry, bx + 3, by + bry + 2, C.DARK, 1); } // tail feathers
}

function pButterfly(g, r, f) {
  const bx = 16, by = 18;
  for (const s of [-1, 1]) {                                        // upper + lower wing lobes
    g.disc(bx + s * 6, by - 3, 5, 4, C.ACC);
    g.disc(bx + s * 5, by + 4, 3.5, 3, C.BASE);
    g.disc(bx + s * 6, by - 3, 2, 1.5, C.GLOW);                     // wing spots
    g.set(bx + s * 5, by + 4, C.ACC_L);
    g.set(bx + s * 9, by - 5, C.GLOW);
  }
  g.rect(bx - 1, by - 5, 2, 12, C.DARK);                            // body
  g.disc(bx - 0.5, by - 6, 1.5, 1.5, C.BASE);                       // head
  g.line(bx - 1, by - 8, bx - 3, by - 10, C.DARK, 1); g.line(bx + 1, by - 8, bx + 3, by - 10, C.DARK, 1);
  g.set(bx - 3, by - 11, C.GLOW); g.set(bx + 3, by - 11, C.GLOW);   // antenna tips
  g.eye(bx - 1, by - 6, 0); g.eye(bx + 1, by - 6, 0);
}

function pSerpent(g, r, f) {
  if (f.tendril) {                                                  // single rising tentacle + pool
    g.disc(16, 29, 7, 2, C.DARK);
    let x = 16, dir = 1;
    for (let y = 28; y >= 8; y--) { g.rect(x - 1, y, 3, 1, C.BASE); if (y % 4 === 0) { x += dir; dir = -dir; } }
    g.disc(16, 7, 2, 2, C.BASE); g.set(15, 6, C.ACC); g.set(17, 6, C.ACC);
    g.line(11, 29, 9, 22, C.BASE, 2); g.set(9, 21, C.ACC);
    g.line(21, 29, 23, 24, C.BASE, 2); g.set(23, 23, C.ACC);
    for (let y = 12; y < 27; y += 4) g.set(x, y, C.ACC);            // suckers
    g.glowEye(15, 7); g.glowEye(17, 7);
    return;
  }
  const big = f.big || f.eastern;
  const humps = [[10, 27, 3.5], [17, 25, 4], [24, 27, 3]];
  for (const [hx, hy, hr2] of humps) g.disc(hx, hy, hr2, big ? 4 : 3, C.BASE);
  g.rect(25, 27, 4, 2, C.BASE); g.set(29, 26, C.BASE);              // tail taper
  if (f.worm) {                                                     // eyeless ringed maw-worm
    g.rect(7, 14, 4, 14, C.BASE);                                   // raised front segment
    g.disc(9, 12, 3, 3, C.BASE);
    g.disc(8, 11, 2, 2, C.XDARK);                                   // round maw
    for (const [tx2, ty2] of [[6, 10], [8, 9], [10, 10], [7, 13], [9, 13]]) g.set(tx2, ty2, C.EYE); // teeth ring
    for (let y = 16; y < 28; y += 3) g.rect(7, y, 4, 1, C.DARK);    // segment rings
    for (const [hx] of humps) g.line(hx - 2, 24, hx + 2, 24, C.DARK, 1);
    return;
  }
  // neck up from front hump + head facing left
  g.rect(8, 14, 3, 13, C.BASE);
  const hy = 12;
  g.disc(9, hy, 3, 2.5, C.BASE);
  g.rect(5, hy, 3, 2, C.BASE); g.set(5, hy, C.XDARK);               // snout + nose
  g.set(4, hy + 1, C.ACC); g.set(3, hy + 1, C.ACC);                 // tongue
  if (f.eastern) {                                                  // horns + whiskers + ridge
    g.line(10, hy - 3, 12, hy - 6, C.ACC, 1); g.line(8, hy - 3, 9, hy - 6, C.ACC, 1);
    g.line(5, hy + 2, 2, hy + 4, C.ACC_L, 1); g.line(6, hy + 3, 4, hy + 6, C.ACC_L, 1);
    for (const [hx, hy2, hr2] of humps) g.set(hx, hy2 - (big ? 5 : 4), C.ACC);
  }
  if (f.horns) { g.line(9, hy - 3, 11, hy - 6, C.ACC, 1); g.line(7, hy - 3, 6, hy - 6, C.ACC, 1); }
  if (f.medusa) for (let i = 0; i < 5; i++) {                       // snake hair
    const a = -2 + i; g.line(9 + a, hy - 2, 9 + a * 2, hy - 5 - (i % 2), C.ACC, 1);
    g.set(9 + a * 2, hy - 6 - (i % 2), C.ACC_L);
  }
  if (f.onna) {                                                     // pale face + long dark hair
    g.disc(9, hy, 2.5, 2, C.EYE);
    g.rect(11, hy - 3, 2, 12, C.XDARK); g.rect(7, hy - 3, 6, 2, C.XDARK);
    g.dots.push([16, hy * 2 + 1, C.PUPIL], [20, hy * 2 + 1, C.PUPIL]);
    g.set(8, hy + 1, C.ACC);                                        // small mouth
    for (const [hx, hy2] of humps) g.set(hx, hy2 - 3, C.ACC);
    return;
  }
  if (f.fins || f.spikes) {                                         // dorsal fins + tail fin
    for (const [hx, hy2, hr2] of humps) { g.set(hx, hy2 - (big ? 5 : 4), C.ACC); g.set(hx + 1, hy2 - (big ? 6 : 5), C.ACC); }
    g.line(29, 25, 31, 22, C.ACC, 1); g.line(29, 26, 31, 28, C.ACC, 1);
  }
  if (f.hood) { g.disc(9, hy, 4, 3.5, C.ACC); g.disc(9, hy, 3, 2.5, C.BASE); g.rect(5, hy, 3, 2, C.BASE); }
  for (const [hx, hy2] of humps) g.set(hx, hy2 + (big ? 3 : 2), C.DARK); // belly shade
  g.eye(8, hy - 1, -1);
}

function pBiped(g, r, f) {
  const tall = f.big ? 2 : 0;
  const tw = ri(r, 5, 6) + (f.big ? 1 : 0);                        // torso half-width
  const ty = 12 - tall, tb = 24;                                    // torso top / bottom
  g.disc(16, (ty + tb) / 2, tw, (tb - ty) / 2 + 1, C.BASE);         // barrel torso
  g.rect(16 - tw + 1, tb, 3, 30 - tb + 1, C.BASE);                  // legs
  g.rect(16 + tw - 4, tb, 3, 30 - tb + 1, C.BASE);
  g.rect(16 - tw + 1, 30, 3, 1, C.DARK); g.rect(16 + tw - 4, 30, 3, 1, C.DARK);
  // long heavy arms
  for (const s of [-1, 1]) {
    g.line(16 + s * tw, ty + 3, 16 + s * (tw + 3), tb + 2, C.BASE, 2);
    g.disc(16 + s * (tw + 3), tb + 3, 1.6, 1.6, C.BASE);            // fist
  }
  // low-set head
  const hy = ty - 2, hr = 3;
  g.disc(16, hy, hr, hr - 1, C.BASE);
  g.rect(13, hy + 2, 7, 1, C.DARK);                                 // jaw line
  if (f.cyclops) { g.disc(16, hy - 1, 1.4, 1.2, C.EYE); g.dots.push([32, hy * 2 - 1, C.PUPIL]); g.rect(14, hy - 3, 5, 1, C.XDARK); }
  else {
    g.rect(13, hy - 2, 7, 1, C.XDARK);                              // brow
    g.eye(14, hy - 1, 0); g.eye(18, hy - 1, 0);
  }
  if (f.bullHorns) { g.line(12, hy - 2, 9, hy - 5, C.EYE, 2); g.line(20, hy - 2, 23, hy - 5, C.EYE, 2); g.set(9, hy - 6, C.EYE); g.set(24, hy - 6, C.EYE); g.set(16, hy + 1, C.ACC); }
  if (f.oniHorns) { g.line(14, hy - 3, 13, hy - 5, C.EYE, 1); g.line(18, hy - 3, 19, hy - 5, C.EYE, 1); }
  if (f.tusks) { g.set(13, hy + 2, C.EYE); g.set(19, hy + 2, C.EYE); }
  if (f.fur) { g.disc(16, (ty + tb) / 2 + 1, tw - 2, (tb - ty) / 2 - 2, C.LITE); for (let i = 0; i < 4; i++) g.set(16 - tw + i * 4, ty + 1, C.LITE); }
  if (f.belt) { g.rect(16 - tw + 1, tb - 2, tw * 2 - 1, 1, C.ACC); g.set(16, tb - 2, C.ACC_L); }
  if (f.icy) for (const [sx, sy] of [[12, ty], [20, ty - 1], [16, ty - 1]]) { g.line(sx, sy, sx, sy - 2, C.LITE, 1); g.set(sx, sy - 3, C.EYE); } // ice spikes on the shoulders
  if (f.club) { g.line(16 + tw + 3, tb + 2, 16 + tw + 6, ty + 4, C.DARK, 2); g.disc(16 + tw + 6, ty + 3, 2, 2.5, C.DARK); g.set(16 + tw + 6, ty + 2, C.BASE); }
  if (f.spikes) for (const s of [-1, 1]) { g.set(16 + s * tw, ty + 1, C.ACC); g.set(16 + s * (tw - 2), ty - 1, C.ACC); }
  if (f.lumps) { g.disc(11, ty + 2, 2, 2, C.ACC); g.disc(22, ty + 4, 1.5, 1.5, C.ACC); }
  if (f.extraEyes) { g.glowEye(12, ty + 4); g.glowEye(21, ty + 2); }
}

function pGolem(g, r, f) {
  const mech = f.mech;
  const tw = (f.tall ? 6 : ri(r, 5, 6));                            // half-width
  const ty = f.tall ? 8 : 11;
  g.rect(16 - tw, ty, tw * 2, 9, C.BASE);                           // chest slab
  g.rect(16 - tw + 2, ty + 9, tw * 2 - 4, 4, C.BASE);               // hips
  g.rect(16 - tw + 2, ty + 13, 3, 30 - (ty + 13) + 1, C.BASE);      // legs
  g.rect(16 + tw - 5, ty + 13, 3, 30 - (ty + 13) + 1, C.BASE);
  g.rect(16 - tw + 1, 29, 5, 2, C.DARK); g.rect(16 + tw - 6, 29, 5, 2, C.DARK); // feet
  for (const s of [-1, 1]) {                                        // shoulder blocks + arms
    g.rect(16 + s * tw - (s > 0 ? 0 : 3), ty - 1, 3, 4, C.BASE);
    g.rect(16 + s * (tw + 1) - (s > 0 ? 0 : 2), ty + 3, 2, 9, C.BASE);
    g.rect(16 + s * (tw + 1) - (s > 0 ? 0 : 3), ty + 12, 3, 3, C.DARK); // fist
  }
  // head: floating cube for mechs, set-in block for rock
  const hy = ty - 4;
  g.rect(13, hy, 7, mech ? 3 : 4, C.BASE);
  if (mech) { g.rect(13, hy + 1, 7, 1, C.XDARK); g.set(14, hy + 1, C.GLOW); g.set(18, hy + 1, C.GLOW); g.set(16, hy - 1, C.DARK); g.set(16, hy - 2, C.ACC); } // dark visor w/ glow eyes + antenna
  else { g.glowEye(14, hy + 1); g.glowEye(18, hy + 1); }
  if (f.cracks) { g.line(14, ty + 2, 16, ty + 5, C.XDARK, 1); g.line(19, ty + 4, 18, ty + 7, C.XDARK, 1); }
  if (f.core) { g.disc(16, ty + 4, 2, 2, C.ACC); g.set(16, ty + 4, C.GLOW); }
  if (f.shards) for (const [sx, sy, l] of [[16 - tw, ty - 2, 3], [16 + tw, ty - 3, 4], [16, ty - 6, 2]]) { g.line(sx, sy + 2, sx + 1, sy - l + 2, C.ACC, 1); g.set(sx + 1, sy - l + 1, C.ACC_L); }
  if (f.coral) for (const s of [-1, 1]) { const x = 16 + s * (tw - 1); g.line(x, ty - 1, x, ty - 4, C.ACC, 1); g.line(x, ty - 3, x + s * 2, ty - 5, C.ACC, 1); g.set(x, ty - 5, C.ACC_L); }
  if (f.chips) { g.disc(13, ty + 3, 1, 1, C.ACC); g.disc(19, ty + 6, 1, 1, C.ACC); g.set(16, ty + 8, C.ACC); }
  if (f.paper) { g.line(16, ty, 16, ty + 8, C.LITE, 1); g.line(13, ty + 4, 19, ty + 4, C.LITE, 1); }
  if (f.book) { g.rect(13, ty + 2, 7, 5, C.ACC); g.line(16, ty + 2, 16, ty + 6, C.EYE, 1); g.line(14, ty + 3, 15, ty + 3, C.EYE, 1); g.line(17, ty + 3, 18, ty + 3, C.EYE, 1); }
  if (f.scrap) { g.set(12, ty + 1, C.ACC); g.set(20, ty + 6, C.ACC); g.set(14, ty + 10, C.ACC); g.set(16 + tw - 1, ty - 1, C.ACC_L); }
  if (f.stripes) for (let y = ty + 1; y < ty + 8; y += 2) g.rect(16 - 2, y, 4, 1, C.EYE);
  if (mech) for (let i = -1; i <= 1; i++) g.set(16 + i * 3, ty + 7, C.GLOW); // chest lights
}

function pGhost(g, r, f) {
  const big = f.big ? 1.5 : 0;
  const rx = 4.5 + big, top = 8 - big;
  g.disc(16, top + 4, rx, 4.5, C.BASE);                             // head/torso dome
  g.rect(16 - rx + 1, top + 6, rx * 2 - 1, 10, C.BASE);             // flowing body
  // ragged tapering wisp tips
  const tips = [[12, 27], [16, 29], [20, 26]];
  for (const [tx, ty] of tips) { g.line(tx, top + 15, tx + (tx < 16 ? -1 : 1), ty, C.BASE, 2); g.set(tx + (tx < 16 ? -1 : 1), ty + 1, C.DARK); }
  for (const s of [-1, 1]) g.line(16 + s * rx, top + 7, 16 + s * (rx + 3), top + 11, C.BASE, 2); // wisp arms
  if (f.hood) { g.disc(16, top + 3, rx - 1, 3.5, C.XDARK); g.glowEye(14, top + 3); g.glowEye(18, top + 3); }
  else { g.eye(14, top + 3, 0); g.eye(18, top + 3, 0); g.rect(15, top + 6, 3, 1, C.XDARK); }
  if (f.crown) { for (let i = -2; i <= 2; i += 2) g.set(16 + i, top - 2, C.ACC); g.rect(14, top - 1, 5, 1, C.ACC); }
  if (f.rings) for (const rr of [3, 5, 7]) { g.line(16 + rx + rr, top + 2, 16 + rx + rr, top + 8, C.ACC_L, 1); } // sonic arcs
  if (f.chains) { for (let i = 0; i < 4; i++) g.set(12 - i, top + 9 + i * 2, C.ACC); }
  if (f.horde) {                                                    // two smaller ghosts flanking
    for (const s of [-1, 1]) {
      const x = 16 + s * (rx + 4);
      g.disc(x, top + 9, 2.5, 3, C.DARK); g.line(x, top + 12, x, top + 16, C.DARK, 2);
      g.glowEye(x - 1, top + 8); g.glowEye(x + 1, top + 8);
    }
  }
  if (f.glitchbits) { g.set(16 + rx + 2, top + 1, C.ACC); g.set(16 - rx - 2, top + 6, C.ACC); g.set(16 + rx + 3, top + 13, C.ACC_L); g.rect(15, top + 8, 1, 1, C.ACC); }
  if (f.stalks) { g.line(16 - rx - 3, 29, 16 - rx - 3, 12, C.ACC, 1); g.set(16 - rx - 4, 12, C.ACC_L); g.set(16 - rx - 2, 14, C.ACC_L); }
  if (f.tendrils) for (const s of [-1, 1]) { g.line(16 + s * (rx + 3), top + 11, 16 + s * (rx + 5), top + 16, C.ACC, 1); g.set(16 + s * (rx + 5), top + 17, C.ACC); }
  if (f.crest) for (let i = -1; i <= 1; i++) g.set(16 + i * 2, top - 1 - (i === 0 ? 1 : 0), C.ACC);
  if (f.object) {                                                   // tsukumogami: possessed lantern
    g.rect(13, top + 5, 7, 6, C.ACC); g.rect(13, top + 5, 7, 1, C.XDARK); g.rect(13, top + 10, 7, 1, C.XDARK);
    g.disc(16, top + 7, 1.4, 1.2, C.EYE); g.dots.push([33, top * 2 + 15, C.PUPIL]);
    g.line(16, top + 11, 17, top + 13, C.ACC_L, 1);                 // tongue
  }
}

function pHumanoid(g, r, f) {
  if (f.scarecrow) {
    g.rect(15, 12, 3, 17, C.BASE);                                  // post body
    g.rect(8, 13, 17, 2, C.DARK);                                   // cross arm
    g.line(9, 15, 9, 18, C.ACC, 1); g.line(23, 15, 23, 18, C.ACC, 1); // dangling sleeves/straw
    g.set(9, 19, C.ACC_L); g.set(23, 19, C.ACC_L);
    g.disc(16, 9, 3, 3, C.ACC);                                     // sack head
    g.rect(11, 6, 11, 1, C.DARK); g.rect(13, 3, 7, 3, C.DARK);      // hat
    g.set(16, 4, C.ACC);
    g.eye(15, 9, 0); g.eye(18, 9, 0); g.line(15, 11, 18, 11, C.XDARK, 1);
    g.rect(14, 29, 5, 2, C.DARK);                                   // base mound
    return;
  }
  const small = f.imp ? 1 : 0;
  const hy = small ? 14 : 9, hr = small ? 2.5 : 2.5;
  const ty = hy + 3, tb = small ? 25 : 21;                          // torso top/bottom
  const tw = small ? 3 : 4;
  if (f.robe) {                                                     // robe flares to the ground
    for (let y = ty; y <= 29; y++) { const w = tw + Math.floor((y - ty) * 0.45); g.rect(16 - w, y, w * 2 + 1, 1, C.BASE); }
    g.rect(16 - tw - 1, ty + 1, 2, 6, C.BASE); g.rect(16 + tw, ty + 1, 2, 6, C.BASE); // sleeves
  } else {
    g.rect(16 - tw, ty, tw * 2 + 1, tb - ty, C.BASE);               // torso
    g.rect(16 - tw + 1, tb, 2, 30 - tb + 1, C.BASE); g.rect(16 + tw - 2, tb, 2, 30 - tb + 1, C.BASE); // legs
    g.rect(16 - tw, 30, 3, 1, C.DARK); g.rect(16 + tw - 2, 30, 3, 1, C.DARK);
    for (const s of [-1, 1]) g.line(16 + s * (tw + 1), ty + 1, 16 + s * (tw + 2), ty + 7, C.BASE, 1); // arms
  }
  g.disc(16, hy, hr, hr, C.BASE);                                   // head
  if (f.husk) { g.glowEye(15, hy); g.glowEye(18, hy); g.rect(15, ty + 2, 3, 3, C.XDARK); } // hollow chest
  else if (f.foxfolk) {
    g.set(14, hy - 3, C.BASE); g.set(14, hy - 4, C.ACC); g.set(18, hy - 3, C.BASE); g.set(18, hy - 4, C.ACC); // fox ears
    g.rect(15, hy + 1, 3, 1, C.LITE);                               // muzzle
    g.eye(15, hy, 0); g.eye(18, hy, 0);
    g.line(16 + tw + 2, tb, 16 + tw + 4, tb - 4, C.ACC, 2);         // tail
  } else if (f.tengu) {
    g.eye(15, hy, 0); g.eye(18, hy, 0);
    g.rect(12, hy + 1, 3, 1, C.ACC);                                // long nose
    for (const s of [-1, 1]) { g.line(16 + s * (tw + 1), ty + 2, 16 + s * (tw + 5), ty - 2, C.DARK, 2); g.set(16 + s * (tw + 5), ty - 3, C.DARK); } // wings
  } else if (f.charles) {
    g.rect(14, hy, 2, 1, C.EYE); g.rect(17, hy, 2, 1, C.EYE); g.set(16, hy, C.XDARK); // glasses
    g.rect(14, hy + 2, 5, 2, C.ACC_L);                              // beard
    g.rect(15, ty, 3, 4, C.EYE); g.set(16, ty + 1, C.ACC);          // shirt + tie
  } else { g.eye(15, hy, 0); g.eye(18, hy, 0); }
  if (f.imp) {
    g.set(14, hy - 3, C.ACC); g.set(18, hy - 3, C.ACC);             // horns
    g.line(16 + tw + 1, tb, 16 + tw + 4, tb - 3, C.ACC, 1); g.set(16 + tw + 5, tb - 4, C.ACC); // arrow tail
    if (f.coin) { g.disc(16 - tw - 3, ty + 5, 1.4, 1.4, C.GLOW); }
  }
  if (f.staff) { g.line(16 + tw + 3, 29, 16 + tw + 3, hy - 2, C.DARK, 1); g.disc(16 + tw + 3, hy - 3, 1.4, 1.4, C.ACC); g.set(16 + tw + 3, hy - 3, C.GLOW); }
  if (f.scythe) { g.line(16 + tw + 3, 29, 16 + tw + 3, hy - 4, C.DARK, 1); g.line(16 + tw + 3, hy - 4, 16 + tw - 2, hy - 6, C.ACC_L, 1); g.line(16 + tw - 2, hy - 6, 16 + tw - 4, hy - 4, C.ACC_L, 1); }
  if (f.katana) { g.line(16 + tw + 2, ty + 7, 16 + tw + 6, ty - 3, C.EYE, 1); g.set(16 + tw + 2, ty + 8, C.ACC); }
  if (f.spear) { g.line(16 - tw - 2, 29, 16 - tw - 2, hy - 5, C.DARK, 1); g.set(16 - tw - 2, hy - 6, C.ACC_L); g.set(16 - tw - 2, hy - 7, C.ACC_L); }
  if (f.blades) for (const s of [-1, 1]) g.line(16 + s * (tw + 2), ty + 7, 16 + s * (tw + 4), ty + 12, C.ACC_L, 1);
  if (f.crest) for (let i = -1; i <= 1; i++) g.set(16 + i, hy - 4, C.ACC);  // helmet crest
  if (f.chains) for (let i = 0; i < 3; i++) { g.set(16 - tw - 2 - i, ty + 8 + i * 2, C.ACC); g.set(16 + tw + 2 + i, ty + 8 + i * 2, C.ACC); }
  if (f.puppeteer) {
    for (const s of [-1, 1]) {                                      // arms raised, strings down
      g.line(16 + s * (tw + 1), ty + 2, 16 + s * (tw + 4), ty - 4, C.BASE, 1);
      g.line(16 + s * (tw + 4), ty - 3, 16 + s * (tw + 4), ty + 6, C.ACC_L, 1);
      g.set(16 + s * (tw + 4), ty + 7, C.ACC);
    }
  }
  if (f.glitch) { for (let y = ty; y < tb; y += 2) g.set(16 + tw + 1, y, C.ACC); g.set(16 - tw - 1, hy, C.ACC); g.rect(19, hy - 2, 2, 1, C.ACC); } // offset echo
  if (f.stars) { g.set(11, 8, C.GLOW); g.set(22, 6, C.GLOW); g.set(24, 12, C.ACC_L); g.set(9, 14, C.ACC_L); }
  if (f.wave) {                                                     // crouched on a wave crest
    for (let x = 6; x <= 26; x++) { const y = 27 - Math.round(Math.sin((x - 6) / 3.2) * 2); g.rect(x, y, 1, 30 - y + 1, C.ACC); }
    g.set(7, 24, C.GLOW); g.set(11, 23, C.GLOW); g.set(25, 24, C.GLOW);
  }
}

function pElemental(g, r, f) {
  if (f.crystal) {                                                  // shard cluster
    const shards = [[16, 8, 4], [11, 14, 3], [22, 13, 3], [8, 20, 2], [25, 19, 2]];
    for (const [sx, sy, w] of shards) {
      for (let y = sy; y <= 29; y++) {
        const ww = Math.min(w, Math.max(1, Math.round((y - sy) * 0.6) + 1));
        g.rect(sx - ww + 1, y, ww * 2 - 1, 1, C.BASE);
      }
      g.line(sx - 1, sy + 2, sx - 1, sy + 5, C.LITE, 1);            // facet shine
      g.set(sx, sy, C.GLOW);
    }
    if (f.face) { g.eye(14, 16, 0); g.eye(18, 16, 0); g.rect(15, 19, 3, 1, C.XDARK); }
    return;
  }
  if (f.flame || f.wisp) {                                          // living flame
    const tall2 = f.tall ? 4 : 0; const small = f.wisp && !f.tall ? 2 : 0;
    const baseY = 28, topY = 8 + small + (f.wisp ? 4 : 0) - tall2;
    for (let y = topY; y <= baseY; y++) {
      const t = (y - topY) / (baseY - topY);
      const w = Math.max(1, Math.round(Math.sin(Math.min(1, t * 1.35)) * (6 - small)));
      const wob = Math.round(Math.sin(y * 1.7) * (1 - t) * 1.6);
      g.rect(16 - w + wob, y, w * 2, 1, C.BASE);
    }
    for (let y = topY + 5; y <= baseY - 1; y++) {                   // hot core
      const t = (y - (topY + 5)) / (baseY - topY - 5);
      const w = Math.max(1, Math.round(Math.sin(Math.min(1, t * 1.3)) * (3 - small)));
      g.rect(16 - w, y, w * 2, 1, C.ACC_L);
    }
    g.set(16 + 7 - small, baseY - 4, C.ACC); g.set(16 - 8 + small, baseY - 7, C.ACC); // sparks
    g.set(16 + 5, topY + 2, C.GLOW);
    if (f.arms) for (const s of [-1, 1]) { g.line(16 + s * (5 - small), 22, 16 + s * (8 - small), 19, C.BASE, 2); g.set(16 + s * (8 - small), 18, C.ACC_L); }
    // face low on the flame where the body is widest (the top wobbles)
    const fy = baseY - 6;
    g.rect(13, fy, 2, 2, C.XDARK); g.rect(18, fy, 2, 2, C.XDARK);   // dark sockets
    g.dots.push([27, fy * 2 + 1, C.EYE], [37, fy * 2 + 1, C.EYE]);  // glints
    g.rect(15, baseY - 3, 3, 1, C.XDARK);                           // mouth
    return;
  }
  if (f.glitchy) {                                                  // misaligned glitch blocks
    g.rect(12, 14, 9, 9, C.BASE);
    g.rect(9, 11, 4, 4, C.ACC); g.rect(21, 17, 5, 3, C.ACC); g.rect(14, 24, 4, 4, C.DARK);
    g.rect(22, 9, 3, 3, C.BASE); g.rect(7, 20, 3, 3, C.ACC_L);
    g.set(26, 14, C.GLOW); g.set(6, 15, C.GLOW); g.set(19, 7, C.ACC_L);
    g.rect(14, 27, 7, 2, C.DARK);
    g.eye(14, 17, 0); g.eye(18, 17, 0);
    if (f.bang) { g.rect(16, 9, 1, 3, C.GLOW); g.set(16, 13, C.GLOW); } // "!" tick
    return;
  }
  if (f.orb) {                                                      // featureless entity-orb
    g.disc(16, 19, 6.5, 6.5, C.BASE);
    g.disc(13, 16, 1.8, 1.5, C.LITE);
    if (f.swirl) { g.line(13, 19, 19, 17, C.ACC, 1); g.line(15, 22, 20, 20, C.ACC, 1); }
    g.line(8, 24, 6, 27, C.DARK, 1); g.line(24, 24, 26, 27, C.DARK, 1); // drips off the orb
    g.bigEye(13, 18); g.bigEye(18, 18);
    return;
  }
  if (f.fragments) {                                                // floating shard stack
    g.rect(13, 22, 7, 5, C.BASE); g.line(13, 22, 19, 26, C.LITE, 1);
    g.rect(11, 14, 6, 5, C.BASE); g.set(12, 15, C.LITE);
    g.rect(18, 9, 5, 4, C.ACC); g.set(19, 10, C.GLOW);
    g.set(16, 20, C.GLOW); g.set(17, 13, C.GLOW); g.set(10, 11, C.ACC_L);
    g.eye(13, 16, 0); g.eye(15, 16, 0);
    return;
  }
  if (f.spark) {                                                    // radiant starburst
    g.disc(16, 17, 3.5, 3.5, C.ACC_L);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]])
      g.line(16 + dx * 4, 17 + dy * 4, 16 + dx * (7 + (dx && dy ? -1 : 0)), 17 + dy * (7 + (dx && dy ? -1 : 0)), C.BASE, 1);
    g.disc(16, 17, 1.6, 1.6, C.GLOW);
    g.set(10, 9, C.GLOW); g.set(23, 11, C.GLOW); g.set(22, 25, C.GLOW);
    g.eye(15, 16, 0); g.eye(18, 16, 0);
    return;
  }
  // default: blob / sludge / spawn
  g.disc(16, 23, 8, 5.5, C.BASE);
  g.disc(13, 19, 3, 2.5, C.BASE); g.disc(20, 18, 2.5, 2.5, C.BASE); // lumpy top
  if (f.drips) { g.line(9, 26, 8, 29, C.DARK, 1); g.line(24, 25, 25, 28, C.DARK, 1); g.set(16, 17, C.LITE); g.set(11, 21, C.ACC); g.set(21, 23, C.ACC); }
  if (f.tendrils) { g.line(10, 19, 7, 13, C.BASE, 2); g.line(22, 18, 25, 12, C.BASE, 2); g.set(7, 12, C.ACC); g.set(25, 11, C.ACC); }
  if (f.manyEyes) { g.eye(12, 21, 0); g.eye(17, 19, 0); g.eye(21, 22, 0); }
  else { g.eye(14, 21, 0); g.eye(19, 21, 0); }
  g.rect(15, 25, 4, 1, C.XDARK);                                    // wide mouth
  if (f.glow) { g.set(8, 20, C.GLOW); g.set(25, 19, C.GLOW); g.set(16, 14, C.GLOW); }
}

function pInsectoid(g, r, f) {
  if (f.spider) {
    g.disc(20, 21, 5.5, 4.5, C.BASE);                               // abdomen
    g.disc(11, 23, 3.5, 3, C.BASE);                                 // cephalothorax
    for (let i = 0; i < 4; i++) {                                   // arched legs
      const a = i / 3;
      g.line(13 - i, 22, 7 - i * 2 + 1, 17 + i, C.DARK, 1);
      g.line(7 - i * 2 + 1, 17 + i, 5 - i * 2 + 1, 29, C.DARK, 1);
      g.line(17 + i, 23, 23 + i * 2, 19 + i, C.DARK, 1);
      g.line(23 + i * 2, 19 + i, 25 + i * 2 - 14 + 14, 29, C.DARK, 1);
    }
    g.disc(20, 19, 2.5, 1.5, C.ACC);                                // abdomen marking
    g.set(20, 18, C.ACC_L);
    g.eye(9, 22, -1); g.eye(12, 22, -1);
    g.dots.push([17, 49, C.PUPIL]);
    g.set(8, 25, C.EYE); g.set(10, 25, C.EYE);                      // fangs
    return;
  }
  // crawler: low segmented bug
  g.disc(18, 25, 8, 3.5, C.BASE);
  g.disc(9, 25, 3, 3, C.BASE);                                      // head
  for (let x = 13; x <= 24; x += 4) g.line(x, 22, x, 28, C.DARK, 1); // segment lines
  for (let i = 0; i < 3; i++) {                                     // 3 leg pairs
    g.line(12 + i * 5, 28, 10 + i * 5, 30, C.DARK, 1);
    g.line(14 + i * 5, 28, 16 + i * 5, 30, C.DARK, 1);
  }
  g.line(8, 23, 5, 19, C.DARK, 1); g.line(10, 22, 9, 18, C.DARK, 1); // antennae
  g.set(4, 18, C.ACC); g.set(9, 17, C.ACC);
  g.set(6, 27, C.EYE); g.set(8, 28, C.EYE);                         // mandibles
  g.eye(8, 24, -1);
  g.set(13, 22, C.ACC); g.set(17, 22, C.ACC); g.set(21, 22, C.ACC); // back dots
}

function pAquatic(g, r, f) {
  if (f.leviathan) {                                                // great finned sea-serpent
    const humps = [[9, 25, 4, 5], [18, 23, 5, 6], [27, 26, 3, 4]];
    for (const [hx, hy, hrx, hry] of humps) g.disc(hx, hy, hrx, hry, C.BASE);
    g.disc(8, 14, 4, 3, C.BASE); g.rect(7, 16, 4, 7, C.BASE);       // head + neck
    g.rect(3, 14, 3, 2, C.BASE); g.set(3, 14, C.XDARK);             // jaw
    g.set(2, 16, C.EYE); g.set(4, 17, C.EYE);                       // teeth
    for (const [hx, hy, hrx, hry] of humps) { g.line(hx, hy - hry - 1, hx + 2, hy - hry - 3, C.ACC, 1); } // dorsal fins
    g.line(29, 24, 31, 20, C.ACC, 1); g.line(29, 25, 31, 28, C.ACC, 1); // fluke
    g.line(8, 11, 10, 8, C.ACC, 1); g.line(10, 12, 13, 10, C.ACC, 1); // head crest fins
    g.eye(7, 13, -1);
    return;
  }
  if (f.lurker) {                                                   // eyes above the waterline
    g.disc(16, 27, 10, 3, C.DARK);                                  // murk pool
    g.disc(16, 23, 6, 3.5, C.BASE);                                 // emerging crown
    g.line(11, 21, 11, 17, C.BASE, 2); g.line(21, 21, 21, 17, C.BASE, 2); // eye stalks
    g.eye(11, 16, 0); g.eye(21, 16, 0);
    g.line(6, 26, 4, 22, C.BASE, 2); g.set(4, 21, C.ACC);           // one reaching tentacle
    for (const x of [8, 13, 19, 24]) g.set(x, 25, C.ACC);           // ripples/bubbles
    if (f.weeds) { g.line(26, 27, 27, 21, C.ACC, 1); g.set(27, 20, C.ACC_L); g.set(26, 22, C.ACC_L); }
    return;
  }
  // kraken / abyssal horror: dome + tentacles + (many) eyes
  const dr = 6.5;
  g.disc(16, 13, dr, 5.5, C.BASE);
  g.rect(10, 15, 13, 4, C.BASE);
  const tents = [[10, 6], [13, 4], [16, 7], [19, 4], [22, 6]];
  let ti = 0;
  for (const [tx, len] of tents) {                                  // wavy tentacles to the floor
    const sway = ti % 2 === 0 ? -1 : 1;
    g.line(tx, 18, tx + sway, 18 + len, C.BASE, 2);
    g.line(tx + sway, 18 + len, tx + sway * 2, 29, C.BASE, 2);
    g.set(tx + sway * 2 + (sway > 0 ? 1 : -1), 29, C.DARK);         // curl tip
    g.set(tx + sway, 21 + (ti % 3), C.ACC);                         // sucker
    ti++;
  }
  if (f.manyEyes) { g.bigEye(12, 12); g.bigEye(18, 12); g.eye(16, 9, 0); g.glowEye(14, 15); g.glowEye(18, 15); }
  else { g.bigEye(12, 12); g.bigEye(18, 12); }
  g.set(11, 8, C.ACC); g.set(21, 7, C.ACC);                         // mottling
}

// ---------- one-off special painters ----------
function pSphinx(g, r, f) {                                         // lion couchant + nemes headdress, front-facing head
  g.rect(9, 22, 17, 7, C.BASE);                                     // lying body
  g.disc(23, 24, 4, 4, C.BASE);                                     // haunch
  g.rect(8, 26, 9, 3, C.BASE);                                      // forelegs extended on the ground
  g.rect(7, 28, 5, 2, C.DARK); g.rect(13, 28, 4, 2, C.DARK);        // paws
  g.line(27, 23, 30, 18, C.BASE, 1); g.set(30, 17, C.ACC);          // tail w/ tuft
  g.line(16, 18, 20, 12, C.ACC, 2);                                 // wing raised clear of the back
  g.line(20, 12, 26, 14, C.ACC, 2);
  g.line(18, 17, 23, 15, C.ACC_L, 1);                               // wing feather line
  g.rect(10, 16, 5, 6, C.BASE);                                     // upright chest/neck
  // nemes headdress: gold body-color flaps with accent stripes (not a hair blob)
  g.rect(9, 10, 2, 8, C.BASE); g.rect(14, 10, 2, 8, C.BASE);        // side flaps (straight)
  g.set(9, 12, C.ACC); g.set(15, 12, C.ACC);                        // flap stripes
  g.set(9, 15, C.ACC); g.set(15, 15, C.ACC);
  g.rect(9, 9, 7, 1, C.ACC);                                        // brow band
  g.set(12, 8, C.GLOW);                                             // uraeus jewel
  g.rect(11, 10, 3, 6, C.LITE);                                     // face (pale, front view)
  g.eye(11, 12, 0); g.eye(13, 12, 0);
  g.rect(11, 14, 3, 1, C.XDARK);                                    // calm mouth
  g.set(9, 18, C.ACC_L); g.set(15, 18, C.ACC_L);                    // flap tips
}

function pEyeball(g, r, f) {                                        // great floating eye
  g.disc(16, 16, 7.5, 7.5, C.BASE);
  g.disc(16, 16, 4.5, 4.5, C.EYE);
  g.disc(16, 16, 2.4, 2.4, C.ACC);
  g.rect(15, 15, 2, 2, C.PUPIL); g.set(15, 15, C.EYE);
  for (const [dx, dy] of [[-9, -5], [9, -5], [-10, 2], [10, 2], [0, -10]])
    g.line(16 + dx * 0.8, 16 + dy * 0.8, 16 + dx, 16 + dy, C.ACC, 1); // radiant lashes
  g.line(13, 24, 12, 28, C.DARK, 1); g.line(19, 24, 20, 28, C.DARK, 1); // trailing nerves
  g.set(12, 29, C.ACC); g.set(20, 29, C.ACC);
}

function pCorebot(g, r, f) {                                        // floating corporate AI core
  g.rect(9, 10, 15, 11, C.BASE);                                    // monitor slab
  g.rect(11, 12, 11, 7, C.XDARK);                                   // screen
  g.glowEye(14, 15); g.glowEye(19, 15);
  g.rect(13, 17, 7, 1, C.ACC);                                      // screen mouth line
  g.set(10, 8, C.DARK); g.set(10, 7, C.ACC); g.set(22, 8, C.DARK); g.set(22, 6, C.ACC); // antennae
  g.rect(12, 21, 3, 2, C.DARK); g.rect(18, 21, 3, 2, C.DARK);       // hover pods
  g.set(13, 24, C.GLOW); g.set(19, 24, C.GLOW);                     // thruster glow
  for (let x = 11; x <= 21; x += 2) g.set(x, 11, C.ACC);            // status lights
}

function pDrone(g, r, f) {
  g.disc(16, 18, 6, 4, C.BASE);                                     // pod
  g.disc(13, 18, 2.2, 2.2, C.XDARK); g.disc(13, 18, 1.2, 1.2, C.ACC); g.set(13, 17, C.EYE); // lens
  g.rect(10, 13, 2, 2, C.DARK); g.rect(21, 13, 2, 2, C.DARK);       // rotor masts
  g.rect(6, 12, 9, 1, C.ACC_L); g.rect(18, 12, 9, 1, C.ACC_L);      // rotor blur
  g.rect(21, 17, 5, 2, C.BASE); g.set(26, 17, C.ACC);               // tail fin
  g.set(16, 23, C.GLOW); g.set(14, 24, C.GLOW); g.set(18, 24, C.GLOW); // downwash glow
  g.set(16, 14, C.ACC);                                             // beacon
}

function pMimic(g, r, f) {
  if (f.cup) {                                                      // trophy cup gone feral
    g.rect(11, 9, 11, 8, C.BASE);                                   // bowl
    g.disc(16, 9, 5.5, 2, C.BASE);
    g.line(9, 10, 7, 13, C.BASE, 1); g.line(7, 13, 9, 15, C.BASE, 1);   // handles
    g.line(23, 10, 25, 13, C.BASE, 1); g.line(25, 13, 23, 15, C.BASE, 1);
    g.rect(14, 17, 5, 4, C.DARK);                                   // stem
    g.rect(11, 21, 11, 3, C.BASE); g.rect(10, 24, 13, 2, C.DARK);   // plinth
    g.rect(12, 13, 9, 3, C.XDARK);                                  // mouth gap
    for (let x = 12; x <= 20; x += 2) g.set(x, 13, C.EYE);          // teeth
    for (let x = 13; x <= 19; x += 2) g.set(x, 15, C.EYE);
    g.eye(13, 11, 0); g.eye(19, 11, 0);
    g.set(16, 22, C.GLOW);                                          // engraving glint
    return;
  }
  // treasure chest, lid ajar
  g.rect(9, 18, 15, 9, C.BASE);                                     // box
  g.rect(9, 12, 15, 4, C.DARK);                                     // lid (open)
  g.rect(9, 16, 15, 2, C.XDARK);                                    // dark gap
  for (let x = 10; x <= 22; x += 2) g.set(x, 16, C.EYE);            // teeth in the gap
  for (let x = 11; x <= 21; x += 2) g.set(x, 17, C.EYE);
  g.glowEye(13, 14); g.glowEye(19, 14);                             // eyes inside lid shadow
  g.line(16, 18, 18, 22, C.ACC, 2); g.set(18, 23, C.ACC);           // tongue lolling out
  g.rect(9, 21, 15, 1, C.ACC); g.rect(15, 18, 3, 9, C.ACC);         // banding
  g.set(16, 22, C.GLOW);                                            // latch
}

function pWall(g, r, f) {                                           // THE FIREWALL
  for (let row = 0; row < 5; row++) {                               // staggered brick courses
    const y = 13 + row * 4;
    for (let col = 0; col < 5; col++) {
      const x = 4 + col * 5 + (row % 2 ? 2 : 0);
      if (x + 4 > 28) continue;
      g.rect(x, y, 4, 3, C.BASE);
    }
  }
  g.rect(4, 13, 25, 20, C.BASE);                                    // fill gaps then re-cut mortar
  for (let row = 0; row <= 5; row++) g.rect(4, 12 + row * 4, 25, 1, C.XDARK);
  for (let row = 0; row < 5; row++) for (let col = 0; col <= 5; col++)
    g.set(4 + col * 5 + (row % 2 ? 2 : 0) - 1, 13 + row * 4 + 1, C.XDARK);
  for (let x = 5; x <= 27; x += 2) {                                // flames licking the top
    const h = 2 + ((x * 7) % 3);
    g.line(x, 12, x + ((x % 4) - 1), 12 - h, C.ACC, 1);
    g.set(x + ((x % 4) - 1), 11 - h, C.ACC_L);
  }
  g.glowEye(12, 19); g.glowEye(20, 19);                             // eyes between bricks
  g.rect(14, 23, 5, 1, C.ACC);                                      // mouth seam
}

function pRing(g, r, f) {                                           // TIME LOOP
  for (let a = 0; a < 64; a++) {                                    // thick torus
    const th = (a / 64) * Math.PI * 2;
    const x = 16 + Math.round(Math.cos(th) * 8), y = 16 + Math.round(Math.sin(th) * 8);
    g.set(x, y, C.BASE); g.set(16 + Math.round(Math.cos(th) * 7), 16 + Math.round(Math.sin(th) * 7), C.BASE);
  }
  g.line(16, 16, 16, 11, C.ACC, 1); g.line(16, 16, 20, 18, C.ACC, 1); // clock hands
  g.disc(16, 16, 1.2, 1.2, C.ACC_L);
  g.set(16, 7, C.GLOW); g.set(25, 16, C.GLOW); g.set(16, 25, C.GLOW); g.set(7, 16, C.GLOW); // hour marks
  g.eye(14, 13, 0); g.eye(18, 13, 0);                               // a face caught in the loop
  g.set(24, 8, C.ACC_L); g.set(8, 24, C.ACC_L);                     // motion echoes
}

function pHand(g, r, f) {                                           // NOLEM'S HAND
  g.rect(13, 24, 8, 7, C.BASE);                                     // wrist
  g.disc(17, 20, 6, 5, C.BASE);                                     // palm
  const fingers = [[11, 9, 2], [14, 7, 2], [17, 6, 2], [20, 8, 2]];
  for (const [fx, fy, fw] of fingers) {
    g.rect(fx, fy, fw, 17 - fy + 4, C.BASE);
    g.set(fx, fy - 1, C.ACC); g.set(fx + 1, fy - 1, C.ACC);         // claw tips
  }
  g.line(23, 19, 26, 15, C.BASE, 3);                                // thumb
  g.set(26, 13, C.ACC); g.set(27, 14, C.ACC);
  for (const [fx] of fingers) g.set(fx + 1, 16, C.DARK);            // knuckle creases
  g.set(13, 12, C.GLOW); g.set(19, 10, C.GLOW); g.set(16, 13, C.GLOW); // dark energy between fingers
  g.glowEye(16, 20); g.glowEye(19, 20);                             // palm eyes — it watches
}

function pAnchor(g, r, f) {
  g.disc(16, 7, 2.5, 2.5, C.BASE); g.disc(16, 7, 1, 1, 0);          // ring (punched hole)
  g.rect(15, 9, 3, 14, C.BASE);                                     // shank
  g.rect(10, 12, 13, 2, C.BASE);                                    // stock crossbar
  for (let t = 0; t <= 20; t++) {                                   // bottom arc flukes
    const th = Math.PI * (0.15 + 0.7 * (t / 20));
    g.set(16 - Math.round(Math.cos(th) * 8), 22 + Math.round(Math.sin(th) * 6) - 1, C.BASE);
    g.set(16 - Math.round(Math.cos(th) * 7), 22 + Math.round(Math.sin(th) * 5) - 1, C.BASE);
  }
  g.set(7, 22, C.ACC); g.set(8, 21, C.ACC); g.set(25, 22, C.ACC); g.set(24, 21, C.ACC); // fluke barbs
  if (f.runes) for (const [x, y] of [[16, 11], [16, 15], [16, 19]]) g.set(x, y, C.GLOW);
  if (f.chains) { g.line(20, 8, 25, 5, C.ACC, 1); g.set(26, 4, C.ACC); g.set(23, 7, C.ACC_L); }
  g.glowEye(14, 17); g.glowEye(18, 17);                             // possessed glow
}

function pRift(g, r, f) {                                           // vertical tear in reality
  for (let y = 6; y <= 28; y++) {
    const t = (y - 6) / 22;
    const w = Math.max(1, Math.round(Math.sin(t * Math.PI) * 5));
    g.rect(16 - w, y, w * 2, 1, C.XDARK);                           // void interior
    g.set(16 - w - 1, y, C.ACC); g.set(16 + w, y, C.ACC);           // glowing rim
  }
  g.line(10, 12, 6, 10, C.ACC_L, 1); g.line(22, 14, 26, 12, C.ACC_L, 1); // crack lines
  g.line(11, 22, 7, 24, C.ACC_L, 1); g.line(21, 24, 25, 26, C.ACC_L, 1);
  g.set(5, 9, C.GLOW); g.set(27, 11, C.GLOW); g.set(6, 25, C.GLOW); g.set(26, 27, C.GLOW); // debris
  if (f.eye) { g.eye(15, 16, 0); g.eye(18, 16, 0); }                // something looks out
}

function pMaw(g, r, f) {                                            // round body, enormous mouth
  g.disc(16, 18, 9, 8, C.BASE);
  g.disc(16, 20, 6.5, 4.5, C.XDARK);                                // gaping mouth
  for (let x = 11; x <= 21; x += 2) g.set(x, 16, C.EYE);            // upper teeth
  for (let x = 12; x <= 20; x += 2) g.set(x, 23, C.EYE);            // lower teeth
  if (f.swirl) { g.line(13, 19, 19, 18, C.ACC, 1); g.line(14, 21, 18, 20, C.ACC_L, 1); } // dimensional gullet
  if (f.stars) { g.set(14, 19, C.GLOW); g.set(18, 20, C.GLOW); g.set(16, 21, C.ACC_L); g.set(24, 9, C.GLOW); g.set(8, 8, C.GLOW); } // stars being eaten
  g.eye(13, 12, 0); g.eye(19, 12, 0);
  g.line(8, 13, 6, 9, C.BASE, 2); g.line(24, 13, 26, 9, C.BASE, 2); // horn-nubs
  g.set(6, 8, C.ACC); g.set(26, 8, C.ACC);
}

function pHive(g, r, f) {                                           // crawling hive mound
  g.disc(16, 24, 9, 6, C.BASE);
  g.disc(16, 18, 6, 4, C.BASE);                                     // upper tier
  for (const [hx, hy] of [[12, 23], [20, 23], [16, 26], [13, 17], [19, 17]]) g.disc(hx, hy, 1.2, 1.2, C.XDARK); // cells
  g.disc(16, 21, 2, 1.6, C.XDARK);                                  // main entrance
  g.glowEye(15, 21); g.glowEye(17, 21);                             // eyes inside
  for (const [bx, by] of [[7, 12], [24, 10], [10, 7], [22, 16]]) {  // flying drones
    g.set(bx, by, C.DARK); g.set(bx - 1, by - 1, C.ACC_L); g.set(bx + 1, by - 1, C.ACC_L);
  }
  g.line(9, 28, 8, 30, C.DARK, 1); g.line(23, 28, 24, 30, C.DARK, 1); // oozing base
}

function pSkeleton(g, r, f) {                                       // GASHADOKURO — looming giant skeleton
  g.disc(16, 8, 5, 4.5, C.BASE);                                    // skull
  g.rect(13, 11, 7, 3, C.BASE);                                     // jaw
  g.disc(14, 8, 1.6, 1.8, C.XDARK); g.disc(19, 8, 1.6, 1.8, C.XDARK); // sockets
  g.dots.push([29, 17, C.GLOW], [39, 17, C.GLOW]);                  // pinprick ghost-lights
  g.set(16, 10, C.XDARK);                                           // nose hole
  for (let x = 13; x <= 19; x += 2) g.set(x, 12, C.XDARK);          // teeth gaps
  g.rect(15, 14, 3, 3, C.BASE);                                     // neck
  g.rect(10, 17, 13, 1, C.BASE);                                    // clavicle
  for (let i = 0; i < 4; i++) g.rect(12, 18 + i * 2, 9, 1, C.BASE); // ribs
  g.rect(15, 18, 3, 8, C.DARK);                                     // spine behind ribs
  for (const s of [-1, 1]) {                                        // arm bones reaching forward
    g.line(16 + s * 7, 17, 16 + s * 9, 24, C.BASE, 2);
    g.disc(16 + s * 9, 25, 1.4, 1.4, C.BASE);                       // joint
    for (let fb = 0; fb < 3; fb++) g.line(16 + s * (8 + fb), 26, 16 + s * (8 + fb), 28, C.BASE, 1); // finger bones
  }
  g.rect(13, 26, 7, 2, C.BASE);                                     // pelvis
  g.rect(13, 28, 2, 3, C.BASE); g.rect(18, 28, 2, 3, C.BASE);       // leg bones
}

const PAINTERS = {
  quadruped: pQuadruped, winged: pWinged, butterfly: pButterfly, serpent: pSerpent,
  biped: pBiped, golem: pGolem, ghost: pGhost, humanoid: pHumanoid,
  elemental: pElemental, insectoid: pInsectoid, aquatic: pAquatic,
  sphinx: pSphinx, eyeball: pEyeball, corebot: pCorebot, drone: pDrone,
  mimic: pMimic, wall: pWall, ring: pRing, hand: pHand, anchor: pAnchor,
  rift: pRift, maw: pMaw, hive: pHive, skeleton: pSkeleton,
};

// ---------- generation ----------
function generateSprite(key, cre) {
  const { arche, feats } = classify(key, cre.name);
  const r = mulberry32(fnv('nv-sprite:' + key));
  const g = new Grid();
  const pal = buildPalette(cre, feats);
  PAINTERS[arche](g, r, feats);
  shadePass(g);
  anchorPass(g, FLOATY.has(arche) || feats.wisp);
  outlinePass(g);
  garnishPass(g, r, cre.rarity);
  return { arche, canvas: renderPNG(g, pal) };
}

function makeSheets(entries, perSheet = 40) {
  const paths = [];
  const COLS = 8, SCALE = 2, TILE_W = 140, TILE_H = 168;
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
      ctx.fillText(e.cre.name.slice(0, 22), cx + TILE_W / 2, cy + 64 * SCALE + 22);
      ctx.fillStyle = '#9090b0';
      ctx.font = '9px "Liberation Sans"';
      ctx.fillText(e.arche + ' · ' + e.cre.type + '/' + e.cre.type2, cx + TILE_W / 2, cy + 64 * SCALE + 34);
    });
    const p = path.join(SHEET_DIR, `sheet-${s + 1}.png`);
    fs.writeFileSync(p, cv.toBuffer('image/png'));
    paths.push(p);
  }
  return paths;
}

function makeCalloutSheet(entries, names) {
  const wanted = entries.filter((e) => names.includes(e.key));
  const COLS = 4, SCALE = 4, TILE_W = 280, TILE_H = 300;
  const rows = Math.ceil(wanted.length / COLS);
  const cv = createCanvas(COLS * TILE_W, rows * TILE_H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2a2a3e'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  wanted.forEach((e, i) => {
    const cx = (i % COLS) * TILE_W, cy = Math.floor(i / COLS) * TILE_H;
    ctx.fillStyle = '#1c1c2c'; ctx.fillRect(cx + 8, cy + 8, TILE_W - 16, 64 * SCALE + 8);
    ctx.drawImage(e.canvas, cx + (TILE_W - 64 * SCALE) / 2, cy + 12, 64 * SCALE, 64 * SCALE);
    ctx.fillStyle = '#e8e8f0'; ctx.font = '16px "Liberation Sans"'; ctx.textAlign = 'center';
    ctx.fillText(e.cre.name, cx + TILE_W / 2, cy + 64 * SCALE + 36);
    ctx.fillStyle = '#9090b0'; ctx.font = '12px "Liberation Sans"';
    ctx.fillText(e.arche, cx + TILE_W / 2, cy + 64 * SCALE + 54);
  });
  const p = path.join(SHEET_DIR, 'sheet-callouts.png');
  fs.writeFileSync(p, cv.toBuffer('image/png'));
  return p;
}

// ---------- main ----------
function main() {
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  fs.mkdirSync(SPRITE_DIR, { recursive: true });

  const artless = Object.entries(CREATURES).filter(([, c]) => c.sprite === null);
  console.log(`art-less creatures: ${artless.length} of ${Object.keys(CREATURES).length}\n`);

  // AUDIT: full name -> archetype mapping
  const counts = {};
  console.log('=== ARCHETYPE AUDIT ===');
  for (const [key, cre] of artless) {
    const { arche, feats } = classify(key, cre.name);
    counts[arche] = (counts[arche] || 0) + 1;
    const fstr = Object.keys(feats).filter((k) => feats[k]).join(',');
    console.log(`${cre.name.padEnd(24)} -> ${arche.padEnd(10)} ${fstr ? '[' + fstr + ']' : ''}`);
  }
  console.log('\n=== ARCHETYPE COUNTS ===');
  for (const [a, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`${a.padEnd(10)} ${n}`);

  // GENERATE
  const entries = [];
  for (const [key, cre] of artless) {
    const { arche, canvas } = generateSprite(key, cre);
    const out = path.join(SPRITE_DIR, key + '.png');
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    entries.push({ key, cre, arche, canvas });
  }
  console.log(`\nwrote ${entries.length} sprites to ${SPRITE_DIR}`);

  // SHEETS (grouped by archetype so silhouettes can be judged together)
  entries.sort((a, b) => (a.arche + a.key).localeCompare(b.arche + b.key));
  const sheets = makeSheets(entries);
  const callouts = ['blizzard_wolf', 'aurora_phoenix', 'frost_giant', 'crystal_stag',
    'chimera_beast', 'data_wraith', 'desert_sphinx', 'chrome_titan', 'dimensional_cow',
    'flame_sprite', 'retnuhxed_crawler', 'abyssal_horror'];
  const cp = makeCalloutSheet(entries, callouts);
  console.log('sheets:', [...sheets, cp].join(' '));
}

main();
