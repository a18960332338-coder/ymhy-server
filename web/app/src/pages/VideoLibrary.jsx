import React, { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'
import Toast from '../toast'
import Icon from '../components/Icon'
import { Button as HeroButton, Chip, Modal as HeroModal, Spinner } from '@heroui/react'

// 时长格式化：秒 -> m:ss 或 Ns
function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '—'
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}

// 日期格式化：时间戳(秒) -> YYYY-MM-DD（到天）
function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 品牌 code -> 中文名
const BRAND_LABELS = { cloudsleepgarden: '云眠花园', sofawithcat: '软居与猫', lyrosdream: 'Luluna月下谣', oblachny_sad: 'Облачный Сад' }

// 批量导出指定视频（打包 zip 下载）
async function exportVideosZip(names, brand) {
  try {
    const r = await api.videoExportZip({ names, zip_name: '云眠花园视频', brand })
    if (r?.blob) {
      const url = URL.createObjectURL(r.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.filename || '云眠花园_视频导出.zip'
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500)
      Toast.success(`已导出 ${names.length} 条视频`)
      return true
    }
    return false
  } catch (e) {
    Toast.error('导出失败：' + (e?.message || e))
    return false
  }
}

// ---------- 视频库（一级 tab：视频生成后统一存放在这里，按品牌桶隔离）----------
export function VideoLibrary({ brand, refreshKey }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())
  const [exporting, setExporting] = useState(false)
  const [durations, setDurations] = useState({}) // name -> 秒
  const [playing, setPlaying] = useState(null)   // 当前播放的视频对象
  const [hoveredName, setHoveredName] = useState(null) // hover 预览的视频名
  const [hoverRect, setHoverRect] = useState(null) // hover 卡片的 getBoundingClientRect 结果
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false) // 批量删除确认弹窗
  const [deleting, setDeleting] = useState(false)
  const videoRefs = useRef({}) // name -> HTMLVideoElement

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.videoGenerated({ brand })
      setVideos(Array.isArray(r?.videos) ? r.videos : [])
    } catch {
      setVideos([])
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load, refreshKey])

  // 打开视频库时先补下载同步：把已提交但未入库（页面刷新/后端重启导致漏轮询）的 ToAPIs 完成视频拉到本地
  const [syncing, setSyncing] = useState(false)
  const syncPending = useRef(false)
  const doSync = useCallback(async () => {
    if (syncPending.current) return
    syncPending.current = true
    setSyncing(true)
    try {
      const r = await api.videoToapisSync(brand)
      if (r && Array.isArray(r.downloaded) && r.downloaded.length > 0) {
        Toast.success(`已补同步 ${r.downloaded.length} 个视频到视频库`)
      }
      await load()
    } catch {
      /* 同步失败不阻塞列表展示 */
    } finally {
      syncPending.current = false
      setSyncing(false)
    }
  }, [brand, load])

  useEffect(() => { doSync() }, [doSync])

  // 生成完成（VideoBatchStudio 派发 app:videos-updated）时刷新列表
  useEffect(() => {
    const onUpdated = () => { load() }
    window.addEventListener('app:videos-updated', onUpdated)
    return () => {
      window.removeEventListener('app:videos-updated', onUpdated)
    }
  }, [load])

  const toggleSelect = (name) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })
  }
  const selectAll = () => setSelected(new Set(videos.map(v => v.name)))
  const clearSelect = () => setSelected(new Set())

  const exportSelected = async () => {
    const names = [...selected].filter(Boolean)
    if (!names.length) { Toast.warn('请先勾选要导出的视频'); return }
    setExporting(true)
    const ok = await exportVideosZip(names, brand)
    if (ok) setSelected(new Set())
    setExporting(false)
  }

  const deleteSelected = async () => {
    const names = [...selected].filter(Boolean)
    if (!names.length) { Toast.warn('请先勾选要删除的视频'); return }
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    const names = [...selected].filter(Boolean)
    if (!names.length) { setShowDeleteConfirm(false); return }
    setDeleting(true)
    try {
      const r = await api.videoDelete({ names, brand })
      const deleted = (r && r.deleted) || names
      Toast.success(`已删除 ${deleted.length} 个视频`)
      setSelected(new Set())
      setShowDeleteConfirm(false)
      load()
    } catch (e) {
      Toast.error('删除失败：' + (e?.message || e))
    } finally {
      setDeleting(false)
    }
  }

  const allSelected = videos.length > 0 && selected.size === videos.length

  return (
    <div className="tk-page">
      <div className="tk-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="video" size={18} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>视频库</span>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>（{BRAND_LABELS[brand] || brand}）</span>
          </div>
          <div style={{ flex: '1 1 auto' }} />
          <Chip size="sm" variant="secondary">共 {videos.length} 个视频</Chip>
        {videos.length > 0 && (
          <HeroButton variant="outline" size="sm" onPress={allSelected ? clearSelect : selectAll}>{allSelected ? '取消全选' : '全选'}</HeroButton>
        )}
        {selected.size > 0 && (
          <HeroButton color="primary" size="sm" onPress={exportSelected} isDisabled={exporting}><Icon name="download" size={13} /> 一键导出（{selected.size}）</HeroButton>
        )}
        {selected.size > 0 && (
          <HeroButton color="danger" size="sm" variant="outline" onPress={deleteSelected} isDisabled={deleting}><Icon name="delete" size={13} /> 删除（{selected.size}）</HeroButton>
        )}
        <HeroButton variant="outline" size="sm" onPress={load}><Icon name="refresh" size={13} /> 刷新</HeroButton>
      </div>
      <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', background: 'transparent', border: 'none' }}>
        {loading ? (
          <div className="tk-empty"><Spinner size="md"/><div style={{ marginTop: 8 }}>加载中…</div></div>
        ) : videos.length === 0 ? (
          <div className="tk-empty">
            <Icon name="video" size={22} />
            <div style={{ marginTop: 6 }}>还没有生成视频</div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 6 }}>到「生成视频」里生成后，视频会自动保存到这里</div>
          </div>
        ) : (
          <div className="library-grid" style={{ padding: '8px 12px 20px', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
            {videos.map(v => {
              const vSel = selected.has(v.name)
              return (
                <div
                  key={v.name}
                  className="library-card"
                  onClick={() => toggleSelect(v.name)}
                  onMouseEnter={(e) => {
                    setHoveredName(v.name)
                    setHoverRect(e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseLeave={() => { setHoveredName(null); setHoverRect(null) }}
                  style={{ cursor: 'pointer', borderColor: vSel ? 'var(--border-strong)' : undefined }}
                >
                  <div className="thumb" style={{ aspectRatio: '9 / 16' }}>
                    <video
                      ref={(el) => { videoRefs.current[v.name] = el }}
                      src={v.url}
                      preload="metadata"
                      muted
                      playsInline
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration
                        if (d && isFinite(d)) setDurations(prev => ({ ...prev, [v.name]: d }))
                      }}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
                    />
                    <span style={{
                      position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 6,
                      background: vSel ? 'var(--surface-bg-2)' : 'rgba(0,0,0,.55)',
                      color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 900,
                      border: '1px solid rgba(255,255,255,.3)', pointerEvents: 'none',
                    }}>{vSel ? <Icon name="check" size={13} /> : ''}</span>
                    {/* 时长角标（左下） */}
                    <span style={{
                      position: 'absolute', left: 8, bottom: 8, borderRadius: 6,
                      background: 'rgba(0,0,0,.7)', color: '#fff', padding: '2px 6px',
                      fontSize: 10, fontFamily: 'ui-monospace, monospace', pointerEvents: 'none',
                    }}>{fmtDuration(durations[v.name])}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* hover 浮层视频预览：紧贴卡片右侧，最上层无遮挡 */}
      {hoveredName && hoverRect && (() => {
        const v = videos.find(x => x.name === hoveredName)
        if (!v) return null
        const cardW = hoverRect.width
        const cardH = hoverRect.height
        const W = Math.min(Math.round(cardW * 1.3), window.innerWidth - 48)
        const H = Math.min(Math.round(W * 16 / 9), window.innerHeight - 48)
        // 默认：紧贴卡片右侧，垂直居中对齐卡片
        let left = hoverRect.right + 10
        let top = hoverRect.top + (cardH - H) / 2
        // 边界修正：右侧放不下 → 放左侧
        if (left + W > window.innerWidth - 16) left = hoverRect.left - W - 10
        // 左侧也放不下 → 贴右边缘
        if (left < 16) left = 16
        // 顶部溢出 → 对齐顶部
        if (top < 16) top = 16
        // 底部溢出 → 对齐底部
        if (top + H > window.innerHeight - 16) top = window.innerHeight - H - 16
        return (
          <div
            style={{
              position: 'fixed',
              zIndex: 99999,
              left,
              top,
              width: W,
              height: H,
              borderRadius: 12,
              border: '2px solid #fff',
              boxShadow: '0 12px 36px rgba(0,0,0,.6)',
              overflow: 'hidden',
              backgroundColor: '#000',
              pointerEvents: 'none',
            }}
          >
            <video
              src={v.url}
              autoPlay
              muted
              playsInline
              loop
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )
      })()}

      {/* 视频播放弹窗（HeroUI Modal） */}
      <HeroModal.Root isOpen={!!playing} onOpenChange={(open) => { if (!open) setPlaying(null) }}>
        <HeroModal.Backdrop />
        <HeroModal.Container>
          <HeroModal.Dialog style={{ width: 'min(920px, 92vw)', maxWidth: '92vw' }}>
            <HeroModal.Header>
              <HeroModal.Heading>{playing?.name}</HeroModal.Heading>
            </HeroModal.Header>
            <HeroModal.Body style={{ padding: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <video
                src={playing?.url}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '78vh', width: 'auto', objectFit: 'contain', display: 'block', borderRadius: 12 }}
              />
            </HeroModal.Body>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {/* 批量删除确认弹窗 */}
      <HeroModal.Root isOpen={!!showDeleteConfirm} onOpenChange={(open) => { if (!open && !deleting) setShowDeleteConfirm(false) }}>
        <HeroModal.Backdrop />
        <HeroModal.Container>
          <HeroModal.Dialog style={{ width: 'min(440px, 92vw)' }}>
            <HeroModal.Header>
              <HeroModal.Heading>删除视频</HeroModal.Heading>
            </HeroModal.Header>
            <HeroModal.Body style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--foreground)' }}>
                确定要删除选中的 <b style={{ color: 'var(--danger, #f31260)' }}>{selected.size}</b> 个视频吗？
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
                此操作不可撤销，请确认是否继续。
              </div>
            </HeroModal.Body>
            <HeroModal.Footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <HeroButton variant="outline" size="sm" onPress={() => !deleting && setShowDeleteConfirm(false)} isDisabled={deleting}>取消</HeroButton>
              <HeroButton color="danger" size="sm" onPress={confirmDelete} isDisabled={deleting}>
                {deleting ? <><Spinner size="sm" /> 删除中…</> : '确定删除'}
              </HeroButton>
            </HeroModal.Footer>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>
    </div>
  )
}

// ---------- 模版生成（一级 tab 占位，具体功能待定）----------
export function TemplateGen({ brand }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div className="tk-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="adjustment" size={18} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>模版生成</span>
      </div>
      <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted-foreground)' }}>
          <Icon name="adjustment" size={32} />
          <div style={{ marginTop: 10, fontWeight: 600, color: 'var(--foreground)' }}>模版生成功能规划中</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>敬请期待，具体方案确定后会在这里上线</div>
        </div>
      </div>
    </div>
  )
}

export default VideoLibrary
