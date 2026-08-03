/**
 * base.image preserves source alt text and does not force performance hints
 * onto an imported image. A lazy image inside a zero-height container is never
 * fetched, so the source declaration must remain authoritative.
 */
import { describe, expect, it } from 'bun:test'
import type { RenderResolvedMedia } from '@core/publisher'
import { registry } from '@core/module-engine'

import '@modules/base'

function libraryMedia(): RenderResolvedMedia {
  return {
    publicPath: '/uploads/hero.png',
    mimeType: 'image/png',
    width: 1200,
    height: 800,
    altText: '',
    blurHash: null,
    posterPath: null,
    variants: [],
  }
}

function render(props: Record<string, unknown>): string {
  const img = registry.getOrThrow('base.image')
  return img.render({ fetchPriority: 'auto', decoding: 'async', ...props }, []).html
}

describe('base.image — imported images keep the source alt', () => {
  it('keeps the alt the source page wrote', () => {
    const html = render({
      src: 'https://example.com/logo.png',
      htmlAttributes: { alt: 'Source logo description', title: 'x' },
    })

    expect(html).toContain('alt="Source logo description"')
    expect(html.match(/alt=/g)).toHaveLength(1)
  })

  it('still emits an empty alt for an image the source left undescribed', () => {
    expect(render({ src: 'https://example.com/spacer.gif' })).toContain('alt=""')
  })

  it('lets the library asset win when it carries alt text', () => {
    const html = render({
      src: '/uploads/hero.png',
      htmlAttributes: { alt: 'source alt' },
      _resolvedMediaByKey: { src: { ...libraryMedia(), altText: 'library alt' } },
    })

    expect(html).toContain('alt="library alt"')
    expect(html).not.toContain('source alt')
  })

  it('falls back to the source alt when the library field is empty', () => {
    const html = render({
      src: '/uploads/hero.png',
      htmlAttributes: { alt: 'source alt' },
      _resolvedMediaByKey: { src: { ...libraryMedia(), altText: '   ' } },
    })

    expect(html).toContain('alt="source alt"')
  })

  it('escapes an alt the source page controlled', () => {
    const html = render({
      src: 'https://example.com/a.png',
      htmlAttributes: { alt: '"><script>alert(1)</script>' },
    })

    expect(html).not.toContain('<script>')
  })

  it('drops an authored alt rejected by the shared HTML-attribute gate', () => {
    const html = render({
      src: 'https://example.com/a.png',
      htmlAttributes: { alt: 'javascript:alert(1)' },
    })

    expect(html).toContain('alt=""')
    expect(html).not.toContain('javascript:')
  })
})

describe('base.image — imported images keep the source hints', () => {
  it('adds neither loading nor decoding to a bare imported <img src alt>', () => {
    const html = render({
      src: 'https://example.com/assets/x.jpg',
      fetchPriority: 'high',
    })

    expect(html).toContain('src="https://example.com/assets/x.jpg"')
    expect(html).not.toContain('loading=')
    expect(html).not.toContain('decoding=')
    expect(html).not.toContain('fetchpriority=')
  })

  it('keeps hints the source page declared', () => {
    const html = render({
      src: 'https://example.com/x.jpg',
      htmlAttributes: { loading: 'eager', decoding: 'sync', fetchpriority: 'low' },
    })

    expect(html).toContain('loading="eager"')
    expect(html).toContain('decoding="sync"')
    expect(html).toContain('fetchpriority="low"')
    expect(html.match(/loading=/g)).toHaveLength(1)
    expect(html.match(/decoding=/g)).toHaveLength(1)
    expect(html.match(/fetchpriority=/g)).toHaveLength(1)
  })

  it('still defaults a library-backed image to lazy + async', () => {
    const html = render({
      src: '/uploads/hero.png',
      loading: 'lazy',
      _resolvedMediaByKey: { src: libraryMedia() },
    })

    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
  })

  it('generates responsive attributes when a source value is rejected by sanitization', () => {
    const html = render({
      src: '/uploads/hero.png',
      htmlAttributes: { srcset: 'javascript:alert(1)' },
      _resolvedMediaByKey: {
        src: {
          ...libraryMedia(),
          variants: [
            {
              width: 640,
              height: 427,
              format: 'webp',
              path: '/uploads/hero-w640.webp',
              sizeBytes: 123,
            },
          ],
        },
      },
    })

    expect(html).toContain('srcset="/uploads/hero-w640.webp 640w"')
    expect(html).not.toContain('javascript:')
  })

  it('normalizes source attribute names before deciding whether generated values are suppressed', () => {
    const html = render({
      src: '/uploads/hero.png',
      htmlAttributes: {
        ' SRCSET ': 'https://cdn.example.com/hero.webp 2x',
        ' width': '321',
      },
      _resolvedMediaByKey: {
        src: {
          ...libraryMedia(),
          variants: [
            {
              width: 640,
              height: 427,
              format: 'webp',
              path: '/uploads/hero-w640.webp',
              sizeBytes: 123,
            },
          ],
        },
      },
    })

    expect(html).toContain('srcset="https://cdn.example.com/hero.webp 2x"')
    expect(html).toContain('width="321"')
    expect(html.match(/srcset=/g)).toHaveLength(1)
    expect(html.match(/width=/g)).toHaveLength(1)
  })
})
