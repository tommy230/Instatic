/**
 * A `:root` custom property declared twice keeps the LAST value, as the
 * cascade does.
 *
 * Root colour and font-stack custom properties are hoisted out of the parsed
 * rules into framework tokens. The same property is routinely declared twice: a
 * plugin ships a default in its stylesheet and the site overrides it in an
 * inline `<style>` later in the document. Registering first-wins inverted that
 * and published the packaged default everywhere.
 *
 * Measured on the agency consent widget: `--da-gdpr-primary` is `#7b6856` on
 * amkinggroup, `#b6872d` on vandeverbatten and `#122c4f` on 890capital, and all
 * three published the widget's built-in navy `#1a2744` — the Accept button came
 * out the wrong colour on every migrated site at once.
 *
 * Sources are handed to the planner in cascade order: a page's linked
 * stylesheets first, its inline `<style>` appended last (see buildPlan), so
 * "last one parsed wins" is exactly the CSS rule.
 */
import { describe, expect, it } from 'bun:test'
import { createCssPlanState, parseCssSourceIntoPlan } from '@core/siteImport/planCss'

const OPTIONS = { breakpoints: [], collectGoogleFonts: () => {} }

/** Feed sources in document order, as the planner does. */
function planOf(sources: Array<[path: string, css: string]>) {
  const state = createCssPlanState()
  for (const [path, css] of sources) parseCssSourceIntoPlan(path, css, state, OPTIONS)
  return state
}

describe('root custom-property precedence', () => {
  it('an inline override beats the packaged default it follows', () => {
    const state = planOf([
      ['assets/da-gdpr-banner.css', ':root{--da-gdpr-primary:#1a2744;--da-gdpr-accent:#1a2744}'],
      ['index.html::inline', ':root{--da-gdpr-primary:#7b6856;--da-gdpr-accent:#a7957e}'],
    ])

    expect(state.colorsBySlug.get('da-gdpr-primary')?.value).toBe('#7b6856')
    expect(state.colorsBySlug.get('da-gdpr-accent')?.value).toBe('#a7957e')
  })

  it('order decides it, not which source is inline', () => {
    // The same two declarations the other way round keep the other value, so
    // the rule really is position and not a special case for inline blocks.
    const state = planOf([
      ['index.html::inline', ':root{--brand:#7b6856}'],
      ['assets/theme.css', ':root{--brand:#1a2744}'],
    ])

    expect(state.colorsBySlug.get('brand')?.value).toBe('#1a2744')
  })

  it('a property declared once is unaffected', () => {
    const state = planOf([
      ['assets/a.css', ':root{--only-here:#123456}'],
      ['assets/b.css', ':root{--other:#654321}'],
    ])

    expect(state.colorsBySlug.get('only-here')?.value).toBe('#123456')
    expect(state.colorsBySlug.get('other')?.value).toBe('#654321')
  })

  it('font-stack tokens follow the same rule', () => {
    const state = planOf([
      ['assets/theme.css', ':root{--font-body:Georgia, serif}'],
      ['index.html::inline', ':root{--font-body:"Brandon Grotesque", sans-serif}'],
    ])

    const token = state.fontTokensByVariable.get('font-body')
    expect(token).toBeDefined()
    expect(JSON.stringify(token)).toContain('Brandon Grotesque')
  })
})
