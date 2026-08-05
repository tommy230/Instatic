import { Type, type Static } from '@core/utils/typeboxHelpers'
import { AnchorTargetSchema } from '@modules/base/shared/anchorTarget'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'

export const ButtonPropsSchema = Type.Object({
  label: Type.String({ default: 'Get Started' }),
  /**
   * Optional inline-SVG icon rendered before the label. Real sites put a 14x14
   * `<svg stroke="currentColor">` inside the `<button>`; base.button is a leaf
   * module, so without this prop the importer had nowhere to put that child and
   * dropped it. Sanitised by the `type: 'svg'` control at the publisher
   * boundary (`escapeProps` → `sanitizeSvg`).
   */
  icon: Type.String({ default: '' }),
  href: Type.String({ default: '' }),
  target: AnchorTargetSchema,
  disabled: Type.Boolean({ default: false }),
  /**
   * `reset` is a real native affordance a form can carry, and it is the only
   * one a button can express without script. Submit lives in `base.submit`,
   * so this stays a two-value choice. Ignored when `href` makes an anchor.
   */
  buttonType: Type.Union([Type.Literal('button'), Type.Literal('reset')], { default: 'button' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})

export type ButtonStoredProps = Static<typeof ButtonPropsSchema>
