/**
 * CSS-source parsing phase of `buildImportPlan`.
 *
 * ONE parse path for both kinds of CSS the importer meets — external
 * stylesheets and per-page inline `<style>` blocks (fed in as synthetic
 * `<htmlPath>::inline` sources). Each call runs the full
 * parse → condition-dedupe → colour-token → font-token pipeline and appends
 * the resulting `CssFileResult` to the shared accumulator state.
 *
 * This used to be two copy-pasted loops inside `buildImportPlan`; any rule
 * added to one path (a new token extractor, a new warning kind) silently
 * missed the other. Now there is exactly one place to extend.
 */

import type { ConditionDef } from '@core/page-tree'
import { cssToStyleRules } from './cssToStyleRules'
import { extractRootColorTokens } from './colorTokens'
import { extractRootFontTokens } from './fontTokens'
import { stripGoogleFontImportRules } from './fontImports'
import type { CssFileResult } from './assetPlan'
import type { ImportColorToken, ImportFontToken, ImportWarning } from './types'

/**
 * Accumulators threaded through every `parseCssSourceIntoPlan` call of one
 * `buildImportPlan` run. Conditions dedupe across sources with the first
 * occurrence winning. Colour and font tokens take the last definition across
 * sources, matching the CSS cascade.
 */
export interface CssPlanState {
  warnings: ImportWarning[]
  droppedAtRules: string[]
  /** Reusable conditions discovered across all CSS sources, deduped by id. */
  conditionsById: Map<string, ConditionDef>
  /** Colour tokens pulled from root-scope rules, keyed by slug; last definition wins. */
  colorsBySlug: Map<string, ImportColorToken>
  /** Font tokens keyed by normalized variable; last definition wins. */
  fontTokensByVariable: Map<string, ImportFontToken>
  cssFileResults: CssFileResult[]
}

export function createCssPlanState(): CssPlanState {
  return {
    warnings: [],
    droppedAtRules: [],
    conditionsById: new Map(),
    colorsBySlug: new Map(),
    fontTokensByVariable: new Map(),
    cssFileResults: [],
  }
}

export interface ParseCssSourceOptions {
  breakpoints: Array<{ id: string; width: number; mediaQuery?: string }>
  mediaTolerance: number
  /** Harvests Google-font `@import` requests before they are stripped. */
  collectGoogleFonts: (cssSource: string) => void
}

/**
 * Parse one CSS source into the accumulated plan state.
 *
 * Colour-valued and font-stack root custom properties are pulled out of the
 * parsed rules so they become framework tokens instead of leftover `:root`
 * rules (which would double-emit each `--<slug>` alongside the framework's
 * own output).
 */
export function parseCssSourceIntoPlan(
  cssPath: string,
  cssSource: string,
  state: CssPlanState,
  options: ParseCssSourceOptions,
): void {
  options.collectGoogleFonts(cssSource)
  const cssForStyleRules = stripGoogleFontImportRules(cssSource)
  const { rules, warnings, assetRefs, conditions, fontFaces } = cssToStyleRules(cssForStyleRules, {
    breakpoints: options.breakpoints,
    mediaTolerance: options.mediaTolerance,
  })
  state.warnings.push(...warnings)
  for (const def of conditions) {
    if (!state.conditionsById.has(def.id)) state.conditionsById.set(def.id, def)
  }
  for (const w of warnings) {
    if (w.kind === 'dropped-at-rule' && w.source) state.droppedAtRules.push(w.source)
  }

  // Last definition wins, because that is what the cascade does.
  //
  // These tokens are hoisted out of `:root` blocks, and the same custom property
  // is routinely declared twice: a plugin stylesheet ships a default and the
  // site overrides it in a later inline `<style>`.
  //
  // Sources reach here in cascade order (linked sheets first, the page's inline
  // block appended last - see buildPlan), so overwriting is exactly the CSS rule.
  // Across pages there is no shared cascade: inline blocks are appended in page
  // order, so the last page's token wins site-wide.
  // Root-scope extraction ignores specificity differences among `:root`, `html`, and `body`.
  const { rules: rulesAfterColors, colorTokens } = extractRootColorTokens(rules)
  for (const token of colorTokens) {
    state.colorsBySlug.set(token.slug, token)
  }
  const { rules: rulesAfterFontTokens, fontTokens } = extractRootFontTokens(rulesAfterColors)
  for (const token of fontTokens) {
    state.fontTokensByVariable.set(token.variable, token)
  }

  state.cssFileResults.push({ cssPath, rules: rulesAfterFontTokens, assetRefs, fontFaces })
}
