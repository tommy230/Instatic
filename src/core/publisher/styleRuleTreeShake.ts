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

/**
 * Can the shipped scripts put this class name on an element at runtime?
 *
 * The literal case is a name that appears verbatim in a script. The other case
 * is a name the script ASSEMBLES: jQuery-era plugins keep a prefix and build
 * their state classes with it, so `unslider-carousel` never appears in
 * unslider.js — `e._` is `"unslider"`, `e.prefix` is `e._ + "-"`, and the
 * class arrives as `addClass(e.prefix + "carousel")`. Verbatim matching saw
 * `unslider-carousel` as a class no node carries and dropped
 * `.unslider-wrap.unslider-carousel > li`, whose `float` is the only thing
 * laying the slides out side by side; 890capital published a slider with every
 * slide stacked and no visible content.
 *
 * So a hyphenated name also counts when BOTH halves of one hyphen split are
 * literals the scripts ship. Requiring both halves keeps this from degenerating
 * into "any name sharing a word with a script".
 *
 * A trailing `-N` is checked against the unsuffixed name too: that is the shape
 * the importer's cross-sheet auto-rename produces, and a renamed copy of a
 * runtime class is added by the same script under its original name.
 *
 * Erring towards keeping is deliberate and safe in one direction only: a false
 * positive keeps a rule pure id-tracking would have dropped, and can never drop
 * one that was needed.
 */
export function scriptCanAddClassName(
  name: string,
  scriptTokens: ReadonlySet<string>,
): boolean {
  if (scriptTokens.has(name)) return true
  for (let cut = name.indexOf('-'); cut > 0; cut = name.indexOf('-', cut + 1)) {
    const head = name.slice(0, cut)
    const tail = name.slice(cut + 1)
    if (!tail) continue
    if (
      (scriptTokens.has(head) || scriptTokens.has(`${head}-`))
      && (scriptTokens.has(tail) || scriptTokens.has(`-${tail}`))
    ) {
      return true
    }
  }
  const renamed = /^(.+)-\d+$/.exec(name)
  if (renamed && renamed[1] !== name) return scriptCanAddClassName(renamed[1], scriptTokens)
  return false
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

const NEGATION_PSEUDOS: ReadonlySet<string> = new Set(['not'])
const ALTERNATION_PSEUDOS: ReadonlySet<string> = new Set([
  'is',
  'where',
  'matches',
  '-webkit-any',
  '-moz-any',
])

interface SelectorPartShape {
  /**
   * The selector text outside negation and alternation pseudos. Every class
   * token here must be present for the part to match (conjunction), which also
   * covers `:has(.x)` and `:nth-child(n of .x)`: their arguments are kept in
   * place because they demand the class just like a plain compound does.
   */
  conjunctive: string
  /** One entry per `:is()`/`:where()` group: the part matches only if SOME alternative can. */
  alternations: string[][]
}

function readFunctionalPseudoName(selector: string, colonIndex: number): string | null {
  let index = colonIndex + 1
  if (selector[index] === ':') return null
  let name = ''
  while (index < selector.length && /[\w-]/.test(selector[index])) {
    name += selector[index]
    index += 1
  }
  if (!name || selector[index] !== '(') return null
  return name.toLowerCase()
}

function findClosingParen(selector: string, openIndex: number): number {
  let depth = 0
  let quote: '"' | "'" | null = null
  for (let index = openIndex; index < selector.length; index += 1) {
    const char = selector[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '\\') index += 1
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return selector.length - 1
}

/**
 * Split one selector-list part into the text whose classes are all required
 * and the `:is()`/`:where()` groups whose alternatives are each sufficient.
 *
 * `:not(...)` is removed outright. A negated class is not a dependency: the
 * selector matches MORE elements when that class is absent, so a class no node
 * carries can never be grounds for dropping the rule. The captured-WordPress
 * shape that forced this was `.x-nav > li > a:not(.x-btn-navbar-woocommerce)
 * { padding: 0 20px }`: nothing on the site carries the WooCommerce class, the
 * rule was dropped, and every header link lost its padding.
 */
function splitSelectorPartShape(part: string): SelectorPartShape {
  let conjunctive = ''
  const alternations: string[][] = []
  let quote: '"' | "'" | null = null
  let attributeDepth = 0

  for (let index = 0; index < part.length; index += 1) {
    const char = part[index]
    if (quote) {
      conjunctive += char
      if (char === '\\' && index + 1 < part.length) {
        index += 1
        conjunctive += part[index]
      } else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      conjunctive += char
      continue
    }
    if (char === '\\') {
      conjunctive += char
      if (index + 1 < part.length) {
        index += 1
        conjunctive += part[index]
      }
      continue
    }
    if (char === '[') attributeDepth += 1
    else if (char === ']') attributeDepth = Math.max(0, attributeDepth - 1)
    if (char === ':' && attributeDepth === 0) {
      const name = readFunctionalPseudoName(part, index)
      if (name && (NEGATION_PSEUDOS.has(name) || ALTERNATION_PSEUDOS.has(name))) {
        const openIndex = index + 1 + name.length
        const closeIndex = findClosingParen(part, openIndex)
        if (ALTERNATION_PSEUDOS.has(name)) {
          const inner = part.slice(openIndex + 1, closeIndex)
          const alternatives = splitCssSelectorList(inner)
          if (alternatives.length > 0) alternations.push(alternatives)
        }
        index = closeIndex
        continue
      }
    }
    conjunctive += char
  }

  return { conjunctive, alternations }
}

function selectorPartCanMatch(
  selector: string,
  knownClassNames: ReadonlySet<string>,
  usedClassNames: ReadonlySet<string>,
): boolean {
  const { conjunctive, alternations } = splitSelectorPartShape(selector)
  for (const token of extractCssSelectorClasses(conjunctive)) {
    if (knownClassNames.has(token.name) && !usedClassNames.has(token.name)) {
      return false
    }
  }
  for (const alternatives of alternations) {
    if (
      !alternatives.some((alternative) =>
        selectorPartCanMatch(alternative, knownClassNames, usedClassNames),
      )
    ) {
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
 * Every publishable registry rule, with no usage analysis at all.
 *
 * This is the `publish.treeShakeStyleRules: false` path. A captured WordPress
 * site gets its classes from places a static page tree cannot see: theme
 * scripts that add state classes, `body` classes printed per template, routes
 * that were never captured, and selectors the shaker can only approximate.
 * For those sites shipping every imported rule is the correct trade, so the
 * setting opts the whole registry out and the canvas and publisher both emit
 * it whole. Framework-generated utilities still come from `framework.css`.
 */
export function selectAllStyleRules(
  styleRules: Record<string, StyleRule>,
): Record<string, StyleRule> {
  const selected: Record<string, StyleRule> = {}
  for (const rule of Object.values(styleRules)) {
    if (isGeneratedClass(rule)) continue
    selected[rule.id] = rule
  }
  return selected
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
 * "Dependency" follows selector semantics: a class inside `:not()` is never
 * one (the rule matches more when it is absent), and the alternatives of
 * `:is()`/`:where()` are each sufficient rather than all required.
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
    if (usedIds.has(rule.id) || scriptCanAddClassName(rule.name, runtimeClassNames)) {
      usedClassNames.add(rule.name)
    }
  }

  const selected: Record<string, StyleRule> = {}
  for (const rule of Object.values(styleRules)) {
    if (isGeneratedClass(rule)) continue

    if (rule.kind === 'class') {
      if (
        usedClassNames.has(rule.name)
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

let lastAllStyleRules: Record<string, StyleRule> | null = null
let lastAllSelected: Record<string, StyleRule> = {}

/**
 * Identity-memoized `selectAllStyleRules` for the multi-frame canvas when the
 * site has opted out of tree shaking (`settings.publish.treeShakeStyleRules`
 * false). Same memo shape as `treeShakeStyleRulesBySignature`, minus the
 * used-id signature it does not need.
 */
export function selectAllStyleRulesByIdentity(
  styleRules: Record<string, StyleRule>,
): Record<string, StyleRule> {
  if (styleRules === lastAllStyleRules) return lastAllSelected
  lastAllSelected = selectAllStyleRules(styleRules)
  lastAllStyleRules = styleRules
  return lastAllSelected
}
