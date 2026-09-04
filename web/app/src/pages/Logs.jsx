import React, { useEffect, useState } from 'react'
import { Button, Tag, Tabs, Empty } from '@douyinfe/semi-ui'
import api from '../api.js'

export default function Logs({ onToast }) {
  const [list, setList] = useState([])
  const [active, setActive] = useState(null)
  const [detail, setDetail] = useState(null)

  async function load() {
    const lg = (await api.logs()).reverse()
    setList(lg)
    if (lg.length) {
      setActive(lg[0])
      show(lg[0])
    }
  }

  async function show(name) {
    try {
      setDetail(await api.logDetail(name))
    } catch (e) {
      onToast('加载日志失败: ' + e.message, 'error')
    }
  }

  useEffect(() => { load().catch() }, [])

  const tabList = list.length
    ? list.map(n => ({ tab: n, itemKey: n }))
    : []

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">任务日志</h3>
        <div className="action-row">
          <Button type="primary" theme="solid" onClick={load}>🔄 刷新日志列表</Button>
          <span className="inline-hint">共 {list.length} 个历史批次</span>
        </div>
      </div>

      {!list.length ? (
        <div className="page-card" style={{ textAlign: 'center', padding: 60 }}>
          <Empty description="暂无历史任务日志" />
        </div>
      ) : (
        <div className="page-card">
          <Tabs
            type="line"
            activeKey={active}
            onTabClick={k => { setActive(k); show(k) }}
            tabList={tabList}
          >
            {list.map(n => (
              <Tabs.TabPane key={n} itemKey={n}>
                {detail && detail.batch_id === n ? (
                  <LogDetailView data={detail} />
                ) : (
                  <div style={{ textAlign: 'center', padding: 20 }}>加载中...</div>
                )}
              </Tabs.TabPane>
            ))}
          </Tabs>
        </div>
      )}
    </div>
  )
}

function LogDetailView({ data }) {
  const rate = parseFloat(data.success_rate || '0')
  return (
    <div style={{ padding: '14px 4px' }}>
      <div className="stat-cards" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card"><div className="stat-card-label">批次号</div><div className="stat-card-value" style={{ fontSize: 16 }}>{data.batch_id}</div></div>
        <div className="stat-card"><div className="stat-card-label">任务总数</div><div className="stat-card-value">{data.total}</div></div>
        <div className="stat-card"><div className="stat-card-label">成功</div><div className="stat-card-value brand">{data.success || 0}</div></div>
        <div className="stat-card"><div className="stat-card-label">失败/待生成</div><div className={`stat-card-value ${data.fail ? 'bad' : 'warn'}`}>{(data.fail || 0) + (data.pending || 0)}</div></div>
        <div className="stat-card"><div className="stat-card-label">成功率</div><div className={`stat-card-value ${rate >= 100 ? 'brand' : 'warn'}`}>{data.success_rate}</div></div>
      </div>

      <div className="log-table-wrap">
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f5f6f8', position: 'sticky', top: 0 }}>
            <tr>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>#</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>主图</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>猫咪图</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>状态</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>用时</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>尝试</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map(it => (
              <tr key={it.index} style={{ borderTop: '1px solid #f0f0f3' }}>
                <td style={{ padding: '8px 14px', color: '#8b8fa3' }}>{it.index}</td>
                <td style={{ padding: '8px 14px' }}>{it.main_image.split('/').pop()}</td>
                <td style={{ padding: '8px 14px' }}>{it.cat_image.split('/').pop()}</td>
                <td style={{ padding: '8px 14px' }}>
                  <Tag color={it.status === 'success' ? 'green' : it.status.startsWith('pending') ? 'amber' : 'red'}>
                    {it.status}
                  </Tag>
                </td>
                <td style={{ padding: '8px 14px' }}>{Number(it.elapsed || 0).toFixed(2)}s</td>
                <td style={{ padding: '8px 14px' }}>{it.attempts || 0}</td>
                <td style={{ padding: '8px 14px', color: '#6b7280' }}>{it.reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18 }}>
        <h4 style={{ fontSize: 13, color: '#1f2330', margin: '0 0 8px' }}>📄 原始 JSON</h4>
        <pre
          style={{
            background: '#f7f7f9',
            padding: 14,
            borderRadius: 8,
            maxHeight: 320,
            overflow: 'auto',
            fontSize: 12,
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  )
}
