import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml, parseHtml, stripUnsafe } from '@core/htmlImport'
import { FORBIDDEN_CUSTOM_HTML_TAGS } from '@modules/base/utils/htmlTag'

function fixtureFor(tag: string): string {
  if (tag === 'iframe') return '<iframe src="https://example.com/form"></iframe><main>Safe</main>'
  if (tag === 'script') return '<script>unsafe()</script><main>Safe</main>'
  if (tag === 'style') return '<style>.safe { color: green; }</style><main>Safe</main>'
  if (tag === 'frameset') return '<frameset><frame src="legacy.html"></frameset>'
  return `<${tag}>Fallback</${tag}><main>Safe</main>`
}

describe('forbidden custom-tag husks', () => {
  it('no forbidden custom tag reaches the imported node map', () => {
    for (const tag of FORBIDDEN_CUSTOM_HTML_TAGS) {
      const result = importHtml(fixtureFor(tag))
      const forbiddenNodes = Object.values(result.nodes).filter((node) => {
        const customTag = node.props.customTag
        return typeof customTag === 'string' && FORBIDDEN_CUSTOM_HTML_TAGS.has(customTag)
      })
      expect(forbiddenNodes, tag).toHaveLength(0)
    }
  })

  it('counts each newly stripped tag family', () => {
    const result = importHtml(`
      <LINK REL="STYLESHEET" href="theme.css">
      <LINK REL="PRELOAD" href="font.woff2">
      <META charset="utf-8">
      <BASE href="https://example.com/">
      <OBJECT data="plugin.bin"><p>Fallback</p></OBJECT>
      <EMBED src="plugin.bin">
      <APPLET><p>Fallback</p></APPLET>
      <IFRAME src="https://example.com/form"></IFRAME>
    `)

    expect(result.stripped).toMatchObject({
      stylesheetLinks: 1,
      otherLinks: 1,
      metadataElements: 2,
      embeddedElements: 3,
      untrustedIframes: 1,
    })

    const legacyFrames = stripUnsafe(parseHtml(
      '<!doctype html><html><frameset><frame src="one.html"><frame src="two.html"></frameset></html>',
    ))
    expect(legacyFrames.embeddedElements).toBe(3)
  })

  it('removes object fallback children with the forbidden parent', () => {
    const result = importHtml('<object data="plugin.bin"><p>Fallback copy</p></object><main>Safe</main>')
    expect(Object.values(result.nodes).some((node) => node.props.text === 'Fallback copy')).toBe(false)
  })

  it('keeps trusted video iframe mapping byte-for-byte', () => {
    const source = 'https://player.vimeo.com/video/123456789?dnt=1'
    const result = importHtml(`<iframe src="${source}" title="Welcome" width="640" height="360" allow="autoplay; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`)
    expect(result.rootIds).toHaveLength(1)
    expect(result.nodes[result.rootIds[0]!]!).toMatchObject({
      moduleId: 'base.video',
      props: {
        videoUrl: source,
        title: 'Welcome',
        embedWidth: '640',
        embedHeight: '360',
        iframeAllow: 'autoplay; fullscreen',
        iframeReferrerPolicy: 'strict-origin-when-cross-origin',
        allowFullscreen: true,
      },
    })
    expect(result.stripped.untrustedIframes).toBe(0)
  })
})
