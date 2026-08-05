/**
 * Sanitise utility for richtext prop values.
 *
 * WHY THIS EXISTS
 * ---------------
 * The publisher's `escapeProps()` passes richtext props through WITHOUT HTML-escaping,
 * relying on the assumption that DOMPurify has already sanitized them at input time.
 * This module provides that sanitization.
 *
 * USAGE
 * -----
 * Call `sanitizeRichtext(value)` at EVERY write path that stores a richtext prop:
 *   - useSandboxBridge: PROP_CHANGE messages from sandboxed plugin module iframes
 *   - CMS draft hydration before store load
 *   - Phase D agent dispatcher: setProps tool calls for richtext-typed props
 *
 * Never trust that "the UI already sanitized it" — sanitize at every write path.
 *
 * CONFIGURATION
 * -------------
 * Default config allows safe formatting tags (strong, em, u, a, ul, ol, li, p, br, h1-h6)
 * and blocks all script execution. Use `sanitizeRichtext(val, STRICT_CONFIG)` to strip
 * all HTML tags and return plain text only (e.g. for meta fields, titles).
 *
 * @see Task #261 — Enforce DOMPurify at Properties Panel boundary
 * @see Contribution #368 — Security Auditor INFO finding
 * @see render.ts escapeProps() — richtext props are passed through unescaped
 */

import DOMPurify, { type Config } from 'dompurify'

type DOMPurifyHookNode = {
  tagName?: string
  setAttribute?: (name: string, value: string) => void
  getAttribute?: (name: string) => string | null
  hasAttribute?: (name: string) => boolean
  remove?: () => void
  parentNode?: { removeChild?: (node: unknown) => void } | null
}

export type DOMPurifyRuntime = {
  sanitize?: (value: string, config?: Config) => unknown
  addHook?: (hookName: 'afterSanitizeAttributes', callback: (node: DOMPurifyHookNode) => void) => void
}

type DOMPurifyFactory = DOMPurifyRuntime & ((window: Window) => DOMPurifyRuntime)

const importedDOMPurify = DOMPurify as unknown as DOMPurifyFactory
let activeDOMPurify: DOMPurifyRuntime | null = null
const purifiersWithHooks = new WeakSet<object>()

/**
 * A same-document fragment reference and nothing else.
 *
 * Deliberately not a URL parse: the only `<use>` target this codebase will
 * emit is `#some-id`, so the check is a whole-string match against the
 * characters an id can contain rather than an attempt to reason about what a
 * browser would resolve. Anything with a scheme, a host, a slash, a query, a
 * space or a second `#` fails by construction.
 */
const SVG_FRAGMENT_REFERENCE = /^#[A-Za-z0-9_:.-]+$/

/** The reference attributes `<use>` can carry. Both are checked, never one. */
const SVG_USE_REFERENCE_ATTRIBUTES = ['href', 'xlink:href'] as const

/**
 * Drop a `<use>` unless every reference on it is a same-document fragment.
 *
 * `<use>` is excluded from DOMPurify's SVG profile for a real reason:
 * `<use href="https://evil.example/x.svg#i">` pulls a remote document into the
 * page, which is a cross-origin content-injection primitive. A `#fragment`
 * reference cannot do that — it can only instantiate a node from the same
 * document — and it is how every icon sprite on the web works. 890capital's
 * checkmarks are the measured case: the Oxygen theme renders each one as
 * `<svg><use xlink:href="#FontAwesomeicon-check"/></svg>` against an inline
 * `<symbol>` sprite that imports fine, so dropping the `<use>` published 13
 * correctly-sized, correctly-coloured, completely empty `<svg>` boxes.
 *
 * The element is removed, not just its attribute: a `<use>` with no resolvable
 * reference renders nothing and would leave a lie in the markup. A `<use>`
 * carrying no reference at all is dropped for the same reason.
 *
 * Leading and trailing whitespace is TRIMMED before the check and the trimmed
 * value written back, so `href=" #ok"` is accepted. Browsers strip ASCII
 * whitespace when resolving a URL attribute, so refusing it would reject
 * markup a browser treats as identical to the bare form — and writing the
 * trimmed value back means the string validated here is byte-for-byte the
 * string the browser resolves, with no room for the two to disagree.
 */
function pruneUnsafeSvgUse(node: DOMPurifyHookNode): void {
  if (String(node.tagName ?? '').toUpperCase() !== 'USE') return

  let references = 0
  let safe = true
  for (const attribute of SVG_USE_REFERENCE_ATTRIBUTES) {
    if (!node.hasAttribute?.(attribute)) continue
    references += 1
    const value = String(node.getAttribute?.(attribute) ?? '').trim()
    if (!SVG_FRAGMENT_REFERENCE.test(value)) {
      safe = false
      break
    }
    node.setAttribute?.(attribute, value)
  }

  if (safe && references > 0) return
  if (typeof node.remove === 'function') node.remove()
  else node.parentNode?.removeChild?.(node)
}

function installSanitizerHooks(purifier: DOMPurifyRuntime): DOMPurifyRuntime {
  if (!purifiersWithHooks.has(purifier) && typeof purifier.addHook === 'function') {
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute?.('target', '_blank')
        node.setAttribute?.('rel', 'noopener noreferrer')
      }
      // Installed on every purifier rather than added and removed around the
      // SVG call: `use` is only reachable when a config allows it (today, only
      // SVG_CONFIG), and a rule this load-bearing should not depend on which
      // entry point ran.
      pruneUnsafeSvgUse(node)
    })
    purifiersWithHooks.add(purifier)
  }
  return purifier
}

export function configureRichtextSanitizer(purifier: DOMPurifyRuntime | null): void {
  activeDOMPurify = purifier ? installSanitizerHooks(purifier) : null
}

function getDOMPurify(): DOMPurifyRuntime | null {
  const direct = activeDOMPurify ?? importedDOMPurify
  if (typeof direct.sanitize === 'function') {
    return installSanitizerHooks(direct)
  }

  if (typeof window !== 'undefined' && typeof importedDOMPurify === 'function') {
    activeDOMPurify = importedDOMPurify(window)
    if (typeof activeDOMPurify.sanitize === 'function') {
      return installSanitizerHooks(activeDOMPurify)
    }
  }

  return null
}

/**
 * Regex HTML strip used ONLY when no DOMPurify runtime is available (one-off
 * scripts; browser + Bun server both configure DOMPurify).
 *
 * Three stages, each looped to a fixpoint with a single literal regex — the
 * exact do-while-until-stable form CodeQL recognises as a complete sanitizer
 * (js/incomplete-multi-character-sanitization). Looping matters because removing
 * one match can reveal another: split-tag obfuscation `<scr<script>ipt>` only
 * collapses after the inner match goes. Close tags use `(?:[\s/][^>]*)?` since
 * the HTML parser ends a tag at the first `>` (js/bad-tag-filter). Each pass
 * strictly shrinks the string, so every loop terminates.
 *
 * 1. drop `<script>…</script>` blocks (removes the JS source, not just the tag)
 * 2. drop `<style>…</style>` blocks (CSS can carry `@import url(javascript:…)`)
 * 3. drop every remaining tag, incl. bare/unbalanced `<script`/`<style` openers
 */
function stripHtmlFallback(value: string): string {
  let current = value
  let previous: string
  do {
    previous = current
    current = current.replace(/<script\b[^>]*>[\s\S]*?<\/script(?:[\s/][^>]*)?>/gi, '')
  } while (current !== previous)
  do {
    previous = current
    current = current.replace(/<style\b[^>]*>[\s\S]*?<\/style(?:[\s/][^>]*)?>/gi, '')
  } while (current !== previous)
  do {
    previous = current
    current = current.replace(/<[^>]*>/g, '')
  } while (current !== previous)
  return current
}

// ---------------------------------------------------------------------------
// DOMPurify configuration profiles
// ---------------------------------------------------------------------------

/**
 * Default richtext config — allows safe HTML formatting, blocks all scripts.
 * Suitable for user-authored HTML content (headings, paragraphs, lists, links).
 */
const RICHTEXT_CONFIG: Config = {
  // Allow safe semantic/formatting tags
  ALLOWED_TAGS: [
    'p', 'br',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
    'a', 'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'span', 'div',
  ],
  // Restrict attributes to safe subset; data-* is blocked by default
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id'],
  // Force all links to open in a new tab with noopener
  ADD_ATTR: ['target'],
  // Never allow data: / javascript: in href
  ALLOW_DATA_ATTR: false,
  // Prevent mXSS via HTML namespace confusion
  NAMESPACE: 'http://www.w3.org/1999/xhtml',
  // Return a string, not a DOM node
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
}

/**
 * Strict config — strips ALL HTML tags; returns plain text only.
 * Use for single-line fields that should never contain markup.
 * Pass this to `sanitizeRichtext()` — it applies a post-strip pass to catch
 * any tags that DOMPurify's `ALLOWED_TAGS: []` might not catch in edge cases.
 */
export const PLAIN_TEXT_CONFIG: Config & { _plainText?: true } = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  _plainText: true,  // sentinel: triggers regex post-strip pass in sanitizeRichtext()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a richtext prop value using DOMPurify.
 *
 * Call this at EVERY write path before storing a richtext prop value in the store.
 * The value returned is safe to insert into an HTML page via the publisher pipeline.
 *
 * @param value  — raw user input (may contain malicious HTML)
 * @param config — DOMPurify config (defaults to RICHTEXT_CONFIG)
 * @returns sanitized HTML string, safe for publisher output
 */
export function sanitizeRichtext(
  value: unknown,
  config: Config & { _plainText?: true } = RICHTEXT_CONFIG,
): string {
  const str = String(value ?? '')
  if (!str.trim()) return ''

  // DOMPurify requires a live DOM-backed runtime. The browser has one
  // naturally; the Bun server installs an explicit runtime in
  // `server/richtextSanitizer.ts`. One-off scripts that do neither get the
  // conservative plain-text fallback.
  const purifier = getDOMPurify()
  if (!purifier || typeof purifier.sanitize !== 'function') {
    const stripped = stripHtmlFallback(str)
    return config._plainText ? stripped.trim() : stripped
  }

  // Sanitise to a fixed point — see the long note in `sanitizeSvg`. Removing a
  // disallowed element makes DOMPurify's NodeIterator skip every sibling after
  // it for the remainder of that pass. Measured on one pass of
  // `<p><iframe></iframe><b onclick="alert(1)">hi</b></p>`: the iframe went, the
  // `onclick` stayed. Re-running until the output stops changing closes it; a
  // value still changing at the cap is dropped rather than emitted.
  let sanitized = str
  let converged = false
  for (let pass = 0; pass < 8; pass++) {
    const next = String(purifier.sanitize(sanitized, config))
    if (next === sanitized) {
      converged = true
      break
    }
    sanitized = next
  }
  if (!converged) return ''

  // When plain-text mode is requested, apply a post-strip pass.
  // DOMPurify's ALLOWED_TAGS:[] covers most cases but certain browsers / DOM
  // implementations may preserve some inline elements. The fixpoint stripper is
  // the guaranteed fallback (and resists split-tag obfuscation).
  if (config._plainText) {
    return stripHtmlFallback(sanitized).trim()
  }

  return sanitized
}

/**
 * Check whether a module schema prop key refers to a richtext type.
 * Canonical key-name heuristic shared across layers (persistence validation,
 * the agent executor, and template binding resolution).
 */
export function isRichtextPropKey(key: string): boolean {
  const k = key.toLowerCase()
  return k === 'richtext' || k === 'html' || k.endsWith('html') || k.endsWith('richtext')
}

// ---------------------------------------------------------------------------
// SVG sanitisation
// ---------------------------------------------------------------------------

/**
 * SVG profile — allows the SVG + SVG-filter element/attribute set, blocks all
 * HTML (so `<foreignObject>` can't smuggle markup), scripts, and event
 * handlers. Used by the `base.svg` module so imported / pasted inline SVG
 * (logos, icons) round-trips and renders, while staying XSS-safe.
 *
 * `currentColor` and presentation attributes survive, so an SVG styled by a
 * CSS class (`fill: currentColor`) keeps inheriting the page's text colour.
 */
const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  // Defence in depth — DOMPurify's svg profile already excludes these, but be
  // explicit: no HTML embedding, no script, and no nested anchors. URI-bearing
  // attributes stay under DOMPurify's scheme validation so safe same-document
  // references such as <textPath href="#ring"> can resolve their SVG geometry.
  FORBID_TAGS: ['script', 'foreignObject', 'a'],
  // `<use>` and its reference attribute are re-admitted here and then policed
  // by `pruneUnsafeSvgUse` in the shared hook, which keeps only same-document
  // `#fragment` targets. Icon sprites are the reason; the remote-document
  // vector the profile was guarding against is still refused.
  ADD_TAGS: ['use'],
  ADD_ATTR: ['xlink:href'],
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
}

/**
 * Sanitise an inline-SVG markup string for safe inclusion in published HTML
 * and the editor canvas. Returns `''` when no DOMPurify runtime is available
 * (one-off scripts) — the browser and the Bun publish server both configure
 * one, so production paths always sanitise rather than drop.
 *
 * Call at every write path that stores an SVG prop (editor onChange, importer)
 * AND at the publisher boundary (`escapeProps`), per the "never trust the UI"
 * rule that governs richtext.
 */
export function sanitizeSvg(value: unknown): string {
  const str = String(value ?? '')
  if (!str.trim()) return ''

  const purifier = getDOMPurify()
  if (!purifier || typeof purifier.sanitize !== 'function') {
    // No runtime: refuse to emit unsanitised markup. Stripping tags would
    // empty the SVG anyway, so return nothing.
    return ''
  }

  // Sanitise to a fixed point, not once.
  //
  // DOMPurify walks the tree with a NodeIterator in document order. Removing a
  // FORBID_TAGS element re-parents its children into a position the iterator has
  // already passed, and the iterator is then reset to the removed node's former
  // place — so every sibling AFTER it is skipped for the rest of that pass.
  // Measured on a single pass of
  //   <svg onload><foreignObject>…</foreignObject>
  //    <a href="javascript:…"><path onclick="alert(1)"/></a>
  //    <image href="javascript:…"/><use href="https://evil.example/x#i"/></svg>
  // only `<foreignObject>` and the root's `onload` were removed; the `onclick`,
  // both `javascript:` URLs and the external `<use>` all survived into the
  // output. Each further pass strips one more forbidden tag and stops again.
  //
  // Re-running until the output stops changing removes the whole class. Clean
  // markup converges on the second pass (the first only normalises self-closing
  // tags). A value that has not converged by the cap is malicious or malformed
  // beyond what we are willing to emit, so it is dropped entirely.
  let current = str
  for (let pass = 0; pass < 8; pass++) {
    const next = String(purifier.sanitize(current, SVG_CONFIG))
    if (next === current) return next
    current = next
  }
  return ''
}
