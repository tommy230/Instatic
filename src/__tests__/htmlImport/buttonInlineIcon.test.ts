/**
 * Inline `<svg>` children of a `<button>` survive import and publish.
 *
 * base.button is a leaf module: the importer mapped `<button>` to a `label`
 * string and recursed into nothing, so any element child was discarded. Real
 * markup puts icons there. Measured on the Digital Alchemy consent widget,
 * which ships on every migrated site:
 *
 *   <button id="da-gdpr-customize" class="da-gdpr-btn da-gdpr-btn--ghost">
 *     <svg width="14" height="14" …><circle stroke="currentColor"/>…</svg>
 *     Customize
 *   </button>
 *
 * imported as `<button …>Customize</button>` — the gear icon vanished on every
 * site using the widget. The markup now lands on the module's `svg`-typed
 * `icon` prop, which means `escapeProps` runs it through `sanitizeSvg` (the
 * DOMPurify SVG profile) at the publisher boundary rather than HTML-escaping
 * it. The hostile-SVG cases below prove the sanitiser, not the importer, is
 * what decides which markup is allowed to reach the page.
 */
import { describe, it, expect } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'
import { escapeProps } from '@core/publisher'
import { ButtonModule } from '@modules/base/button'
import type { ButtonStoredProps } from '@modules/base/button/props'

/** The exact consent-widget Customize button. */
const CONSENT_BUTTON =
  '<button id="da-gdpr-customize" class="da-gdpr-btn da-gdpr-btn--ghost">' +
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
  '<circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M7 1v2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>Customize</button>'

/** Import `html` and return the props of its single button node. */
function buttonProps(html: string): Record<string, unknown> {
  const result = importHtml(`<html><body>${html}</body></html>`)
  const node = Object.values(result.nodes).find((n) => n.moduleId === 'base.button')
  if (!node) throw new Error('no base.button node was produced')
  return node.props as Record<string, unknown>
}

/** Publish `props` through the real escape boundary + module render(). */
function publishedHtml(props: Record<string, unknown>): string {
  const escaped = escapeProps(props, ButtonModule.schema) as unknown as ButtonStoredProps
  return ButtonModule.render!(escaped, {} as never).html
}

/** Import then publish, the way a migrated page actually reaches the browser. */
function roundTrip(html: string): string {
  return publishedHtml(buttonProps(html))
}

describe('inline SVG inside a button', () => {
  it('keeps the consent widget gear icon through import', () => {
    const props = buttonProps(CONSENT_BUTTON)
    expect(props.label).toBe('Customize')
    expect(String(props.icon)).toContain('<svg')
    expect(String(props.icon)).toContain('width="14"')
    expect(String(props.icon)).toContain('viewBox="0 0 14 14"')
    expect(String(props.icon)).toContain('currentColor')
  })

  it('publishes the icon as real markup, before the label', () => {
    const html = roundTrip(CONSENT_BUTTON)
    expect(html).toContain('<svg')
    expect(html).toContain('currentColor')
    expect(html).not.toContain('&lt;svg')
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('Customize'))
  })

  it('keeps presentation attributes the icon needs to draw', () => {
    const html = roundTrip(CONSENT_BUTTON)
    for (const attribute of [
      'viewBox="0 0 14 14"',
      'fill="none"',
      'stroke="currentColor"',
      'stroke-width="1.5"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'cx="7"',
      'cy="7"',
      'r="2"',
      'd="M7 1v2"',
    ]) {
      expect(html).toContain(attribute)
    }
  })

  it('keeps an icon inside a btn-classed anchor too', () => {
    const html = roundTrip('<a class="btn" href="/x"><svg viewBox="0 0 8 8"><path d="M0 0h8"/></svg>Go</a>')
    expect(html).toContain('<svg')
    expect(html).toContain('Go')
  })

  it('leaves a plain text button unchanged', () => {
    const props = buttonProps('<button>Plain</button>')
    expect(props.icon).toBe('')
    expect(publishedHtml(props)).toBe('<button type="button">Plain</button>')
  })
})

describe('hostile SVG on the icon prop never reaches the page', () => {
  /**
   * Every hostile construct at once. Asserted on the *stored prop* rather than
   * on imported HTML: an `<iframe>` nested in `<foreignObject>` makes a real
   * HTML parser tear the surrounding markup apart, which would test the parser
   * instead of the boundary. A corrupted store, a malicious plugin or a hand-
   * edited prop reaches render() by exactly this path.
   */
  const HOSTILE =
    '<svg onload="alert(1)" viewBox="0 0 10 10">' +
    '<foreignObject><b>smuggled</b></foreignObject>' +
    '<a href="javascript:alert(4)"><path d="M0 0h10" onclick="alert(5)"/></a>' +
    '<image href="javascript:alert(6)"/>' +
    '<use href="https://evil.example/x.svg#i"/>' +
    '<circle cx="5" cy="5" r="4" fill="currentColor"/>' +
    '</svg>'

  it('strips scripts, handlers and hostile URLs but keeps the drawable parts', () => {
    const html = publishedHtml({ label: 'Danger', icon: HOSTILE, disabled: false, htmlAttributes: {} })

    // Dangerous constructs, gone.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(')
    expect(html).not.toContain('onload')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('foreignObject')
    expect(html).not.toContain('smuggled')
    expect(html).not.toContain('evil.example')
    // `<use>` is a documented XSS/SSRF vector; DOMPurify drops it outright.
    expect(html).not.toContain('<use')

    // The safe geometry still renders, so this is sanitisation, not deletion.
    expect(html).toContain('<svg')
    expect(html).toContain('<circle')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('Danger')
  })

  it('keeps a same-document fragment reference on a textPath', () => {
    const html = publishedHtml({
      label: 'Ref',
      icon: '<svg viewBox="0 0 100 100"><defs><path id="p" d="M0 0h100"/></defs><text><textPath href="#p">Round</textPath></text></svg>',
      disabled: false,
      htmlAttributes: {},
    })
    expect(html).toContain('href="#p"')
    expect(html).toContain('Round')
  })

  it('does not let an unwrapped <a> child smuggle an event handler through', () => {
    // Regression guard for the single-pass DOMPurify gap: unwrapping a
    // FORBID_TAGS element re-parents its children behind the walker.
    const html = publishedHtml({
      label: 'Wrapped',
      icon: '<svg viewBox="0 0 10 10"><a href="#x"><path d="M0 0h1" onclick="alert(1)"/></a></svg>',
      disabled: false,
      htmlAttributes: {},
    })
    expect(html).toContain('<path')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('alert(')
  })

  it('emits nothing for an icon whose markup is entirely unsafe', () => {
    const html = publishedHtml({
      label: 'Safe text',
      icon: '<script>alert(1)</script>',
      disabled: false,
      htmlAttributes: {},
    })
    expect(html).not.toContain('alert(')
    expect(html).not.toContain('<script')
    expect(html).toContain('Safe text')
  })

  it('strips a script smuggled inside an imported button icon', () => {
    const html = roundTrip('<button><svg viewBox="0 0 4 4" onload="alert(1)"></svg>Import</button>')
    expect(html).not.toContain('alert(')
    expect(html).not.toContain('onload')
    expect(html).toContain('viewBox="0 0 4 4"')
  })
})

// ---------------------------------------------------------------------------
// The other half of the same trade-off: a button whose children are STRUCTURE.
//
// The leaf mapping carries one label and one svg. That is the whole of the
// consent-widget button above, and it is destructive for a button someone
// built a layout inside. 890capital's FAQ accordion rows are
//
//   <button class="ct-div-block oxel_accordion__row" aria-expanded="false">
//     <div class="ct-code-block oxel_accordion__icon">
//       <svg style="width:100%; height:auto" viewBox="0 0 32 32">…</svg>
//     </div>
//     <div class="ct-div-block oxel_accordion__row_left">…label…</div>
//   </button>
//
// and flattening them dropped the 32px `.oxel_accordion__icon` box. The svg,
// sized `width:100%`, then had the 1264px flex row to fill: eight ~1000px plus
// signs down the page, publishing at 15607px against live's 8505px.
// ---------------------------------------------------------------------------

const ACCORDION_ROW =
  '<button class="ct-div-block oxel_accordion__row" aria-expanded="false">' +
  '<div class="ct-code-block oxel_accordion__icon">' +
  '<svg style="width:100%; height: auto;" viewBox="0 0 32 32" fill="none"><path d="M16 8v16M8 16h16"/></svg>' +
  '</div>' +
  '<div class="ct-div-block oxel_accordion__row_left">' +
  '<div class="ct-text-block oxel_accordion__row__label">Can you provide an example?</div>' +
  '</div>' +
  '</button>'

describe('a button built out of structure stays a container', () => {
  it('recurses instead of flattening to a leaf', () => {
    const result = importHtml(ACCORDION_ROW)
    const row = result.nodes[result.rootIds[0]!]!

    expect(row.moduleId).toBe('base.container')
    expect(row.props.tag).toBe('custom')
    expect(row.props.customTag).toBe('button')
    expect(row.classIds).toEqual(['ct-div-block', 'oxel_accordion__row'])
    expect(row.children).toHaveLength(2)
  })

  it('keeps the icon wrapper that gives the svg its box', () => {
    const result = importHtml(ACCORDION_ROW)
    const row = result.nodes[result.rootIds[0]!]!
    const iconWrapper = result.nodes[row.children[0]!]!

    // This element is the whole point: it is the 32px box the svg fills.
    expect(iconWrapper.classIds).toEqual(['ct-code-block', 'oxel_accordion__icon'])
    expect(iconWrapper.children).toHaveLength(1)
    expect(result.nodes[iconWrapper.children[0]!]!.moduleId).toBe('base.svg')
  })

  it('keeps the label subtree and its classes', () => {
    const result = importHtml(ACCORDION_ROW)
    const row = result.nodes[result.rootIds[0]!]!
    const left = result.nodes[row.children[1]!]!
    const label = result.nodes[left.children[0]!]!

    expect(left.classIds).toEqual(['ct-div-block', 'oxel_accordion__row_left'])
    expect(label.classIds).toEqual(['ct-text-block', 'oxel_accordion__row__label'])
    expect(result.nodes[label.children[0]!]!.props.text).toBe('Can you provide an example?')
  })

  it('an svg-only button is still a leaf, so the consent widget is unchanged', () => {
    const result = importHtml(CONSENT_BUTTON)
    const node = result.nodes[result.rootIds[0]!]!

    expect(node.moduleId).toBe('base.button')
    expect(node.children).toHaveLength(0)
    expect(String(node.props.icon)).toContain('<svg')
  })

  it('a text-only button is still a leaf', () => {
    const result = importHtml('<button class="cta">Get started</button>')
    const node = result.nodes[result.rootIds[0]!]!

    expect(node.moduleId).toBe('base.button')
    expect(node.props.label).toBe('Get started')
  })

  it('a submit button is still base.submit even when it has structure', () => {
    const result = importHtml(
      '<form><button type="submit"><span class="ico">x</span>Send</button></form>',
    )
    const form = result.nodes[result.rootIds[0]!]!
    const submit = result.nodes[form.children[0]!]!

    expect(submit.moduleId).toBe('base.submit')
  })
})
