/**
 * buttonContent.ts — content-shape decisions for imported `<button>` elements,
 * shared by the button rule in `rules.ts`.
 *
 * A button's children decide which module it becomes and whether the walker
 * recurses into it:
 *   - text (+ at most one inline `<svg>`) → base.button leaf, svg on `icon`;
 *   - real structure → base.container that recurses;
 *   - a SUBMIT button with any element child → base.submit that recurses, so
 *     icon-only submits (`<svg>`, icon-font `<i>`, `<img>`) survive as child
 *     nodes instead of flattening to the literal word "Submit".
 */
import { normalizeImportedText } from './text'

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? ''
}

/**
 * Markup of the first inline `<svg>` inside `el`, or '' when there is none.
 *
 * base.button is a LEAF module: it maps `<button>` to a `label` string and
 * recurses into nothing. Real consent bars, search fields and CTAs put a small
 * `<svg stroke="currentColor">` inside the button, and that subtree used to be
 * discarded outright — the gear icon on the consent widget's Customize button
 * disappeared on every imported site. The markup is captured verbatim here and
 * lands on the module's `svg`-typed `icon` prop, which sanitises it at the
 * publisher boundary (`escapeProps` → `sanitizeSvg`, the DOMPurify SVG
 * profile) exactly like base.svg's own prop.
 */
export function inlineIconMarkup(el: Element): string {
  const svg = el.querySelector('svg')
  return svg ? svg.outerHTML : ''
}

/**
 * Whether an element's children are STRUCTURE rather than a label and an icon.
 *
 * The leaf mapping carries exactly two things across: the element's text, and
 * one inline `<svg>` on the `icon` prop. That is all of
 * `<button><svg/>Customize</button>`, so an svg-only button stays a leaf.
 * Anything else is a layout the author built, and flattening it deletes every
 * element and class inside except the first svg — see the button rule in
 * `rules.ts`.
 */
export function hasStructuralChild(el: Element): boolean {
  return Array.from(el.children).some((child) => child.tagName.toLowerCase() !== 'svg')
}

/** The submit's childless label: `value` attr, then text, then 'Submit'. */
export function submitLabel(el: Element): string {
  const label = attr(el, 'value') || normalizeImportedText(el.textContent ?? '')
  return label || 'Submit'
}

/**
 * Whether a `<button>` submits its form: an explicit `type="submit"`, or no
 * type at all while inside a `<form>` (the HTML default). Shared by the
 * button rule's `map` and `recurse` so the two cannot disagree about which
 * branch an element takes.
 */
export function isSubmitButton(el: Element): boolean {
  const type = attr(el, 'type').trim().toLowerCase()
  return type === 'submit' || (!type && el.closest('form') !== null)
}
