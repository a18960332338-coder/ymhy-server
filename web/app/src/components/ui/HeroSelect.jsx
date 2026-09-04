import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon'

/**
 * HeroSelect — 自定义下拉选择器（fixed 定位 + body portal）
 *
 * 为什么用 fixed + Portal 到 document.body：
 *   1) 父容器常有 overflow:hidden/auto（如 VBS 分镜编辑区 section overflowY:auto），
 *      absolute 下拉会被裁剪；fixed 不受祖先 overflow 影响。
 *   2) 关键陷阱：祖先元素只要带 transform/filter/perspective/will-change/contain
 *      （哪怕 transform: matrix(1,0,0,1,0,0) 这种恒等变换），就会成为 fixed 元素的
 *       containing block，使 fixed 不再相对视口、而相对该祖先。此时用
 *       getBoundingClientRect()（视口坐标）去定 left/top 必然错位（下拉被推到右/下边缘）。
 *      → 把下拉通过 createPortal 渲染到 body 直接子节点，彻底脱离任何祖先的
 *        transform/filter 上下文，fixed 重新相对视口，坐标一一对应，错位消失。
 *
 * 用法不变：
 *   <HeroSelect
 *     value={value}
 *     onChange={setValue}
 *     options={[{ value: 'a', label: '选项A' }]}
 *     placeholder="请选择"
 *     className="w-full"
 *   />
 */
export function HeroSelect({
  value,
  onChange,
  options = [],
  placeholder = '请选择',
  label,
  className = '',
  style,
  isDisabled = false,
  direction = 'down',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const [filter, setFilter] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState({})

  // 同步计算位置（作为初始值，避免 rAF 延迟期间的闪烁/错位）
  const measurePosition = () => {
    if (!buttonRef.current) return null
    const rect = buttonRef.current.getBoundingClientRect()
    // 防御：如果 rect 全为 0（元素不可见/未挂载），返回 null
    if (rect.width === 0 && rect.height === 0) return null
    // 向上展开：dropdown 在按钮上方，max-h-60 = 240px 估算高度
    if (direction === 'up') {
      return {
        top: rect.top - 240 - 4,
        left: rect.left,
        width: Math.max(rect.width, 120),
      }
    }
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 120),
    }
  }

  // 计算 fixed 定位坐标（先同步设初始值，再用 rAF 精调）
  const updatePosition = useCallback(() => {
    // 同步设置初始位置（避免 dropdown 在 rAF 前以 {top:0,left:0,width:'100%'} 闪烁到角落）
    const sync = measurePosition()
    if (sync) setDropdownStyle(sync)
    // rAF 精调：确保 React 已把 DOM 提交后再测量（处理异步布局场景）
    requestAnimationFrame(() => {
      const refined = measurePosition()
      if (refined) setDropdownStyle(refined)
    })
  }, []) // ← 不依赖 open，避免闭包过期

  // 打开时立即定位 + 滚动/缩放时重算
  useEffect(() => {
    if (open) updatePosition()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // 关闭时重置 dropdownStyle，避免下次打开时复用旧坐标
  const handleClose = useCallback(() => {
    setOpen(false)
    setFilter('')
    setDropdownStyle({})
  }, [])

  // 点击外部关闭（dropdown 是 fixed，不在 containerRef 内，需特殊处理）
  useEffect(() => {
    if (!open || isDisabled) return
    const handler = (e) => {
      const target = e.target
      // 如果点击在按钮或下拉面板内，不关闭
      if (containerRef.current && containerRef.current.contains(target)) return
      // 如果点击在下拉面板内（fixed 定位已脱离 container），不关闭
      const dropdown = document.querySelector('[data-hero-select-dropdown]')
      if (dropdown && dropdown.contains(target)) return
      handleClose()
    }
    // 用 mousedown 而非 click，确保在 blur 之前触发
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, isDisabled, handleClose])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, handleClose])

  const current = options.find(o => o.value === value)

  // 过滤选项（支持搜索）
  const filtered = filter
    ? options.filter(o => (o.label || '').toLowerCase().includes(filter.toLowerCase()))
    : options

  const handleSelect = (val) => {
    if (onChange) onChange(val)
    handleClose()
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} style={style} ref={containerRef}>
      {label && <label className="text-xs text-(--muted-foreground)">{label}</label>}
      <div className="relative">
        <button
          type="button"
          ref={buttonRef}
          disabled={isDisabled}
          onClick={() => !isDisabled && setOpen(v => !v)}
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-(--radius-lg) border bg-(--surface-tertiary) px-3 text-left text-[13px] text-(--foreground) outline-none transition-colors ${
            isDisabled
              ? 'cursor-not-allowed opacity-50 border-(--border)'
              : 'border-(--border) hover:border-(--border-strong) hover:bg-(--surface-secondary)'
          }`}
        >
          <span className={current ? '' : 'text-(--muted-foreground)'}>
            {current?.label || placeholder}
          </span>
          <Icon name="down" size={12} className={`shrink-0 text-(--muted-foreground) transition-transform ${open || direction === 'up' ? 'rotate-180' : ''}`} />
        </button>

        {open && !isDisabled && createPortal(
          <div
            data-hero-select-dropdown
            style={{
              position: 'fixed',
              top: dropdownStyle.top ?? 0,
              left: dropdownStyle.left ?? 0,
              width: dropdownStyle.width ?? '100%',
              zIndex: 99999,
            }}
            className="min-w-[120px] max-h-60 overflow-y-auto rounded-(--radius-xl) border border-(--border) bg-(--surface) p-1.5 shadow-(--surface-shadow)"
          >
            {/* 搜索框（选项 > 8 个时显示） */}
            {options.length > 8 && (
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="搜索..."
                autoFocus
                className="mb-1.5 w-full rounded-(--radius-lg) border border-(--border) bg-(--surface-bg-2) px-2.5 py-1.5 text-[12px] text-(--foreground) outline-none focus:border-(--accent)"
                onClick={e => e.stopPropagation()}
              />
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-(--muted-foreground)">无匹配项</div>
            )}
            {filtered.map((o) => {
              const id = String(o.value)
              const active = id === String(value)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelect(o.value)}
                  className={`flex w-full items-center gap-2 rounded-(--radius-lg) px-3 py-2 text-left text-[13px] outline-none transition-colors ${
                    active
                      ? 'bg-(--accent-soft) text-white font-medium'
                      : 'text-(--foreground) hover:bg-(--surface-secondary)'
                  }`}
                >
                  {active && <Icon name="check" size={14} className="shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.creditsCost != null && (
                    <span className="shrink-0 text-[11px] text-(--muted-foreground)">{o.creditsCost} 积分</span>
                  )}
                  {o.quality && (
                    <span className="shrink-0 rounded-md bg-(--surface-tertiary) px-1.5 py-0.5 text-[10px] text-(--muted-foreground)">{o.quality}</span>
                  )}
                </button>
              )
            })}
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

export default HeroSelect
