// Single source of truth for the buy-bot manifest's tier shape.
// Adding a new tier means appending one line here AND updating the
// workflow's `on.push.paths` filter (in regenerate-manifest.yml).
// Everything else — manifest object shape, verify-step disk check —
// is derived from this array.
//
// Each tier has two names:
//   - `key`:    the camelCase key in manifest.json. Used by the bot.
//   - `folder`: the on-disk folder name under buybot/. Kebab-case is
//               allowed (e.g. "four-twenty") since this never appears
//               in JS identifiers.

module.exports = [
  { key: "regular",    folder: "regular"     },
  { key: "nice",       folder: "nice"        },
  { key: "birthday",   folder: "birthday"    },
  { key: "fourTwenty", folder: "four-twenty" },
  { key: "whales",     folder: "whales"      },
];
