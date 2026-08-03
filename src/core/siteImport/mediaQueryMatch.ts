/**
 * Match an imported `@media` condition to one of the site's viewport contexts.
 *
 * Folding a source block is lossy unless its condition text is the viewport
 * context's own query. Snapping a near match can lose a media type, shift the
 * boundary by one pixel, and move the block after custom conditions. A later
 * custom block on the same selector can then appear earlier in emitted CSS,
 * inverting equal-specificity source order.
 *
 * Exact-query folding keeps the override editable and preserves its query
 * text. Mixed folded and custom contexts still follow the emitter's fixed
 * custom-before-breakpoint grouping, so exact matching does not guarantee
 * source-order fidelity for every mixed rule. Near misses remain custom
 * conditions, trading breakpoint editability for source fidelity.
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
