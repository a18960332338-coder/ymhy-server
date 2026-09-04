import { forwardRef, useCallback } from 'react'
import { TextArea, Label, Description, FieldError } from '@heroui/react'

/**
 * HeroTextArea — HeroUI v3 TextArea（react-aria 薄包装）封装
 * ⚠️ HeroUI v3 的 Input/TextArea 是原生元素薄包装：
 *   - 受控写法是 value + onChange（原生 ChangeEvent），不是 onValueChange
 *   - 样式直接写在 className 上（没有 inputWrapper/input slot）
 *   - autoResize/minRows/maxRows 不是有效 prop（react-aria 无此支持），
 *     本组件内部用 onInput 手动实现 auto-grow
 * 用法：
 *   <HeroTextArea value={val} onChange={(v) => setVal(v)} label="商品描述" minRows={3} autoResize />
 */
export const HeroTextArea = forwardRef(function HeroTextArea(
  {
    value,
    onChange,
    label,
    placeholder,
    description,
    error,
    rows,
    minRows,
    maxRows,
    isDisabled = false,
    isReadOnly = false,
    className = '',
    style,
    onKeyDown,
    onInput,
    autoResize = false,
    bare = false,
    inputClassName,
    ...rest
  },
  ref
) {
  const finalRows = rows ?? (minRows != null ? minRows : undefined)

  const handleInput = useCallback(
    (e) => {
      if (autoResize) {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 168) + 'px'
      }
      if (onInput) onInput(e)
    },
    [autoResize, onInput]
  )

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} style={style}>
      {label && <Label className="text-xs text-(--muted-foreground)">{label}</Label>}
      <TextArea
        ref={ref}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        rows={finalRows}
        disabled={isDisabled}
        readOnly={isReadOnly}
        onKeyDown={onKeyDown}
        onInput={handleInput}
        className={[
          'w-full resize-none rounded-(--radius-lg) px-3 py-2 outline-none transition-colors box-border',
          bare
            ? 'bg-transparent border-0 text-[14px] leading-relaxed'
            : 'bg-(--surface-tertiary) border border-(--border) text-[13px] leading-relaxed text-(--foreground) placeholder:text-(--muted-foreground) hover:bg-(--surface-secondary) hover:border-(--border-strong) focus-visible:border-(--accent)',
          autoResize ? 'overflow-y-auto' : '',
          inputClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {description && !error && <Description className="text-(--muted-foreground) text-[11px]">{description}</Description>}
      {error && <FieldError className="text-(--danger) text-[11px]">{error}</FieldError>}
    </div>
  )
})

export default HeroTextArea
