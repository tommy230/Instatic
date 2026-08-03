export type TrustedVideoEmbedProvider = 'vimeo' | 'cloudflare-stream'

export interface TrustedVideoEmbed {
  provider: TrustedVideoEmbedProvider
  /** Parsed, normalized URL, including provider query parameters and fragment. */
  src: string
  /** Exact parent-page CSP origins needed to frame this player. */
  frameOrigins: string[]
}

/**
 * Recognise provider-owned video-player URLs that are safe to emit as iframes.
 *
 * This is intentionally an allowlist of player hosts and path shapes. Public
 * video pages, lookalike subdomains, maps, forms, and arbitrary iframes do not
 * qualify. Credentials, explicit non-default ports, and non-HTTPS URLs are
 * rejected before provider matching.
 */
export function trustedVideoEmbed(raw: string): TrustedVideoEmbed | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
  ) {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(url.pathname)) {
    return {
      provider: 'vimeo',
      src: url.href,
      frameOrigins: ['https://player.vimeo.com'],
    }
  }

  if (hostname === 'iframe.videodelivery.net' && /^\/[a-z0-9_-]+\/?$/i.test(url.pathname)) {
    return {
      provider: 'cloudflare-stream',
      src: url.href,
      frameOrigins: ['https://iframe.videodelivery.net'],
    }
  }

  if (
    /^customer-[a-z0-9]+\.cloudflarestream\.com$/i.test(hostname)
    && /^\/[a-z0-9_-]+\/iframe\/?$/i.test(url.pathname)
  ) {
    return {
      provider: 'cloudflare-stream',
      src: url.href,
      frameOrigins: [url.origin],
    }
  }

  return null
}
