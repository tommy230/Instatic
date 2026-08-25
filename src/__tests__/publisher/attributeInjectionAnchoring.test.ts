/**
 * Regression — `data-style` / `data-class` custom attributes must never be
 * mistaken for the real `style` / `class` attribute by root-element injection.
 *
 * Measured case (890capital footer newsletter form, fleet sweep 2026-08-25):
 * the source markup is `<form style="display:flex; …" data-style="spinner-only">`.
 * The import correctly harvested the inline declarations onto the node's
 * `inlineStyles` and kept `data-style="spinner-only"` as a custom attribute.
 * At publish, `injectStyleIntoRootElement` looked for an existing style
 * attribute with /\bstyle="…"/ — and `\b` matches after the hyphen in
 * `data-style`, so the author's declarations were "merged" into
 * `data-style="spinner-only; display: flex; …"`, no real `style` attribute
 * was emitted, and the form lost its flex layout on 84 published pages.
 * `injectClassIntoRootElement` had the identical latent flaw for
 * `data-class="…"`.
 */
import { describe, it, expect } from 'bun:test'
import { injectNodeInlineStyles, injectNodeClassIds } from '@core/publisher'
import { makeSite } from './helpers'

const site = makeSite({
  styleRules: {
    'row-id': {
      id: 'row-id',
      name: 'row',
      kind: 'class',
      selector: '.row',
      order: 0,
      styles: {},
      contextStyles: {},
    },
  },
})

describe('style injection ignores data-style', () => {
  it('inserts a real style attribute instead of merging into data-style', () => {
    const html = '<form class="customForm" data-style="spinner-only">x</form>'
    const out = injectNodeInlineStyles(html, { display: 'flex', gap: '8px' })
    expect(out).toContain('data-style="spinner-only"')
    expect(out).toContain('style="display: flex; gap: 8px"')
    expect(out).not.toContain('spinner-only; display')
  })

  it('still merges into a genuine style attribute that follows data-style', () => {
    const html = '<form data-style="spinner-only" style="color: red">x</form>'
    const out = injectNodeInlineStyles(html, { display: 'flex' })
    expect(out).toContain('data-style="spinner-only"')
    expect(out).toContain('style="color: red; display: flex"')
  })

  it('merge behaviour on a plain style attribute is unchanged', () => {
    const out = injectNodeInlineStyles('<div style="color: red">x</div>', { display: 'flex' })
    expect(out).toBe('<div style="color: red; display: flex">x</div>')
  })
})

describe('class injection ignores data-class', () => {
  it('inserts a real class attribute instead of merging into data-class', () => {
    const out = injectNodeClassIds('<div data-class="fancy">x</div>', ['row-id'], site)
    expect(out).toContain('data-class="fancy"')
    expect(out).toContain('class="row"')
    expect(out).not.toContain('row fancy')
  })

  it('still prepends onto a genuine class attribute alongside data-class', () => {
    const out = injectNodeClassIds(
      '<div data-class="fancy" class="existing">x</div>',
      ['row-id'],
      site,
    )
    expect(out).toContain('data-class="fancy"')
    expect(out).toContain('class="row existing"')
  })
})
