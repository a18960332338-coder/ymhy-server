import { Checkbox } from '@heroui/react'

/**
 * HeroCheckbox — HeroUI v3 命名空间 Checkbox 的简化封装
 *
 * 结构（官方 anatomy）：
 *   Checkbox > Checkbox.Content > (Checkbox.Control > Checkbox.Indicator) + 纯文本 label
 *   Description / FieldError 要放在 Content 的「外面」，作为兄弟节点。
 *
 * 注意：
 *   - 变更回调是 onChange(isSelected: boolean)，不是 onSelectionChange
 *   - 没有 size prop（v3 Checkbox 只有 variant: primary | secondary）
 *   - classNames 的 slot 只有 base / content / control / indicator
 *   - 无 label 时要传 ariaLabel，保证可访问性
 */
export function HeroCheckbox({
  isSelected = false,
  onChange,
  isIndeterminate = false,
  isDisabled = false,
  isInvalid = false,
  label,
  ariaLabel,
  className = '',
  ...rest
}) {
  return (
    <Checkbox
      isSelected={isSelected}
      isIndeterminate={isIndeterminate}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      onChange={onChange}
      aria-label={!label ? ariaLabel : undefined}
      className={className}
      {...rest}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {label}
      </Checkbox.Content>
    </Checkbox>
  )
}

export default HeroCheckbox
