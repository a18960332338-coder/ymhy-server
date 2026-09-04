import React, { useState } from 'react'
import { Button, TextArea, Banner, Collapse } from '@douyinfe/semi-ui'
import api from '../api.js'

export default function Crawl({ onToast }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function run() {
    const urls = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    if (!urls.length) return onToast('请至少输入一个 1688 商品链接', 'warning')
    setLoading(true)
    setResult(null)
    try {
      const r = await api.crawl(urls)
      setResult(r)
      const ok = Object.values(r).filter(x => x.status === 'success').length
      onToast(`爬取完成：成功 ${ok} / 共 ${urls.length}`)
    } catch (e) {
      onToast('爬取失败: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const sample = [
    'https://detail.1688.com/offer/xxxxxxxx1.html',
    'https://detail.1688.com/offer/xxxxxxxx2.html',
  ].join('\n')

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">1688 主图批量爬取</h3>
        <Banner
          type="info"
          title="前置条件"
          description="需在 config.yaml 中启用 alibaba.enabled 并填入 App Key / Secret / Access Token；未填凭证时仅走占位联调逻辑。"
          style={{ marginBottom: 16 }}
          closeIcon={null}
        />
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>商品链接（每行一个）：</div>
        <TextArea
          placeholder={`示例：\n${sample}`}
          value={text}
          onChange={setText}
          rows={7}
          style={{ fontSize: 12, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}
        />
        <div className="action-row">
          <Button type="primary" theme="solid" loading={loading} onClick={run}>
            开始爬取
          </Button>
          <Button onClick={() => setText(sample)}>填入示例链接</Button>
          <span className="inline-hint">将自动提取商品首图 + 前4张副图，默认过滤非白底图</span>
        </div>
      </div>

      {result && (
        <div className="page-card">
          <h3 className="card-title">爬取结果</h3>
          <Collapse defaultActiveKey={['raw']}>
            <Collapse.Panel header="原始 JSON" itemKey="raw">
              <pre style={{
                background: '#f7f7f9',
                padding: 14,
                borderRadius: 8,
                maxHeight: 400,
                overflow: 'auto',
                fontSize: 12,
                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
              }}>{JSON.stringify(result, null, 2)}</pre>
            </Collapse.Panel>
          </Collapse>
        </div>
      )}
    </div>
  )
}
