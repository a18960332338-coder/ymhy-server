import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import Icon from '../components/Icon'
import {
  Button as HeroButton,
  Checkbox as HeroCheckbox,
  Chip,
  Popover,
  ToggleButtonGroup,
  ToggleButton,
} from '@heroui/react'
import { HeroSelect, HeroTextArea } from '../components/ui'
import { useImageDims, useContainerWidth, layoutMasonryRowMajor } from '../masonry'

// 套图生成：左侧与豆包 Agent 对话（确认/取消按钮 + 勾选卡片），右侧生成预览区

const PLATFORMS = [
  { key: 'douyin', label: '抖店',        lang: 'zh', size: '1:1' },
  { key: 'tiktok', label: 'TikTok Shop', lang: 'en', size: '1:1' },
  { key: 'ozon',   label: 'Ozon',        lang: 'ru', size: '3:4' },
]

const LANGS = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]

const SIZES = [
  { key: 'auto', label: '跟随平台默认' },
  { key: '1:1',  label: '1:1 方形' },
  { key: '3:4',  label: '3:4 竖版（高4宽3）' },
  { key: '16:9', label: '16:9 横版' },
  { key: '9:16', label: '9:16 竖屏' },
]

const STATUS_META = {
  pending:    { text: '等待中',   color: 'var(--muted-foreground)' },
  generating: { text: '生成中…', color: 'var(--warning)' },
  done:       { text: '已完成',   color: '#22c55e' },
  fail:       { text: '失败',     color: 'var(--danger)' },
}

// 套图结果卡片显示用的缩略图宽度。
// 卡片宽度约 180–240px，480 在 2x 屏上也够清晰；而后端原图是 6MB PNG，
// 服务器公网上行 ~70KB/s 时一张要 85 秒 —— 卡片会长时间空白转圈。
const CARD_THUMB_W = 480

function imgSrc(u) {
  if (!u) return ''
  // 生成完成后卡片只需「看得清」，一律走缩略图接口（后端 Pillow 生成 JPEG 并长期缓存）。
  // 原图 URL 仍保留在 it.url 里，供「点击查看大图 / 传给后端」使用，二者互不影响。
  const s = api.thumbOf(u, CARD_THUMB_W)
  if (s.startsWith('/') && api.baseUrl) return api.baseUrl + s
  return s
}

// HeroUI 下拉 — 基于命名空间 Select（HeroUI v3 真正的复合 Select，不是 Popover 自建）
// options 接受 [{ key, label }]，内部映射为 HeroSelect 期望的 [{ value, label }]
function HeroDropdown({ value, options, onChange, minWidth }) {
  const mapped = (Array.isArray(options) ? options : []).map(o => ({ value: o.key, label: o.label }))
  return <HeroSelect value={value} onChange={onChange} options={mapped} className="w-full" />
}

// 选择器图片墙：复用与图库完全相同的「横向行优先瀑布流」算法（layoutMasonryRowMajor），
// 保证排序方向、列数、间距与图库一致；不再用 CSS column（竖向填充）导致顺序看着是歪的。
function PickerGrid({ imgs, onSelect }) {
  const gridRef = useRef(null)
  const wrapW = useContainerWidth(gridRef)
  const urlMap = useMemo(() => {
    const m = {}
    for (const im of imgs) m[im.name] = im.url
    return m
  }, [imgs])
  const [dims, reportDim] = useImageDims(imgs.map(i => i.name), (n) => urlMap[n] || '')
  const layout = layoutMasonryRowMajor(imgs, dims, wrapW || 720, 200, 12)
  return (
    <div ref={gridRef} style={{ position: 'relative', height: layout.totalH, minHeight: 120 }}>
      {layout.placed.map(it => (
        <div
          key={it.name}
          onClick={() => onSelect(it)}
          role="button"
          title="点击选择这张图"
          style={{
            position: 'absolute', left: it._x, top: it._y, width: it._w, height: it._h,
            borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)',
            background: 'var(--surface-bg-2)', cursor: 'pointer',
            transition: 'border-color .15s ease, transform .15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none' }}
        >
          <img
            src={it.url} alt="" loading="lazy"
            onLoad={(e) => reportDim(it.name, { w: e.target.naturalWidth, h: e.target.naturalHeight })}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ))}
    </div>
  )
}

const S = {
  page: { display: 'flex', flexDirection: 'row', gap: 12, height: '100%', minHeight: 0, padding: 12, boxSizing: 'border-box' },
  panel: {
    background: 'var(--surface-bg-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column',
    minHeight: 0, overflow: 'hidden',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
    borderBottom: '1px solid var(--border)', flex: '0 0 auto',
  },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--foreground)' },
  body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 12 },
  label: { fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', background: 'var(--surface-tertiary)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', background: 'var(--surface-tertiary)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    background: 'var(--accent)', color: 'var(--accent-foreground)',
    border: 'none', borderRadius: 'var(--radius-lg)', padding: '8px 16px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  btnGhost: {
    background: 'transparent', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
  },
}

// ====== 翻译解析：从文本中提取【中文翻译】xxx ======
const TRANSLATION_RE = /【中文翻译】([\s\S]*?)$/m
/** 拆分原文和翻译，返回 { text, translation } （无翻译时 translation 为空串） */
function parseTranslation(text) {
  if (!text) return { text: '', translation: '' }
  const m = text.match(TRANSLATION_RE)
  if (m) {
    return { text: text.slice(0, m.index).trim(), translation: m[1].trim() }
  }
  return { text, translation: '' }
}

/** 翻译显示块（灰色小字，附在原文下方） */
function TranslationBlock({ text }) {
  if (!text) return null
  return (
    <div style={{
      marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)',
      fontSize: 11.5, lineHeight: 1.6, color: 'var(--muted-foreground)',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      <span style={{ fontSize: 10, color: 'var(--border-strong)', marginRight: 4, fontWeight: 500 }}>🌐 中文</span>
      {text}
    </div>
  )
}

function Bubble({ role, children, rawText }) {
  const isUser = role === 'user'
  // 对 AI 的纯文本消息解析中文翻译
  const { text: cleanText, translation } = (!isUser && typeof rawText === 'string')
    ? parseTranslation(rawText)
    : { text: '', translation: '' }
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
      <div style={{
        maxWidth: '86%',
        background: isUser ? 'var(--surface-bg-2)' : 'var(--surface-tertiary)',
        color: isUser ? 'var(--accent-foreground)' : 'var(--foreground)',
        borderRadius: 'var(--radius-xl)', padding: '9px 12px',
        fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {cleanText ? cleanText : children}
        {!isUser && translation && <TranslationBlock text={translation} />}
      </div>
    </div>
  )
}

function DraftCard({ draft }) {
  if (!draft) return null
  const { text: title, translation: titleZh } = parseTranslation(draft.title || '')
  return (
    <div style={{
      background: 'var(--surface-tertiary)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 10, marginBottom: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--foreground)' }}>
        {title}
      </div>
      {titleZh && <TranslationBlock text={titleZh} />}
      {!!(draft.selling_points || []).length && (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--foreground)' }}>
          {draft.selling_points.map((p, i) => {
            const { text: spText, translation: spZh } = parseTranslation(p)
            return <li key={i}>
              {spText}
              {spZh && <TranslationBlock text={spZh} />}
            </li>
          })}
        </ul>
      )}
      {(() => {
        const { text: detail, translation: detailZh } = parseTranslation(draft.detail_description || '')
        return (
          <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--muted-foreground)', whiteSpace: 'pre-wrap' }}>
            {detail}
            {detailZh && <TranslationBlock text={detailZh} />}
          </div>
        )
      })()}
    </div>
  )
}

// ====== 模型选择器（复用 api.models()，与 VideoBatchStudio 同源）======
function SuiteModelSelect({ value, onChange }) {
  const [models, setModels] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    api.models().then(r => {
      const arr = (r && Array.isArray(r.models)) ? r.models : []
      setModels(arr)
    }).catch(e => { setErr(String(e.message || e).slice(0, 80)) })
  }, [])
  const opts = models.map(m => ({
    value: m.id || m.key || m.model_id || m.name || '',
    label: (m.displayName || m.name || m.label || m.model_id || m.id || '') +
           (m.creditsCost != null ? ` (${m.creditsCost} 积分/张)` : ''),
  }))
  return (
    <>
      <HeroSelect value={value} onChange={onChange} options={opts} className="w-full" placeholder="选择生成模型…" />
      {err && <div style={{ marginTop: 2, fontSize: 11, color: 'var(--danger)' }}>模型加载失败：{err}</div>}
    </>
  )
}

// ====== 状态持久化：localStorage 读写 ======
const SUITE_LS_KEY = (brand) => `cs_suite_${brand || 'default'}`

function loadSuiteState(brand) {
  try {
    const raw = localStorage.getItem(SUITE_LS_KEY(brand))
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveSuiteState(brand, data) {
  try {
    if (data == null) { localStorage.removeItem(SUITE_LS_KEY(brand)); return }
    localStorage.setItem(SUITE_LS_KEY(brand), JSON.stringify(data))
  } catch { /* quota / privacy mode */ }
}

function clearSuiteState(brand) {
  try { localStorage.removeItem(SUITE_LS_KEY(brand)) } catch {}
}

export default function SuiteGenerator({ brand, account }) {
  // ---- 从 localStorage 恢复或使用默认值 ----
  const saved = loadSuiteState(brand)
  const [platform, setPlatform] = useState(saved?.platform || 'douyin')
  const [language, setLanguage] = useState(saved?.language || 'zh')
  const [size, setSize] = useState(saved?.size || 'auto')
  const [model, setModel] = useState(saved?.model || '')
  const [description, setDescription] = useState(saved?.description || '')
  const [refPath, setRefPath] = useState(saved?.refPath || '')
  const [refName, setRefName] = useState(saved?.refName || '')
  const [refFile, setRefFile] = useState(null)          // 原始 File（本地上传时）
  const [refImage, setRefImage] = useState(saved?.refImage || null)  // 预览 url（objectURL 或图库 http url）

  // —— 图库选择器 ——
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [pickerBuckets, setPickerBuckets] = useState([])   // [{key, label, images:[{name,url}]}]
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerActive, setPickerActive] = useState('gen')

  const [sid, setSid] = useState(saved?.sid || '')
  const [state, setState] = useState(saved?.state || null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const [checked, setChecked] = useState(saved?.checked || [])
  const [cancelMode, setCancelMode] = useState(saved?.cancelMode || false)
  const [cancelExtra, setCancelExtra] = useState(saved?.cancelExtra || '')

  const fileRef = useRef(null)
  const chatRef = useRef(null)
  const restoredRef = useRef(!!saved)  // 标记本次挂载是否从 localStorage 恢复

  // ---- 持久化：关键状态变化时自动写入 localStorage ----
  useEffect(() => {
    // 只持久化「未开始」的表单状态 或 「已开始」的会话状态
    if (!sid) {
      saveSuiteState(brand, { platform, language, size, model, description, refPath, refName, refImage,
                             sid: '', state: null, checked: [], cancelMode: false, cancelExtra: '' })
    } else {
      saveSuiteState(brand, { platform, language, size, model, description, refPath, refName, refImage,
                             sid, state, checked, cancelMode, cancelExtra })
    }
  }, [brand, platform, language, size, model, description, refPath, refName, refImage,
     sid, state, checked, cancelMode, cancelExtra])

  // ---- 恢复会话时：如果之前有进行中的 sid，自动轮询一次看是否仍有效 ----
  useEffect(() => {
    if (!restoredRef.current || !sid) return
    restoredRef.current = false  // 只执行一次
    // 静默检查 sid 是否仍然有效；无论成败都保留本地快照（界面不停留在初始空表单）
    api.suiteStatus(sid).then(s => {
      if (s) setState(s)  // 会话仍有效，用服务端最新状态覆盖
    }).catch(() => {
      // 网络抖动 / 服务重启期间：不清空界面，保留本地保存的进度并提示
      setError('正在恢复会话…若服务刚重启，已完成图片仍会保留')
    })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps -- 仅在 mount 时执行一次

  const doReset = () => {
    setSid(''); setState(null); setChecked([]); setCancelMode(false); setCancelExtra(''); setError('')
    clearSuiteState(brand)
  }

  const phase = state?.phase || ''
  const chat = state?.chat || []

  // 生成中/等待中时流式推送状态（SSE）
  useEffect(() => {
    if (!sid) return
    let es = null
    const needStream = phase === 'generating' || state?.running
    if (needStream) {
      es = api.suiteStream(sid, (data) => {
        setState(data)
      }, (err) => {
        console.error('suite stream error', err)
        setError(`流式连接出错：${err}`)
      }, () => {
        // 完成后自动关闭
      })
    }
    return () => { if (es) es.close() }
  }, [sid, phase, state?.running])

  // 轮询兜底：SSE 中断后不会自动重连（浏览器/网络抖动、后端重启都会断），
  // 一旦断开状态就永远停在旧快照 —— 表现就是「已生成的图片出不来」。
  // 这里在生成期间每 3s 拉一次状态，保证进度与成品图实时可见。
  useEffect(() => {
    if (!sid) return
    const busy = phase === 'generating' || state?.running
    if (!busy) return
    const t = setInterval(() => {
      api.suiteStatus(sid).then(s => setState(s)).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [sid, phase, state?.running])

  // 聊天自动滚动到底
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chat.length, state?.images?.length])

  // 通知图库刷新：① 全部完成时 ② 任意单张图片状态变为 done 时
  const prevDoneRef = useRef(0)
  useEffect(() => {
    const images = state?.images || []
    const doneCount = images.filter(it => it.status === 'done').length
    const phaseDone = state?.phase === 'done'
    // 新增了已完成图片，或整体阶段变为 done → 通知图库
    if (doneCount > prevDoneRef.current || (phaseDone && doneCount > 0)) {
      try { window.dispatchEvent(new CustomEvent('tk:refresh-results')) } catch {}
    }
    prevDoneRef.current = doneCount
  }, [state?.phase, state?.images])

  const onPlatformChange = (k) => {
    setPlatform(k)
    const p = PLATFORMS.find(x => x.key === k)
    if (p) setLanguage(p.lang)
  }

  const onUploadRef = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const r = await api.suiteUploadRef(f, brand)
      setRefPath(r?.path || '')
      setRefName(r?.filename || f.name)
      setRefFile(f)
      setRefImage(URL.createObjectURL(f))
    } catch (err) {
      setError(`参考图上传失败：${err.message || err}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const clearRefImage = () => {
    setRefPath('')
    setRefName('')
    setRefFile(null)
    setRefImage(null)
  }

  // —— 图库选择器 ——
  const absUrl = (u) => {
    if (!u) return ''
    if (u.startsWith('http')) return u
    return (api.baseUrl || 'http://127.0.0.1:8000') + (u.startsWith('/') ? '' : '/') + u
  }

  const openImagePicker = async () => {
    setShowImagePicker(true)
    setPickerLoading(true)
    try {
      // 分类与「图库」页保持一致：synthesized 桶按文件名前缀拆成
      // 合成图(gen_) / 分镜图(frame_) / 套图(suite_) / 其他生成图(img_)，
      // 否则所有生成图都挤在一个 tab 里。并发请求，弹窗打开更快。
      const [synthRes, tplRes, mainsRes, catsRes] = await Promise.all([
        api.images('synthesized', { brand }).catch(() => null),
        api.images('template_results', { brand }).catch(() => null),
        api.images('mains', { brand }).catch(() => null),
        api.images('cats', { brand }).catch(() => null),
      ])
      const synthAll = synthRes?.images || []
      // relUrl 是后端可解析的相对路径（/api/image/{category}/{name}?brand=..&account=..），
      // 作为 ref_image 传给后端时会被归一化成本地文件 data URL（零网络依赖）。
      // url 仅用于前端缩略图预览（前端 origin 绝对地址）。
      const toImgs = (bucket, items) => (items || []).map(im => {
        // url    = 仅用于弹窗内缩略图显示 → 走后端 ?w= 缩略图接口（Pillow 生成 + 长期缓存），
        //          避免一次请求上百张原图（每张 ~1.5MB）把带宽打满、图片迟迟出不来。
        // relUrl = 选中后传给后端的原图相对路径（后端会归一化成 data URL，需保持原始分辨率）。
        const thumb = api.thumbUrl(bucket, im.name, 480, { brand })
        const rel = api.imageUrl(bucket, im.name, { brand })
        return { name: im.name, url: absUrl(thumb), relUrl: rel }
      })
      const pickSynth = (re) => toImgs('synthesized', synthAll.filter(im => re.test(im.name || '')))
      const results = [
        { key: 'gen',       label: '合成图',     images: pickSynth(/^gen_/i) },
        { key: 'frame',     label: '分镜图',     images: pickSynth(/^frame_/i) },
        { key: 'templates', label: '模版图',     images: toImgs('template_results', tplRes?.images) },
        { key: 'suite',     label: '套图',       images: pickSynth(/^suite_/i) },
        { key: 'other',     label: '其他生成图', images: pickSynth(/^img_/i) },
        { key: 'mains',     label: '主图素材',   images: toImgs('mains', mainsRes?.images) },
        { key: 'cats',      label: '猫咪素材',   images: toImgs('cats', catsRes?.images) },
      ]
      setPickerBuckets(results)
      // 默认选中第一个有图片的分类（合成图优先，为空则自动回退）
      const firstWithImages = results.find(b => b.images.length > 0)
      setPickerActive(firstWithImages ? firstWithImages.key : 'gen')
    } finally {
      setPickerLoading(false)
    }
  }

  const onPickerSelect = (img) => {
    if (!img?.url) return
    setRefImage(img.url)         // 预览（图库 http url 直接可显示）
    setRefFile(null)             // 非本地上传文件
    setRefPath(img.relUrl || img.url)  // 优先传后端可解析的相对路径作为 ref_image
    setRefName(img.name)
    setShowImagePicker(false)
  }

  const doStart = async () => {
    if (!description.trim()) { setError('请先填写商品描述'); return }
    setError(''); setBusy(true); setStarting(true)
    try {
      // 如果有正在进行的旧会话，先取消它（清除未开始的排队项）
      if (sid && (state?.running || state?.phase === 'generating')) {
        try { await api.suiteAction({ sid, action: 'cancel' }) } catch {}
        setSid(''); setState(null); setChecked([])
      }
      const s = await api.suiteStart({
        brand, platform, language, size, model: model || undefined,
        description: description.trim(),
        ref_image: refPath || null,
      })
      setSid(s.sid); setState(s); setChecked([]); setCancelMode(false); setCancelExtra('')
    } catch (e) {
      setError(`开始失败：${e.message || e}`)
    } finally { setBusy(false); setStarting(false) }
  }

  const doAction = useCallback(async (action, extra = {}) => {
    if (!sid) return
    setError(''); setBusy(true)
    try {
      const s = await api.suiteAction({ sid, action, ...extra })
      setState(s)
      setCancelMode(false); setCancelExtra('')
    } catch (e) {
      setError(`操作失败：${e.message || e}`)
    } finally { setBusy(false) }
  }, [sid])

  const onConfirm = () => doAction('confirm')
  const onCancelSubmit = () => doAction('cancel', { extra: cancelExtra.trim() })

  const toggleCheck = (id) => {
    setChecked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const onGenerate = () => {
    if (!checked.length) { setError('请至少勾选一张图'); return }
    // 去重后提交：重复 type_id 会导致重复项永远停在「等待中」
    doAction('select', { type_ids: Array.from(new Set(checked)) })
  }

  // 找到最后一张 confirm / select 卡片（只有最新的卡片可交互）
  const lastConfirmIdx = chat.reduce((acc, m, i) => (m.type === 'confirm' ? i : acc), -1)
  const lastSelectIdx = chat.reduce((acc, m, i) => (m.type === 'select' ? i : acc), -1)

  const images = state?.images || []
  const progress = state?.progress || { total: 0, done: 0, fail: 0, percent: 0 }

  // ---- 历史套图列表：从 synthesized 中筛选 suite_ 前缀 ----
  const [suiteHistory, setSuiteHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const refreshHistory = useCallback(() => {
    setHistLoading(true)
    api.images('synthesized', { brand }).then(d => {
      const items = (d.images || [])
        .filter(it => it.name?.startsWith('suite_'))
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      setSuiteHistory(items)
    }).catch(() => setSuiteHistory([])).finally(() => setHistLoading(false))
  }, [brand])
  useEffect(() => { refreshHistory() }, [refreshHistory])

  return (
    <div style={S.page}>
      <style>{'@keyframes suite-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes suite-blink{0%,100%{opacity:1}50%{opacity:0}}@keyframes suite-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>

      {/* ================= 左：输入 + 对话 ================= */}
      <div style={{ ...S.panel, flex: '0 0 42%', maxWidth: 560, minWidth: 360 }}>
        <div style={S.head}>
          <Icon name="message" size={16} />
          <span style={S.title}>套图生成 · 对话</span>
          <div style={{ flex: 1 }} />
          {!!sid && (
            <HeroButton variant="outline" size="sm" onPress={doReset}>重新开始</HeroButton>
          )}
        </div>

        <div style={S.body} ref={chatRef}>
          {/* 基础信息表单（未开始时显示；开始后折叠为只读摘要） */}
          {!sid && (
            <div style={{ marginBottom: 14 }}>
              {/* 上传参考图（置顶，支持点击 / 粘贴 / 拖拽 / 图库选择） */}
              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>参考商品图</span>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {/* 上传/预览区域 */}
                  {!refImage ? (
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--foreground)' }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                      onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        e.currentTarget.style.borderColor = 'var(--border)'
                        const f = e.dataTransfer.files?.[0]
                        if (f) onUploadRef({ target: { files: [f] } })
                      }}
                      style={{
                        border: '2px dashed var(--border-strong)', borderRadius: 'var(--radius-xl)',
                        padding: '18px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 6, cursor: 'pointer', background: 'var(--surface-tertiary)',
                        transition: 'border-color .15s', position: 'relative', flex: 1,
                      }}
                      onPaste={(e) => {
                        const f = e.clipboardData?.files?.[0]
                        if (f && f.type.startsWith('image/')) { e.preventDefault(); onUploadRef({ target: { files: [f] } }) }
                      }}
                    >
                      <Icon name="picture" size={24} style={{ color: 'var(--muted-foreground)' }} />
                      <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                        点击、拖拽或粘贴图片
                      </span>
                      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUploadRef} />
                    </div>
                  ) : (
                    <div style={{
                      position: 'relative', width: 140, aspectRatio: '4/3', borderRadius: 12,
                      overflow: 'hidden', border: '1px solid var(--border)',
                      background: 'var(--surface-tertiary)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <img src={refImage} alt={refName || '参考图'} style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); clearRefImage() }}
                        style={{
                          position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: '50%',
                          background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', cursor: 'pointer',
                          display: 'grid', placeItems: 'center', fontSize: 12,
                        }}
                        title="删除参考图"
                      ><Icon name="close" size={12} /></button>
                    </div>
                  )}
                </div>
                {/* 从图库选择按钮 */}
                <div style={{ marginTop: 6 }}>
                  <HeroButton variant="outline" size="sm" onPress={openImagePicker}>
                    <Icon name="picture" size={13} /> 从图库选择图片
                  </HeroButton>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <span style={S.label}>平台</span>
                  <HeroDropdown value={platform} options={PLATFORMS} onChange={onPlatformChange} />
                </div>
                <div>
                  <span style={S.label}>语言</span>
                  <HeroDropdown value={language} options={LANGS} onChange={setLanguage} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>尺寸</span>
                <HeroDropdown value={size} options={SIZES} onChange={setSize} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>生成模型</span>
                <SuiteModelSelect value={model} onChange={setModel} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>商品描述</span>
                <HeroTextArea
                  value={description}
                  onChange={setDescription}
                  placeholder="例如：全棉四件套，60支长绒棉，亲肤透气，适合租房党与小户型卧室…"
                  minRows={4}
                  className="w-full"
                />
              </div>

              <HeroButton color="primary" onPress={doStart} isDisabled={busy}>
                {starting ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-flex', animation: 'suite-spin 1s linear infinite' }}>
                      <Icon name="refresh" size={13} />
                    </span>
                    正在连接 AI 助手…
                  </span>
                ) : busy ? '处理中…' : '开始生成'}
              </HeroButton>
            </div>
          )}

          {!!sid && (
            <div style={{
              fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 12, lineHeight: 1.8,
              background: 'var(--surface-tertiary)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
            }}>
              平台 {PLATFORMS.find(p => p.key === state?.platform)?.label || state?.platform} ·
              语言 {LANGS.find(l => l.key === state?.language)?.label || state?.language} ·
              尺寸 {state?.width}×{state?.height}（{state?.size}）
              {state?.model ? ` · 模型 ${state.model}` : ''}
              {refName ? ` · 参考图 ${refName}` : ''}
            </div>
          )}

          {/* 对话流 */}
          {chat.map((m, i) => {
            if (m.type === 'text' || !m.type) {
              return <Bubble key={i} role={m.role} rawText={m.text}>{m.text}</Bubble>
            }
            if (m.type === 'confirm') {
              const active = i === lastConfirmIdx && phase === 'await_confirm' && !busy
              return (
                <Bubble key={i} role={m.role}>
                  <div style={{ marginBottom: 8 }}>{m.text}</div>
                  <DraftCard draft={m.draft} />
                  {active && !cancelMode && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <HeroButton color="primary" onPress={onConfirm}>确认</HeroButton>
                      <HeroButton variant="outline" size="sm" onPress={() => setCancelMode(true)}>取消</HeroButton>
                    </div>
                  )}
                  {active && cancelMode && (
                    <div>
                      <HeroTextArea
                        value={cancelExtra}
                        onChange={setCancelExtra}
                        placeholder="补充/修改商品信息（可留空直接重新生成）"
                        minRows={3}
                        className="w-full mb-2"
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <HeroButton color="primary" onPress={onCancelSubmit}>提交修改</HeroButton>
                        <HeroButton variant="outline" size="sm" onPress={() => setCancelMode(false)}>返回</HeroButton>
                      </div>
                    </div>
                  )}
                  {!active && <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>（已处理）</div>}
                </Bubble>
              )
            }
            if (m.type === 'select') {
              const active = i === lastSelectIdx && phase === 'await_select' && !busy
              const plan = m.plan || []
              return (
                <Bubble key={i} role={m.role}>
                  <div style={{ marginBottom: 8 }}>{m.text}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {plan.map(it => {
                      const on = checked.includes(it.type_id)
                      return (
                        <div key={it.type_id} style={{
                          display: 'flex', gap: 8, alignItems: 'flex-start', cursor: active ? 'pointer' : 'default',
                          background: on ? 'var(--surface-tertiary)' : 'transparent',
                          border: `1px solid ${on ? 'var(--success)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-lg)', padding: '7px 9px',
                        }}>
                          <HeroCheckbox
                            isSelected={on}
                            onChange={() => toggleCheck(it.type_id)}
                            isDisabled={!active}
                            aria-label={it.title}
                            className="mt-0.5"
                          >
                            <HeroCheckbox.Content>
                              <HeroCheckbox.Control>
                                <HeroCheckbox.Indicator />
                              </HeroCheckbox.Control>
                              <span style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                                {(() => {
                                  const { text: t, translation: tZh } = parseTranslation(it.title || '')
                                  return <><b>{t}</b>{tZh && <TranslationBlock text={tZh} />}</>
                                })()}
                                {it.concept ? (
                                  (() => {
                                    const { text: c, translation: cZh } = parseTranslation(it.concept)
                                    return <><span style={{ color: 'var(--muted-foreground)' }}> — {c}</span>{cZh && <TranslationBlock text={cZh} />}</>
                                  })()
                                ) : null}
                              </span>
                            </HeroCheckbox.Content>
                          </HeroCheckbox>
                        </div>
                      )
                    })}
                  </div>
                  {active && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <HeroButton color="primary" onPress={onGenerate}>生成选中的 {checked.length} 张</HeroButton>
                        <HeroButton variant="outline" size="sm" onPress={() => setChecked(plan.map(p => p.type_id))}>全选</HeroButton>
                      <HeroButton variant="outline" size="sm" onPress={() => setChecked([])}>清空</HeroButton>
                    </div>
                  )}
                  {!active && <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>（已处理）</div>}
                </Bubble>
              )
            }
            return null
          })}

          {/* 流式文本：豆包逐字输出 */}
          {state?.streaming_text && (
            <Bubble role="agent" rawText={state.streaming_text}>
              {state.streaming_text}
              <span style={{
                display: 'inline-block', width: 6, height: 14,
                background: 'var(--foreground)', marginLeft: 2,
                animation: 'suite-blink 0.8s step-end infinite',
                verticalAlign: 'text-bottom', opacity: 0.7,
              }} />
            </Bubble>
          )}

          {(busy || state?.running) && !state?.streaming_text && (
            <Bubble role="agent">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-flex', animation: 'suite-spin 1s linear infinite' }}>
                  <Icon name="refresh" size={13} />
                </span>
                正在处理…
              </span>
            </Bubble>
          )}

          {!!error && (
            <div style={{
              background: 'rgba(254,44,85,.12)', border: '1px solid var(--danger)',
              color: 'var(--danger)', borderRadius: 'var(--radius-lg)',
              padding: '8px 10px', fontSize: 12.5, marginTop: 8,
            }}>{error}</div>
          )}
        </div>
      </div>

      {/* ================= 右：生成预览区 ================= */}
      <div style={{ ...S.panel, flex: '1 1 auto' }}>
        <div style={S.head}>
          <Icon name="picture" size={16} />
          <span style={S.title}>生成区</span>
          <div style={{ flex: 1 }} />
          {!!progress.total && (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              {progress.done}/{progress.total} 完成
              {progress.fail ? ` · ${progress.fail} 失败` : ''}
            </span>
          )}
        </div>

        <div style={S.body}>
          {!images.length && (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              color: 'var(--muted-foreground)', fontSize: 13, textAlign: 'center', padding: 24,
            }}>
              <Icon name="picture" size={28} />
              <div>左侧填写商品描述并开始后，</div>
              <div>确认信息 → 勾选图片，即可在此看到生成的套图。</div>
            </div>
          )}

          {!!images.length && (
            <>
              {!!progress.total && (
                <div style={{
                  height: 4, background: 'var(--surface-tertiary)',
                  borderRadius: 999, overflow: 'hidden', marginBottom: 12,
                }}>
                  <div style={{
                    width: `${progress.percent}%`, height: '100%',
                    background: 'var(--success)', transition: 'width .4s',
                  }} />
                </div>
              )}

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12,
                alignItems: 'start',
              }}>
                {images.map((it) => {
                  const meta = STATUS_META[it.status] || STATUS_META.pending
                  return (
                    <div key={it.type_id} style={{
                      background: 'var(--surface-tertiary)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-xl)', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}>
                      <div style={{
                        position: 'relative',
                        background: 'var(--surface-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                        // 宽度固定为卡片宽度；已完成时高度由图片真实比例决定（不裁切）
                        ...((it.status === 'done' && it.url) ? null : { aspectRatio: '1 / 1' }),
                      }}>
                        {it.status === 'done' && it.url ? (
                          <img
                            src={imgSrc(it.url)}
                            alt={it.title}
                            style={{ width: '100%', height: 'auto', display: 'block' }}
                          />
                        ) : it.status === 'fail' ? (
                          <div style={{ padding: 10, fontSize: 11.5, color: 'var(--danger)', textAlign: 'center' }}>
                            {it.error || '生成失败'}
                          </div>
                        ) : it.status === 'generating' ? (
                          // 生成中：扫光骨架占位 + 转圈
                          <>
                            <div style={{
                              position: 'absolute', inset: 0,
                              background: 'linear-gradient(110deg, transparent 0%, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%, transparent 100%)',
                              backgroundSize: '200% 100%',
                              animation: 'suite-shimmer 1.6s linear infinite',
                              pointerEvents: 'none',
                            }} />
                            <div style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                              color: 'var(--muted-foreground)', fontSize: 12, zIndex: 1,
                            }}>
                              <span style={{ animation: 'suite-spin 1s linear infinite', display: 'inline-flex' }}>
                                <Icon name="refresh" size={20} />
                              </span>
                              <span>{meta.text}</span>
                            </div>
                          </>
                        ) : (
                          // 等待中：静态省略号图标，不闪不转
                          <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                            color: 'var(--muted-foreground)', fontSize: 12, zIndex: 1,
                          }}>
                            <span style={{ display: 'inline-flex', opacity: 0.5 }}>
                              <Icon name="more" size={24} />
                            </span>
                            <span>{meta.text}</span>
                          </div>
                        )}
                        <Chip size="sm" className="absolute right-1.5 top-1.5" style={{ background: 'rgba(0,0,0,.65)', color: meta.color }}>{meta.text}</Chip>
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>
                          {it.title}
                        </div>
                        {it.credits != null && (
                          <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                            消耗积分 {it.credits}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== 图库选择器 ===== */}
      {showImagePicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }} onClick={() => setShowImagePicker(false)}>
          <div style={{ width: 760, maxWidth: '92vw', maxHeight: '82vh', overflowY: 'auto', borderRadius: 16, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="picture" size={16} /> 从图库选择参考图
              </div>
              <button onClick={() => setShowImagePicker(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="关闭"><Icon name="close" size={18} /></button>
            </div>
            {pickerLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>加载中…</div>
            ) : (
              <div>
                <ToggleButtonGroup
                  selectionMode="single"
                  selectedKeys={pickerActive != null ? [String(pickerActive)] : []}
                  onSelectionChange={(keys) => setPickerActive(Array.from(keys)[0])}
                  size="sm"
                  className="mb-4 flex-wrap gap-1 rounded-full bg-(--surface-tertiary) border border-(--border) p-1"
                >
                  {pickerBuckets.map(b => (
                    <ToggleButton
                      key={b.key}
                      id={String(b.key)}
                      className="px-3 py-1.5 text-[12px] font-medium text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-full transition-colors"
                    >
                      {b.label} <span style={{ opacity: 0.7 }}>{b.images.length}</span>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                {(() => {
                  const bucket = pickerBuckets.find(b => b.key === pickerActive)
                  const imgs = bucket?.images || []
                  return imgs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>该图库暂无图片</div>
                  ) : (
                    <PickerGrid imgs={imgs} onSelect={onPickerSelect} />
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
