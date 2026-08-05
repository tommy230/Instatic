/**
 * Imported `@media` blocks keep their source order and their query text.
 *
 * BUG F, measured on redrockscafe.com. The theme sets `.two-column-with-image-col
 * img { max-height }` twice: 318px under `only screen and (max-width: 767px)` at
 * line ~6484, then 148px under `only screen and (max-width: 639px)` at ~7455.
 * Equal specificity, so at a 390px viewport source order decides and 148px wins.
 *
 * The importer snapped the 767px block to the site's 768px Tablet breakpoint
 * (±10px tolerance). Breakpoint contexts emit AFTER custom conditions, so the
 * published CSS carried the 639px block first and the 767px block second — as
 * `(max-width: 768px)`, having lost both `only screen` and a pixel. At 390px
 * the cascade produced 318px instead of 148px, the image rendered 330x255
 * against production's 192x148, and every section below it shifted.
 *
 * Two properties are pinned here because either one alone would have hidden the
 * bug: the ORDER of the emitted blocks, and the TEXT of each query.
 */
import { describe, it, expect } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'
import { generateClassCSS, type ViewportContext } from '@core/publisher'
import { DEFAULT_BREAKPOINTS } from '@core/page-tree'

const BREAKPOINTS: ViewportContext[] = DEFAULT_BREAKPOINTS.map((bp) => ({
  id: bp.id,
  width: bp.width,
  mediaQuery: bp.mediaQuery,
}))

/** The redrockscafe rule, trimmed to the four blocks that decide the outcome. */
const THEME_CSS = `
.two-column-with-image-col img { max-height: 418px; object-fit: cover; width: 100%; }
@media only screen and (max-width: 1023px) {
  .two-column-with-image-col img { width: auto; height: auto; margin: 0; display: block; }
}
@media only screen and (max-width: 767px) {
  .two-column-with-image-col img { max-height: 318px; margin: 0 0 60px; }
}
@media only screen and (max-width: 639px) {
  .two-column-with-image-col img { max-height: 148px; margin: 0 0 60px; }
}
`

function publishCss(css: string): string {
  const { rules, conditions } = cssToStyleRules(css, { breakpoints: BREAKPOINTS })
  const registry = Object.fromEntries(
    rules.map((rule, index) => [`r${index}`, { ...rule, id: `r${index}`, order: index }]),
  )
  return generateClassCSS(registry as never, BREAKPOINTS, conditions)
}

/** Media preludes in the order they appear in the emitted CSS. */
function mediaPreludeOrder(css: string): string[] {
  return [...css.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim())
}

describe('imported @media blocks — source order and query text', () => {
  it('emits the 639px override after the 767px one, as the source did', () => {
    const css = publishCss(THEME_CSS)
    const order = mediaPreludeOrder(css)

    expect(order).toEqual([
      'only screen and (max-width: 1023px)',
      'only screen and (max-width: 767px)',
      'only screen and (max-width: 639px)',
    ])
    // The property that actually renders: at 390px both match, so the last one
    // wins and the image is 148px tall.
    expect(css.indexOf('max-height: 148px')).toBeGreaterThan(css.indexOf('max-height: 318px'))
  })

  it('keeps the media type and the exact pixel value of each query', () => {
    const css = publishCss(THEME_CSS)

    // `only screen` excluded print; dropping it changes what print gets.
    expect(css).toContain('@media only screen and (max-width: 767px)')
    // 767 and 768 differ at exactly one viewport width — a 768px tablet.
    expect(css).not.toContain('(max-width: 768px)')
  })

  it('keeps this rule\'s order when another selector registered a condition first', () => {
    // The real stylesheet is not one rule: redrockscafe.com uses the 639px
    // query for other selectors earlier in the file, so the site-level
    // condition registry meets 639px before 767px. Ordering by registry index
    // therefore emitted every rule's 639px override first — the published site
    // still rendered 318px at 390px even after the queries stopped being
    // rewritten. Per-rule declared order is what fixes it.
    const withDecoy = `@media only screen and (max-width: 639px) { .decoy { color: red } }\n${THEME_CSS}`
    const css = publishCss(withDecoy)
    const imgBlock = css.slice(css.indexOf('.two-column-with-image-col img'))

    expect(imgBlock.indexOf('max-height: 148px')).toBeGreaterThan(
      imgBlock.indexOf('max-height: 318px'),
    )
  })

  it('records the declared context order on the rule so it survives storage', () => {
    // Object key order does not survive Postgres jsonb, so the order is data.
    const { rules } = cssToStyleRules(THEME_CSS, { breakpoints: BREAKPOINTS })
    expect(rules[0].contextOrder).toEqual([
      'media:only screen and (max-width: 1023px)',
      'media:only screen and (max-width: 767px)',
      'media:only screen and (max-width: 639px)',
    ])
  })

  it('still folds a block whose query IS the breakpoint query', () => {
    // Lossless: re-emitting the breakpoint's own query reproduces the source
    // text, so folding costs nothing and keeps the override editable.
    const { rules, conditions } = cssToStyleRules(
      '.foo { color: red }\n@media (max-width: 768px) { .foo { color: blue } }',
      { breakpoints: BREAKPOINTS },
    )
    expect(rules[0].contextStyles.tablet).toMatchObject({ color: 'blue' })
    expect(conditions).toHaveLength(0)
  })
})
