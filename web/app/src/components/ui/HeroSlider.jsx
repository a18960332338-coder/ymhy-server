import { Slider, Label } from '@heroui/react'

/**
 * HeroSlider — HeroUI v3 Slider（react-aria 复合）封装
 * 用法：
 *   <HeroSlider
 *     value={strength}
 *     onChange={setStrength}
 *     minValue={0}
 *     maxValue={100}
 *     step={1}
 *     label="主体识别强度"
 *     valueSuffix="%"
 *   />
 *
 * 注意：v3 的 Slider 不接受 classNames 这种 slot 对象，
 * 样式必须逐个写在子组件的 className 上（slot 只有 base/fill/marks/output/thumb/track）。
 * Slider.Output 的 render prop 参数是 { orientation, isDisabled, state }。
 */
export function HeroSlider({
  value,
  onChange,
  minValue = 0,
  maxValue = 100,
  step = 1,
  label,
  valueSuffix = '',
  isDisabled = false,
  showOutput = true,
  className = '',
}) {
  return (
    <Slider
      value={value}
      onChange={onChange}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      isDisabled={isDisabled}
      className={`w-full ${className}`}
    >
      {label ? <Label className="text-xs text-(--muted-foreground)">{label}</Label> : null}
      {showOutput ? (
        <Slider.Output className="text-[12px] text-(--muted-foreground)">
          {({ state }) => `${state.values[0]}${valueSuffix}`}
        </Slider.Output>
      ) : null}
      <Slider.Track className="h-1.5 rounded-full bg-(--surface-secondary)">
        <Slider.Fill className="bg-(--accent)" />
        <Slider.Thumb className="h-4 w-4 rounded-full bg-(--accent) border-2 border-(--accent-foreground) shadow-(--surface-shadow)" />
      </Slider.Track>
    </Slider>
  )
}

export default HeroSlider
