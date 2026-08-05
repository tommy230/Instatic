/**
 * Sanitise a CSS property value — block dangerous CSS injection patterns.
 *
 * This is the CANONICAL implementation and the SINGLE authority for CSS value
 * sanitisation across the codebase. Every consumer imports it from
 * `@core/css-sanitize` (or transitively via `@core/publisher`, which re-exports
 * it): the publisher's `bagToCSS`/`bagToInlineStyle`, the editor live preview
 * (`ClassStyleInjector` / canvas), base module CSS, AND the framework engine's
 * `:root { --token: … }` variable emission. No per-file reimplementations
 * (Constraint #228 / the pattern that fixed CWE-116 for HTML escaping).
 *
 * It lives in its own dependency-free leaf module — not inside `@core/publisher`
 * — because `@core/publisher` imports `@core/framework`, so the framework engine
 * cannot import back from the publisher barrel without creating a cycle. A pure
 * leaf both modules depend on keeps the graph one-directional.
 *
 * Guards against:
 * - `expression(...)` — IE CSS expression(), executes JS (CWE-79 via CSS)
 * - `javascript:` — invalid in CSS but historically exploited in some parsers
 * - `behavior:` / `-moz-binding:` — legacy IE/Gecko CSS code execution
 * - `data:text/` — data URI in CSS `url()` loads arbitrary HTML in some browsers
 * - `{` or `}` — closes/opens the surrounding selector block, enabling injection
 *               of arbitrary CSS rules (CWE-74, Medium)
 * - `</style` / `</script` — the RAWTEXT-escape sequences. Defence-in-depth
 *          against `</style/>`, `</style/foo>`, etc. breaking out of the inline
 *          `<style>` block. Pairs with the block-level neutraliser in
 *          `sanitizeModuleCSS` (CWE-79).
 *
 *          This guard used to reject the bare bigram `</`, on the premise that
 *          "legitimate CSS values never contain `</`". They do: an inline SVG
 *          data URI is ordinary authored CSS —
 *          `background: url('data:image/svg+xml;utf8,<svg …></svg>') …` — and
 *          every one of them was silently dropped at this boundary. Measured on
 *          890capital.com, whose carousel overrides Unslider's grey PNG arrows
 *          with a 40x40 inline-SVG arrow: the override's `background-image`
 *          never reached the published CSS, so the fallback showed through as
 *          grey blobs. HTML5 ends a `<style>` element's RAWTEXT only at
 *          `</style` (plus whitespace, `/` or `>`), so naming the two tags is
 *          exactly as strong and stops discarding valid graphics.
 *
 * Note: `;` is intentionally NOT blocked here — it is legitimate inside a quoted
 * `url("data:image/png;base64,…")` value within a declaration block. Contexts
 * where a bare `;` would terminate the declaration and inject a sibling (e.g. a
 * `:root` custom-property block) apply that stricter guard at their emission
 * site, on top of this function.
 *
 * Numbers are always safe — they are stringified and returned directly.
 * Returns the trimmed string value if safe, or `null` if the value must be dropped.
 */
export function sanitiseCssValue(value: string | number): string | null {
  if (typeof value === 'number') return String(value)
  const v = value.trim()
  if (/expression\s*\(/i.test(v)) return null
  if (/javascript\s*:/i.test(v)) return null
  if (/behavior\s*:/i.test(v)) return null
  if (/-moz-binding/i.test(v)) return null
  if (/data\s*:\s*text/i.test(v)) return null
  if (/[{}]/.test(v)) return null
  if (/<\/\s*(style|script)/i.test(v)) return null
  return v
}
