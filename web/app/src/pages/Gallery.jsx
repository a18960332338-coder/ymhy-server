import React, { useEffect, useState } from 'react'
import { Button, Empty, Modal, Tooltip, Badge } from '@douyinfe/semi-ui'
import api from '../api.js'

export default function Gallery({ onToast }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const r = await api.synthesized()
      const items = (r.images || [])
        .filter(n => /\.(png|jpg|jpeg|webp)$/i.test(n))
        .sort((a, b) => b.localeCompare(a))
      setImages(items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch() }, [])

  const groups = images.reduce((acc, n) => {
    const m = n.match(/^(\d{8}_\d{6})/)
    const batch = m ? m[1] : '未分组'
    ;(acc[batch] = acc[batch] || []).push(n)
    return acc
  }, {})

  return (
    <div>
      <div className="page-card">
        <h3 className="card-title">合成结果图库</h3>
        <div className="action-row">
          <Button type="primary" theme="solid" onClick={load}>🔄 刷新</Button>
          <span className="inline-hint">共 {images.length} 张产物，按时间倒序，点击图片查看大图</span>
          <Badge count={images.length} style={{ marginLeft: 'auto' }} />
        </div>
      </div>

      {!images.length && !loading ? (
        <div className="page-card" style={{ textAlign: 'center', padding: 60 }}>
          <Empty description="暂无合成结果，请先运行单组合成或批量任务" />
        </div>
      ) : (
        Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(batch => (
          <div className="page-card" key={batch}>
            <h3 className="card-title">
              🗂️ 批次 {batch}
              <TagLike style={{ marginLeft: 10 }}>{groups[batch].length} 张</TagLike>
            </h3>
            <div className="image-grid">
              {groups[batch].map(n => (
                <Tooltip key={n} content={n} position="bottom">
                  <div className="image-card" onClick={() => setPreview(n)}>
                    <div className="image-thumb">
                      <img loading="lazy" src={api.thumbUrl('synthesized', n)} alt={n} />
                    </div>
                    <div className="image-meta">
                      <b>{n.split('_').slice(3).join('_')}</b>
                    </div>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        ))
      )}

      {preview && (
        <Modal
          title={preview}
          visible={!!preview}
          onCancel={() => setPreview(null)}
          footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
          size="large"
          width={760}
        >
          <img src={api.imageUrl('synthesized', preview)} style={{ width: '100%', borderRadius: 8 }} />
        </Modal>
      )}
    </div>
  )
}

function TagLike({ children, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 10px',
        borderRadius: 999,
        background: 'rgba(90,122,74,.1)',
        color: '#5a7a4a',
        fontSize: 11,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
