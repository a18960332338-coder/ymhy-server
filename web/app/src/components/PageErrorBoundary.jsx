import React from 'react'

/**
 * 页面级 ErrorBoundary
 * —— 包裹单个页面组件，崩溃时只影响该页面，不影响整个应用
 * —— 显示页面名 + 错误信息 + 组件堆栈，便于定位
 */
export class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[PageErrorBoundary] 页面 "${this.props.name}" 崩溃:`, error, info)
    this.setState({ info })
  }

  handleRetry = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const stack = info?.componentStack || ''
    // 提取最顶层的组件帧（通常是崩溃发生的组件）
    const topFrame = stack.split('\n').filter(Boolean).slice(0, 4).join('\n')

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 14,
          padding: 32,
          height: '100%',
          minHeight: 240,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)' }}>
            「{this.props.name}」加载失败
          </span>
        </div>

        <div
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'var(--danger-soft, rgba(254,44,85,.1))',
            border: '1px solid var(--danger)',
            borderRadius: 12,
            padding: '10px 14px',
            maxWidth: 720,
            wordBreak: 'break-word',
          }}
        >
          {error?.message || String(error) || '未知错误'}
        </div>

        {topFrame && (
          <pre
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--muted-foreground)',
              background: 'var(--surface-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '10px 14px',
              maxWidth: 720,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {topFrame}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '7px 20px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-secondary)',
              color: 'var(--foreground)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '7px 20px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            刷新页面
          </button>
        </div>
      </div>
    )
  }
}

export default PageErrorBoundary
