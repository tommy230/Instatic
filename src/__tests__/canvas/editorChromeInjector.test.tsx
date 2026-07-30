/**
 * Regression guard: the editor-chrome injector must NOT overwrite the site's
 * own Framework tokens on the iframe `:root`.
 *
 * The injector is unlayered, so anything it sets on `:root` beats the site's
 * Framework tokens (which live in `@layer user-authored`). It used to copy
 * admin tokens straight onto the iframe root, silently rendering canvas
 * content with editor token values instead of the site's configured ones.
 * Editor chrome must ride chrome-namespaced variables instead.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import { EditorChromeInjector } from '@site/canvas/EditorChromeInjector'

afterEach(cleanup)

/** A detached document whose :root carries admin typography and spacing tokens. */
function makeParentDoc(): Document {
  document.documentElement.style.setProperty('--font-sans', '"Inter Variable", system-ui, sans-serif')
  document.documentElement.style.setProperty('--text-xs', 'clamp(10px, calc(9.629px + 0.095vw), 11px)')
  document.documentElement.style.setProperty('--text-s', 'clamp(11px, calc(10.629px + 0.095vw), 12px)')
  document.documentElement.style.setProperty('--space-s', 'clamp(6px, calc(5.257px + 0.19vw), 8px)')
  document.documentElement.style.setProperty('--space-xl', 'clamp(12px, calc(11.257px + 0.19vw), 14px)')
  return document
}

describe('EditorChromeInjector font isolation', () => {
  it('forwards editor chrome tokens under chrome-namespaced variables, never site Framework tokens', () => {
    const target = document.implementation.createHTMLDocument('iframe')
    render(<EditorChromeInjector targetDocument={target} parentDocument={makeParentDoc()} />)

    const css = target.getElementById('instatic-editor-chrome')?.textContent ?? ''
    expect(css).not.toBe('')

    // The chrome font is exposed as a namespaced var carrying the editor font…
    expect(css).toContain('--chrome-font-sans: "Inter Variable", system-ui, sans-serif;')
    // …and chrome rules reference it.
    expect(css).toContain('font-family: var(--chrome-font-sans);')
    expect(css).toContain('--chrome-text-xs: clamp(10px, calc(9.629px + 0.095vw), 11px);')
    expect(css).toContain('--chrome-text-s: clamp(11px, calc(10.629px + 0.095vw), 12px);')
    expect(css).toContain('font-size: var(--chrome-text-s);')
    expect(css).toContain('font-size: var(--chrome-text-xs);')
    expect(css).toContain('--chrome-space-s: clamp(6px, calc(5.257px + 0.19vw), 8px);')
    expect(css).toContain('--chrome-space-xl: clamp(12px, calc(11.257px + 0.19vw), 14px);')
    expect(css).toContain('gap: var(--chrome-space-s);')
    expect(css).toContain('padding: var(--chrome-space-xl);')

    // It must NEVER set the site's own Framework tokens on :root, nor
    // reference them — doing so clobbers token values for all canvas content.
    expect(css).not.toMatch(/^\s*--font-sans:/m)
    expect(css).not.toContain('var(--font-sans)')
    expect(css).not.toMatch(/^\s*--text-s:/m)
    expect(css).not.toMatch(/^\s*--text-xs:/m)
    expect(css).not.toContain('var(--text-s)')
    expect(css).not.toContain('var(--text-xs)')
    expect(css).not.toMatch(/^\s*--space-s:/m)
    expect(css).not.toMatch(/^\s*--space-xl:/m)
    expect(css).not.toContain('var(--space-s)')
    expect(css).not.toContain('var(--space-xl)')
  })
})

/**
 * Imported WordPress themes routinely hide content at `opacity: 0` and reveal
 * it from a scroll observer. With page scripts off — the canvas default — the
 * reveal class never arrives and the author edits a blank band. Fleet-wide this
 * affects 6 stores via CSS3 Animate It and 3 via AOS.
 */
describe('EditorChromeInjector scroll-reveal neutralisation', () => {
  function chromeCss(): string {
    const target = document.implementation.createHTMLDocument('iframe')
    render(<EditorChromeInjector targetDocument={target} parentDocument={makeParentDoc()} />)
    return target.getElementById('instatic-editor-chrome')?.textContent ?? ''
  }

  it('reveals the hidden base state of each known scroll-animation family', () => {
    const css = chromeCss()
    expect(css).toContain('.animated:not(.go)')
    expect(css).toContain('[data-aos]:not(.aos-animate)')
    expect(css).toContain('.wpb_animate_when_almost_visible:not(.wpb_start_animation)')
    expect(css).toContain('.elementor-invisible')
  })

  it('gates every reveal on the absence of the library reveal class, so the rule disables itself once the script runs', () => {
    const css = chromeCss()
    const section = css.slice(css.indexOf('Imported scroll-animation reveal'))
    const selectors = section
      .split('\n')
      .filter((line) => line.trim().endsWith('{'))
      .map((line) => line.trim())

    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      // `.elementor-invisible` is itself the reveal gate — the library removes
      // the class rather than adding one, so it needs no `:not()`.
      if (selector.startsWith('.elementor-invisible')) continue
      expect(selector).toContain(':not(')
    }
  })

  it('does not blanket-override opacity, which would unhide legitimately hidden UI', () => {
    const css = chromeCss()
    // No unqualified transparency override — fancybox overlays, closed
    // dropdowns and inactive tab panels must stay hidden.
    expect(css).not.toMatch(/^\s*\*\s*\{/m)
    expect(css).not.toContain('[style*="opacity"]')
    expect(css).not.toContain('.fancybox')
  })
})
