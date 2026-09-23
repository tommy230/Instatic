import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'
import { registry } from '@core/module-engine'
import { publishPage } from '@core/publisher'
import { VideoModule } from '@modules/base/video'
import { makePage, makeSite } from '../publisher/helpers'

describe('native videos with a deferred source', () => {
  it('preserves authored playback attributes through import and publish without a src', () => {
    const imported = importHtml('<video id="hero" autoplay muted loop playsinline></video>')
    const { html } = publishPage(makePage(imported.nodes, imported.rootIds[0]!), makeSite(), registry)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const video = doc.querySelector('video')!
    for (const name of ['autoplay', 'muted', 'loop', 'playsinline']) {
      expect(video.hasAttribute(name)).toBe(true)
    }
    expect(video.hasAttribute('src')).toBe(false)
    expect(video.hasAttribute('controls')).toBe(false)
  })

  it('preserves poster, preload, and controls while waiting for a source', () => {
    const { html } = VideoModule.render({
      ...VideoModule.defaults,
      videoUrl: '', poster: '/poster.jpg', preload: 'none', controls: true,
    }, [])
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const video = doc.querySelector('video')!
    expect(video.getAttribute('poster')).toBe('/poster.jpg')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('src')).toBe(false)
  })

  it('still removes unsafe source and poster URLs', () => {
    const { html } = VideoModule.render({
      ...VideoModule.defaults,
      videoUrl: 'javascript:alert(1)', poster: 'javascript:alert(2)', muted: true,
    }, [])
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const video = doc.querySelector('video')!
    expect(video.getAttribute('src')).toBe('#')
    expect(video.getAttribute('poster')).toBe('#')
    expect(video.hasAttribute('muted')).toBe(true)
  })
})
