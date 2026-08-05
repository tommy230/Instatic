/**
 * Parsing the `src` descriptor of an `@font-face`.
 *
 * Split out of `cssToStyleRules` because the descriptor needs more than its URL
 * payloads: a Typekit source is extensionless —
 * `https://use.typekit.net/af/c7fc58/…/l?primer=…` — so the only statement of
 * what the file is comes from the `format(...)` hint beside it. Reading the URLs
 * without their formats leaves an external face with nothing rankable, which is
 * how `rift` went missing on redrockscafe.com while the same kit's self-hosted
 * substitutes survived.
 */

/** A `url(...)` payload with the `format(...)` hint that follows it, if any. */
export interface FontSrcEntry {
  url: string
  format: string | null
}

const SRC_ENTRY =
  /url\(\s*(['"]?)([^'")\n]*)\1\s*\)(\s*format\(\s*(['"]?)([^'")\n]*)\4\s*\))?/g

export function extractSrcEntries(value: string): FontSrcEntry[] {
  const entries: FontSrcEntry[] = []
  let match: RegExpExecArray | null
  SRC_ENTRY.lastIndex = 0
  while ((match = SRC_ENTRY.exec(value)) !== null) {
    const url = match[2].trim()
    if (!url) continue
    entries.push({ url, format: (match[5] ?? '').trim().toLowerCase() || null })
  }
  return entries
}
