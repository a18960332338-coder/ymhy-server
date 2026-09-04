import { Card } from '@heroui/react'

/**
 * HeroCard — HeroUI v3 命名空间 Card 的简化封装
 * 用法：
 *   <HeroCard className="p-4">
 *     <HeroCard.Header>
 *       <HeroCard.Title>标题</HeroCard.Title>
 *     </HeroCard.Header>
 *     <HeroCard.Content>内容</HeroCard.Content>
 *   </HeroCard>
 */
export function HeroCard({ className = '', variant = 'default', children, ...rest }) {
  return (
    <Card className={`bg-(--surface-bg-2) border border-(--border) shadow-(--surface-shadow) rounded-(--radius-xl) ${className}`} variant={variant} {...rest}>
      {children}
    </Card>
  )
}

HeroCard.Header = function HeroCardHeader({ className = '', children, ...rest }) {
  return <Card.Header className={`border-b border-(--border) px-5 py-4 ${className}`} {...rest}>{children}</Card.Header>
}

HeroCard.Title = function HeroCardTitle({ className = '', children, ...rest }) {
  return <Card.Title className={`text-(--foreground) text-[15px] font-semibold ${className}`} {...rest}>{children}</Card.Title>
}

HeroCard.Description = function HeroCardDescription({ className = '', children, ...rest }) {
  return <Card.Description className={`text-(--muted-foreground) text-[12px] ${className}`} {...rest}>{children}</Card.Description>
}

HeroCard.Content = function HeroCardContent({ className = '', children, ...rest }) {
  return <Card.Content className={`p-5 ${className}`} {...rest}>{children}</Card.Content>
}

HeroCard.Footer = function HeroCardFooter({ className = '', children, ...rest }) {
  return <Card.Footer className={`border-t border-(--border) px-5 py-4 flex justify-end gap-3 ${className}`} {...rest}>{children}</Card.Footer>
}

export default HeroCard
