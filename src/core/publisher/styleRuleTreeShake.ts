import {
  extractCssSelectorClasses,
  isGeneratedClass,
  splitCssSelectorList,
  type SiteDocument,
  type StyleRule,
} from '@core/page-tree'
import type { SiteFile } from '@core/files/schemas'

const NO_RUNTIME_CLASS_NAMES: ReadonlySet<string> = new Set()

/**
 * Class-name-shaped tokens appearing in the site's shipped script files.
 *
 * Scroll/viewport libraries (jquery.in-viewport-class, AOS, CSS3 Animate It,
 * WPBakery) add state classes such as `in-viewport-once` or `aos-animate` at
 * runtime. No node carries those classes in the document, so id-based
 * tree-shaking sees them as dead and removes every rule whose selector
 * depends on them — leaving reveal animations stuck at their hidden start
 * state on the published site while the script that triggers them ships and
 * runs. A known class whose name also appears verbatim in shipped JavaScript
 * must therefore be treated as possibly present at runtime.
 *
 * Tokenising is deliberately crude — split on anything outside the class-name
 * alphabet — because a false positive (a script identifier coinciding with a
 * class name) only keeps a rule that pure id-tracking would have dropped;
 * it can never drop a needed one.
 */
export function collectScriptClassNameTokens(
  files: readonly Pick<SiteFile, 'type' | 'content'>[] | undefined,
): Set<string> {
  const tokens = new Set<string>()
  for (const file of files ?? []) {
    if (file.type !== 'script' || !file.content) continue
    for (const token of file.content.split(/[^A-Za-z0-9_-]+/)) {
      if (token) tokens.add(token)
    }
  }
  return tokens
}

/** Collect every registry class id referenced by page and Visual Component nodes. */
export function collectUsedStyleRuleIds(
  site: Pick<SiteDocument, 'pages' | 'visualComponents'>,
): Set<string> {
  const usedIds = new Set<string>()
  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) {
      for (const id of node.classIds ?? []) usedIds.add(id)
    }
  }
  for (const component of site.visualComponents ?? []) {
    for (const id of component.classIds ?? []) usedIds.add(id)
    for (const node of Object.values(component.tree.nodes)) {
      for (const id of node.classIds ?? []) usedIds.add(id)
    }
  }
  return usedIds
}

/**
 * A stable primitive signature suitable for store subscriptions. It changes
 * only when the set of assigned class ids changes, not for unrelated edits.
 */
export function usedStyleRuleIdSignature(
  site: Pick<SiteDocument, 'pages' | 'visualComponents'>,
): string {
  return [...collectUsedStyleRuleIds(site)].sort().join('\0')
}

function selectorPartCanMatch(
  selector: string,
  knownClassNames: ReadonlySet<string>,
  usedClassNames: ReadonlySet<string>,
): boolean {
  for (const token of extractCssSelectorClasses(selector)) {
    if (knownClassNames.has(token.name) && !usedClassNames.has(token.name)) {
      return false
    }
  }
  return true
}

function selectorCanMatch(
  selector: string,
  knownClassNames: ReadonlySet<string>,
  usedClassNames: ReadonlySet<string>,
): boolean {
  return splitCssSelectorList(selector).some((part) =>
    selectorPartCanMatch(part, knownClassNames, usedClassNames),
  )
}

/**
 * Select only registry rules that can affect the current document trees.
 *
 * Class rules require their assignment id and every known class dependency in
 * their selector. Ambient selector fragments require every known dependency
 * in at least one selector-list alternative. Class-free selectors and raw
 * stylesheet blocks stay conservative because their reach cannot be inferred
 * from node class ids alone.
 *
 * `runtimeClassNames` (see `collectScriptClassNameTokens`) widens "used" for
 * classes that shipped scripts may add to the DOM after load: a class rule
 * whose name is in the set is kept even with no node assignment, and it
 * satisfies dependency checks in other rules' selectors. The editor canvas
 * path passes nothing here — scripts do not run in the canvas, so its
 * shaking stays purely id-driven.
 */
export function treeShakeStyleRules(
  styleRules: Record<string, StyleRule>,
  usedIds: ReadonlySet<string>,
  runtimeClassNames: ReadonlySet<string> = NO_RUNTIME_CLASS_NAMES,
): Record<string, StyleRule> {
  const knownClassNames = new Set<string>()
  const usedClassNames = new Set<string>()

  for (const rule of Object.values(styleRules)) {
    if (rule.kind !== 'class') continue
    knownClassNames.add(rule.name)
    if (usedIds.has(rule.id) || runtimeClassNames.has(rule.name)) {
      usedClassNames.add(rule.name)
    }
  }

  const selected: Record<string, StyleRule> = {}
  for (const rule of Object.values(styleRules)) {
    if (isGeneratedClass(rule)) continue

    if (rule.kind === 'class') {
      if (
        (usedIds.has(rule.id) || runtimeClassNames.has(rule.name))
        && selectorCanMatch(rule.selector, knownClassNames, usedClassNames)
      ) {
        selected[rule.id] = rule
      }
      continue
    }

    if (
      rule.rawCss
      || selectorCanMatch(rule.selector, knownClassNames, usedClassNames)
    ) {
      selected[rule.id] = rule
    }
  }
  return selected
}

let lastStyleRules: Record<string, StyleRule> | null = null
let lastUsedIdSignature = ''
let lastTreeShakenRules: Record<string, StyleRule> = {}

/**
 * Identity/signature-memoized entry for the multi-frame editor canvas. Every
 * frame sees the same immutable registry snapshot, so a 40k-rule Tailwind
 * registry is filtered once per change rather than once per iframe.
 */
export function treeShakeStyleRulesBySignature(
  styleRules: Record<string, StyleRule>,
  usedIdSignature: string,
): Record<string, StyleRule> {
  if (
    styleRules === lastStyleRules
    && usedIdSignature === lastUsedIdSignature
  ) {
    return lastTreeShakenRules
  }
  const usedIds = usedIdSignature
    ? new Set(usedIdSignature.split('\0'))
    : new Set<string>()
  lastTreeShakenRules = treeShakeStyleRules(styleRules, usedIds)
  lastStyleRules = styleRules
  lastUsedIdSignature = usedIdSignature
  return lastTreeShakenRules
}
