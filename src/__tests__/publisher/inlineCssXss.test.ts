import { describe, test, expect } from 'bun:test'
import { publishPage } from '@core/publisher'
import { makeModule, makeRegistry, makePage, makeSite } from './helpers'

/**
 * ISS-007: the inline-CSS emitter baked the raw user stylesheet + framework CSS
 * into a `<style>` block without `</style>` neutralisation. A user stylesheet
 * containing `</style><script>…` could close the style element early and inject
 * script into the rendered page (stored XSS, e.g. in the admin Live Canvas
 * iframe). Every inline CSS source must be neutralised before emission.
 */
describe('inline CSS emission — </style> breakout (ISS-007)', () => {
  test('neutralises </style> from a user stylesheet', () => {
    const registry = makeRegistry({
      'base.text': makeModule('base.text', {
        render: (props) => ({ html: `<h1>${(props as { text: string }).text}</h1>`, css: '' }),
      }),
    })
    const site = makeSite({
      files: [
        {
          id: 'evil',
          path: 'styles/evil.css',
          type: 'style',
          content: 'h1{color:red}</style><script>alert(document.cookie)</script>',
        },
      ],
    })
    const page = makePage({ root: { moduleId: 'base.text', props: { text: 'Hi' } } })
    const { html } = publishPage(page, site, registry)

    // The breakout sequence must not survive verbatim — it would close the
    // <style> element and run the script.
    expect(html).not.toContain('</style><script>')
    // The CSS itself is still present (neutralised, not dropped).
    expect(html).toContain('h1{color:red}')
  })
})

describe('inline CSS emission — safe inline SVG data URI', () => {
  test('preserves an inline SVG style value in the published style block', () => {
    const inlineSvgValue =
      'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<path d="M2 8h12" stroke="%23000000"/></svg>\')'
    const page = makePage({
      root: { moduleId: 'base.text', props: { text: 'Hi' }, classIds: ['inline-svg'] },
    })
    const site = makeSite({
      pages: [page],
      styleRules: {
        'inline-svg': {
          id: 'inline-svg',
          name: 'inline-svg',
          kind: 'class',
          selector: '.inline-svg',
          order: 0,
          styles: { backgroundImage: inlineSvgValue },
          contextStyles: {},
          createdAt: 0,
          updatedAt: 0,
        },
      },
    })
    const registry = makeRegistry({
      'base.text': makeModule('base.text', {
        render: (props) => ({ html: `<h1>${(props as { text: string }).text}</h1>`, css: '' }),
      }),
    })

    const { html } = publishPage(page, site, registry)
    const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]

    expect(styleBlock).toContain(`background-image: ${inlineSvgValue};`)
  })
})
