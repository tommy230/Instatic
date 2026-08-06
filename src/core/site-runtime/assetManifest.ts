import type {
  PublishedPageRuntimeAssets,
  PublishedRuntimeScriptAsset,
  SiteScriptPlacement,
} from './schemas'

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function isSelfHostedRuntimeAssetUrl(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  if (trimmed.includes('\\')) return false

  const pathOnly = trimmed.split(/[?#]/, 1)[0]
  return pathOnly.split('/').every((segment) => segment !== '..')
}

function runtimeScriptsForPlacement(
  runtimeAssets: PublishedPageRuntimeAssets | undefined,
  placement: SiteScriptPlacement,
): PublishedRuntimeScriptAsset[] {
  return [...(runtimeAssets?.scripts ?? [])]
    .filter((asset) => asset.placement === placement)
    .filter((asset) => isSelfHostedRuntimeAssetUrl(asset.src))
    .sort((a, b) => a.priority - b.priority || a.src.localeCompare(b.src))
}

function emittedScriptSrc(asset: PublishedRuntimeScriptAsset): string {
  const src = asset.src.trim()
  if (src.includes('#') || !asset.srcFragment?.startsWith('#')) return src
  return `${src}${asset.srcFragment}`
}

function isSafeAttributeName(name: string): boolean {
  return Boolean(name) && !Array.from(name).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 32 || code === 127 || `"'<>/=`.includes(character) || character === '`'
  })
}

function authoredScriptAttributes(asset: PublishedRuntimeScriptAsset): string {
  const seen = new Set<string>()
  const attributes: string[] = []

  for (const attribute of asset.authoredAttributes ?? []) {
    const normalizedName = attribute.name.toLowerCase()
    if (seen.has(normalizedName)) continue
    seen.add(normalizedName)
    if (!isSafeAttributeName(attribute.name)) continue
    if (
      normalizedName === 'src' ||
      normalizedName === 'type' ||
      normalizedName === 'data-instatic-runtime-script' ||
      normalizedName === 'integrity' ||
      (normalizedName === 'crossorigin' && Boolean(asset.integrity)) ||
      normalizedName.startsWith('on')
    ) continue

    const name = escapeAttribute(attribute.name)
    attributes.push(attribute.value === undefined
      ? ` ${name}`
      : ` ${name}="${escapeAttribute(attribute.value)}"`)
  }

  return attributes.join('')
}

export function hasPublishedRuntimeScripts(runtimeAssets: PublishedPageRuntimeAssets | undefined): boolean {
  return (runtimeAssets?.scripts ?? []).some((asset) => isSelfHostedRuntimeAssetUrl(asset.src))
}

export function scriptTagsForRuntimeAssets(
  runtimeAssets: PublishedPageRuntimeAssets | undefined,
  placement: SiteScriptPlacement,
): string {
  return runtimeScriptsForPlacement(runtimeAssets, placement)
    .map((asset) => {
      const integrity = asset.integrity
        ? ` integrity="${escapeAttribute(asset.integrity)}" crossorigin="anonymous"`
        : ''
      const type = asset.format === 'classic' ? '' : ' type="module"'
      const authored = authoredScriptAttributes(asset)
      return `  <script${type} src="${escapeAttribute(emittedScriptSrc(asset))}" data-instatic-runtime-script="${escapeAttribute(asset.fileId)}"${integrity}${authored}></script>`
    })
    .join('\n')
}
