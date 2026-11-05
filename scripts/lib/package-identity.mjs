/**
 * The package name is one fact with four spellings, and they are not all the
 * same string: npm drops the scope separator when naming a tarball, pnpm quotes
 * a scoped key in a lockfile importer, and the install directory keeps the
 * separator. Restating the name per file is what let a scoped publish ship a
 * package whose mount row still named the bare specifier
 * (`ERR_MODULE_NOT_FOUND`, reported as `1 entry did not activate`), so every
 * consumer reads it from here instead.
 *
 * See scripts/package-identity-test.mjs for the mount sites and
 * scripts/apply-package-name.mjs to move all of them at once.
 */
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

/** As `package.json` declares it, and as dsh resolves the host row. */
export const packageName = pkg.name

/**
 * The key pnpm writes under an importer's `dependencies`. pnpm quotes it once a
 * `/` makes it a URI-like scalar, which is why callers must not hand-write the
 * bare name here — and why `lockfileDeclaresPackage()` currently matches only
 * the unquoted form.
 */
export const pnpmDepKey = (name = packageName) => (name.includes('/') ? `'${name}'` : name)

/** `@scope/name` -> `scope-name`, the stem npm uses for `<stem>-<version>.tgz`. */
export const tarballStem = (name = packageName) => name.replace(/^@/, '').replace('/', '-')

/** Where a `nodeLinker: hoisted` profile puts the installed package. */
export const installedPath = (name = packageName) => `node_modules/${name}`
