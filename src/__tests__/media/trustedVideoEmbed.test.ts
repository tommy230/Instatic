import { describe, expect, it } from 'bun:test'
import { trustedVideoEmbed } from '@core/media/trustedVideoEmbed'

describe('trustedVideoEmbed', () => {
  it('accepts a Vimeo player URL and normalizes its source', () => {
    expect(trustedVideoEmbed('https://player.vimeo.com/video/123456789')).toEqual({
      provider: 'vimeo',
      src: 'https://player.vimeo.com/video/123456789',
      frameOrigins: ['https://player.vimeo.com'],
    })
  })

  it('accepts an iframe.videodelivery.net Stream URL', () => {
    expect(trustedVideoEmbed('https://iframe.videodelivery.net/video_id-1')).toEqual({
      provider: 'cloudflare-stream',
      src: 'https://iframe.videodelivery.net/video_id-1',
      frameOrigins: ['https://iframe.videodelivery.net'],
    })
  })

  it('accepts a customer subdomain Stream URL', () => {
    expect(
      trustedVideoEmbed('https://customer-account1.cloudflarestream.com/video_id-1/iframe'),
    ).toEqual({
      provider: 'cloudflare-stream',
      src: 'https://customer-account1.cloudflarestream.com/video_id-1/iframe',
      frameOrigins: ['https://customer-account1.cloudflarestream.com'],
    })
  })

  it('rejects lookalike hostnames', () => {
    for (const url of [
      'https://player.vimeo.com.evil.com/video/1',
      'https://evil.com/player.vimeo.com/video/1',
      'https://notplayer.vimeo.com/video/1',
    ]) {
      expect(trustedVideoEmbed(url)).toBeNull()
    }
  })

  it('rejects unsupported player path shapes', () => {
    for (const url of [
      'https://player.vimeo.com/video/abc',
      'https://player.vimeo.com/123',
      'https://iframe.videodelivery.net/',
      'https://customer-account1.cloudflarestream.com/video_id-1',
    ]) {
      expect(trustedVideoEmbed(url)).toBeNull()
    }
  })

  it('rejects invalid customer subdomains', () => {
    for (const url of [
      'https://customer-.cloudflarestream.com/video_id-1/iframe',
      'https://customer-account1.extra.cloudflarestream.com/video_id-1/iframe',
      'https://customer-account.one.cloudflarestream.com/video_id-1/iframe',
    ]) {
      expect(trustedVideoEmbed(url)).toBeNull()
    }
  })

  it('rejects credentials', () => {
    for (const url of [
      'https://user@player.vimeo.com/video/1',
      'https://user:secret@iframe.videodelivery.net/video_id-1',
    ]) {
      expect(trustedVideoEmbed(url)).toBeNull()
    }
  })

  it('rejects explicit ports', () => {
    expect(trustedVideoEmbed('https://player.vimeo.com:8443/video/1')).toBeNull()
    expect(trustedVideoEmbed('https://iframe.videodelivery.net:9443/video_id-1')).toBeNull()
  })

  it('rejects non-HTTPS URLs', () => {
    expect(trustedVideoEmbed('http://player.vimeo.com/video/1')).toBeNull()
  })

  it('accepts hostname case deliberately and normalizes it', () => {
    expect(trustedVideoEmbed('https://PLAYER.VIMEO.COM/video/1')?.src).toBe(
      'https://player.vimeo.com/video/1',
    )
  })

  it('preserves query strings and fragments in the normalized source', () => {
    const embed = trustedVideoEmbed(
      'https://PLAYER.VIMEO.COM/video/1?autoplay=0&dnt=1#preview',
    )
    expect(embed?.src).toBe('https://player.vimeo.com/video/1?autoplay=0&dnt=1#preview')
  })

  it('does not decode HTML entity text outside the importer', () => {
    const embed = trustedVideoEmbed(
      'https://player.vimeo.com/video/1?autoplay=0&amp;dnt=1',
    )
    expect(embed?.src).toBe('https://player.vimeo.com/video/1?autoplay=0&amp;dnt=1')
  })
})
