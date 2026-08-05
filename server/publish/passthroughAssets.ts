/**
 * Verbatim asset passthrough.
 *
 * A migrated WordPress site keeps plugins that build asset URLs at runtime and
 * fetch them from the origin the page is served from. Slider Revolution asks for
 * `/wp-content/plugins/revslider/public/js/migration.js`, LayerSlider builds
 * `<skinsPath><skin>/skin.css`, and a theme can carry an absolute
 * `/wp-content/uploads/...` image straight through the import. None of those go
 * through the CSS or script pipelines, so nothing rewrites them and nothing
 * imports the file they point at: on the published site they 404, and a plugin
 * that waits for its own asset waits forever. On regencywoods-cary.com that left
 * the hero slider hidden with the page collapsed behind it.
 *
 * The fix is to serve those paths as they are. Files staged in the passthrough
 * directory are copied into the publish slot at their site-relative path, so
 * `passthrough/wp-content/plugins/.../skin.css` answers
 * `/wp-content/plugins/.../skin.css` from the site's own origin. No rewriting is
 * involved: the URL the plugin builds is already correct once the path resolves.
 *
 * Copied on every publish, so a republish picks up whatever was staged since.
 *
 * Two things are never shadowed. A baked page artefact always wins, because a
 * route is the site and a stray file is not; and `_instatic/` and `uploads/` are
 * refused outright, because those are the publisher's own namespaces and a file
 * landing there would break the page it belongs to rather than the one it came
 * from. Both are reported rather than silently dropped.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/** Namespaces the publisher owns. A passthrough file may not enter them. */
const RESERVED_PREFIXES = ['_instatic', 'uploads']

export interface PassthroughCopyResult {
  copied: string[]
  /** Skipped because a baked artefact already claims the path. */
  shadowed: string[]
  /** Skipped because the path is inside a namespace the publisher owns. */
  reserved: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function walk(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await walk(root, rel)))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

/**
 * Copy every staged file into the slot, preserving its relative path.
 *
 * `slotDir` is the inactive publish slot, so this runs before the swap and a
 * failure leaves the live slot untouched.
 */
export async function copyPassthroughAssets(
  slotDir: string,
  passthroughDir: string | undefined,
): Promise<PassthroughCopyResult> {
  const result: PassthroughCopyResult = { copied: [], shadowed: [], reserved: [] }
  if (!passthroughDir || !(await exists(passthroughDir))) return result

  for (const rel of await walk(passthroughDir)) {
    const segments = rel.split('/')
    if (RESERVED_PREFIXES.includes(segments[0] ?? '')) {
      result.reserved.push(rel)
      continue
    }

    const destination = join(slotDir, ...segments)
    // Same containment check the artefact writer makes: a staged path must not
    // climb out of the slot, whatever it is called.
    const contained = relative(slotDir, destination)
    if (contained.startsWith('..') || isAbsolute(contained) || contained.split(sep)[0] === '..') {
      result.reserved.push(rel)
      continue
    }

    // A baked page owns its path. Passthrough fills gaps; it never overwrites.
    if (await exists(destination)) {
      result.shadowed.push(rel)
      continue
    }

    await mkdir(dirname(destination), { recursive: true })
    await copyFile(join(passthroughDir, rel), destination)
    result.copied.push(rel)
  }

  return result
}
