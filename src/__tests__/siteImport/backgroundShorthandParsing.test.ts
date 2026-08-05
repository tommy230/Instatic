/**
 * Background shorthands survive the CSS parser intact.
 *
 * Two happy-dom 20.9.0 parser bugs, both silent, both measured through
 * `cssToStyleRules`:
 *
 * BUG A. `<position> / <bg-size>` is a layer-level construct, but the parser
 * folded the slash into whichever single whitespace-delimited token happened to
 * contain it. Unslider's fallback arrow,
 * `background: rgba(0,0,0,.2) url(…) no-repeat scroll 50% 50% / 7px 11px`,
 * came out as position `50% 50%` / `11px` with size `7px`: the second position
 * token was read as a position-Y and the second size token as a position.
 *
 * BUG B. `getURL` applied the unquoted-url-token restrictions to *quoted* URLs,
 * so a quoted URL containing spaces or the opposite quote character was
 * rejected; on top of that the url() regexp could not span a `)` inside the
 * URL. An inline `data:image/svg+xml` background therefore failed to parse and,
 * because `getBackground` returns null when no component matches, the whole
 * `background` declaration vanished before any importer code saw it.
 *
 * Measured on 890capital.com: the carousel deliberately overrides Unslider's
 * grey PNG fallback with a 40x40 inline-SVG arrow
 * (`transform="rotate(90 39.5 0.5)"` supplies the offending parenthesis). Bug B
 * dropped the override, exposing the fallback, and bug A then rendered the
 * fallback at the wrong size and position: grey blobs instead of arrows.
 *
 * Fixed by patching `patches/happy-dom@20.9.0.patch`. These tests fail if the
 * patch is dropped by a lockfile change or a happy-dom upgrade that
 * reintroduces either gap.
 */
import { describe, expect, it } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'

/** The exact 890capital.com carousel arrow override. */
const ARROW_SVG_URL =
  `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">` +
  `<rect x="39.5" y="0.5" width="39" height="39" rx="19.5" transform="rotate(90 39.5 0.5)" stroke="%23122C4F"/>` +
  `<path d="M20.3933 13.987L25.4467 19.3L12 19.3L12 20.7L25.4467 20.7L20.3933 26.013L21.3333 27L28 20L21.3333 13L20.3933 13.987Z" fill="%23122C4F"/>` +
  `</svg>')`

describe('background shorthand position/size slash syntax', () => {
  it('splits the Unslider fallback into the right longhands', () => {
    const { rules } = cssToStyleRules(
      '.unslider-arrow { background: rgba(0,0,0,.2) url("data:image/png;base64,iVBORw0KGgo=") no-repeat scroll 50% 50% / 7px 11px }',
    )
    expect(rules[0].styles).toMatchObject({
      backgroundImage: 'url("data:image/png;base64,iVBORw0KGgo=")',
      backgroundPositionX: '50%',
      backgroundPositionY: '50%',
      backgroundSize: '7px 11px',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'scroll',
      backgroundColor: 'rgba(0, 0, 0, .2)',
    })
  })

  it.each([
    ['center/40px 40px', 'center', 'center', '40px 40px'],
    ['center / cover', 'center', 'center', 'cover'],
    ['top left / 50% 60%', 'left', 'top', '50% 60%'],
    ['50% 50%/7px', '50%', '50%', '7px'],
  ])('parses %s', (value, positionX, positionY, size) => {
    const { rules } = cssToStyleRules(`.a { background: url(x.png) no-repeat ${value} }`)
    expect(rules[0].styles).toMatchObject({
      backgroundPositionX: positionX,
      backgroundPositionY: positionY,
      backgroundSize: size,
    })
  })

  it('leaves a shorthand without a slash alone', () => {
    const { rules } = cssToStyleRules('.a { background: #fff url(x.png) no-repeat center }')
    expect(rules[0].styles).toMatchObject({
      backgroundColor: '#fff',
      backgroundPositionX: 'center',
      backgroundPositionY: 'center',
      backgroundSize: 'initial',
    })
  })
})

describe('quoted data: URL backgrounds survive', () => {
  it('keeps an inline SVG background with spaces, quotes and parentheses', () => {
    const { rules } = cssToStyleRules(
      `#slider-125-15 .unslider-arrow { background: ${ARROW_SVG_URL} no-repeat center/40px 40px; border: 1px solid #122C4F }`,
    )
    const styles = rules[0].styles
    expect(styles.backgroundImage).toContain('data:image/svg+xml')
    expect(styles.backgroundImage).toContain('rotate(90 39.5 0.5)')
    expect(styles).toMatchObject({
      backgroundRepeat: 'no-repeat',
      backgroundPositionX: 'center',
      backgroundPositionY: 'center',
      backgroundSize: '40px 40px',
    })
  })

  it('keeps a quoted URL containing spaces', () => {
    const { rules } = cssToStyleRules('.a { background-image: url("my image.png") }')
    expect(rules[0].styles.backgroundImage).toBe('url("my image.png")')
  })

  it('quotes the serialised URL so inner quotes stay valid CSS', () => {
    const { rules } = cssToStyleRules(`.a { background-image: url('a"b.png') }`)
    expect(rules[0].styles.backgroundImage).toBe(`url('a"b.png')`)
  })

  it('still rejects an unquoted URL containing spaces', () => {
    const { rules } = cssToStyleRules('.a { background-image: url(my image.png) }')
    expect(rules[0]?.styles.backgroundImage).toBeUndefined()
  })

  it('still rejects a URL whose quotes do not match', () => {
    const { rules } = cssToStyleRules(`.a { background-image: url("mismatched.png') }`)
    expect(rules[0]?.styles.backgroundImage).toBeUndefined()
  })
})
