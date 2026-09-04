import React, { useState } from 'react'
import { Button, Form, Select, Spin, Tag, Progress } from '@douyinfe/semi-ui'
import api from '../api.js'

const TEMPLATES = [
  { value: 0, label: '温馨家居风' },
  { value: 1, label: '治愈系猫咪' },
  { value: 2, label: '清新日系' },
  { value: 3, label: '慵懒午后' },
]

export default function BatchPage({ onToast }) {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [values, setValues] = useState({ template: 0 })

  async function run(form) {
    setLoading(true)
    setReport(null)
    try {
      const r = await api.batch({
        template: Number(form.template) || 0,
        subject: form.subject?.trim() || null,
      })
      setReport(r)
      // 消耗了积分 → 立即刷新顶部积分显示
      window.dispatchEvent(new Event('app:refresh-credits'))
      const rate = parseFloat(r.success_rate || '0')
      if (rate >= 100 && r.success > 0) onToast(`批量任务完成，成功率 100%`)
      else if (r.pending > 0) onToast(`${r.pending} 个任务已入队 Seedream`, 'warning')
      else onToast(`成功率 ${r.success_rate}`, rate > 50 ? 'success' : 'warning')
    } catch (e) {
      onToast('批量任务失败: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const statBadge = (s) => {
    if (s === 'success') return <Tag color="green" size="small">成功</Tag>
    if (s.startsWith('pending')) return <Tag color="amber" size="small">待Seedream生成</Tag>
    return <Tag color="red" size="small">失败</Tag>
  }

  const hasPending = report?.pending > 0
  const rate = parseFloat(report?.success_rate || '0')
  const hasFail = report?.fail > 0

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">批量任务调度</h3>
        <div style={{ maxWidth: 680 }}>
          <Form
            values={values}
            onValueChange={v => setValues({ ...values, ...v })}
            onSubmit={run}
            labelPosition="left"
            labelAlign="right"
            labelWidth={120}
          >
            <Form.Select field="template" label="关键词模板" style={{ width: '100%' }}>
              {TEMPLATES.map(t => (
                <Select.Option key={t.value} value={t.value}>{t.label}</Select.Option>
              ))}
            </Form.Select>
            <Form.Input field="subject" label="品类描述" placeholder="留空使用默认关键词" />
            <Form.Slot label=" ">
              <Button type="primary" theme="solid" htmlType="submit" loading={loading}>
                🚀 启动批量合成
              </Button>
              <span className="inline-hint" style={{ marginLeft: 12 }}>
                自动配对 output/crawled 主图 × input/cat_images 猫咪图（单次最多 20 组，失败重试 2 次）
              </span>
            </Form.Slot>
          </Form>
        </div>
      </div>

      {loading && (
        <div className="page-card" style={{ textAlign: 'center', padding: 50 }}>
          <Spin size="large" />
          <div style={{ marginTop: 14, color: '#8b8fa3' }}>批量合成中...（Seedream 引擎下会很快返回 pending 队列）</div>
        </div>
      )}

      {report && (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <div className="stat-card-label">任务总数</div>
              <div className="stat-card-value">{report.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">成功</div>
              <div className="stat-card-value brand">{report.success || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">{hasPending ? 'Seedream 待生成' : '失败'}</div>
              <div className={`stat-card-value ${hasFail ? 'bad' : hasPending ? 'warn' : 'brand'}`}>
                {hasPending ? report.pending : report.fail || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">成功率</div>
              <div className="stat-card-value brand">{report.success_rate}</div>
            </div>
          </div>

          {hasPending && (
            <div className="pending-note" style={{ marginBottom: 16 }}>
              💡 {report.pending} 个任务已写入 <code>_seedream_pending.jsonl</code> 队列。<br />
              请在此 TRAE 会话中让 Agent 读取队列并调用 <code>GenerateImage</code> 完成真实生成 → 转换PNG → 更新本批次日志成功率。
            </div>
          )}

          <div className="page-card">
            <h3 className="card-title">
              批次详情 · {report.batch_id}
              <span style={{ marginLeft: 12 }}>
                <Progress
                  percent={Math.round(rate)}
                  size="small"
                  style={{ width: 180, display: 'inline-block' }}
                  aria-label="success-rate"
                />
              </span>
            </h3>
            <div className="log-table-wrap">
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f5f6f8', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 50 }}>#</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>主图</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>猫咪图</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 110 }}>状态</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 80 }}>用时</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.items || []).map(it => (
                    <tr key={it.index} style={{ borderTop: '1px solid #f0f0f3' }}>
                      <td style={{ padding: '8px 14px', color: '#8b8fa3' }}>{it.index}</td>
                      <td style={{ padding: '8px 14px' }}>{it.main_image.split('/').pop()}</td>
                      <td style={{ padding: '8px 14px' }}>{it.cat_image.split('/').pop()}</td>
                      <td style={{ padding: '8px 14px' }}>{statBadge(it.status)}</td>
                      <td style={{ padding: '8px 14px' }}>{Number(it.elapsed || 0).toFixed(2)}s</td>
                      <td style={{ padding: '8px 14px', color: '#6b7280' }}>{it.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
