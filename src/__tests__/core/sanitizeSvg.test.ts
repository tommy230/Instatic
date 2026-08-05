/**
 * sanitizeSvg.test.ts — the SVG DOMPurify profile keeps vector markup but
 * strips scripting / HTML-smuggling vectors.
 */

import { describe, it, expect } from 'bun:test'
import { sanitizeSvg } from '@core/sanitize'

describe('sanitizeSvg', () => {
  it('keeps a normal inline SVG (svg/path/viewBox)', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M1 1h22"/></svg>')
    expect(out).toContain('<svg')
    expect(out).toContain('viewBox="0 0 24 24"')
    expect(out).toContain('<path')
    expect(out).toContain('d="M1 1h22"')
  })

  it('preserves presentation attributes (fill: currentColor styling)', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>')
    expect(out).toContain('<circle')
    expect(out).toContain('currentColor')
  })

  it('preserves safe fragment references used by text paths', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 100 100"><defs><path id="ring" d="M10 50a40 40 0 1 1 80 0"/></defs><text><textPath href="#ring" xlink:href="#ring">Around the ring</textPath></text></svg>',
    )

    expect(out).toContain('<textPath')
    expect(out).toContain('href="#ring"')
    expect(out).toContain('xlink:href="#ring"')
    expect(out).toContain('Around the ring')
  })

  it('strips unsafe URI schemes from SVG reference attributes', () => {
    const out = sanitizeSvg(
      '<svg><text><textPath href="javascript:alert(1)" xlink:href="javascript:alert(2)">Unsafe</textPath></text></svg>',
    )

    expect(out).toContain('<textPath')
    expect(out).not.toContain('href=')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('strips data-URI SVG reuse payloads', () => {
    const out = sanitizeSvg(
      '<svg><use href="data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E"></use></svg>',
    )

    expect(out.toLowerCase()).not.toContain('<use')
    expect(out.toLowerCase()).not.toContain('data:image')
    expect(out.toLowerCase()).not.toContain('onload')
  })

  it('strips <script> inside the SVG', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out.toLowerCase()).not.toContain('alert(1)')
    expect(out.toLowerCase()).toContain('<svg')
  })

  it('strips inline event handlers', () => {
    const out = sanitizeSvg('<svg><path d="M0 0" onload="alert(1)"/></svg>')
    expect(out.toLowerCase()).not.toContain('onload')
  })

  it('strips <foreignObject> HTML smuggling', () => {
    const out = sanitizeSvg('<svg><foreignObject><img src=x onerror="alert(1)"></foreignObject></svg>')
    expect(out.toLowerCase()).not.toContain('foreignobject')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('returns empty string for empty/blank input', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg('   ')).toBe('')
    expect(sanitizeSvg(null)).toBe('')
  })
})

/**
 * DOMPurify's NodeIterator skips every sibling that follows a node it removes,
 * so a single pass leaves later siblings unsanitised. `sanitizeSvg` therefore
 * re-runs until the output stops changing. Measured before the fix: one pass of
 * the payload below removed only `<foreignObject>` and the root `onload` — the
 * `onclick`, both `javascript:` URLs and the external `<use>` all survived.
 */
describe('sanitizeSvg sanitises to a fixed point', () => {
  const CHAINED =
    '<svg onload="alert(1)" viewBox="0 0 10 10">' +
    '<foreignObject><b>smuggled</b></foreignObject>' +
    '<a href="javascript:alert(2)"><path d="M0 0h10" onclick="alert(3)"/></a>' +
    '<image href="javascript:alert(4)"/>' +
    '<use href="https://evil.example/x.svg#i"/>' +
    '<circle cx="5" cy="5" r="4" fill="currentColor"/>' +
    '</svg>'

  it('removes every forbidden construct, not just the first', () => {
    const out = sanitizeSvg(CHAINED)
    expect(out.toLowerCase()).not.toContain('onload')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('foreignobject')
    expect(out).not.toContain('smuggled')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('<circle')
  })

  it('is idempotent — re-sanitising its own output changes nothing', () => {
    const once = sanitizeSvg(CHAINED)
    expect(sanitizeSvg(once)).toBe(once)
  })
})

/**
 * `<use>` is allowed for SAME-DOCUMENT fragment references only.
 *
 * The profile excluded it outright because `<use href="https://evil/x.svg#i">`
 * pulls a remote document into the page. A `#fragment` cannot do that, and it
 * is how every icon sprite works: 890capital's Oxygen theme renders each
 * checkmark as `<svg><use xlink:href="#FontAwesomeicon-check"/></svg>` against
 * an inline `<symbol>` sprite that imports fine, so dropping the `<use>`
 * published 13 correctly-sized, correctly-coloured, empty `<svg>` boxes.
 *
 * Every case below that is not a bare fragment drops the ELEMENT, not just the
 * attribute — a `<use>` that resolves to nothing renders nothing and would
 * leave a lie in the markup.
 */
describe('sanitizeSvg — <use> fragment allowlist', () => {
  it('keeps a same-document sprite reference on xlink:href', () => {
    const out = sanitizeSvg('<svg id="i"><use xlink:href="#FontAwesomeicon-check"></use></svg>')
    expect(out).toContain('<use')
    expect(out).toContain('#FontAwesomeicon-check')
  })

  it('keeps a same-document sprite reference on href', () => {
    const out = sanitizeSvg('<svg id="i"><use href="#FontAwesomeicon-check"></use></svg>')
    expect(out).toContain('<use')
    expect(out).toContain('#FontAwesomeicon-check')
  })

  it('drops a remote document reference', () => {
    const out = sanitizeSvg('<svg><use xlink:href="https://evil.example/x.svg#y"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
    expect(out).not.toContain('evil.example')
  })

  it('drops a protocol-relative reference', () => {
    const out = sanitizeSvg('<svg><use href="//evil.example/#x"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
    expect(out).not.toContain('evil.example')
  })

  it('drops a data: reference', () => {
    const out = sanitizeSvg('<svg><use href="data:image/svg+xml,%3Csvg onload=alert(1)%3E#x"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
    expect(out.toLowerCase()).not.toContain('data:')
    expect(out.toLowerCase()).not.toContain('onload')
  })

  it('drops a blob: reference', () => {
    const out = sanitizeSvg('<svg><use href="blob:https://evil.example/abc#x"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
    expect(out).not.toContain('evil.example')
  })

  it('drops a fragment containing whitespace', () => {
    const out = sanitizeSvg('<svg><use href="#a b"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
  })

  it('drops a <use> with no reference at all', () => {
    const out = sanitizeSvg('<svg><use></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
  })

  it('drops a <use> with an empty reference', () => {
    expect(sanitizeSvg('<svg><use href=""></use></svg>').toLowerCase()).not.toContain('<use')
    expect(sanitizeSvg('<svg><use href="#"></use></svg>').toLowerCase()).not.toContain('<use')
  })

  it('drops the element when ONE of two references fails', () => {
    const out = sanitizeSvg('<svg><use href="#ok" xlink:href="https://evil.example/#y"></use></svg>')
    expect(out.toLowerCase()).not.toContain('<use')
    expect(out).not.toContain('evil.example')
  })

  /**
   * Accepted, and normalised on the way through. Browsers strip ASCII
   * whitespace when resolving a URL attribute, so ` #ok` and `#ok` are the same
   * reference to a renderer; rejecting the spaced form would drop markup that
   * works. The trimmed value is written back so the string validated here is
   * byte-for-byte the string the browser resolves.
   */
  it('accepts a padded fragment and writes back the trimmed value', () => {
    const out = sanitizeSvg('<svg><use href=" #ok "></use></svg>')
    expect(out).toContain('<use')
    expect(out).toContain('href="#ok"')
    expect(out).not.toContain('" #ok')
  })

  it('a kept <use> survives re-sanitising unchanged', () => {
    const once = sanitizeSvg('<svg id="i"><use xlink:href="#icon-check"></use></svg>')
    expect(sanitizeSvg(once)).toBe(once)
  })
})
