import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import Toast from '../toast'
import Icon from '../components/Icon'
import { Button as HeroButton, Spinner, ToggleButton, ToggleButtonGroup } from '@heroui/react'
import { HeroTextArea, HeroSlider } from '../components/ui'

// ==================== 常量 ====================
const BRAND = 'cloudsleepgarden'
const STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAIL: 'fail',
}

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|flv|m4v|mpg|mpeg)$/i
const IMG_EXT_RE = /\.(jpg|jpeg|png|webp|bmp|gif)$/i

const ASPECT_ICONS = {
  '21:9': '21:9',
  '16:9': '16:9',
  '4:3': '4:3',
  '1:1': '1:1',
  '3:4': '3:4',
  '9:16': '9:16',
}

const CHEAPEST_DEFAULT_MODEL = 'seedance-2-mini'

// 简单选择弹出层封装
function Popover({ children, anchorRef, open, onClose, width = 320 }) {
  const panelRef = useRef(null)
  const [style, setStyle] = useState({})

  useEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const panel = panelRef.current
    const desiredWidth = Math.min(width, window.innerWidth - 24)
    let left = rect.left + rect.width / 2 - desiredWidth / 2
    let top = rect.top - 8
    if (left < 12) left = 12
    if (left + desiredWidth > window.innerWidth - 12) left = window.innerWidth - desiredWidth - 12
    if (panel) {
      const height = panel.offsetHeight || 260
      if (top - height < 12) top = rect.bottom + 8
      else top = top - height
    }
    setStyle({
      position: 'fixed',
      left,
      top,
      width: desiredWidth,
      zIndex: 99999,
    })
  }, [open, anchorRef, width])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose, anchorRef])

  if (!open) return null
  return (
    <>
      <div
        ref={panelRef}
        style={{
          ...style,
          background: 'var(--surface-bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          padding: 14,
          color: 'var(--foreground)',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ maxHeight: 'calc(100vh - 76px)', overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </>
  )
}

function ToolBtn({ refProp, icon, label, active, onClick, disabled, title }) {
  return (
    <HeroButton
      ref={refProp}
      title={title}
      variant={active ? 'secondary' : 'bordered'}
      size="sm"
      isDisabled={disabled}
      onPress={onClick}
      style={{ whiteSpace: 'nowrap' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {icon && <Icon name={icon} size={14} />}
        <span>{label}</span>
        <Icon name="down" size={12} style={{ marginLeft: 2, opacity: 0.7 }} />
      </span>
    </HeroButton>
  )
}

function fmtStatus(status) {
  const map = {
    [STATUS.PENDING]: '待提交',
    [STATUS.QUEUED]: '排队中',
    [STATUS.RUNNING]: '生成中',
    [STATUS.SUCCESS]: '生成完成',
    [STATUS.FAIL]: '生成失败',
  }
  return map[status] || status
}

// 左侧参考内容堆叠缩略图（支持一个视频 + 多张图片）
function ReferenceStack({ items, onClick, onDropFile, onMouseEnter, onMouseLeave }) {
  const [dragOver, setDragOver] = useState(false)
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const files = e.dataTransfer && e.dataTransfer.files
    if (files && files.length && onDropFile) onDropFile(Array.from(files))
  }
  const total = items.length
  const show = items.slice(-4)
  const more = Math.max(0, total - show.length)
  const transforms = [
    'translate(0,0) rotate(0deg)',
    'translate(-5px,-3px) rotate(-3deg)',
    'translate(5px,-3px) rotate(3deg)',
    'translate(0,-6px) rotate(0deg)',
  ]

  return (
    <div
      onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
      onDragLeave={(e) => { e.stopPropagation(); setDragOver(false) }}
      onDrop={handleDrop}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: 72, height: 72, borderRadius: 12,
        border: `1.5px dashed ${dragOver ? '#fff' : 'rgba(255,255,255,.35)'}`,
        background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', position: 'relative', flexShrink: 0,
        transition: 'border-color .15s, background .15s',
      }}
    >
      {total === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <Icon name="plus" size={18} />
          <span style={{ fontSize: 10, color: 'var(--muted-foreground)', textAlign: 'center', lineHeight: 1.2 }}>{dragOver ? '松开放入' : '参考内容'}</span>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {show.map((ref, idx) => {
            const t = transforms[idx] || transforms[transforms.length - 1]
            return (
              <div
                key={ref.id}
                style={{
                  position: 'absolute', inset: 6, borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--border)', background: 'var(--surface-bg-2)',
                  transform: t, zIndex: idx,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                }}
              >
                {ref.type === 'video' ? (
                  <video src={ref.preview} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <img src={ref.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
              </div>
            )
          })}
          {more > 0 && (
            <span style={{
              position: 'absolute', right: 4, bottom: 4, zIndex: 10,
              background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 8,
              padding: '2px 5px', fontSize: 10, fontWeight: 700,
            }}>+{more}</span>
          )}
        </div>
      )}
    </div>
  )
}

// 输入框里的参考内容小芯片：迷你缩略图 + 名称 + 格式
function ReferenceChips({ items, onRemove }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      {items.map((ref) => (
        <div
          key={ref.id}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 8px 4px 4px', borderRadius: 8,
            background: 'var(--muted)', border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--foreground)', maxWidth: '100%',
          }}
        >
          <div style={{ width: 18, height: 18, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: '#000' }}>
            {ref.type === 'video' ? (
              <video src={ref.preview} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <img src={ref.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.name}</span>
          <span style={{ color: 'var(--muted-foreground)', fontSize: 10 }}>{ref.ext}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(ref.id) }}
            style={{
              width: 14, height: 14, border: 'none', borderRadius: '50%', background: 'transparent',
              color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 11, display: 'grid', placeItems: 'center',
            }}
          >×</button>
        </div>
      ))}
    </div>
  )
}

// ==================== 组件 ====================

// 历史复刻视频（仅展示 source=replicate 的视频，不调用视频库组件，无则整块隐藏）
function ReplicateHistory({ brand, refreshKey }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.videoGenerated({ brand, source: 'replicate' })
      setVideos(Array.isArray(r?.videos) ? r.videos : [])
    } catch (e) {
      setVideos([])
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load, refreshKey])

  // 没有则不展示
  if (!loading && videos.length === 0) return null

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name="history" size={16} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>历史复刻视频</span>
        {!loading && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{videos.length} 个</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, maxHeight: 460, overflow: 'auto', paddingRight: 4 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted-foreground)', fontSize: 13 }}>
            <Spinner size="sm" /> 加载中…
          </div>
        ) : (
          videos.map((v) => (
            <div
              key={v.name}
              className="library-card"
              onClick={() => { const a = document.createElement('a'); a.href = v.url; a.target = '_blank'; a.rel = 'noopener'; a.click() }}
              style={{ cursor: 'pointer' }}
            >
              <div className="thumb" style={{ aspectRatio: '9 / 16' }}>
                <video
                  src={v.url}
                  preload="metadata"
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
                />
                {v.duration ? (
                  <span style={{
                    position: 'absolute', left: 8, bottom: 8, borderRadius: 6,
                    background: 'rgba(0,0,0,.7)', color: '#fff', padding: '2px 6px',
                    fontSize: 10, fontFamily: 'ui-monospace, monospace', pointerEvents: 'none',
                  }}>{v.duration}s</span>
                ) : null}
              </div>
              <div className="meta">
                <div className="sub" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Icon name="video" size={11} /> {v.model || '复刻'}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function VideoReplicate({ brand, account }) {
  const b = brand || BRAND

  // 参考素材：一个视频 + 多张参考图
  const [video, setVideo] = useState(null) // { id, type, file, name, ext, preview, url, status }
  const [images, setImages] = useState([]) // array of same shape
  const [uploadBusy, setUploadBusy] = useState(false)

  // 参考内容 hover 展开
  const [refHoverOpen, setRefHoverOpen] = useState(false)
  const [refHoverPos, setRefHoverPos] = useState({ left: 0, top: 0 })
  const allRefs = useMemo(() => (video ? [video, ...images] : images), [video, images])

  // 提示词
  const [prompt, setPrompt] = useState('')

  // 模型与参数
  const [models, setModels] = useState([])
  const [reachable, setReachable] = useState(true)
  const [modelId, setModelId] = useState('')
  const [resolutions, setResolutions] = useState([])
  const [aspects, setAspects] = useState(['9:16'])
  const [durations, setDurations] = useState([5])
  const [resolution, setResolution] = useState('480p')
  const [aspect, setAspect] = useState('9:16')
  const [duration, setDuration] = useState(4)
  const [audio, setAudio] = useState(true)
  const [count, setCount] = useState(1)

  // 生成记录列表（支持并行多条）
  const [tasks, setTasks] = useState([])
  const pollRefs = useRef({})

  // 弹出层
  const [showModelPanel, setShowModelPanel] = useState(false)
  const [showParamPanel, setShowParamPanel] = useState(false)
  const [showDurationPanel, setShowDurationPanel] = useState(false)
  const [showCountPanel, setShowCountPanel] = useState(false)
  const modelBtnRef = useRef(null)
  const paramBtnRef = useRef(null)
  const durationBtnRef = useRef(null)
  const countBtnRef = useRef(null)

  const refInputRef = useRef(null)
  const refStackRef = useRef(null)
  const refHoverTimer = useRef(null)

  // 历史瀑布流刷新信号
  const [historyKey, setHistoryKey] = useState(0)

  const toAbs = (url) => (url && url.startsWith('http') ? url : (window.location.origin + (url || '')))

  useEffect(() => {
    let mounted = true
    api.videoToapisModels().then((r) => {
      if (!mounted) return
      setReachable(!!r?.reachable)
      const ms = (r?.models || []).filter((m) => m.supports_video_ref)
      setModels(ms)
      if (ms.length && !modelId) {
        const def = ms.find((m) => m.id === CHEAPEST_DEFAULT_MODEL) || ms.find((m) => m.id === 'kling-v3') || ms[0]
        applyModel(def)
      }
    }).catch(() => { if (mounted) setModels([]) })
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyModel = (m) => {
    if (!m) return
    setModelId(m.id)
    const resList = m.resolutions || []
    const aspList = m.aspect_ratios || ['9:16']
    const durList = m.durations || [5]
    setResolutions(resList)
    setAspects(aspList)
    setDurations(durList)
    // 默认选该模型最便宜（分辨率最低）+ 9:16 + 最短时长
    const cheapestRes = resList.reduce((acc, r) => {
      const id = r.id || r
      const order = { '480p': 0, '720p': 1, '1080p': 2, '4k': 3 }[id] ?? 99
      if (!acc || order < acc.order) return { id, order }
      return acc
    }, null)
    setResolution(cheapestRes ? cheapestRes.id : (resList.find((r) => (r.id || r) === '1080p') ? '1080p' : (resList[0]?.id || '480p')))
    setAspect(aspList.includes('9:16') ? '9:16' : aspList[0])
    const minDur = Math.min(...durList.map(Number))
    setDuration(isFinite(minDur) ? minDur : durList[0])
  }

  // 参考素材管理（一个视频 + 多张参考图）
  const makeRef = (f, type) => {
    const name = f.name || ''
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    return {
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      file: f,
      name: base,
      ext,
      preview: URL.createObjectURL(f),
      url: '',
      status: 'uploading',
    }
  }

  const uploadRefToServer = async (ref, bucket) => {
    try {
      const res = await api.upload(bucket, [ref.file], { brand: b })
      const saved = res && res.saved && res.saved[0]
      if (saved && saved.url) return { ok: true, url: saved.url }
      const reason = (res && res.skipped && res.skipped[0] && res.skipped[0].reason) || '未知错误'
      return { ok: false, error: reason }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  const addVideo = async (f) => {
    if (!f) return
    if (!VIDEO_EXT_RE.test(f.name || '')) { Toast.warning('请上传视频文件（mp4/mov/webm 等）'); return }
    if (video && video.preview.startsWith('blob:')) URL.revokeObjectURL(video.preview)
    const ref = makeRef(f, 'video')
    setVideo(ref)
    setUploadBusy(true)
    const r = await uploadRefToServer(ref, 'videos')
    setUploadBusy(false)
    if (r.ok) {
      setVideo({ ...ref, url: r.url, status: 'done' })
      Toast.success('参考视频已上传')
    } else {
      setVideo({ ...ref, url: '', status: 'error' })
      Toast.warning('视频上传失败：' + r.error)
    }
  }

  const addImage = async (f) => {
    if (!f) return
    if (!IMG_EXT_RE.test(f.name || '')) { Toast.warning('请上传图片文件（jpg/png/webp 等）'); return }
    const ref = makeRef(f, 'image')
    setImages((prev) => [...prev, ref])
    const r = await uploadRefToServer(ref, 'cats')
    setImages((prev) => prev.map((item) => (item.id === ref.id ? { ...item, url: r.url || '', status: r.ok ? 'done' : 'error' } : item)))
    if (!r.ok) Toast.warning(`图片 ${ref.name}${ref.ext} 上传失败：${r.error}`)
  }

  const removeVideo = () => {
    if (video && video.preview.startsWith('blob:')) URL.revokeObjectURL(video.preview)
    setVideo(null)
  }

  const removeImage = (id) => {
    const ref = images.find((i) => i.id === id)
    if (ref && ref.preview.startsWith('blob:')) URL.revokeObjectURL(ref.preview)
    setImages((prev) => prev.filter((i) => i.id !== id))
  }

  const routeFiles = (files) => {
    if (!files || !files.length) return
    for (const f of Array.from(files)) {
      const name = f.name || ''
      const type = f.type || ''
      if (type.startsWith('video/') || VIDEO_EXT_RE.test(name)) {
        addVideo(f)
      } else if (type.startsWith('image/') || IMG_EXT_RE.test(name)) {
        addImage(f)
      } else {
        Toast.warning('不支持的文件类型：' + (f.name || ''))
      }
    }
  }

  const onPickReference = (e) => {
    const files = e.target.files
    e.target.value = ''
    if (files && files.length) routeFiles(Array.from(files))
  }

  const clearAllRefs = () => {
    if (video && video.preview.startsWith('blob:')) URL.revokeObjectURL(video.preview)
    images.forEach((img) => { if (img.preview.startsWith('blob:')) URL.revokeObjectURL(img.preview) })
    setVideo(null)
    setImages([])
  }

  // 生成任务管理
  const genId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const startGenerate = async () => {
    if (!video || !video.url) { Toast.warning('请先上传需要复刻的视频'); return }
    if (!prompt.trim()) { Toast.warning('请填写提示词'); return }
    if (!modelId) { Toast.warning('请选择视频模型'); return }

    const imageUrls = images.filter((i) => i.url).map((i) => i.url)
    const params = {
      video_url: video.url,
      image_url: imageUrls[0] || null,
      image_urls: imageUrls,
      prompt: prompt.trim(),
      model: modelId,
      duration: Number(duration) || 5,
      resolution,
      aspect_ratio: aspect,
      audio,
      brand: b,
    }

    const runs = Math.max(1, Math.min(4, Number(count) || 1))
    for (let i = 0; i < runs; i++) {
      const localId = genId()
      const record = {
        localId,
        taskId: null,
        status: STATUS.PENDING,
        progress: 10,
        videoUrl: '',
        remoteUrl: '',
        error: '',
        creditsUsed: null,
        params: { ...params, index: i + 1 },
        createdAt: Date.now(),
      }
      setTasks((prev) => [record, ...prev])
      pollRefs.current[localId] = true

      try {
        const r = await api.videoReplicateSubmit(params)
        window.dispatchEvent(new Event('app:refresh-credits'))
        const taskId = r?.id || r?.task_id || (r?.data && (r.data.task_id || r.data.id))
        if (!taskId) {
          const msg = r?.detail || r?.message || (r?.error && r.error.message) || '未返回任务 ID'
          updateTask(localId, { status: STATUS.FAIL, progress: 100, error: String(msg) })
          pollRefs.current[localId] = false
          continue
        }
        updateTask(localId, { taskId, status: STATUS.RUNNING, progress: 30 })
        pollTask(localId, taskId, params)
      } catch (e) {
        updateTask(localId, { status: STATUS.FAIL, progress: 100, error: String(e?.message || e) })
        pollRefs.current[localId] = false
      }
    }
  }

  const updateTask = (localId, patch) => {
    setTasks((prev) => prev.map((t) => (t.localId === localId ? { ...t, ...patch } : t)))
  }

  const removeTask = (localId) => {
    pollRefs.current[localId] = false
    setTasks((prev) => prev.filter((t) => t.localId !== localId))
  }

  const pollTask = (localId, taskId, params) => {
    let polls = 0
    const tick = async () => {
      if (!pollRefs.current[localId]) return
      polls += 1
      let s = null
      try { s = await api.videoToapisStatus(taskId) } catch (e) { /* continue */ }
      const st = s && s.status
      if (st === 'completed') {
        const arr = Array.isArray(s && s.result && s.result.data) ? s.result.data : []
        const remoteUrl = (arr[0] && arr[0].url) || (s && s.video_url) || ''
        let localUrl = remoteUrl
        if (remoteUrl) {
          try {
            const dl = await api.videoToapisDownload({
              url: remoteUrl,
              filename: `replicate_${taskId}.mp4`,
              brand: b,
              credits_used: (typeof (s && s.credits_used) === 'number') ? s.credits_used : null,
              model: params.model,
              resolution: params.resolution,
              duration: Number(params.duration),
              source: 'replicate',
              prompt: params.prompt,
            })
            if (dl && dl.url) localUrl = dl.url
          } catch (e) { /* keep remote url */ }
        }
        updateTask(localId, { status: STATUS.SUCCESS, progress: 100, videoUrl: localUrl, remoteUrl, creditsUsed: (s && s.credits_used) ?? null })
        pollRefs.current[localId] = false
        setHistoryKey((k) => k + 1)
        return
      }
      if (st === 'failed') {
        const msg = (s && s.error && s.error.message) || (s && s.message) || (s && s.error) || '生成失败'
        updateTask(localId, { status: STATUS.FAIL, progress: 100, error: String(msg) })
        pollRefs.current[localId] = false
        return
      }
      if (polls >= 120) {
        updateTask(localId, { status: STATUS.FAIL, progress: 100, error: '生成超时（>6分钟），请稍后在视频库查看结果' })
        pollRefs.current[localId] = false
        return
      }
      updateTask(localId, { progress: Math.min(90, 30 + polls * 2) })
      setTimeout(tick, 3000)
    }
    setTimeout(tick, 1500)
  }

  const resetAll = () => {
    clearAllRefs(); setPrompt('')
  }

  const openRefHover = () => {
    if (allRefs.length === 0) return
    if (refHoverTimer.current) clearTimeout(refHoverTimer.current)
    const rect = refStackRef.current?.getBoundingClientRect()
    if (rect) setRefHoverPos({ left: rect.left, top: rect.bottom + 8 })
    setRefHoverOpen(true)
  }
  const closeRefHover = () => {
    refHoverTimer.current = setTimeout(() => setRefHoverOpen(false), 120)
  }

  const selectedModel = models.find((m) => m.id === modelId)
  const canSubmit = video && video.url && prompt.trim() && modelId && !uploadBusy

  // 粘贴处理：从剪贴板取视频/图片，按类型自动分流（纯文本则放行，不干扰提示词输入）
  const onPaste = (e) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = []
    if (cd.files && cd.files.length) {
      for (const f of cd.files) files.push(f)
    } else if (cd.items) {
      for (const it of cd.items) {
        if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f) }
      }
    }
    if (!files.length) return
    routeFiles(files)
    e.preventDefault()
  }

  // 页面级拖拽：阻止浏览器默认“打开文件”行为；把文件分发到对应素材位
  const onContainerDragOver = (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault() }
  const onContainerDrop = (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return
    e.preventDefault()
    routeFiles(Array.from(e.dataTransfer.files))
  }

  const runningCount = useMemo(() => tasks.filter((t) => t.status === STATUS.RUNNING || t.status === STATUS.PENDING).length, [tasks])

  return (
    <div
      onPaste={onPaste}
      onDragOver={onContainerDragOver}
      onDrop={onContainerDrop}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'auto' }}
    >
      {/* 顶部标题 */}
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>
          开启你的 <span style={{ color: 'var(--foreground)' }}>复刻视频</span> 即刻造梦！
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 6 }}>
          上传参考视频与图片，输入提示词，选择模型后即可复刻生成新视频
        </div>
      </div>

      {!reachable && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          ToAPIs 视频服务当前不可用，复刻生成将失败。请联系管理员检查 ToAPIs 域名配置。
        </div>
      )}

      {/* 主输入卡 */}
      <div style={{
        background: 'var(--surface-bg-2)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '18px 18px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          {/* 左侧参考内容堆叠入口 */}
          <div
            ref={refStackRef}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, paddingTop: 2 }}
            onMouseEnter={openRefHover}
            onMouseLeave={closeRefHover}
          >
            <ReferenceStack
              items={allRefs}
              onClick={() => refInputRef.current && refInputRef.current.click()}
              onDropFile={routeFiles}
              onMouseEnter={openRefHover}
              onMouseLeave={closeRefHover}
            />
            <input ref={refInputRef} type="file" accept="video/*,image/*" multiple style={{ display: 'none' }} onChange={onPickReference} />
          </div>

          {/* 提示词 + 参考内容芯片 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              onMouseEnter={openRefHover}
              onMouseLeave={closeRefHover}
            >
              <ReferenceChips items={allRefs} onRemove={(id) => { if (video && video.id === id) removeVideo(); else removeImage(id) }} />
            </div>
            <HeroTextArea
              value={prompt}
              onChange={(v) => setPrompt(v)}
              placeholder="描述你想复刻的视频效果：画面内容、动作、风格、运镜、光线……"
              minRows={3}
              maxRows={10}
              style={{ flex: 1, minHeight: 72 }}
              inputClassName="h-full"
            />
          </div>
        </div>

        {/* 工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {/* 模型选择 */}
          <ToolBtn
            refProp={modelBtnRef}
            icon="layers"
            label={selectedModel ? selectedModel.id : '选择模型'}
            active={showModelPanel}
            onClick={() => { setShowModelPanel(true); setShowParamPanel(false); setShowDurationPanel(false); setShowCountPanel(false) }}
          />

          {/* 比例+分辨率 */}
          <ToolBtn
            refProp={paramBtnRef}
            icon="monitor"
            label={`${aspect} · ${resolution}`}
            active={showParamPanel}
            onClick={() => { setShowParamPanel(true); setShowModelPanel(false); setShowDurationPanel(false); setShowCountPanel(false) }}
          />

          {/* 时长 */}
          <ToolBtn
            refProp={durationBtnRef}
            icon="clock"
            label={`${duration}s`}
            active={showDurationPanel}
            onClick={() => { setShowDurationPanel(true); setShowModelPanel(false); setShowParamPanel(false); setShowCountPanel(false) }}
          />

          {/* 生成数量 */}
          <ToolBtn
            refProp={countBtnRef}
            icon="hash"
            label={`× ${count}`}
            title="选择同时生成的视频数量（1-4）"
            active={showCountPanel}
            onClick={() => { setShowCountPanel(true); setShowModelPanel(false); setShowParamPanel(false); setShowDurationPanel(false) }}
          />

          {/* 声音开关 */}
          <ToolBtn
            icon="volume"
            label={audio ? '有声' : '静音'}
            title="生成视频是否带声音（ToAPIs audio 参数）"
            active={audio}
            onClick={() => setAudio((v) => !v)}
          />

          <div style={{ flex: 1 }} />

          {/* 生成按钮 */}
          <HeroButton
            variant="primary"
            size="md"
            onPress={startGenerate}
            isDisabled={!canSubmit || runningCount > 0}
            className="rounded-full px-[22px] py-[10px] text-[14px] font-bold"
          >
            {runningCount > 0 ? <Spinner size="sm" color="current" /> : <Icon name="send" size={15} />}
            {runningCount > 0 ? `${runningCount} 个生成中…` : '立即生成'}
          </HeroButton>
        </div>
      </div>

      {/* 参考内容 hover 展开面板 */}
      {refHoverOpen && allRefs.length > 0 && (
        <div
          onMouseEnter={() => { if (refHoverTimer.current) clearTimeout(refHoverTimer.current); setRefHoverOpen(true) }}
          onMouseLeave={closeRefHover}
          style={{
            position: 'fixed',
            left: refHoverPos.left,
            top: refHoverPos.top,
            zIndex: 1001,
            background: 'var(--surface-bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            display: 'flex', gap: 10,
            maxWidth: 'calc(100vw - 48px)',
          }}
        >
          {allRefs.map((ref) => (
            <div
              key={ref.id}
              style={{
                width: 110, flexShrink: 0,
                borderRadius: 10, overflow: 'hidden',
                border: '1px solid var(--border)', background: '#000',
                position: 'relative',
              }}
            >
              <div style={{ aspectRatio: '9 / 16' }}>
                {ref.type === 'video' ? (
                  <video src={ref.preview} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <img src={ref.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
              </div>
              <div style={{ padding: '6px 8px', background: 'var(--muted)' }}>
                <div style={{ fontSize: 11, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.name}{ref.ext}</div>
                {ref.status === 'uploading' && <div style={{ fontSize: 10, color: 'var(--text-2)' }}>上传中…</div>}
                {ref.status === 'error' && <div style={{ fontSize: 10, color: 'var(--danger)' }}>上传失败</div>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); if (video && video.id === ref.id) removeVideo(); else removeImage(ref.id) }}
                style={{
                  position: 'absolute', top: 4, right: 4, width: 18, height: 18,
                  border: 'none', borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff',
                  fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* 模型选择弹出面板 */}
      <Popover anchorRef={modelBtnRef} open={showModelPanel} onClose={() => setShowModelPanel(false)} width={420}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--foreground)' }}>选择模型</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
          {models.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)', padding: '12px 0' }}>暂无可用的复刻模型</div>
          )}
          {models.map((m) => {
            const sel = m.id === modelId
            const cheapest = (m.resolutions || []).some((r) => (r.id || r) === '480p')
            return (
              <div
                key={m.id}
                onClick={() => { applyModel(m); setShowModelPanel(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 12, borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${sel ? 'var(--border-strong)' : 'var(--border)'}`,
                  background: sel ? 'var(--surface-bg-2)' : 'var(--muted)',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, background: 'var(--surface-bg-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--border)',
                }}>
                  <Icon name="video" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{m.id}</span>
                    {cheapest && <span style={{ fontSize: 10, color: '#fff', background: 'var(--success)', padding: '1px 6px', borderRadius: 999 }}>低价</span>}
                    {m.id.includes('kling') && <span style={{ fontSize: 10, color: '#fff', background: 'var(--warning)', padding: '1px 6px', borderRadius: 999 }}>推荐</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
                    支持同时参考视频与图片 · {m.aspect_ratios?.length || 0} 比例 · {(m.resolutions || []).map((r) => r.id || r).join('/')}
                  </div>
                </div>
                {sel && <Icon name="check" size={18} color="var(--success)" />}
              </div>
            )
          })}
        </div>
      </Popover>

      {/* 比例+分辨率弹出面板 */}
      <Popover anchorRef={paramBtnRef} open={showParamPanel} onClose={() => setShowParamPanel(false)} width={340}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>选择比例</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={aspect != null ? [String(aspect)] : []}
            onSelectionChange={(keys) => setAspect(Array.from(keys)[0])}
            size="sm"
            isDetached
            className="flex-wrap gap-2"
          >
            {aspects.map((ar) => (
              <ToggleButton
                key={ar}
                id={String(ar)}
                className="text-[12px] text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-[10px] transition-colors"
              >
                {ASPECT_ICONS[ar] || ar}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>选择分辨率</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={resolution != null ? [String(resolution)] : []}
            onSelectionChange={(keys) => setResolution(Array.from(keys)[0])}
            size="sm"
            isDetached
            className="flex-wrap gap-2"
          >
            {resolutions.map((r) => {
              const id = r.id || r
              const label = r.label || id
              return (
                <ToggleButton
                  key={id}
                  id={String(id)}
                  className="text-[12px] text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-[10px] transition-colors"
                >
                  {label}
                </ToggleButton>
              )
            })}
          </ToggleButtonGroup>
        </div>
      </Popover>

      {/* 时长弹出面板 */}
      <Popover anchorRef={durationBtnRef} open={showDurationPanel} onClose={() => setShowDurationPanel(false)} width={300}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>选择视频生成时长</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <HeroSlider
            value={duration}
            onChange={(raw) => {
              const allowed = durations.map(Number)
              const nearest = allowed.reduce((best, d) => (Math.abs(d - raw) < Math.abs(best - raw) ? d : best), allowed[0])
              setDuration(nearest)
            }}
            minValue={Math.min(...durations)}
            maxValue={Math.max(...durations)}
            step={1}
            showOutput={false}
            className="flex-1"
          />
          <div style={{
            minWidth: 52, textAlign: 'center', padding: '6px 10px', borderRadius: 8,
            background: 'var(--muted)', border: '1px solid var(--border)',
            fontSize: 14, fontWeight: 700,
          }}>
            {duration}<span style={{ fontSize: 11, marginLeft: 2, color: 'var(--muted-foreground)' }}>s</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted-foreground)', marginTop: 8 }}>
          <span>{Math.min(...durations)}s</span>
          <span>{Math.max(...durations)}s</span>
        </div>
      </Popover>

      {/* 生成数量弹出面板 */}
      <Popover anchorRef={countBtnRef} open={showCountPanel} onClose={() => setShowCountPanel(false)} width={200}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>选择生成数量</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[1, 2, 3, 4].map((n) => {
            const sel = n === count
            return (
              <button
                key={n}
                onClick={() => { setCount(n); setShowCountPanel(false) }}
                style={{
                  width: 38, height: 38, borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: `1px solid ${sel ? 'var(--border-strong)' : 'var(--border)'}`,
                  background: sel ? 'var(--surface-bg-2)' : 'var(--muted)',
                  color: sel ? '#fff' : 'var(--foreground)',
                  cursor: 'pointer',
                }}
              >
                {n}
              </button>
            )
          })}
        </div>
      </Popover>

      {/* 生成记录列表 */}
      {tasks.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Icon name="list" size={16} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>生成记录</span>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              {tasks.filter((t) => t.status === STATUS.SUCCESS).length} 成功 / {tasks.length} 条
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tasks.map((t) => (
              <div
                key={t.localId}
                style={{
                  background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="video" size={14} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{t.params.model}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                      {t.params.aspect_ratio} · {t.params.resolution} · {t.params.duration}s
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11,
                      color: t.status === STATUS.SUCCESS ? 'var(--success)' : t.status === STATUS.FAIL ? 'var(--danger)' : 'var(--warning)',
                    }}>
                      {fmtStatus(t.status)}
                    </span>
                    <button onClick={() => removeTask(t.localId)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>
                </div>

                <div style={{ height: 6, background: 'var(--muted)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    width: `${t.status === STATUS.SUCCESS ? 100 : t.status === STATUS.FAIL ? 100 : Math.max(10, Math.min(t.progress, 90))}%`,
                    height: '100%',
                    background: t.status === STATUS.FAIL ? 'var(--danger)' : (t.status === STATUS.SUCCESS ? 'var(--success)' : 'var(--warning)'),
                    transition: 'width .4s',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 8 }}>
                  {t.taskId ? `task_id: ${t.taskId}` : '准备提交…'}
                  {typeof t.creditsUsed === 'number' && <span style={{ marginLeft: 10 }}>消耗积分：{t.creditsUsed}</span>}
                </div>

                {t.status === STATUS.FAIL && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 8 }}>
                    {t.error}
                  </div>
                )}

                {t.status === STATUS.SUCCESS && t.videoUrl && (
                  <video src={toAbs(t.videoUrl)} controls style={{ width: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 历史复刻视频（仅复刻来源，无则隐藏） */}
      <ReplicateHistory brand={b} refreshKey={historyKey} />
    </div>
  )
}
