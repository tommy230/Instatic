/**
 * A `:root` custom property declared twice keeps the LAST value, as the
 * cascade does.
 *
 * Root colour and font-stack custom properties are hoisted out of parsed
 * rules into framework tokens. A plugin may ship a default in its stylesheet
 * while a site overrides it in a later inline `<style>`. Registering first-wins
 * inverted that order and published packaged defaults instead.
 *
 * Sources are handed to the planner in cascade order: linked stylesheets
 * first, then inline `<style>` blocks (see buildPlan), so last-wins matches CSS.
 */
import { describe, expect, it } from 'bun:test'
import { createCssPlanState, parseCssSourceIntoPlan } from '@core/siteImport/planCss'

const OPTIONS = { breakpoints: [], mediaTolerance: 15, collectGoogleFonts: () => {} }

/** Feed sources in document order, as the planner does. */
function planOf(sources: Array<[path: string, css: string]>) {
  const state = createCssPlanState()
  for (const [path, css] of sources) parseCssSourceIntoPlan(path, css, state, OPTIONS)
  return state
}

describe('root custom-property precedence', () => {
  it('an inline override beats the packaged default it follows', () => {
    const state = planOf([
      ['assets/plugin.css', ':root{--plugin-primary:#222222;--plugin-accent:#222222}'],
      ['index.html::inline', ':root{--plugin-primary:#111111;--plugin-accent:#333333}'],
    ])

    expect(state.colorsBySlug.get('plugin-primary')?.value).toBe('#111111')
    expect(state.colorsBySlug.get('plugin-accent')?.value).toBe('#333333')
  })

  it('order decides it, not which source is inline', () => {
    // Reversing declaration order keeps the later value, proving precedence is
    // positional rather than a special case for inline blocks.
    const state = planOf([
      ['index.html::inline', ':root{--brand:#111111}'],
      ['assets/theme.css', ':root{--brand:#222222}'],
    ])

    expect(state.colorsBySlug.get('brand')?.value).toBe('#222222')
  })

  it('the last :root block wins within one source', () => {
    const state = planOf([
      ['assets/theme.css', ':root{--brand:#111111}:root{--brand:#222222}'],
    ])

    expect(state.colorsBySlug.get('brand')?.value).toBe('#222222')
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
      ['index.html::inline', ':root{--font-body:"Example Sans", sans-serif}'],
    ])

    const token = state.fontTokensByVariable.get('font-body')
    expect(token).toBeDefined()
    expect(token?.family).toBe('Example Sans')
  })
})
