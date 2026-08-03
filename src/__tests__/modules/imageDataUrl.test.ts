import { describe, expect, it } from 'bun:test'
import { registry } from '@core/module-engine'
import { escapeProps } from '@core/publisher'

import '@modules/base'

function render(props: Record<string, unknown>): string {
  const img = registry.getOrThrow('base.image')
  const safeProps = escapeProps({ ...img.defaults, ...props }, img.schema)
  return img.render(safeProps, []).html
}

describe('base.image — data: image placeholders', () => {
  // Lazy-loading themes can ship an inline SVG placeholder as `src` and the
  // real URL in a data attribute. Rewriting it to `#` re-requests the page.
  const PLACEHOLDER =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%201%201'%3E%3C/svg%3E"

  it('keeps a data:image placeholder instead of rewriting it to #', () => {
    const html = render({ src: PLACEHOLDER })

    expect(html).toContain('data:image/svg+xml')
    expect(html).not.toContain('src="#"')
  })

  it('accepts the raster image types too', () => {
    for (const src of [
      'data:image/png;base64,AAA',
      'data:image/jpeg;base64,AAA',
      'data:image/jpg;base64,AAA',
      'data:image/gif;base64,AAA',
      'data:image/webp;base64,AAA',
      'data:image/avif;base64,AAA',
      'data:image/bmp;base64,AAA',
      'data:image/x-icon;base64,AAA',
      'data:image/vnd.microsoft.icon;base64,AAA',
    ]) {
      expect(render({ src })).toContain(src)
    }
  })

  it('allows a base64 SVG declaration', () => {
    expect(render({ src: 'data:image/svg+xml;base64,AAA' })).toContain(
      'src="data:image/svg+xml;base64,AAA"',
    )
  })

  it('validates the declared image MIME type rather than inspecting the payload', () => {
    // Payload sniffing belongs to the browser; this boundary validates only
    // the declared MIME type and attribute context.
    const src = 'data:image/svg+xml,<html>not-an-svg</html>'
    expect(render({ src })).toContain('src="data:image/svg+xml,&lt;html&gt;not-an-svg&lt;/html&gt;"')
  })

  it('refuses non-image, missing, and empty MIME declarations', () => {
    for (const src of [
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:application/javascript,alert(1)',
      'data:;base64,AAA',
      'data:image/,AAA',
      'DATA:TEXT/HTML,<script>alert(1)</script>',
    ]) {
      const html = render({ src })
      expect(html).toContain('src="#"')
      expect(html).not.toContain(src)
    }
  })

  it('refuses whitespace and control-character scheme smuggling', () => {
    for (const src of [
      'data:\ttext/html,<script>alert(1)</script>',
      'java\nscript:alert(1)',
      ' \tdata:text/html,<script>alert(1)</script>',
    ]) {
      const html = render({ src })
      expect(html).toContain('src="#"')
      expect(html).not.toContain(src)
    }
  })

  it('keeps percent-encoded text in the relative-URL negative matrix', () => {
    // Browsers do not percent-decode before scheme detection, so this is a safe relative URL.
    expect(render({ src: '%64ata:image/png,x&y' })).toContain(
      'src="%64ata:image/png,x&amp;y"',
    )
  })

  it('still refuses javascript: in an image src', () => {
    expect(render({ src: 'javascript:alert(1)' })).toContain('src="#"')
  })

  it('keeps data:image scoped out of non-image props', () => {
    const schema = { href: { type: 'url', label: 'Link' } } as const
    expect(escapeProps({ href: 'data:image/png;base64,AAA' }, schema).href).toBe('#')
  })
})
