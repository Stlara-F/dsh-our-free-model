/**
 * The package name is a mount identifier in three shipped files besides
 * package.json, and the host resolves each of them differently:
 *
 *   - `cordis.patch.yml` inserts the host row, whose `name` is imported as a
 *     package specifier;
 *   - the browser half registers itself through `__ModuleLoader__.load({ id })`,
 *     and `dsh-client-modules` accepts it only when `factories.has(<row name>)` —
 *     so the row name and this id have to be the same string;
 *   - `src/updater.js` records the name the package manager writes into the
 *     profile, which is how the in-app updater finds its own installation.
 *
 * Renaming the package therefore moves all four together. A publish that renames
 * only `package.json` ships an artifact whose host row imports a specifier that
 * does not exist (`ERR_MODULE_NOT_FOUND`, reported as `1 entry did not activate`),
 * and renaming only the row leaves the browser half `loaded without registering`.
 * `catalog-test.mjs` already pins `catalog/dsh-plugin.json` to `package.json`;
 * these three sites were the ones nobody checked.
 *
 * Run: node scripts/package-identity-test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const packageName = JSON.parse(read('package.json')).name
assert.ok(typeof packageName === 'string' && packageName.length > 0, 'package.json must declare a name')

/**
 * More than one match is a failure, not a tie-break: a second mount site would
 * be an identity the release path does not rewrite and this suite does not read.
 */
function onlyIdentifier (source, pattern, file) {
  const found = [...source.matchAll(pattern)]
  assert.equal(found.length, 1, `${file}: expected exactly one mount identifier, found ${found.length}`)
  return found[0][1]
}

const rowName = onlyIdentifier(read('cordis.patch.yml'), /- id: our-free-model\s*\r?\n\s+name: '([^']+)'/g, 'cordis.patch.yml')
const clientId = onlyIdentifier(read('client.js'), /__ModuleLoader__\.load\(\{\s*id: '([^']+)'/g, 'client.js')
const updaterName = onlyIdentifier(read('src/updater.js'), /const PACKAGE_NAME = '([^']+)'/g, 'src/updater.js')

const pluginManifest = JSON.parse(read('catalog/dsh-plugin.json'))
const provenance = JSON.parse(read('catalog/provenance.json'))

assert.equal(rowName, packageName,
  `cordis.patch.yml mounts the host row as "${rowName}", but the package is "${packageName}" — dsh imports that name as a specifier and fails with ERR_MODULE_NOT_FOUND`)
assert.equal(clientId, packageName,
  `client.js registers "${clientId}", but the host looks it up under the row name "${packageName}" and reports "loaded without registering"`)
assert.equal(updaterName, packageName,
  `src/updater.js looks for "${updaterName}" in the profile, but the package manager recorded "${packageName}"`)
// `catalog-test.mjs` already pins dsh-plugin.json to package.json; provenance is
// re-asserted here because nothing else compares its subject name to the package,
// and a marketplace record naming a package that does not exist is how a scoped
// publish silently ships the broken mount again.
assert.equal(pluginManifest.name, packageName, `catalog/dsh-plugin.json names the plugin "${pluginManifest.name}"`)
assert.equal(provenance.subject?.name, packageName, `catalog/provenance.json names the subject "${provenance.subject?.name}"`)

console.log(`ok  package identity: ${packageName} across package.json, cordis.patch.yml, client.js, src/updater.js and both catalog records`)
