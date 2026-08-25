import { Type, type Static } from '@core/utils/typeboxHelpers'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'

export const ImagePropsSchema = Type.Object({
  src: Type.String({ default: '' }),
  loading: Type.Union([Type.Literal('lazy'), Type.Literal('eager')], { default: 'lazy' }),
  fetchPriority: Type.Union(
    [Type.Literal('auto'), Type.Literal('high'), Type.Literal('low')],
    { default: 'auto' },
  ),
  decoding: Type.Union(
    [Type.Literal('async'), Type.Literal('sync'), Type.Literal('auto')],
    { default: 'async' },
  ),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
  // Set by the HTML import and by nothing else (no editor control). Marks a
  // node whose <img> markup was authored by a source page, so the renderer
  // emits only the attributes that page declared instead of fabricating
  // srcset/sizes/width/height/loading/decoding from the library asset — the
  // source site's CSS was written against the markup it shipped.
  sourceAuthored: Type.Optional(Type.Boolean()),
})

export type ImageStoredProps = Static<typeof ImagePropsSchema>
