export const TRUSTED_IFRAME_ALLOW_TOKENS = [
  'autoplay',
  'encrypted-media',
  'fullscreen',
  'picture-in-picture',
  'clipboard-write',
] as const

const trustedIframeAllowTokens = new Set<string>(TRUSTED_IFRAME_ALLOW_TOKENS)

export function sanitizeTrustedIframeAllow(value: string): string {
  return value
    .split(';')
    .map((token) => token.trim())
    .filter((token) => trustedIframeAllowTokens.has(token))
    .join('; ')
}

const TRUSTED_IFRAME_REFERRER_POLICIES = [
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
] as const

export function sanitizeTrustedIframeReferrerPolicy(
  value: string,
): (typeof TRUSTED_IFRAME_REFERRER_POLICIES)[number] | undefined {
  return TRUSTED_IFRAME_REFERRER_POLICIES.find((policy) => policy === value)
}
