import type { BaseNode, SiteDocument, StyleRule } from '@core/page-tree'
import type { RenderResolvedMedia } from './renderConfig'

export interface ResponsiveCssOptions {
  mediaAssets?: ReadonlyMap<string, RenderResolvedMedia>
}

const LOCAL_UPLOAD_PREFIX = '/uploads/'
const BACKGROUND_IMAGE_SET_REFERENCE_WIDTH = 1024
const CSS_URL_RE = /url\(\s*(?:(["'])(.*?)\1|([^"')\s][^)]*?))\s*\)/gi
const IMAGE_SET_RE = /\bimage-set\s*\(/i

interface ResponsiveBackgroundImage {
  fallback: string
  imageSet: string | null
}

function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`
}

function formatResolution(width: number, referenceWidth: number): string {
  return `${parseFloat((width / referenceWidth).toFixed(2))}x`
}

function sortedVariants(media: RenderResolvedMedia): RenderResolvedMedia['variants'] {
  return media.variants.slice().sort((a, b) => a.width - b.width)
}

function largestVariantUrl(media: RenderResolvedMedia): string | null {
  const variants = sortedVariants(media)
  return variants.length > 0 ? variants[variants.length - 1].path : null
}

function buildImageSet(media: RenderResolvedMedia): string | null {
  const variants = sortedVariants(media)
  if (variants.length === 0) return null

  // An image-set resolution descriptor sets the image's density, and density
  // sets its intrinsic CSS size (pixelWidth / density). A background drawn at
  // `background-size: auto` therefore renders the picked variant at
  // pixelWidth / descriptor CSS pixels wide - so descriptors must be relative
  // to the ORIGINAL image's intrinsic width, or the drawn size changes.
  // Normalising to a fixed 1024 made salt4life's 389px notched-card shape
  // (Vector1.png, background-size auto) draw 1024px wide and swallow half the
  // card. The fixed reference remains only as the fallback for assets whose
  // intrinsic width was never recorded.
  const referenceWidth =
    media.width && media.width > 0 ? media.width : BACKGROUND_IMAGE_SET_REFERENCE_WIDTH
  const seenDescriptors = new Set<string>()
  const options: string[] = []
  for (const variant of variants) {
    const descriptor = formatResolution(variant.width, referenceWidth)
    if (descriptor === '0x' || seenDescriptors.has(descriptor)) continue
    seenDescriptors.add(descriptor)
    options.push(`${cssUrl(variant.path)} ${descriptor}`)
  }

  return options.length > 0 ? `image-set(${options.join(', ')})` : null
}

function rewriteCssUrls(
  value: string,
  replacementFor: (path: string) => string | null,
): { value: string; replaced: boolean } {
  let replaced = false
  CSS_URL_RE.lastIndex = 0
  const next = value.replace(CSS_URL_RE, (full, _quote: string, quoted: string, bare: string) => {
    const path = (quoted ?? bare ?? '').trim()
    const replacement = replacementFor(path)
    if (!replacement) return full
    replaced = true
    return replacement
  })
  return { value: next, replaced }
}

export function collectBackgroundImagePaths(value: unknown): string[] {
  if (typeof value !== 'string' || IMAGE_SET_RE.test(value)) return []
  const paths: string[] = []
  CSS_URL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CSS_URL_RE.exec(value)) !== null) {
    const path = (match[2] ?? match[3] ?? '').trim()
    if (path.startsWith(LOCAL_UPLOAD_PREFIX)) paths.push(path)
  }
  return paths
}

export function collectBackgroundImagePathsFromStyleBag(
  bag: Record<string, unknown> | undefined,
  paths: Set<string>,
): void {
  if (!bag) return
  for (const path of collectBackgroundImagePaths(bag.backgroundImage)) {
    paths.add(path)
  }
}

function collectBackgroundImagePathsFromStyleRule(rule: StyleRule, paths: Set<string>): void {
  collectBackgroundImagePathsFromStyleBag(rule.styles, paths)
  for (const bag of Object.values(rule.contextStyles ?? {})) {
    collectBackgroundImagePathsFromStyleBag(bag, paths)
  }
}

export function collectSiteStyleBackgroundImagePaths(site: Pick<SiteDocument, 'styleRules'>): Set<string> {
  const paths = new Set<string>()
  for (const rule of Object.values(site.styleRules ?? {})) {
    collectBackgroundImagePathsFromStyleRule(rule, paths)
  }
  return paths
}

export function collectNodeBackgroundImagePaths(node: Pick<BaseNode, 'inlineStyles'>, paths: Set<string>): void {
  collectBackgroundImagePathsFromStyleBag(node.inlineStyles, paths)
}

export function responsiveBackgroundImage(
  value: string,
  mediaAssets: ReadonlyMap<string, RenderResolvedMedia> | undefined,
): ResponsiveBackgroundImage {
  if (!mediaAssets || mediaAssets.size === 0 || IMAGE_SET_RE.test(value)) {
    return { fallback: value, imageSet: null }
  }

  const fallback = rewriteCssUrls(value, (path) => {
    const media = mediaAssets.get(path)
    const replacement = media ? largestVariantUrl(media) : null
    return replacement ? cssUrl(replacement) : null
  })
  if (!fallback.replaced) return { fallback: value, imageSet: null }

  const imageSet = rewriteCssUrls(value, (path) => {
    const media = mediaAssets.get(path)
    return media ? buildImageSet(media) : null
  })

  return {
    fallback: fallback.value,
    imageSet: imageSet.replaced ? imageSet.value : null,
  }
}
