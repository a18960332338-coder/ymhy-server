import React, { useState, useEffect } from 'react'
import {
  Button,
  Form,
  Select,
  Input,
  Card,
  Tag,
  Modal,
  Empty,
  RadioGroup,
  Radio,
} from '@douyinfe/semi-ui'
import api from '../api.js'

const TEMPLATES = [
  { value: 0, label: '温馨家居风', desc: '暖光卧室 · 自然系 · 适合四件套主图' },
  { value: 1, label: '治愈系猫咪', desc: '柔焦柔光 · 猫咪C位 · 情绪价值拉满' },
  { value: 2, label: '清新日系', desc: '原木MUJI风 · 极简构图' },
  { value: 3, label: '慵懒午后', desc: '午后光影 · 窗帘光斑 · 闲适氛围' },
]

export default function Synthesize({ onToast }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [mainList, setMainList] = useState([])
  const [catList, setCatList] = useState([])
  const [preview, setPreview] = useState(null)
  const [values, setValues] = useState({ template: 0 })

  useEffect(() => {
    Promise.all([
      api.crawled().then(r => setMainList(r.images || [])),
      api.cats().then(r => setCatList((r.resources || []).map(x => x.name))),
    ]).catch()
  }, [])

  async function run(form) {
    if (!form.main_image || !form.cat_image) {
      return onToast('请选择主图和猫咪图', 'warning')
    }
    setLoading(true)
    setResult(null)
    try {
      const r = await api.synthesize({
        main_image: form.main_image.startsWith('/') ? form.main_image : `output/crawled/${form.main_image}`,
        cat_image: form.cat_image.startsWith('/') ? form.cat_image : `input/cat_images/${form.cat_image}`,
        template: Number(form.template) || 0,
        subject: form.subject?.trim() || null,
      })
      setResult(r)
      // 消耗了积分 → 立即刷新顶部积分显示
      window.dispatchEvent(new Event('app:refresh-credits'))
      if (r.status === 'pending_seedream') {
        onToast('已入队 Seedream，请在 Agent 会话中完成真实生成', 'warning')
      } else {
        onToast('合成成功')
      }
    } catch (e) {
      onToast('合成失败: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">单组 AI 合成</h3>
        <div style={{ maxWidth: 680 }}>
          <Form
            values={values}
            onValueChange={v => setValues({ ...values, ...v })}
            onSubmit={run}
            labelPosition="left"
            labelAlign="right"
            labelWidth={120}
          >
            <Form.Select
              field="main_image"
              label="家纺主图"
              placeholder="选择已爬取的主图，或手动输入绝对路径"
              style={{ width: '100%' }}
              filter
              allowCreate
            >
              {mainList.length === 0 ? (
                <Select.Option value="" disabled>output/crawled 下暂无图片</Select.Option>
              ) : (
                mainList.map(n => (
                  <Select.Option key={n} value={`output/crawled/${n}`}>{n}</Select.Option>
                ))
              )}
            </Form.Select>

            <Form.Select
              field="cat_image"
              label="猫咪图"
              placeholder="选择猫咪图，或手动输入绝对路径"
              style={{ width: '100%' }}
              filter
              allowCreate
            >
              {catList.length === 0 ? (
                <Select.Option value="" disabled>input/cat_images 下暂无图片</Select.Option>
              ) : (
                catList.map(n => (
                  <Select.Option key={n} value={`input/cat_images/${n}`}>{n}</Select.Option>
                ))
              )}
            </Form.Select>

            <Form.Select
              field="template"
              label="关键词模板"
              style={{ width: '100%' }}
            >
              {TEMPLATES.map(t => (
                <Select.Option key={t.value} value={t.value}>{t.label} — {t.desc}</Select.Option>
              ))}
            </Form.Select>

            <Form.Input
              field="subject"
              label="品类描述"
              placeholder="留空用默认：no-stick hair four-piece bedding set"
            />

            <Form.Slot label=" ">
              <Button type="primary" theme="solid" htmlType="submit" loading={loading}>
                🎨 开始合成
              </Button>
            </Form.Slot>
          </Form>
        </div>
      </div>

      {result && (
        <div className="page-card">
          <h3 className="card-title">合成结果</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Tag color={result.status === 'success' ? 'green' : 'amber'}>
              {result.status === 'success' ? '合成成功' : 'Seedream已入队(待生成)'}
            </Tag>
            <Tag color="violet">引擎: {result.engine}</Tag>
            {result.mock && <Tag color="grey">MOCK模式</Tag>}
          </div>
          {result.status === 'pending_seedream' && (
            <div className="pending-note">
              💡 任务已写入 pending 队列，请在此 TRAE 会话中让 Agent 调用 GenerateImage 工具完成真实生成。<br />
              Agent 会自动读取队列 → 调用 Seedream → 转换 PNG → 更新日志成功率。
            </div>
          )}
          {result.name && (
            <Card
              style={{ maxWidth: 420 }}
              bodyStyle={{ padding: 0 }}
              cover={
                <img
                  alt="合成结果预览"
                  src={api.imageUrl('synthesized', result.name)}
                  style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', cursor: 'zoom-in' }}
                  onClick={() => setPreview(result.name)}
                />
              }
            >
              <Card.Meta
                title="输出文件"
                description={<span style={{ fontSize: 12, wordBreak: 'break-all' }}>{result.output}</span>}
              />
            </Card>
          )}
        </div>
      )}

      {preview && (
        <Modal
          title="大图预览"
          visible={!!preview}
          onCancel={() => setPreview(null)}
          footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
          size="large"
        >
          <img src={api.imageUrl('synthesized', preview)} style={{ width: '100%', borderRadius: 8 }} />
        </Modal>
      )}
    </div>
  )
}
