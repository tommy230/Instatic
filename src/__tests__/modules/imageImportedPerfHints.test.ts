/**
 * base.image — perf hints are never forced onto an imported image.
 *
 * `loading="lazy"` and `decoding="async"` are right for an image the editor
 * placed and wrong for one carried over from a source page that asked for
 * neither: a lazy image inside a zero-height container (LayerSlider's
 * `ls-hidden`) is never fetched at all, so a slider waits forever for a
 * background that will not arrive.
 *
 * The first guard tested "no library asset AND some leftover authored
 * attribute", which missed the commonest imported image there is — `<img src
 * alt>` — because both of those become props rather than htmlAttributes. On
 * redrockscafe.com 26 of 31 published images still carried a forced
 * `loading="lazy"`. The guard is now the absence of a library asset alone: the
 * editor's `src` control is a media picker, so an image with no resolvable
 * asset did not come from the editor.
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
  // Same family as the perf-hint bug and the same shape: an attribute the
  // module regenerates from a library asset, dropped at import, and an imported
  // image has no asset to regenerate it from. ecolorworld.com's footer publishes
  // three images whose source alts are "csi", "csi" and "Web Services By Digital
  // Alchemy"; all three published as alt="". A screen reader hears nothing and
  // the text a visitor sees when the image 404s is gone — fleet-wide, silent.
  it('keeps the alt the source page wrote', () => {
    const html = render({
      src: 'https://example.com/logo.png',
      htmlAttributes: { alt: 'Web Services By Digital Alchemy', title: 'x' },
    })

    expect(html).toContain('alt="Web Services By Digital Alchemy"')
    // Exactly one alt: the resolved value is held out of the generic
    // passthrough so it cannot be emitted twice.
    expect(html.match(/alt=/g)).toHaveLength(1)
  })

  it('still emits an empty alt for an image the source left undescribed', () => {
    // A decorative image is a decision; `alt=""` is how it is spelled.
    expect(render({ src: 'https://example.com/spacer.gif' })).toContain('alt=""')
  })

  it('lets the library asset win when it carries alt text', () => {
    // The Media viewer edits the library value, so a per-instance copy frozen
    // at import would make those edits silently not apply.
    const html = render({
      src: '/uploads/hero.png',
      htmlAttributes: { alt: 'source alt' },
      _resolvedMediaByKey: { src: { ...libraryMedia(), altText: 'library alt' } },
    })

    expect(html).toContain('alt="library alt"')
    expect(html).not.toContain('source alt')
  })

  it('falls back to the source alt when the library field is empty', () => {
    // An empty library field is the absence of a decision, not a decision to
    // ship no alt text.
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
})

describe('base.image — imported images keep the source hints', () => {
  it('adds neither loading nor decoding to a bare imported <img src alt>', () => {
    const html = render({ src: 'https://example.com/wp-content/uploads/x.jpg' })

    expect(html).toContain('src="https://example.com/wp-content/uploads/x.jpg"')
    expect(html).not.toContain('loading=')
    expect(html).not.toContain('decoding=')
  })

  it('keeps hints the source page declared', () => {
    const html = render({
      src: 'https://example.com/x.jpg',
      htmlAttributes: { loading: 'eager', decoding: 'sync' },
    })

    expect(html).toContain('loading="eager"')
    expect(html).toContain('decoding="sync"')
    // Not emitted twice — the module skips what the source already set.
    expect(html.match(/loading=/g)).toHaveLength(1)
    expect(html.match(/decoding=/g)).toHaveLength(1)
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
})

describe('base.image — data: image placeholders', () => {
  // WordPress lazy-loaders ship an inline SVG of the right aspect ratio as the
  // placeholder `src` and the real URL in `data-lazy-src`. `safeUrl` refuses
  // every `data:` scheme, so the placeholder was rewritten to `#` — a request
  // for the page itself, loaded into an image slot.
  const PLACEHOLDER =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%201457%20909'%3E%3C/svg%3E"

  it('keeps a data:image placeholder instead of rewriting it to #', () => {
    const html = render({ src: PLACEHOLDER, htmlAttributes: { 'data-lazy-src': 'https://x/y.jpg' } })

    expect(html).toContain('data:image/svg+xml')
    expect(html).not.toContain('src="#"')
  })

  it('accepts the raster image types too', () => {
    for (const src of ['data:image/png;base64,AAA', 'data:image/webp;base64,AAA', 'data:image/gif,AAA']) {
      expect(render({ src })).toContain(src.slice(0, 20))
    }
  })

  it('still refuses a data: URI that is not an image', () => {
    // The whole point of the guard: a data: URI can carry a document.
    for (const src of ['data:text/html,<script>alert(1)</script>', 'data:application/javascript,alert(1)']) {
      const html = render({ src })
      expect(html).toContain('src="#"')
      expect(html).not.toContain('script')
    }
  })

  it('still refuses javascript: in an image src', () => {
    expect(render({ src: 'javascript:alert(1)' })).toContain('src="#"')
  })
})
