import React, { useEffect, useState } from 'react'
import { Button, Empty, Modal } from '@douyinfe/semi-ui'
import api from '../api.js'

export default function Cats({ onToast }) {
  const [data, setData] = useState(null)
  const [preview, setPreview] = useState(null)

  async function scan() {
    const c = await api.cats()
    setData(c)
    onToast(`扫描完成：可用 ${c.total} 张，无效 ${c.skipped_invalid}，重复 ${c.skipped_duplicate}`)
  }

  useEffect(() => { scan().catch() }, [])

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">猫咪图资源池</h3>
        <div className="action-row">
          <Button type="primary" theme="solid" onClick={scan}>🔍 扫描猫咪图目录</Button>
          <span className="inline-hint">自动扫描 input/cat_images，MD5 去重，支持 JPG/PNG</span>
        </div>
        {data && (
          <div className="stat-cards" style={{ marginTop: 18 }}>
            <div className="stat-card"><div className="stat-card-label">可用素材</div><div className="stat-card-value brand">{data.total}</div></div>
            <div className="stat-card"><div className="stat-card-label">无效文件</div><div className="stat-card-value">{data.skipped_invalid}</div></div>
            <div className="stat-card"><div className="stat-card-label">重复MD5</div><div className="stat-card-value">{data.skipped_duplicate}</div></div>
            <div className="stat-card"><div className="stat-card-label">识别格式</div><div className="stat-card-value" style={{ fontSize: 16 }}>JPG / PNG</div></div>
          </div>
        )}
      </div>

      <div className="page-card">
        <h3 className="card-title">素材预览</h3>
        {!data?.resources?.length ? (
          <Empty description="暂无猫咪图，请放入 input/cat_images 目录" />
        ) : (
          <div className="image-grid">
            {data.resources.map(r => (
              <div className="image-card" key={r.md5} onClick={() => setPreview(r)}>
                <div className="image-thumb">
                  <img src={api.imageUrl('cat', r.name)} alt={r.name} />
                </div>
                <div className="image-meta">
                  <b>{r.name}</b><br />
                  MD5: {r.md5.slice(0, 14)}…
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <Modal
          title={preview.name}
          visible={!!preview}
          onCancel={() => setPreview(null)}
          footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
          size="large"
        >
          <img src={api.imageUrl('cat', preview.name)} style={{ width: '100%', borderRadius: 8 }} />
        </Modal>
      )}
    </div>
  )
}
