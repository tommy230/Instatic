/**
 * Strip dangerous constructs from a parsed HTML Document, mutating it in place,
 * and collect the CSS that the importer re-homes instead of dropping.
 *
 * What is stripped (and counted in StripReport):
 *   - <script> elements               → counted as `scripts`
 *   - <link> elements                 → counted as `stylesheetLinks` or `otherLinks`
 *   - <meta> and <base> elements      → counted as `metadataElements`
 *   - Legacy/plugin embeds            → counted as `embeddedElements`
 *   - Untrusted <iframe> elements     → counted as `untrustedIframes`
 *   - Inline event-handler attributes → counted as `inlineHandlers`
 *     (any attribute whose name begins with "on", e.g. onclick, onload)
 *
 * What is removed from the DOM but NOT dropped from the import:
 *   - <style> elements   → their CSS is harvested by `collectStyleCss` (parsed
 *     into editor StyleRules / Selectors-panel entries by the consumer).
 *   - Inline style="…"   → harvested by `harvestInlineStyles` into the node's
 *     first-class `inlineStyles` bag before this removal runs.
 *
 * HTML comments and processing instructions are removed silently.
 */

import { isTrustedVideoIframeSrc } from './trustedVideoIframe'

export interface StripReport {
  scripts: number
  stylesheetLinks: number
  otherLinks: number
  metadataElements: number
  embeddedElements: number
  untrustedIframes: number
  inlineHandlers: number
}

/**
 * Concatenate the text content of every `<style>` element in `doc`. Call this
 * BEFORE `stripUnsafe` removes the `<style>` elements. Empty/whitespace-only
 * blocks are skipped. The consumer parses the result via `cssToStyleRules` so
 * the rules land in the global class registry / Selectors panel.
 */
export function collectStyleCss(doc: Document): string {
  const parts: string[] = []
  for (const el of Array.from(doc.querySelectorAll('style'))) {
    const css = el.textContent ?? ''
    if (css.trim().length > 0) parts.push(css)
  }
  return parts.join('\n')
}

/**
 * Recursively remove comment nodes (nodeType 8) and processing-instruction
 * nodes (nodeType 7) from the subtree rooted at `node`.
 *
 * Uses the `nextSibling` pattern (capture before removal) so we never skip
 * nodes while mutating the child list.
 */
function removeCommentsAndPIs(node: Node): void {
  let child = node.firstChild
  while (child !== null) {
    const next = child.nextSibling
    if (
      child.nodeType === 8 /* COMMENT_NODE */ ||
      child.nodeType === 7 /* PROCESSING_INSTRUCTION_NODE */
    ) {
      node.removeChild(child)
    } else {
      removeCommentsAndPIs(child)
    }
    child = next
  }
}

/**
 * Strip unsafe constructs from `doc` in place and return counts of what was
 * removed. `<style>` elements and inline `style` attributes are removed too,
 * but their CSS is harvested beforehand (see `collectStyleCss` /
 * `harvestInlineStyles`) so it is preserved, not dropped.
 */
export function stripUnsafe(doc: Document): StripReport {
  const report: StripReport = {
    scripts: 0,
    stylesheetLinks: 0,
    otherLinks: 0,
    metadataElements: 0,
    embeddedElements: 0,
    untrustedIframes: 0,
    inlineHandlers: 0,
  }

  // Remove <script> elements first so their content cannot be accessed.
  for (const el of Array.from(doc.querySelectorAll('script'))) {
    el.remove()
    report.scripts++
  }

  // Remove <style> elements — their CSS was already harvested by collectStyleCss.
  for (const el of Array.from(doc.querySelectorAll('style'))) {
    el.remove()
  }

  // The site-import plan harvests stylesheets from its own parse of the whole
  // document before this importer runs. No link element has useful body
  // semantics after mapping, so remove every link rather than publishing an
  // inert div. Keep stylesheet and other-link counts distinct because only
  // stylesheets are re-homed by the plan. Relation tokens are ASCII
  // case-insensitive.
  for (const el of Array.from(doc.querySelectorAll('link'))) {
    const relationTokens = (el.getAttribute('rel') ?? '').split(/[ \t\n\f\r]+/)
    const isStylesheet = relationTokens.some((token) => token.toLowerCase() === 'stylesheet')
    el.remove()
    if (isStylesheet) report.stylesheetLinks++
    else report.otherLinks++
  }

  // These document-metadata elements cannot retain their semantics in the
  // page-node body tree. Their custom-tag nodes are forbidden at render time,
  // so remove them before mapping instead of leaving inert div husks.
  for (const el of Array.from(doc.querySelectorAll('meta, base'))) {
    el.remove()
    report.metadataElements++
  }

  // Plugin and legacy frame elements are forbidden custom tags. Removing a
  // parent also removes any fallback descendants: those children were only
  // meant to render when the unsupported embedded resource failed.
  for (const el of Array.from(doc.querySelectorAll('frame, frameset, object, embed, applet'))) {
    el.remove()
    report.embeddedElements++
  }

  // Preserve exactly the iframe sources that the mapping rules turn into a
  // real base.video node. Everything else would become a forbidden custom-tag
  // container and publish as an inert div.
  for (const el of Array.from(doc.querySelectorAll('iframe'))) {
    if (isTrustedVideoIframeSrc(el.getAttribute('src') ?? '')) continue
    el.remove()
    report.untrustedIframes++
  }

  // Strip event-handler attributes (counted) and the now-harvested inline
  // `style` attribute (not counted — its declarations live on node.inlineStyles).
  // Collect attribute names before removing to avoid NamedNodeMap mutation
  // issues while iterating.
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const toRemove: string[] = []
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) {
        toRemove.push(attr.name)
        report.inlineHandlers++
      } else if (attr.name === 'style') {
        toRemove.push(attr.name)
      }
    }
    for (const name of toRemove) {
      el.removeAttribute(name)
    }
  }

  removeCommentsAndPIs(doc)

  return report
}
