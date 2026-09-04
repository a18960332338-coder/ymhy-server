import { Input, Label, Description, FieldError } from '@heroui/react'

/**
 * HeroInput — HeroUI v3 Input（react-aria 薄包装）封装
 * ⚠️ HeroUI v3 的 Input 是原生 input 薄包装：
 *   - 受控写法是 value + onChange（原生 ChangeEvent），不是 onValueChange
 *   - 样式直接写在 className 上（没有 inputWrapper/input slot）
 * 用法：
 *   <HeroInput value={val} onChange={(v) => setVal(v)} label="商品名称" placeholder="请输入" />
 */
export function HeroInput({
  value,
  onChange,
  label,
  placeholder,
  description,
  error,
  type = 'text',
  isDisabled = false,
  isReadOnly = false,
  className = '',
  startContent,
  endContent,
  style,
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} style={style}>
      {label && <Label className="text-xs text-(--muted-foreground)">{label}</Label>}
      <div className="relative flex items-center">
        {startContent && <span className="pointer-events-none absolute left-3 z-10 text-(--muted-foreground)">{startContent}</span>}
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange && onChange(e.target.value)}
          placeholder={placeholder}
          disabled={isDisabled}
          readOnly={isReadOnly}
          className="w-full rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) px-3 py-2 text-[13px] text-(--foreground) placeholder:text-(--muted-foreground) outline-none transition-colors hover:bg-(--surface-secondary) hover:border-(--border-strong) focus-visible:border-(--accent)"
          style={{
            ...(startContent ? { paddingLeft: 32 } : null),
            ...(endContent ? { paddingRight: 32 } : null),
          }}
        />
        {endContent && <span className="absolute right-3 z-10 text-(--muted-foreground)">{endContent}</span>}
      </div>
      {description && !error && <Description className="text-(--muted-foreground) text-[11px]">{description}</Description>}
      {error && <FieldError className="text-(--danger) text-[11px]">{error}</FieldError>}
    </div>
  )
}

export default HeroInput
