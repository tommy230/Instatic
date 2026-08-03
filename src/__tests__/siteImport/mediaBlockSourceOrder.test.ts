/**
 * Imported `@media` blocks keep source order and query text.
 *
 * The source sets one selector under 800px, then overrides it under 640px.
 * Equal specificity means the later 150px declaration must win where both
 * queries match. Snapping a near-miss block to a configured breakpoint would
 * lose its media type, shift its boundary, and move it after custom conditions.
 */
import { describe, it, expect } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'
import { generateClassCSS, type ViewportContext } from '@core/publisher'
import { DEFAULT_BREAKPOINTS, type StyleRule } from '@core/page-tree'

const BREAKPOINTS: ViewportContext[] = DEFAULT_BREAKPOINTS.map((bp) => ({
  id: bp.id,
  width: bp.width,
  mediaQuery: bp.mediaQuery,
}))

const IMPORTED_CSS = `
.hero img { max-height: 400px; object-fit: cover; width: 100%; }
@media only screen and (max-width: 1024px) {
  .hero img { width: auto; height: auto; margin: 0; display: block; }
}
@media only screen and (max-width: 800px) {
  .hero img { max-height: 300px; margin: 0 0 60px; }
}
@media only screen and (max-width: 640px) {
  .hero img { max-height: 150px; margin: 0 0 60px; }
}
`

function publishCss(css: string): string {
  const { rules, conditions } = cssToStyleRules(css, { breakpoints: BREAKPOINTS })
  const registry: Record<string, StyleRule> = Object.fromEntries(
    rules.map((rule, index) => [`r${index}`, { ...rule, id: `r${index}`, order: index }]),
  )
  return generateClassCSS(registry, BREAKPOINTS, conditions)
}

function mediaPreludeOrder(css: string): string[] {
  return [...css.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim())
}

describe('imported @media blocks - source order and query text', () => {
  it('emits the 640px override after the 800px one, as the source did', () => {
    const css = publishCss(IMPORTED_CSS)
    expect(mediaPreludeOrder(css)).toEqual([
      'only screen and (max-width: 1024px)',
      'only screen and (max-width: 800px)',
      'only screen and (max-width: 640px)',
    ])
    expect(css.indexOf('max-height: 150px')).toBeGreaterThan(css.indexOf('max-height: 300px'))
  })

  it('keeps the media type and exact pixel value of each query', () => {
    const css = publishCss(IMPORTED_CSS)
    expect(css).toContain('@media only screen and (max-width: 800px)')
    expect(css).not.toContain('(max-width: 768px)')
  })

  it('keeps this rule\'s order when another selector registered a condition first', () => {
    const withDecoy = `@media only screen and (max-width: 640px) { .decoy { color: red } }\n${IMPORTED_CSS}`
    const css = publishCss(withDecoy)
    const imageRule = css.slice(css.indexOf('.hero img'))

    expect(imageRule.indexOf('max-height: 150px')).toBeGreaterThan(
      imageRule.indexOf('max-height: 300px'),
    )
  })

  it('records declared context order on the rule so it survives storage', () => {
    const { rules } = cssToStyleRules(IMPORTED_CSS, { breakpoints: BREAKPOINTS })
    expect(rules[0].contextOrder).toEqual([
      'media:only screen and (max-width: 1024px)',
      'media:only screen and (max-width: 800px)',
      'media:only screen and (max-width: 640px)',
    ])
  })

  it('still folds a block whose query is the breakpoint query', () => {
    const { rules, conditions } = cssToStyleRules(
      '.foo { color: red }\n@media (max-width: 768px) { .foo { color: blue } }',
      { breakpoints: BREAKPOINTS },
    )
    expect(rules[0].contextStyles.tablet).toMatchObject({ color: 'blue' })
    expect(conditions).toHaveLength(0)
  })

  it('currently emits custom conditions before folded breakpoint contexts in a mixed rule', () => {
    const css = publishCss(`
      @media (max-width: 768px) { .hero { max-height: 300px; } }
      @media (max-width: 640px) { .hero { max-height: 150px; } }
    `)

    // Known limitation: the exact breakpoint folds, while the later narrower
    // query remains custom; the emitter groups custom conditions first.
    expect(css.indexOf('max-height: 150px')).toBeLessThan(css.indexOf('max-height: 300px'))
  })
})
