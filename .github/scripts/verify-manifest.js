// Post-write sanity check: re-parse the committed manifest.json and
// assert that every tier's array length equals the count of accepted
// image files in the matching folder on disk. Catches a partial-write
// from the regenerator and a manifest hand-edit that drifts from
// reality.
//
// Invoked by .github/workflows/regenerate-manifest.yml after the
// regenerate step. Exits non-zero on mismatch so the workflow run is
// visibly failed.

const fs = require("fs");
const path = require("path");
const TIERS = require("./manifest-tiers");

const ACCEPT_EXT = /\.(png|jpe?g|gif)$/i;

const manifest = JSON.parse(fs.readFileSync(path.join("buybot", "manifest.json"), "utf8"));

let mismatches = 0;
for (const tier of TIERS) {
  const dir = path.join("buybot", tier.folder);
  const onDisk = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => ACCEPT_EXT.test(f)).length
    : 0;
  const inManifest = (manifest[tier.key] || []).length;
  if (onDisk !== inManifest) {
    console.error(
      `MISMATCH: ${tier.folder}/ has ${onDisk} file(s) on disk but manifest.${tier.key} lists ${inManifest}`,
    );
    mismatches++;
  }
}

if (mismatches > 0) {
  console.error(`Verify failed: ${mismatches} tier(s) out of sync.`);
  process.exit(1);
}

console.log("Manifest tier counts match disk.");
