/**
 * Match an imported `@media` condition to one of the site's viewport contexts.
 *
 * Folding a source `@media` block into a breakpoint context is lossy in two
 * ways, and both bite at exactly the viewport widths the block was written for:
 *
 *   1. The emitted query becomes the BREAKPOINT's query, not the source's. A
 *      block written for `only screen and (max-width: 767px)` re-emitted as
 *      `(max-width: 768px)` applies at one more pixel than it was authored for,
 *      and applies to print, where `only screen` excluded it.
 *   2. Breakpoint contexts emit AFTER custom conditions (see the cascade order
 *      in `@core/publisher/classCss`), so folding moves the block later in the
 *      output than it sat in the source. On redrockscafe.com a 767px block and
 *      a 639px block set the same property on the same selector; source order
 *      made 148px win at 390px, and folding only the 767px block inverted that
 *      to 318px. The image rendered 330x255 against production's 192x148 and
 *      every section below it shifted.
 *
 * So a block is folded ONLY when its condition text is the breakpoint's own
 * query, which is lossless by definition: the re-emitted text is what the
 * source said. Everything else is kept verbatim as a custom condition, which
 * preserves both the query and its source position.
 *
 * This deliberately gives up near-miss folding (a 767px block no longer becomes
 * editable under the site's 768px Tablet context). Fidelity to the source page
 * is worth more than editability of an imported override: the override is
 * usually theme CSS nobody will open in the editor, and a site that renders
 * differently from production is a failed migration regardless of how editable
 * it is.
 */
import { breakpointMediaQuery } from '@core/page-tree'
import type { BreakpointHint } from './types'

function normalizeConditionText(conditionText: string): string {
  return conditionText.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function matchMediaQueryToViewport(
  conditionText: string,
  breakpoints: BreakpointHint[],
): BreakpointHint | null {
  const normalized = normalizeConditionText(conditionText)
  for (const bp of breakpoints) {
    if (normalizeConditionText(breakpointMediaQuery(bp)) === normalized) return bp
  }
  return null
}
