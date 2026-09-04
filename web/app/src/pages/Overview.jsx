import React, { useEffect, useState } from 'react'
import { Button, Space, Descriptions, Tag } from '@douyinfe/semi-ui'
import api from '../api.js'

export default function Overview({ onToast }) {
  const [cfg, setCfg] = useState(null)
  const [crawled, setCrawled] = useState(0)
  const [syn, setSyn] = useState(0)
  const [cats, setCats] = useState(0)
  const [logs, setLogs] = useState(0)
  const [lastLog, setLastLog] = useState(null)

  async function refresh() {
    const [c, cr, sy, ct, lg] = await Promise.all([
      api.config(),
      api.crawled(),
      api.synthesized(),
      api.cats(),
      api.logs(),
    ])
    setCfg(c)
    setCrawled(cr.images?.length || 0)
    setSyn(sy.images?.length || 0)
    setCats(ct.total || 0)
    setLogs(lg.length || 0)
    if (lg.length) {
      try {
        setLastLog(await api.logDetail(lg[lg.length - 1]))
      } catch (_) {}
    }
  }

  useEffect(() => {
    refresh().catch((e) => onToast('加载配置失败: ' + e.message, 'warning'))
  }, [])

  const lav = cfg?.lovart || cfg?.lavort || {}
  const ali = cfg?.alibaba || {}
  const sc = cfg?.scheduler || {}
  const engine = (lav.engine || 'mock').toUpperCase()

  return (
    <div>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">猫咪图素材</div>
          <div className="stat-card-value brand">{cats}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">已爬主图</div>
          <div className="stat-card-value">{crawled}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">合成产物</div>
          <div className="stat-card-value brand">{syn}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">任务批次</div>
          <div className="stat-card-value">{logs}</div>
        </div>
      </div>

      <div className="page-card">
        <h3 className="card-title">系统配置</h3>
        <Descriptions
          column={2}
          size="small"
          data={[
            { key: '合成引擎', value: <Tag color={engine === 'SEEDREAM' ? 'green' : engine === 'MOCK' ? 'grey' : 'blue'}>{engine}</Tag> },
            { key: 'Mock联调', value: lav.mock ? <Tag color="amber">开启 (占位图)</Tag> : <Tag color="green">关闭 (真实生成)</Tag> },
            { key: '图像尺寸', value: `${lav.width || 800} × ${lav.height || 800} px` },
            { key: '单次最多配对', value: `${sc.max_pairs || 20} 组` },
            { key: '失败重试次数', value: `${sc.retry_times || 2} 次` },
            { key: '1688 API', value: ali.enabled ? <Tag color="green">已启用</Tag> : <Tag color="grey">未启用(占位)</Tag> },
            { key: 'Lovart Access Key', value: lav.access_key ? `${lav.access_key.slice(0, 8)}***` : '未填' },
            { key: '超时时间', value: `${lav.timeout || 120} s` },
          ]}
        />
        <div className="action-row" style={{ marginTop: 14 }}>
          <Button type="primary" theme="solid" onClick={refresh}>刷新配置</Button>
          <Space>
            <Button onClick={() => api.crawled().then(r => onToast(`已爬主图 ${r.images.length} 张`))}>查看已爬主图</Button>
            <Button onClick={() => api.synthesized().then(r => onToast(`合成结果 ${r.images.length} 张`))}>查看合成结果</Button>
          </Space>
        </div>
      </div>

      {lastLog && (
        <div className="page-card">
          <h3 className="card-title">最近一批任务概览 · {lastLog.batch_id}</h3>
          <Descriptions
            column={4}
            size="small"
            data={[
              { key: '总数', value: <b>{lastLog.total}</b> },
              { key: '成功', value: <b style={{ color: '#2e7d32' }}>{lastLog.success || 0}</b> },
              { key: '失败', value: <b style={{ color: '#c62828' }}>{lastLog.fail || 0}</b> },
              { key: '成功率', value: <b style={{ color: '#5a7a4a' }}>{lastLog.success_rate}</b> },
            ]}
          />
          <div className="log-table-wrap" style={{ marginTop: 14 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f5f6f8' }}>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>主图</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>猫咪图</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>状态</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>用时</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>说明</th>
                </tr>
              </thead>
              <tbody>
                {(lastLog.items || []).map(it => (
                  <tr key={it.index} style={{ borderTop: '1px solid #f0f0f3' }}>
                    <td style={{ padding: '8px 12px' }}>{it.index}</td>
                    <td style={{ padding: '8px 12px' }}>{it.main_image.split('/').pop()}</td>
                    <td style={{ padding: '8px 12px' }}>{it.cat_image.split('/').pop()}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <Tag color={it.status === 'success' ? 'green' : it.status.startsWith('pending') ? 'amber' : 'red'}>{it.status}</Tag>
                    </td>
                    <td style={{ padding: '8px 12px' }}>{Number(it.elapsed || 0).toFixed(2)}s</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{it.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
