import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Toast, Tooltip } from '@douyinfe/semi-ui'
import api from '../api'
import Icon from '../components/Icon'

const BUCKET = 'cats'

function Chip({ children, color = 'grey', onClick }) {
  const map = {
    cyan: { bg: 'rgba(37,244,238,.12)', border: 'rgba(37,244,238,.4)', color: '#7cf8f4' },
    red: { bg: 'rgba(254,44,85,.12)', border: 'rgba(254,44,85,.4)', color: '#ff6485' },
    grey: { bg: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.16)', color: 'var(--muted-foreground)' },
  }
  const s = map[color] || map.grey
  return (
    <span
      onClick={onClick}
      className="tk-chip"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        background: s.bg, borderColor: s.border, color: s.color,
        padding: '2px 10px',
      }}
    >{children}</span>
  )
}

export default function CatsGallery() {
  const fileInputRef = useRef()
  const [dragOver, setDragOver] = useState(false)
  const [list, setList] = useState([])
  const [kw, setKw] = useState('')
  const [preview, setPreview] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    api.images(BUCKET).then(d => setList(d.images || [])).catch(() => setList([]))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const onDrop = async (e) => {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      const r = await api.upload(BUCKET, files)
      Toast.success(`已上传 ${r.savedCount}/${r.total}`)
      refresh()
    } catch (err) { Toast.error('上传失败: ' + err.message) }
    finally { setBusy(false) }
  }

  const pickAndUpload = async () => {
    const files = Array.from(fileInputRef.current?.files || [])
    if (!files.length) return
    fileInputRef.current.value = ''
    setBusy(true)
    try {
      const r = await api.upload(BUCKET, files)
      Toast.success(`已上传 ${r.savedCount}/${r.total}`)
      refresh()
    } catch (err) { Toast.error('上传失败: ' + err.message) }
    finally { setBusy(false) }
  }

  const deleteOne = async (name) => {
    try {
      await api.deleteImg(BUCKET, name)
      Toast.success('已删除 ' + name)
      setDeleteConfirm(null)
      refresh()
    } catch (e) { Toast.error(e.message) }
  }

  const filtered = list.filter(it => {
    if (!kw) return true
    const k = kw.toLowerCase()
    return it.name.toLowerCase().includes(k)
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {/* 顶部工具栏 */}
      <div className="tk-panel" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 240 }}>
          <Input
            value={kw}
            onChange={setKw}
            placeholder="搜索猫咪素材名称…"
            showClear
            prefix={<Icon name="search" size={14} style={{ color: 'var(--text-muted)' }} />}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tk-chip">共 {list.length} 张素材</span>
          {kw && <Chip color="cyan">匹配 {filtered.length}</Chip>}
          <Tooltip content="或拖拽图片到下方区域">
            <Button
              loading={busy}
              onClick={() => fileInputRef.current?.click()}
              type="primary" theme="solid"
            >+ 上传猫咪图片</Button>
          </Tooltip>
          <Button theme="light" onClick={refresh}>⟳ 刷新</Button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={pickAndUpload} />

      {/* Dropzone + Grid */}
      <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        <div
          className={`dropzone ${dragOver ? 'dragover' : ''}`}
          style={{ marginTop: 14 }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="dz-icon" style={{ display: 'inline-flex', color: 'var(--accent)' }}><Icon name="cat" size={28} /></div>
          <div className="dz-title">拖拽 PNG 猫咪素材到此处</div>
          <div className="dz-sub">支持透明背景 PNG · JPG · WEBP · 单张最大 20MB · 可批量</div>
        </div>

        {filtered.length === 0 ? (
          <div className="tk-empty">
            <span className="emoji">{kw ? <Icon name="search" size={20} /> : <Icon name="inbox" size={20} />}</span>
            {kw ? `没有匹配「${kw}」的素材` : '还没有猫咪素材，拖到上方上传吧～'}
          </div>
        ) : (
          <div className="library-grid" style={{ padding: '4px 14px 18px' }}>
            {filtered.map(it => (
              <div key={it.name} className="library-card" title={it.name}>
                <div className="thumb"
                  onClick={() => setPreview(it)}
                  style={{ cursor: 'zoom-in' }}>
                  <img src={api.thumbUrl(BUCKET, it.name)} alt={it.name} loading="lazy" />
                </div>
                <div className="meta">
                  <div className="name">{it.name}</div>
                  <div className="sub">
                    <span>{it.mtimeText}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <Tooltip content="预览大图">
                        <Button size="small" theme="borderless" onClick={() => setPreview(it)} style={{ display: 'inline-flex', alignItems: 'center' }}><Icon name="view" size={12} /></Button>
                      </Tooltip>
                      <Tooltip content="删除素材">
                        <Button size="small" theme="borderless" type="danger"
                          onClick={() => setDeleteConfirm(it)} style={{ display: 'inline-flex', alignItems: 'center' }}><Icon name="delete" size={12} /></Button>
                      </Tooltip>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 预览 */}
      <Modal
        title={preview?.name || ''}
        visible={!!preview}
        onOk={() => setPreview(null)}
        onCancel={() => setPreview(null)}
        okText="关闭"
        cancelProps={{ style: { display: 'none' } }}
        width={720}
      >
        {preview && (
          <>
            <img className="modal-img" src={api.imageUrl(BUCKET, preview.name)} alt={preview.name} />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12 }}>
              <span>
                <Chip style={{ marginRight: 8 }}>{(preview.size / 1024 / 1024).toFixed(2)} MB</Chip>
                {preview.mtimeText}
              </span>
              <Button type="danger" size="small" onClick={() => setDeleteConfirm(preview)}>删除此素材</Button>
            </div>
          </>
        )}
      </Modal>

      {/* 删除确认 */}
      <Modal
        title="确认删除"
        visible={!!deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onOk={() => deleteConfirm && deleteOne(deleteConfirm.name)}
        okType="danger"
        okText="删除"
      >
        <p>你将删除猫咪素材 <b>{deleteConfirm?.name}</b>，删除后无法恢复。</p>
      </Modal>
    </div>
  )
}
