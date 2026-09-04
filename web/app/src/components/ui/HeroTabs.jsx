import { Tabs } from '@heroui/react'

/**
 * HeroTabs — HeroUI v3 Tabs 的简化封装
 *
 * 官方 anatomy（务必照抄这个层级）：
 *   Tabs > Tabs.ListContainer > Tabs.List > Tabs.Tab > (Tabs.Separator? + Tabs.Indicator)
 *   Tabs.Panel 放在 ListContainer 外面，作为 Tabs 的直接子节点。
 *
 * 注意：
 *   - Tabs.Indicator 要放在【每个 Tabs.Tab 内部】，不是 List 的兄弟节点
 *   - Tabs.ListContainer 是必需外层（负责溢出时的滚动箭头与渐隐边缘）
 *   - v3 没有 classNames slot 对象，也没有 fullWidth；样式只能逐个写 className
 *   - variant 只有 "primary"（填充指示器）和 "secondary"（下划线指示器）
 */
export function HeroTabs({
  value,
  onChange,
  items = [],
  variant = 'primary',
  orientation = 'horizontal',
  className = '',
  listContainerClassName = '',
  listClassName = '',
  tabClassName = '',
  indicatorClassName = '',
  panelClassName = '',
}) {
  return (
    <Tabs
      selectedKey={value != null ? String(value) : null}
      onSelectionChange={(key) => onChange && onChange(String(key))}
      variant={variant}
      orientation={orientation}
      className={className}
    >
      <Tabs.ListContainer className={listContainerClassName}>
        <Tabs.List aria-label="tabs" className={listClassName}>
          {items.map((it) => (
            <Tabs.Tab key={it.key} id={it.key} className={tabClassName}>
              {it.label}
              <Tabs.Indicator className={indicatorClassName} />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {items.map((it) => (
        <Tabs.Panel key={it.key} id={it.key} className={panelClassName}>
          {it.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  )
}

export default HeroTabs
