import { trustedVideoEmbed } from '@core/media/trustedVideoEmbed'

/** Keep this predicate shared by stripping and mapping so their decisions cannot drift. */
export function isTrustedVideoIframeSrc(src: string): boolean {
  let isYoutube = false
  if (src) {
    try {
      const host = new URL(src).hostname.toLowerCase().replace(/^www\./, '')
      isYoutube = host === 'youtube.com'
        || host === 'm.youtube.com'
        || host === 'youtube-nocookie.com'
        || host === 'youtu.be'
    } catch {
      // Malformed URLs are not trusted video sources.
    }
  }

  return isYoutube || trustedVideoEmbed(src) !== null
}
