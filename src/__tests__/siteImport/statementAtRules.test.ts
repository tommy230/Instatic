/**
 * A statement at-rule does not eat the rule that follows it.
 *
 * happy-dom 20.9.0's CSS parser scans only for `{` and `}`. A statement
 * at-rule — `@import url(…);`, `@charset "utf-8";`, `@namespace …;`,
 * `@layer a, b;` — has no block, so the scanner never sees a boundary for it
 * and hands the NEXT rule a selector text of
 * `@import url("…");  .the .real .selector`. That text starts with `@`, lands
 * in the parser's "unknown rule" branch, and the real rule is dropped without
 * a warning. Everything after it parses normally, so exactly one rule
 * disappears per statement at-rule and nothing looks wrong.
 *
 * Measured on employeeassessmentgroup.com. Its Bridge child theme opens with
 * `@import url("…/themes/bridge/style.css");` and the rule immediately after it
 * is the page's content cap:
 *
 *   .section_inner_wrap .wpb_wrapper { width: 1100px; margin: 0 auto; }
 *
 * That rule never reached the store, while the identical-looking
 * `.section_inner_column` two lines later and the `@media (max-width:1129px)`
 * override of the same selector both survived — which is what made it look
 * like a dedupe keyed on the declaration block. It is not: it is position after
 * an `@import`.
 *
 * Fixed by patching `patches/happy-dom@20.9.0.patch`. These tests fail if the
 * patch is dropped by a lockfile change or a happy-dom upgrade.
 */
import { describe, expect, it } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'

/** Selectors of the parsed rules, in order. */
function selectors(css: string): string[] {
  return cssToStyleRules(css).rules.map((rule) => rule.selector)
}

describe('statement at-rules', () => {
  it.each([
    ['@import', '@import url("https://example.com/theme/style.css");'],
    ['@charset', '@charset "utf-8";'],
    ['@namespace', '@namespace svg url(http://www.w3.org/2000/svg);'],
    ['@layer', '@layer base, components, utilities;'],
  ])('keeps the rule immediately after %s', (_name, atRule) => {
    expect(selectors(`${atRule}\n.r1{color:red}.r2{color:blue}`)).toEqual(['.r1', '.r2'])
  })

  it('keeps the rule after a run of statement at-rules', () => {
    const css = '@charset "utf-8";\n@import url("a.css");\n@import url("b.css");\n.r1{color:red}'
    expect(selectors(css)).toEqual(['.r1'])
  })

  it('is not confused by a semicolon inside the imported URL', () => {
    expect(selectors('@import url("a;b.css");\n.r1{color:red}')).toEqual(['.r1'])
  })

  it('keeps both declarations of the rule after the @import', () => {
    const { rules } = cssToStyleRules(
      '@import url("https://example.com/bridge/style.css");\n' +
        '.section_inner_wrap .wpb_wrapper{ width:1100px; margin:0 auto; }\n' +
        '.section_inner_column{ width:1100px; margin:0 auto; }',
    )
    expect(rules.map((rule) => rule.selector)).toEqual([
      '.section_inner_wrap .wpb_wrapper',
      '.section_inner_column',
    ])
    // Two selectors with byte-identical declaration blocks: both survive.
    for (const rule of rules) {
      expect(rule.styles).toMatchObject({
        width: '1100px',
        marginTop: '0px',
        marginRight: 'auto',
        marginBottom: '0px',
        marginLeft: 'auto',
      })
    }
  })

  it('still parses block at-rules the way it always did', () => {
    expect(selectors('@media screen{.m1{color:red}}\n.r1{color:blue}')).toEqual(['.m1', '.r1'])
    expect(selectors('@supports (display:grid){.s1{color:red}}\n.r1{color:blue}')).toEqual([
      '.s1',
      '.r1',
    ])
    expect(selectors('@font-face{font-family:X;src:url(a.woff2)}\n.r1{color:red}')).toEqual(['.r1'])
  })
})
