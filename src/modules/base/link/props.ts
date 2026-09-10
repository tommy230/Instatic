import { Type, type Static } from '@core/utils/typeboxHelpers'
import { AnchorTargetSchema } from '@modules/base/shared/anchorTarget'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'

export const LinkPropsSchema = Type.Object({
  href: Type.Union([Type.String(), Type.Null()], { default: '#' }),
  text: Type.String({ default: 'Click here' }),
  target: Type.Union([AnchorTargetSchema, Type.Null()], { default: '_self' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})

export type LinkStoredProps = Static<typeof LinkPropsSchema>
