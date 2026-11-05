/**
 * Move the package's mount identity to a new npm name in one step.
 *
 * The name is not a single field. dsh imports the `cordis.patch.yml` row `name`
 * as a package specifier, looks the browser half up under that same string, and
 * the in-app updater searches the profile for the name this package recorded —
 * so a rename that stops at `package.json` ships an artifact that fails at
 * mount time. This script rewrites every site together and nothing else, so a
 * scoped publish (or a private mirror under another scope) stays self-consistent.
 *
 * Run: node scripts/apply-package-name.mjs <new-package-name>
 *      node scripts/apply-package-name.mjs --check [<name>]
 *
 * Four of the rewritten files ship inside the package, so their digests live in
 * `feed/manifest.json` and `catalog/integrity.json`; rebuilding those needs the
 * pinned signing key, so this script does not attempt it. See the follow-up it
 * prints after writing.
 *
 * The pnpm-ownership fixtures in `scripts/updater-test.mjs` read the name from
 * `scripts/lib/package-identity.mjs`, so they follow a rename automatically —
 * and if they start failing after one, the in-app updater cannot see a scoped
 * pnpm-owned install (`lockfileDeclaresPackage()` matches only an unquoted key).
 *
 * Sites this deliberately leaves alone: README install snippets, the standalone
 * desktop/`packages/standalone` copies of the browser bundle, and test fixtures
 * that synthesise a profile. They describe an installation, not this package's
 * own mount identity, and the script lists what is left so a person decides.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

const args = process.argv.slice(2)
const check = args.includes('--check')
const target = args.find(arg => !arg.startsWith('--'))

/**
 * npm's own rule, plus the characters Windows refuses inside a directory name:
 * the package name becomes `node_modules/<name>`, so `@scope/` is the only
 * separator a mount point may contain.
 */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

const current = JSON.parse(read('package.json')).name
if (typeof current !== 'string' || current.length === 0) {
  console.error('error: package.json declares no name; this script reads the current identity from it')
  process.exit(1)
}

if (target === undefined) {
  console.log(`current package name: ${current}`)
  console.log('usage: node scripts/apply-package-name.mjs <new-package-name> | --check [<name>]')
  process.exit(check ? 0 : 1)
}
if (!NPM_NAME.test(target)) {
  console.error(`error: "${target}" is not a usable npm package name (lowercase, optional @scope/, no path separators or reserved characters)`)
  process.exit(1)
}
if (target === current) {
  console.log(`nothing to do: ${current} already matches`)
  process.exit(0)
}

const quote = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Each site is anchored on its key so a substring inside a longer value cannot
 * be mistaken for it — `catalog/dsh-plugin.json` keeps `id` as
 * `dev.ebony-vinyl.dsh-our-free-model`, which contains the bare name.
 */
/** JSON sites put a comma after the closing quote; the pattern keeps it verbatim. */
const jsonName = () => new RegExp(`^([ \\t]*"name":\\s*")${quote(current)}(",?)$`, 'gm')

const sites = [
  ['package.json', jsonName()],
  ['cordis.patch.yml', new RegExp(`(- id: our-free-model\\s*\\r?\\n\\s+name: ')${quote(current)}(')`, 'g')],
  ['client.js', new RegExp(`(__ModuleLoader__\\.load\\(\\{\\s*id: ')${quote(current)}(')`, 'g')],
  ['src/updater.js', new RegExp(`(const PACKAGE_NAME = ')${quote(current)}(')`, 'g')],
  ['catalog/dsh-plugin.json', jsonName()],
  ['catalog/provenance.json', jsonName()],
]

const planned = []
for (const [rel, pattern] of sites) {
  const source = read(rel)
  const found = [...source.matchAll(pattern)]
  if (found.length !== 1) {
    console.error(`error: ${rel}: expected exactly 1 mount identifier for "${current}", found ${found.length}`)
    console.error('       the file no longer has the shape this script knows; update it by hand and re-check with')
    console.error('       node scripts/package-identity-test.mjs')
    process.exit(1)
  }
  planned.push([rel, source, source.replace(pattern, (_all, head, tail) => `${head}${target}${tail}`)])
}

console.log(`${check ? 'plan' : 'rewrite'}: ${current} -> ${target}`)
for (const [rel, source, next] of planned) {
  const before = source.split('\n')
  const changed = next.split('\n').filter((line, index) => line !== before[index]).length
  if (next.split('\n').length !== before.length) {
    console.error(`error: ${rel} would change line count; refusing to write a rewrite that moves more than the name`)
    process.exit(1)
  }
  console.log(`  ${rel.padEnd(24)} ${changed} line(s)`)
}

if (check) process.exit(0)

// Every replacement above already succeeded against a full read, so writing
// cannot leave the tree half-moved; a failed write still reports which file.
try {
  for (const [rel, , next] of planned) fs.writeFileSync(path.join(root, rel), next)
} catch (error) {
  console.error(`error: stopped while writing ${error.path ?? 'an unknown file'}; earlier files in the list are already rewritten — re-run to finish`)
  process.exit(1)
}

// Anything still naming the old package is a site this script does not own. This
// runs after the writes, so a missing file here must not look like a rename failure.
const leftovers = []
for (const rel of ['README.md', 'README_EN.md', 'src/egress.js']) {
  if (!fs.existsSync(path.join(root, rel))) continue
  const hits = read(rel).split('\n').filter(line => line.includes(current)).length
  if (hits > 0) leftovers.push(`  ${rel.padEnd(34)} ${hits} line(s) still mention "${current}"`)
}
console.log(`\nwrote ${planned.length} files. Follow-up:`)
console.log('  node scripts/test-all.mjs --only package-identity # must pass on the new name')
console.log('  node scripts/catalog-test.mjs                     # the digest check now disagrees until rebuilt')
console.log('  npm run manifest --key <pem>                       # rebuilding needs OFM_MANIFEST_KEY or --key:')
console.log('       build-manifest.mjs refuses to write an unsigned manifest, so only the holder of the')
console.log('       pinned signing key can ship a renamed artifact. A private fork must instead set')
console.log('       distribution=managed so the in-app upgrader stands down.')
if (leftovers.length > 0) {
  console.log('\nsites left for a person to judge (installation docs, not mount identity):')
  for (const line of leftovers) console.log(line)
}
