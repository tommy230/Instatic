import { Type, type Static } from '@core/utils/typeboxHelpers'

export const VideoPropsSchema = Type.Object({
  videoUrl: Type.String({ default: '' }),
  poster: Type.String({ default: '' }),
  autoplay: Type.Boolean({ default: false }),
  loop: Type.Boolean({ default: false }),
  muted: Type.Boolean({ default: false }),
  controls: Type.Boolean({ default: true }),
  playsinline: Type.Boolean({ default: true }),
  preload: Type.Union(
    [Type.Literal('none'), Type.Literal('metadata'), Type.Literal('auto')],
    { default: 'metadata' },
  ),
  /** Iframe title attribute for trusted provider embeds. Improves accessibility. */
  title: Type.String({ default: '' }),
  /** Imported trusted-player dimensions. Empty means let CSS size the player. */
  embedWidth: Type.String({ default: '' }),
  embedHeight: Type.String({ default: '' }),
  /** Safe iframe capabilities retained from an allowlisted provider embed. */
  iframeAllow: Type.String({ default: '' }),
  iframeReferrerPolicy: Type.String({ default: '' }),
  allowFullscreen: Type.Boolean({ default: true }),
  /** When true, appends rel=0 to the YouTube embed URL to suppress related videos. */
  noRelatedVideos: Type.Boolean({ default: false }),
})

export type VideoStoredProps = Static<typeof VideoPropsSchema>
