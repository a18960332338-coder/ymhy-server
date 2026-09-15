import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import Toast from '../toast'
import Icon from '../components/Icon'
import bananaIcon from '../assets/banana-icon.png'
import { STORYBOARD_PRESET, getBrandAI } from '../presets'
import { vbsModelKey, accId } from '../accountKeys'
import {
  Button as HeroButton,
  Chip,
  Spinner,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from '@heroui/react'
import { HeroTextArea, HeroInput, HeroSelect } from '../components/ui'

// ==================== 常量 ====================
const cnNums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
const DURATION_OPTIONS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '15s', '20s', '30s', '45s', '60s']

const MODEL_NANOBANANA2 = { id: 'nanobanana2', key: 'nanobanana2', label: 'nanobannan 2', creditsPerFrame: 3, locked: true, note: '锁定床品四件套与小猫形象保持不变' }
const CHANNELS = ['抖音短视频', '小红书', '快手', '视频号']

// 分镜文案自动生成的镜头用途标签（按分镜序号取模：分镜 N 用 labels[(N-1) % 5]）
const PRESET_LABELS_HOME = ['卧室环境交代', '床品全貌展示', '人与宠物空间', '床品面料细节', '动态氛围感特写']
const PRESET_LABELS_SOFA = ['客厅环境交代', '沙发全貌展示', '人与宠物空间', '沙发布面料细节', '动态氛围感特写']

const STATUS_QUEUED = 'queued'
const STATUS_RUNNING = 'running'
const STATUS_SUCCESS = 'success'
const STATUS_FAIL = 'fail'
const STATUS_CANCELED = 'canceled'

const DEFAULT_SHOTS = [
  { duration: '3s', imagePrompt: '阳光透过白纱帘洒进卧室，白色长毛猫轻盈走在薄荷绿波点冰丝床面上，整体画面温柔有氛围感', videoPrompt: '阳光透过白纱帘洒进卧室，白色长毛猫轻盈走在薄荷绿波点冰丝床面上，整体画面温柔有氛围感' },
  { duration: '5s', imagePrompt: '特写连贯动作：猫毛散落在面料上，手轻轻一扫毛发全部滑落；随即指尖划过面料，泛起丝绸般光泽', videoPrompt: '特写连贯动作：猫毛散落在面料上，手轻轻一扫毛发全部滑落；随即指尖划过面料，泛起丝绸般光泽' },
  { duration: '5s', imagePrompt: '镜头拉远定格，猫咪蜷在枕旁慵懒趴卧，整套四件套铺床效果完整呈现', videoPrompt: '镜头拉远定格，猫咪蜷在枕旁慵懒趴卧，整套四件套铺床效果完整呈现，角落弹出「不粘毛・冰丝凉感」字幕' },
]

// ==================== 工具函数 ====================
const pad2 = (n) => String(n).padStart(2, '0')
const genId = (len = 8) => 'v_' + Math.random().toString(36).slice(2, 2 + len)

const durSec = (s) => parseInt(String(s || '3s').replace(/[^0-9]/g, ''), 10) || 3

// 分镜图生成耗时格式化：从进度快照里找当前 idx 的 elapsed，展示"已生成 Xs / 提交中… / 下载中…"
const fmtFrameElapsed = (prog, idx) => {
  if (!prog) return '生成中…'
  const item = Array.isArray(prog.items) ? prog.items.find(it => it.idx === idx) : null
  if (item && item.status === 'downloading') return '下载中…'
  if (item && item.status === 'submitted') return '已提交，排队中…'
  if (item && typeof item.elapsed === 'number' && item.elapsed > 0) {
    const s = Math.round(item.elapsed)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `已生成 ${m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`}`
  }
  if (prog.message && prog.total > 1) return `第 ${prog.current}/${prog.total} 张…`
  return '生成中…'
}

// 视频时长格式化：秒 -> m:ss 或 Ns
const fmtDur = (sec) => {
  if (!sec || !isFinite(sec)) return '—'
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}

// 日期格式化：时间戳(秒) -> YYYY-MM-DD（到天）
const fmtDay = (ts) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// 给本地图片 URL 补全 brand/account，避免账号隔离后旧 frame.url 取不到图
const ensureFrameUrl = (url, brand, account) => {
  if (!url || typeof url !== 'string') return url
  if (!url.startsWith('/api/image/')) return url
  if (url.includes('account=') && url.includes('brand=')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}brand=${encodeURIComponent(brand || 'cloudsleepgarden')}&account=${encodeURIComponent(accId(account) || 'b')}`
}

// 视频生成预估时长（秒）：按模型 + 分辨率估算，进度条将按此时间推进
const estGenSec = (modelKey, resKey) => {
  const base = /kling/i.test(modelKey || '') ? 60 : 60
  const factor = resKey === '4k' ? 1.8 : resKey === '1080p' ? 1.3 : 1
  return Math.round(base * factor)
}

// ToAPIs 模型 id -> 友好显示名称（保留全部模型，仅对常见模型做中文映射）
const formatModelLabel = (id) => {
  const map = {
    'kling-v3': '可灵 V3',
    'kling-3.0-turbo': '可灵 V3 Turbo',
    'kling-v3-omni': '可灵 V3 Omni',
    'kling-v2-6': '可灵 V2.6',
    'kling-video-o1': '可灵 Video O1',
    'sora-2-vvip': 'Sora 2 VVIP',
    'sora-2-official': 'Sora 2 官方',
    'seedance-2': 'Seedance 2',
    'seedance-2-mini': 'Seedance 2 Mini',
    'seedance-2-fast': 'Seedance 2 Fast',
    'seedance-2-5': 'Seedance 2.5',
    'doubao-seedance-1-5-pro': '豆包 Seedance 1.5 Pro',
    'doubao-seedance-1-0-pro-fast': '豆包 Seedance 1.0 Pro Fast',
    'doubao-seedance-1-0-pro-quality': '豆包 Seedance 1.0 Pro 高清',
    'Veo3.1-quality-official': 'Veo 3.1 Quality 官方',
    'Veo3.1-fast-official': 'Veo 3.1 Fast 官方',
    'Veo3.1-lite-official': 'Veo 3.1 Lite 官方',
    'veo3.1-fast': 'Veo 3.1 Fast',
    'veo3.1-lite': 'Veo 3.1 Lite',
    'MiniMax-H3': 'MiniMax H3',
    'MiniMax-Hailuo-02': 'MiniMax 海螺 02',
    'MiniMax-Hailuo-2.3': 'MiniMax 海螺 2.3',
    'MiniMax-Hailuo-2.3-Fast': 'MiniMax 海螺 2.3 Fast',
    'wan2.6': 'Wan 2.6',
    'wan2.6-flash': 'Wan 2.6 Flash',
    'viduq3': 'Vidu Q3',
    'viduq3-pro': 'Vidu Q3 Pro',
    'viduq3-pro-fast': 'Vidu Q3 Pro Fast',
    'viduq3-mix': 'Vidu Q3 Mix',
    'viduq3-ad': 'Vidu Q3 Ad',
    'viduq3-drama': 'Vidu Q3 Drama',
    'grok-video-1.0': 'Grok Video 1.0',
    'grok-video-1.5': 'Grok Video 1.5',
    'gemini_omni': 'Gemini Omni',
    'gemini-omni-flash-preview-official': 'Gemini Omni Flash 官方',
    'gemini_omni_flash': 'Gemini Omni Flash',
    'happyhorse-1.1': 'HappyHorse 1.1',
  }
  return map[id] || id
}

// 设计稿 shots[{duration, imagePrompt, videoPrompt}] -> 规范竖线脚本（时长累加为区间）
// 兼容旧数据：若只有 description，则同时作为图片/视频提示词
const shotsToScript = (shots) => {
  let cursor = 0
  return (shots || []).map((s, i) => {
    const d = durSec(s.duration)
    const start = cursor
    const end = cursor + d
    cursor = end
    const videoPrompt = String(s.videoPrompt || s.description || '').replace(/[|\n]/g, ' ').trim()
    const imagePrompt = String(s.imagePrompt || s.description || '').replace(/[|\n]/g, ' ').trim()
    return `${i + 1} | ${start}-${end}s | ${videoPrompt} |  | ${imagePrompt}`
  }).join('\n')
}

const parseScriptLocal = (text) => {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const scenes = []
  const endSeconds = []
  for (const rawLine of lines) {
    // 注意：不能 filter 掉空列，否则中间的 caption 空列被删除会导致后面列错位，
    // 使 shot（图片提示词）列被挤掉。竖线脚本固定 5 列：idx | time | visual(视频) | caption | shot(图片)
    const parts = rawLine.split(/\s*\|\s*/).map(s => s.trim())
    if (parts.length < 3) continue
    const [idxRaw, time, visual, caption = '', shot = ''] = parts
    if ((visual || '').length < 2 && (shot || '').length < 2) continue
    const idx = parseInt(idxRaw || String(scenes.length + 1), 10) || scenes.length + 1
    scenes.push({ idx, time: time || '', visual, caption, shot })
    const m = (time || '').match(/(\d+)\s*-\s*(\d+)\s*s/)
    if (m) endSeconds.push(parseInt(m[2], 10))
  }
  const estDur = endSeconds.length > 0 ? Math.max(...endSeconds) : 5
  return { scenes, estDurationSec: estDur }
}

// ==================== 基础 UI 组件 ====================
function Button({ children, type = 'default', size = 'default', theme = 'light', onClick, loading = false, disabled = false, block = false, style, className = '', title, primary = false }) {
  const variant = theme === 'solid' || primary
    ? (type === 'danger' ? 'danger' : 'primary')
    : type === 'danger'
      ? 'danger-soft'
      : 'bordered'
  const sz = size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'md'
  return (
    <HeroButton title={title} className={className} style={style} variant={variant} size={sz} fullWidth={block} isDisabled={disabled || loading} onPress={onClick}>
      {loading ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Spinner size="sm" color="current"/>
          {children}
        </span>
      ) : children}
    </HeroButton>
  )
}

function Tag({ children, color = 'gray', size = 'default', style }) {
  const chipColorMap = {
    gray: 'default', green: 'success', red: 'danger', blue: 'primary',
    orange: 'warning', cyan: 'info', purple: 'secondary',
  }
  return (
    <Chip size={size === 'small' ? 'sm' : 'md'} variant="secondary" color={chipColorMap[color] || 'default'} style={style}>
      {children}
    </Chip>
  )
}

function Spin({ size = 'default', tip }) {
  const spinnerSize = size === 'large' ? 'lg' : 'sm'
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <Spinner size={spinnerSize}/>
      {tip && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{tip}</span>}
    </div>
  )
}

function Toggle({ checked, onChange, label, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...style }}>
      {label && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{label}</span>}
      {/* Switch 的 slot 只有 base/content/control/icon/thumb，且不支持 classNames 对象；
          开启态颜色由 heroui.css 的 .app-hero .switch 统一接管（--success）。 */}
      <Switch
        isSelected={!!checked}
        onChange={(v) => onChange && onChange(v)}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb className="bg-white" />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  )
}

function TkBadge({ n }) {
  return (
    <span style={{
      width: 20, height: 20, borderRadius: '50%', background: '#fff',
      fontSize: 10, color: '#fff', display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', fontWeight: 600, flexShrink: 0,
    }}>{n}</span>
  )
}

// ==================== NanoBanana 模型下拉（复用自合成工作台）====================
const _MODEL_NANO_FAMILY_HINT = /(nano|banana|nanobanana)/i
const _MODEL_2K4K_HINT = /(2k|4k|pro|hd|ultra)/i
function ModelSelectDropdown({ value, onChange, placeholder = '选择 NanoBanana 模型', style }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [provider, setProvider] = useState('NanoBanana')
  const [defaultId, setDefaultId] = useState('')
  const [err, setErr] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true); setErr('')
      try {
        const r = await api.models().catch(() => null)
        if (!alive) return
        const arr = (r && Array.isArray(r.models)) ? r.models : []
        setList(arr)
        setProvider((r && r.provider) || 'NanoBanana')
        setDefaultId((r && r.default) || (arr[0] && (arr[0].id || arr[0].key || arr[0].model_id)) || '')
      } catch (e) { setErr(String(e?.message || e)) }
      finally { if (alive) setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const _id = (m) => (m && (m.id || m.key || m.model_id || m.name || '')) || ''
  const _name = (m) => (m && (m.displayName || m.name || m.label || m.model_name || _id(m))) || ''
  const _cost = (m) => {
    if (!m) return 1
    const c = m.creditsCost ?? m.credits_cost ?? m.credit ?? m.cost ?? m.price ?? 1
    const n = Number(c)
    return Number.isFinite(n) && n >= 0 ? n : 1
  }
  const _tags = (m) => {
    if (!m) return []
    const raw = m.tags || m.tagList || []
    if (Array.isArray(raw)) return raw.filter(Boolean).slice(0, 4)
    if (typeof raw === 'string') return raw.split(/[,，/|]/).map(s => s.trim()).filter(Boolean).slice(0, 4)
    return []
  }
  const _isPro = (m) => _MODEL_2K4K_HINT.test(_name(m)) || _tags(m).some(t => _MODEL_2K4K_HINT.test(String(t)))

  const { nanoGroup, standardGroup, premiumGroup } = useMemo(() => {
    const nano = [], std = [], prem = []
    for (const m of list || []) {
      const n = _name(m)
      if (_MODEL_NANO_FAMILY_HINT.test(n)) nano.push(m)
      else if (_isPro(m)) prem.push(m)
      else std.push(m)
    }
    return { nanoGroup: nano, standardGroup: std, premiumGroup: prem }
  }, [list])

  const current = (list || []).find(m => _id(m) === value) || null
  const currentName = current ? _name(current) : (value === MODEL_NANOBANANA2.id ? MODEL_NANOBANANA2.label : '')

  return (
    <div className="mini-select" ref={ref} style={{ position: 'relative', ...(style || {}) }}>
      <div className="mini-select-box" onClick={() => setOpen(o => !o)} style={{ cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          {current && <img src={bananaIcon} alt="" style={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 4 }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: current ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
            {loading ? '加载中…' : (current ? currentName : placeholder)}
          </span>
          <span className={`mini-select-arrow ${open ? 'up' : ''}`}>▾</span>
        </div>
      {err && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger)' }}>模型加载异常：{err}</div>}
      {open && !loading && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 90,
          maxHeight: 380, overflowY: 'auto', background: 'var(--surface-bg-2)', borderRadius: 12,
          border: '1px solid var(--border)', boxShadow: '0 12px 30px rgba(15,23,42,.18)', padding: 10,
        }}>
          {(list || []).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: 14, textAlign: 'center' }}>暂无可选模型</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nanoGroup.length > 0 && <GroupLabel color="var(--foreground)" text="Nano Banana 家族" icon={bananaIcon} iconType="img" />}
              {nanoGroup.map(m => <ModelCardItem key={_id(m)} m={m} value={value} onPick={() => { onChange && onChange(_id(m), m); setOpen(false) }} />)}
              {standardGroup.length > 0 && <GroupLabel color="var(--success)" text="标准（1 积分）" icon={<Icon name="check" size={14} />} />}
              {standardGroup.map(m => <ModelCardItem key={_id(m)} m={m} value={value} onPick={() => { onChange && onChange(_id(m), m); setOpen(false) }} />)}
              {premiumGroup.length > 0 && <GroupLabel color="var(--surface-tertiary)" text="高级 · 高清（2K / 4K / Pro）" icon={<Icon name="target" size={14} />} />}
              {premiumGroup.map(m => <ModelCardItem key={_id(m)} m={m} value={value} onPick={() => { onChange && onChange(_id(m), m); setOpen(false) }} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
function GroupLabel({ color, text, icon, iconType }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color, padding: '2px 6px 4px' }}>
      {icon && (iconType === 'img'
        ? <img src={icon} alt="" style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3 }} />
        : <span style={{ display: 'inline-flex', color: '#fff' }}>{icon}</span>
      )}
      <span>{text}</span>
    </div>
  )
}
function ModelCardItem({ m, value, onPick }) {
  const id = m.id || m.key || m.model_id || m.name || ''
  const name = m.displayName || m.name || m.label || m.model_name || id
  const cost = Number(m.creditsCost ?? m.credits_cost ?? m.credit ?? m.cost ?? 1)
  const active = value === id
  return (
    <div role="button" onClick={onPick} style={{
      borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
      border: `1px solid ${active ? '#fff' : 'var(--border)'}`,
      background: active ? 'var(--surface-bg-2)' : 'var(--surface-bg-2)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{name}</span>
      <span style={{ fontSize: 11, color: active ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: 700 }}>
        {active ? '✓ 已选' : `💰 ${cost} 积分`}
      </span>
    </div>
  )
}

// ==================== 参考主图上传（设计稿：60% 宽虚线框 + 预览）====================
function RefUploadZone({ image, onPick, onClear }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const onFilesChosen = (files) => {
    const f = Array.from(files || [])[0]
    if (!f) return
    if (!f.type?.startsWith('image/')) { Toast.warning('请上传图片文件'); return }
    if (f.size > 10 * 1024 * 1024) { Toast.warning('图片不能超过 10MB'); return }
    onPick && onPick(f)
  }

  return (
    <div style={{ width: '100%' }}>
      {!image ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={(e) => { if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFilesChosen(e.dataTransfer?.files) }}
          onClick={() => inputRef.current?.click?.()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            borderRadius: 12, cursor: 'pointer', padding: '40px 24px', textAlign: 'center',
            border: `2px dashed ${dragOver ? '#fff' : 'var(--border)'}`,
            background: dragOver ? 'var(--surface-bg-2)' : 'var(--surface-bg-2)',
            transition: 'all .15s ease',
          }}
        >
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'color-mix(in srgb, #fff 10%, transparent)', color: '#fff', display: 'grid', placeItems: 'center', marginBottom: 12 }}><Icon name="upload" size={26} /></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>点击、拖拽或粘贴上传参考主图</div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>支持 JPG / PNG / WebP，建议尺寸 1080×1920，也可直接 Ctrl/⌘+V 粘贴</div>
        </div>
      ) : (
        <div className="relative" style={{ position: 'relative', width: 150, aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={image} alt="主图预览" style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
          <button
            onClick={(e) => { e.stopPropagation(); onClear && onClear() }}
            style={{
              position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', cursor: 'pointer',
              display: 'grid', placeItems: 'center', fontSize: 14,
            }}
            title="删除"
          ><Icon name="close" size={14} /></button>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const t = e.target; onFilesChosen(t.files); t.value = '' }} />
    </div>
  )
}

// ==================== 视频卡片播放占位 ====================
function VideoCard({ task, selected, onSelect, onPreview }) {
  const statusMeta = {
    [STATUS_QUEUED]: { color: 'var(--muted-foreground)', text: '待审核', icon: 'clock' },
    [STATUS_RUNNING]: { color: 'var(--warning)', text: '生成中', icon: 'play' },
    [STATUS_SUCCESS]: { color: 'var(--success)', text: '已通过', icon: 'check' },
    [STATUS_FAIL]: { color: 'var(--danger)', text: '失败', icon: 'close' },
    [STATUS_CANCELED]: { color: 'var(--muted-foreground)', text: '已取消', icon: 'close' },
  }[task.status] || { color: 'var(--muted-foreground)', text: task.status, icon: '?' }

  const dur = task.duration || task.config?.duration || 5
  const res = task.config?.resolution || '1080p'
  const aspect = task.config?.aspect || '9:16'

  return (
    <div
      onClick={() => onSelect && onSelect(task.id)}
      style={{
        cursor: 'pointer', borderRadius: 12, padding: 10,
        border: `1px solid ${selected ? '#fff' : 'var(--border)'}`,
        background: selected ? 'var(--surface-bg-2)' : 'var(--surface-bg-2)',
        transition: 'all .15s ease',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: aspect.replace(':', ' / '), overflow: 'hidden', borderRadius: 8, background: '#161618', marginBottom: 8, display: 'grid', placeItems: 'center' }}>
        {task.status === STATUS_SUCCESS && task.videoUrl ? (
          <video src={task.videoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted={false} />
        ) : task.status === STATUS_RUNNING ? (
          <Spinner size="md"/>
        ) : (
          <span style={{ fontSize: 28, opacity: 0.5, color: selected ? 'var(--foreground)' : 'var(--muted-foreground)' }}><Icon name="play" size={28} /></span>
        )}
        <span style={{ position: 'absolute', bottom: 8, right: 8, borderRadius: 6, background: 'rgba(0,0,0,.7)', padding: '2px 6px', fontSize: 10, color: '#fff', fontFamily: 'ui-monospace, monospace' }}>{dur}s</span>
        <span style={{ position: 'absolute', left: 8, top: 8, borderRadius: 6, background: statusMeta.color === 'var(--success)' ? 'color-mix(in srgb, var(--success) 80%, transparent)' : 'rgba(0,0,0,.65)', padding: '2px 6px', fontSize: 10, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {statusMeta.icon} {statusMeta.text}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>{task.title || '视频'}</div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>第 {task.index} 镜 · {dur}s · {res}</div>
      <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
        {task.status === STATUS_SUCCESS && <Button size="small" theme="solid" onClick={(e) => { e.stopPropagation(); onPreview && onPreview(task) }} style={{ flex: 1 }}><Icon name="play" size={12} /> 预览</Button>}
        {task.status === STATUS_FAIL && <Button size="small" theme="solid" type="danger" onClick={(e) => { e.stopPropagation(); onPreview && onPreview(task) }} style={{ flex: 1 }}><Icon name="refresh" size={12} /> 重试</Button>}
      </div>
    </div>
  )
}

// ==================== 主组件 ====================
export default function VideoBatchStudio(props) {
  const { brand, brandsMeta, onSwitchTab, account } = props || {}

  // —— 步骤 ——
  const [step, setStep] = useState(1)

  // —— 步骤1 数据 ——
  const [refFile, setRefFile] = useState(null)        // 原始 File
  const [refImage, setRefImage] = useState(null)      // 预览 url
  const [refImageUrl, setRefImageUrl] = useState('')  // 上传后的 http url
  const [productName, setProductName] = useState('不粘毛冰丝凉感四件套')
  const [targetChannel, setTargetChannel] = useState('抖音短视频')
  const [aspectRatio, setAspectRatio] = useState('9:16 竖屏')
  const [shots, setShots] = useState(DEFAULT_SHOTS)

  // —— 解析结果（scenes 供生图/视频用）——
  const [scenes, setScenes] = useState(() => parseScriptLocal(shotsToScript(DEFAULT_SHOTS)).scenes)

  // —— 步骤2 数据 ——
  const [step2FirstVisit, setStep2FirstVisit] = useState(true)
  const [frames, setFrames] = useState({})            // { idx: {status,url,error} }
  const [selectedShotIdx, setSelectedShotIdx] = useState(null)
  const [nanoModelId, setNanoModelId] = useState(() => {
    try { return localStorage.getItem(vbsModelKey(account)) || MODEL_NANOBANANA2.id } catch { return MODEL_NANOBANANA2.id }
  })
  const [nanoModelMeta, setNanoModelMeta] = useState(MODEL_NANOBANANA2)
  const [shotFeedback, setShotFeedback] = useState('')
  // 分镜图生成队列（后台串行，多个分镜可同时入队）
  const [frameQueue, setFrameQueue] = useState([])
  const frameQueueRef = useRef([])
  const frameProcessingRef = useRef(false)
  // 分镜图生成进度（轮询 /api/video/generate_frames/progress 展示"第几张/耗时"）
  const [frameGenProgress, setFrameGenProgress] = useState(null) // {running,current,total,message,items}
  const frameProgressTimerRef = useRef(null)
  // 上传本地图片作为分镜图（隐藏 file input）
  const uploadInputRef = useRef(null)
  const uploadTargetRef = useRef(null)

  // —— 步骤3 数据 ——
  const [videoModel, setVideoModel] = useState('')
  const [resolution, setResolution] = useState('')
  const [klingModels, setKlingModels] = useState([])
  const [klingResolutions, setKlingResolutions] = useState([])
  const [klingAspects, setKlingAspects] = useState(['9:16', '16:9', '1:1'])
  const [klingDurations, setKlingDurations] = useState([5, 10])
  const [toapisReachable, setToapisReachable] = useState(true) // ToAPIs 服务是否可达
  const [tasksQueue, setTasksQueue] = useState([])
  // 批量生成时：任一任务失败/积分不足 → 置 true，取消队列中剩余未提交任务
  const cancelQueueRef = useRef(false)
  const pendingTasksRef = useRef([])
  const [selectedVideoId, setSelectedVideoId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewTask, setPreviewTask] = useState(null)

  // —— 已生成图片/视频板块 ——
  const [generatedImages, setGeneratedImages] = useState([])
  const [generatedVideos, setGeneratedVideos] = useState([])
  const [showGenerated, setShowGenerated] = useState(null) // null | 'images' | 'videos'
  const [selectedVideos, setSelectedVideos] = useState(() => new Set()) // 已生成视频多选导出
  const [genDurations, setGenDurations] = useState({}) // name -> 秒（已生成视频时长）

  // —— 图库选择器 ——
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [pickerBuckets, setPickerBuckets] = useState([]) // [{key, label, images:[{name,url}]}]
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerActive, setPickerActive] = useState('mains')
  const [pickerMode, setPickerMode] = useState('ref') // 'ref' | 'frame'
  const [pickerFrameIdx, setPickerFrameIdx] = useState(null) // 当 mode='frame' 时记录目标分镜 idx
  // 分镜文案 hover 完整展示
  const [hoverTip, setHoverTip] = useState(null) // { text, x, y }
  // 正在生成文案的分镜索引（null=无）
  const [generatingScriptIdx, setGeneratingScriptIdx] = useState(null)
  // 排队中的分镜索引（后台串行队列）
  const [scriptQueue, setScriptQueue] = useState([])
  const scriptQueueRef = useRef([])
  const scriptProcessingRef = useRef(false)
  // 逐镜视频生成进度定时器（按 task id 记录）
  const progressTimersRef = useRef({})

  // ====== 派生数据 ======
  const frameDoneCount = Object.values(frames).filter(f => f.status === 'done').length
  const aspectKey = aspectRatio.includes('16:9') ? '16:9' : aspectRatio.includes('1:1') ? '1:1' : '9:16'
  const totalDurationSec = shots.reduce((a, s) => a + durSec(s.duration), 0)

  const selectedVideo = tasksQueue.find(t => t.id === selectedVideoId) || tasksQueue[0]

  // ====== 持久化 nanoModelId ======
  useEffect(() => { try { localStorage.setItem(vbsModelKey(account), nanoModelId) } catch {} }, [nanoModelId])

  // ====== 任务状态更新 & ToAPIs 轮询辅助（真实链接 ToAPIs）======
  const updateTask = useCallback((id, patch) => {
    setTasksQueue(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // 按预估时长推进进度条：从 5% 平滑升至 95%，到时后卡在 95% 直到真实完成
  const runProgress = useCallback((itemId, estSec) => {
    const prev = progressTimersRef.current[itemId]
    if (prev) clearInterval(prev)
    const start = Date.now()
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000
      const ratio = Math.min(1, elapsed / Math.max(1, estSec))
      const pct = Math.min(95, 5 + ratio * 90)
      updateTask(itemId, { progress: Math.round(pct) })
      if (ratio >= 1) {
        clearInterval(progressTimersRef.current[itemId])
        progressTimersRef.current[itemId] = null
      }
    }
    progressTimersRef.current[itemId] = setInterval(tick, 350)
    tick()
  }, [updateTask])
  // 停止并清理某任务的进度定时器（真实完成时调用）
  const stopProgress = (itemId) => {
    const t = progressTimersRef.current[itemId]
    if (t) { clearInterval(t); progressTimersRef.current[itemId] = null }
  }

  // 取消队列中尚未开始提交的剩余任务（失败/积分不足时调用）
  const cancelPendingQueue = useCallback((reason) => {
    cancelQueueRef.current = true
    const pending = pendingTasksRef.current.filter(t => t.status === STATUS_RUNNING && !t.klingTaskId)
    if (pending.length) {
      setTasksQueue(prev => prev.map(t => (pending.some(p => p.id === t.id) ? { ...t, status: STATUS_CANCELED, error: reason || '已取消' } : t)))
      Toast.warning(`已取消队列中 ${pending.length} 条待生成视频：${reason || ''}`)
    }
  }, [])

  const pollKlingStatus = useCallback(async (itemId, taskId, item) => {
    // 串行队列下，4 个任务最坏可能耗时 ~8 分钟（每个 60-120s 串行）。
    // 提到 200 轮 ≈10 分钟，留足余量；并且超时只标当前任务 FAIL，
    // 不再 cancelPendingQueue —— 否则后续任务永远不会被下载。
    const MAX_POLLS = 200
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(3000)
      let s = null
      try { s = await api.videoToapisStatus(taskId) } catch { /* 继续轮询 */ }
      // ToAPIs status 返回单条任务对象：{ id, status, progress, result:{data:[{url}]}, error:{message}, credits_used }
      const status = s?.status
      if (status === 'completed') {
        const result = s?.result || {}
        const arr = Array.isArray(result?.data) ? result.data : []
        const remoteUrl = arr[0]?.url || s?.video_url || ''
        let localUrl = remoteUrl
        if (remoteUrl) {
          try {
            const dl = await api.videoToapisDownload({
              url: remoteUrl,
              filename: `toapis_${taskId}.mp4`,
              brand: brand || 'cloudsleepgarden',
              credits_used: (typeof s?.credits_used === 'number') ? s.credits_used : null,
              model: s?.model || item?.config?.videoModel || null,
              resolution: item?.config?.resolution || null,
              duration: item?.duration || null,
            })
            if (dl?.url) localUrl = dl.url
          } catch (e) {
            // 下载失败 → 标失败而非伪成功（否则视频库读不到本地文件，视频会“消失”）
            stopProgress(itemId)
            updateTask(itemId, { status: STATUS_FAIL, progress: 100, error: '视频下载到本地失败：' + (e?.message || e) })
            cancelPendingQueue(`视频下载失败：${String(e?.message || e).slice(0, 60)}`)
            return
          }
        }
        stopProgress(itemId)
        updateTask(itemId, {
          status: STATUS_SUCCESS, progress: 100, videoUrl: localUrl, remoteUrl,
          creditsUsed: (typeof s?.credits_used === 'number') ? s.credits_used : null,
        })
        // 刷新已生成列表
        try {
          const g = await api.videoGenerated({ brand: brand || 'cloudsleepgarden' }).catch(() => null)
          if (g) {
            setGeneratedImages(Array.isArray(g.images) ? g.images : [])
            setGeneratedVideos(Array.isArray(g.videos) ? g.videos : [])
          }
        } catch { /* ignore */ }
        // 通知视频库（若已打开）立即刷新，把刚生成的视频显示出来
        try { window.dispatchEvent(new Event('app:videos-updated')) } catch { /* ignore */ }
        return
      }
      if (status === 'failed') {
        const msg = s?.error?.message || s?.message || s?.error || 'ToAPIs 生成失败'
        stopProgress(itemId)
        updateTask(itemId, { status: STATUS_FAIL, progress: 100, error: String(msg) })
        // 生成失败 → 取消队列中剩余待生成任务
        cancelPendingQueue(`前序视频生成失败：${String(msg).slice(0, 60)}`)
        return
      }
      // 进度由 runProgress 定时器按预估时间推进，此处不再改动
    }
    stopProgress(itemId)
    updateTask(itemId, { status: STATUS_FAIL, progress: 100, error: 'ToAPIs 生成超时（已超过 10 分钟，可手动重试）' })
    // 不再 cancelPendingQueue —— 队列里其他任务可能正常完成，
    // 取消它们会导致 ToAPIs 已生成但前端永远不下载。超时仅影响当前任务。
  }, [updateTask, brand, cancelPendingQueue])

  const submitOneKling = useCallback(async (item) => {
    if (!item.frameUrl) {
      updateTask(item.id, { status: STATUS_FAIL, progress: 100, error: '缺少首帧分镜图，无法提交 ToAPIs' })
      cancelPendingQueue('缺少首帧分镜图')
      return
    }
    try {
      // 使用分镜实际配置：模型 id / 时长(3-15s) / 分辨率 / 比例，不再强制映射到 kling-v3
      const modelId = item.config?.videoModel || videoModel || 'kling-v3'
      const duration = item.duration || 5
      const r = await api.videoToapisSubmit({
        prompt: item.prompt,
        model: modelId,
        image_url: item.frameUrl,
        duration: duration,
        resolution: item.config?.resolution || '1080p',
        aspect_ratio: item.config?.aspect || '9:16',
        brand: brand || 'cloudsleepgarden',
      })
      // 消耗了积分 → 立即刷新顶部积分显示
      window.dispatchEvent(new Event('app:refresh-credits'))
      const taskId = r?.id || r?.task_id || r?.data?.task_id || r?.data?.id
      if (!taskId) {
        const msg = r?.message || r?.detail || r?.error?.message || 'ToAPIs 未返回 task_id'
        updateTask(item.id, { status: STATUS_FAIL, progress: 100, error: String(msg) })
        // 未返回 task_id（常见：积分不足 / quota 限制）→ 取消队列剩余任务
        cancelPendingQueue(String(msg).slice(0, 60))
        return
      }
      updateTask(item.id, { klingTaskId: taskId })
      await pollKlingStatus(item.id, taskId, item)
    } catch (e) {
      const msg = String(e?.message || e)
      updateTask(item.id, { status: STATUS_FAIL, progress: 100, error: msg })
      // 提交异常（含积分不足 / 余额不足 / 网络失败）→ 取消队列剩余任务
      cancelPendingQueue(msg.slice(0, 60))
    }
  }, [brand, pollKlingStatus, updateTask, videoModel, cancelPendingQueue])

  // ====== shots 变化 → 重新解析 scenes ======
  const reparse = useCallback((list) => {
    const r = parseScriptLocal(shotsToScript(list))
    setScenes(r.scenes || [])
    return r
  }, [])

  useEffect(() => {
    const t = setTimeout(() => reparse(shots), 300)
    return () => clearTimeout(t)
  }, [shots, reparse])

  // ====== 分镜 CRUD ======
  const updateShot = (i, field, value) => {
    setShots(prev => {
      const next = prev.slice()
      next[i] = { ...next[i], [field]: value || '' }
      return next
    })
  }
  const addShot = () => {
    setShots(prev => [...prev, { duration: '3s', imagePrompt: '', videoPrompt: '' }])
  }
  const deleteShot = (i) => {
    setShots(prev => {
      if (prev.length <= 1) return prev
      const next = prev.slice()
      next.splice(i, 1)
      return next
    })
  }

  // 从 AI 返回的分镜文案中解析出「图片提示词」与「视频提示词」两个区块
  const parseStoryboardContent = (text) => {
    const t = String(text || '').trim()
    const imgM = t.match(/【图片提示词】([\s\S]*?)(?=【视频提示词】|$)/)
    const vidM = t.match(/【视频提示词】([\s\S]*)$/)
    let imagePrompt = (imgM && imgM[1].trim()) || ''
    let videoPrompt = (vidM && vidM[1].trim()) || ''
    return { imagePrompt, videoPrompt, raw: t }
  }

  // ====== 分镜文案自动生成（参考图 + 云眠AI「短视频分镜助手」预设 → 豆包，后台队列串行）======
  const generateScriptContent = async (shotIndex) => {
    const labels = brand === 'sofawithcat' ? PRESET_LABELS_SOFA : PRESET_LABELS_HOME
    const preset = labels[shotIndex % labels.length]
    if (!preset) throw new Error('预设提示词缺失')
    // 确保参考图已上传（无参考图时降级为纯文本描述生成）
    let refUrl = ''
    try { refUrl = await uploadRefImage() || '' } catch { refUrl = '' }
    const system = getBrandAI(brand).storyboard
    const productNoun = brand === 'sofawithcat' ? '家具' : '床品'
    // 本分镜时长：使用用户在分镜编辑区选择的时间，默认 5s
    const shotDur = shots[shotIndex]?.duration || '5s'
    // 已生成记录（用于差异化）：其他分镜已有的图片/视频提示词摘要，避免机位/动作/景别/路线重复
    const history = shots
      .map((s, i) => (i !== shotIndex && (s.imagePrompt || s.videoPrompt))
        ? `分镜${i + 1}（主题：${labels[i % labels.length]}）：${String(s.imagePrompt || s.videoPrompt || '').slice(0, 100)}`
        : null)
      .filter(Boolean)
    const userPrompt = `请严格按上述系统预设，只生成第 ${shotIndex + 1} 个分镜（单分镜逐次生成，不要输出其他分镜）。\n本分镜目标（差异化标签）：${preset}。\n本分镜时长：${shotDur}（总时长必须严格使用该秒数，视频提示词按此时长写）。\n\n【已生成记录（用于差异化，本分镜不得重复其机位/核心动作/景别/运动路线）】\n${history.length ? history.join('\n') : '（暂无，本分镜为第一个）'}\n\n【输出结构要求，必须严格遵守】\n1. 先写「图片提示词」：以【图片提示词】开头，只写静态关键帧画面（禁止写镜头移动、跟拍、跑动/跳跃/翻滚过程、动作变化，禁止出现“动态/连续/跟随”等词），用于生成视频底图。\n2. 再写「视频提示词」：以【视频提示词】开头，只写动态过程与运镜（不重复图片已固定的场景、产品、花色、机位等静态参数）。\n两个区块都必须完整写出、不能省略；严格基于参考图片生成，场景锁定（完整复用原图全部环境、${productNoun}、猫咪、道具、光线）；不要 markdown 大标题，不要多余解释文字。`
    const resp = await api.chat({
      messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
      model: 'doubao',
      max_tokens: 2000,
      temperature: 0.7,
      images: refUrl ? [refUrl] : [],
      brand: brand || 'cloudsleepgarden',
    })
    const content = (resp?.content || (typeof resp === 'string' ? resp : '') || '').trim()
    if (!content) throw new Error('未返回内容')
    const parsed = parseStoryboardContent(content)
    // 兜底：若 AI 未按要求分块，整段作为视频提示词，图片提示词留空由用户自行补充
    return {
      imagePrompt: parsed.imagePrompt,
      videoPrompt: parsed.videoPrompt || content,
      raw: content,
    }
  }

  const processScriptQueue = async () => {
    if (scriptProcessingRef.current) return
    scriptProcessingRef.current = true
    try {
      while (scriptQueueRef.current.length > 0) {
        const shotIndex = scriptQueueRef.current[0]
        setGeneratingScriptIdx(shotIndex)
        try {
          const { imagePrompt, videoPrompt } = await generateScriptContent(shotIndex)
          updateShot(shotIndex, 'imagePrompt', imagePrompt)
          updateShot(shotIndex, 'videoPrompt', videoPrompt)
          Toast.success(`分镜${cnNums[shotIndex] || (shotIndex + 1)}文案已生成（图片/视频提示词已分别填入）`)
        } catch (e) {
          Toast.error(`分镜${cnNums[shotIndex] || (shotIndex + 1)}文案生成失败：` + (e?.message || e))
        }
        // 队首出列
        scriptQueueRef.current = scriptQueueRef.current.slice(1)
        setScriptQueue(scriptQueueRef.current)
      }
    } finally {
      scriptProcessingRef.current = false
      setGeneratingScriptIdx(null)
    }
  }

  const autoGenerateScript = (shotIndex) => {
    // 已在队列或正在生成则忽略，避免重复入队
    if (scriptQueueRef.current.includes(shotIndex) || generatingScriptIdx === shotIndex) return
    scriptQueueRef.current = [...scriptQueueRef.current, shotIndex]
    setScriptQueue(scriptQueueRef.current)
    processScriptQueue()
  }

  // ====== 参考图上传 ======
  const handlePickRef = (file) => {
    setRefFile(file)
    setRefImage(URL.createObjectURL(file))
    setRefImageUrl('')
  }
  const handleClearRef = () => {
    setRefFile(null)
    setRefImage(null)
    setRefImageUrl('')
  }

  // ====== 剪贴板粘贴图片作为参考主图（全局监听，任何步骤都可粘贴）======
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            setRefFile(file)
            setRefImage(URL.createObjectURL(file))
            setRefImageUrl('')
            Toast.success('已粘贴图片作为参考主图')
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // 上传参考图到后端（video_refs），得到可访问 http url
  const uploadRefImage = useCallback(async () => {
    if (!refFile || refImageUrl) return refImageUrl
    try {
      const r = await api.videoUploadRef([refFile], { brand: brand || 'cloudsleepgarden' })
      const name = r?.saved?.[0]?.name || r?.saved?.[0]?.relPath
      if (name) {
        // 参考图上传到 video_refs bucket，访问 url 必须用 /api/image/video_refs/（不能用 videoUrl 的 videos 目录）
        const url = api.imageUrl('video_refs', name, { brand: brand || 'cloudsleepgarden' })
        setRefImageUrl(url)
        return url
      }
    } catch (e) {
      Toast.warning('参考图上传失败，将按文生图生成：' + (e?.message || ''))
    }
    return ''
  }, [refFile, refImageUrl, brand])

  // ====== 生图参数拼进 prompt ======
  // scene.shot 对应「图片提示词」，scene.visual 对应「视频提示词」
  const buildImagePrompt = useCallback((scene) => {
    const base = scene.shot?.trim() || scene.visual || scene.caption || ''
    // 主体一致性硬约束：场景、四件套产品、猫咪必须与参考图完全一致
    const IDENTITY_LOCK = '严格保持参考图中的场景布置、四件套产品（款式/颜色/面料纹理）与猫咪形象完全一致，仅可调整镜头景别、构图与动作，禁止改变产品外观与猫咪外貌，'
    let prefix = IDENTITY_LOCK
    if (shotFeedback?.trim()) prefix += `修改意见：${shotFeedback.trim()}，`
    return (prefix + base).trim() || base
  }, [shotFeedback])

  // ====== 分镜图生成（后台队列串行，多个分镜可同时入队）======
  // 启动分镜生成进度轮询（每 2s 拉一次，展示"第几张/已耗时"）
  const startFrameProgressPolling = useCallback(() => {
    if (frameProgressTimerRef.current) return
    const tick = async () => {
      try {
        const p = await api.videoFrameProgress({ brand: brand || 'cloudsleepgarden' })
        setFrameGenProgress(p)
        // 生成结束（running=false）且没有后续任务 → 停止轮询
        if (p && !p.running && !frameQueueRef.current.length) stopFrameProgressPolling()
      } catch { /* 网络抖动忽略，下次再拉 */ }
    }
    tick()
    frameProgressTimerRef.current = setInterval(tick, 2000)
  }, [brand])

  const stopFrameProgressPolling = useCallback(() => {
    if (frameProgressTimerRef.current) {
      clearInterval(frameProgressTimerRef.current)
      frameProgressTimerRef.current = null
    }
    setFrameGenProgress(null)
  }, [])

  // 组件卸载时清理
  useEffect(() => () => {
    if (frameProgressTimerRef.current) clearInterval(frameProgressTimerRef.current)
  }, [])

  const generateFrameOne = useCallback(async (idx) => {
    const scene = scenes.find(s => s.idx === idx)
    if (!scene) return false
    const refUrl = await uploadRefImage()
    const prompt = buildImagePrompt(scene)
    startFrameProgressPolling()
    try {
      const resp = await api.videoGenerateFrames({
        brand: brand || 'cloudsleepgarden',
        ref_image: refUrl || null,
        scenes: [scene],
        prompts: [prompt],
        idx_only: idx,
        model_id: nanoModelId || undefined,
      })
      // 分镜生图消耗 NanoBanana 积分 → 立即刷新顶部积分显示
      window.dispatchEvent(new Event('app:refresh-credits'))
      const frame = Array.isArray(resp?.frames) ? resp.frames[0] : null
      if (!frame) {
        setFrames(prev => ({ ...prev, [idx]: { ...(prev[idx] || {}), status: 'fail', error: '生成请求无返回' } }))
        return false
      }
      setFrames(prev => ({
        ...prev,
        [idx]: { status: frame.status === 'fail' ? 'fail' : 'done', url: frame.url || '', error: frame.error || '', framePrompt: frame.framePrompt || '' },
      }))
      return frame.status !== 'fail'
    } finally {
      // 生成完成后停掉轮询（若有后续排队任务，下一条会重新启动）
      stopFrameProgressPolling()
    }
  }, [scenes, brand, nanoModelId, uploadRefImage, buildImagePrompt, startFrameProgressPolling, stopFrameProgressPolling])

  const processFrameQueue = useCallback(async () => {
    if (frameProcessingRef.current) return
    frameProcessingRef.current = true
    try {
      while (frameQueueRef.current.length > 0) {
        const idx = frameQueueRef.current[0]
        setFrames(prev => ({ ...prev, [idx]: { ...(prev[idx] || {}), status: 'running' } }))
        try {
          const ok = await generateFrameOne(idx)
          if (ok) Toast.success(`分镜${pad2(idx)}分镜图已生成`)
          else Toast.warning(`分镜${pad2(idx)}分镜图生成失败`)
        } catch (e) {
          setFrames(prev => ({ ...prev, [idx]: { ...(prev[idx] || {}), status: 'fail', error: String(e?.message || e) } }))
          Toast.error(`分镜${pad2(idx)}分镜图生成失败：` + (e?.message || e))
        }
        frameQueueRef.current = frameQueueRef.current.slice(1)
        setFrameQueue(frameQueueRef.current)
      }
    } finally {
      frameProcessingRef.current = false
      setStep2FirstVisit(false)
    }
  }, [generateFrameOne])

  const requestGenerate = useCallback((idx = null) => {
    if (!scenes.length) { Toast.warning('请先在步骤1填写分镜'); return }
    const targets = idx != null ? [idx] : scenes.map(s => s.idx)
    // 过滤已在队列中（含正在生成）的分镜，避免重复入队
    const newTargets = targets.filter(t => !frameQueueRef.current.includes(t))
    if (newTargets.length === 0) { Toast.info('所选分镜已在生成队列中'); return }
    frameQueueRef.current = [...frameQueueRef.current, ...newTargets]
    setFrameQueue(frameQueueRef.current)
    processFrameQueue()
  }, [scenes, processFrameQueue])

  // 取消排队中（尚未开始生成）的分镜图：从队列移除并恢复原状态
  const cancelFrame = useCallback((idx) => {
    if (frameQueueRef.current.includes(idx)) {
      frameQueueRef.current = frameQueueRef.current.filter(t => t !== idx)
      setFrameQueue(frameQueueRef.current)
    }
    setFrames(prev => {
      const cur = prev[idx]
      // 若原本已生成/失败，取消后保留原图；否则回到待绘制
      const restore = cur && (cur.status === 'done' || cur.status === 'fail') ? cur : { status: 'idle' }
      return { ...prev, [idx]: restore }
    })
    Toast.info(`已取消分镜${pad2(idx)}的绘制排队`)
  }, [])

  // 上传本地图片作为分镜图（替代 AI 生成，直接进入视频首帧）
  const handleUploadClick = useCallback((idx) => {
    uploadTargetRef.current = idx
    uploadInputRef.current?.click()
  }, [])

  const handleUploadChange = useCallback(async (e) => {
    const input = e.target
    const file = input.files?.[0]
    input.value = '' // 允许重复选择同一文件
    const idx = uploadTargetRef.current
    if (!file || idx == null) return
    try {
      Toast.info(`正在上传分镜${pad2(idx)}图片…`)
      const r = await api.upload('synthesized', [file], { brand: brand || 'cloudsleepgarden' })
      const name = r?.saved?.[0]?.name || r?.saved?.[0]?.relPath
      if (!name) throw new Error('上传返回为空')
      const url = api.imageUrl('synthesized', name, { brand: brand || 'cloudsleepgarden' })
      setFrames(prev => ({ ...prev, [idx]: { status: 'done', url, uploaded: true } }))
      Toast.success(`分镜${pad2(idx)}图片已上传`)
    } catch (err) {
      Toast.error('上传失败：' + (err?.message || err))
    }
  }, [brand])

  // ====== 已生成图片/视频加载 ======
  const loadGenerated = useCallback(async () => {
    try {
      const r = await api.videoGenerated({ brand }).catch(() => null)
      if (r) {
        setGeneratedImages(Array.isArray(r.images) ? r.images : [])
        setGeneratedVideos(Array.isArray(r.videos) ? r.videos : [])
      }
    } catch {}
  }, [brand])

  useEffect(() => { loadGenerated() }, [loadGenerated])

  // 打开生成页时先补下载同步：把历史已提交但未入库（页面刷新/后端重启漏轮询）的完成视频拉到本地
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.videoToapisSync(brand || 'cloudsleepgarden')
        if (!cancelled && r && Array.isArray(r.downloaded) && r.downloaded.length > 0) {
          Toast.success(`已补同步 ${r.downloaded.length} 个视频到视频库`)
          await loadGenerated()
        }
      } catch { /* 同步失败不阻塞页面 */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  // 从后端拉取 ToAPIs 视频生成实际可用模型 / 分辨率 / 比例 / 时长，替代前端写死列表
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const r = await api.videoToapisModels()
        if (!mounted) return
        const d = r?.default || {}
        // ToAPIs 服务不可达时给出明确提示
        if (typeof r?.reachable === 'boolean') {
          setToapisReachable(r.reachable)
          if (!r.reachable) {
            Toast.warning(`ToAPIs 视频服务当前不可用（${r.base_url || ''}），请检查网络或域名配置`)
          }
        }
        if (r?.models?.length) {
          setKlingModels(r.models)
          // 默认模型（kling-v3）的能力：分辨率/比例/时长随模型联动
          const dm = r.models.find(x => x.id === (d.model || r.default?.model)) || r.models[0]
          if (dm?.resolutions?.length) {
            setKlingResolutions(dm.resolutions)
            setResolution(dm.default_resolution || (dm.resolutions.some(x => x.id === '1080p') ? '1080p' : dm.resolutions[0].id))
          }
        }
        if (d.model) setVideoModel(d.model)
        if (d.resolution && !klingResolutions.length) setResolution(d.resolution)
      } catch (e) {
        console.warn('拉取 ToAPIs 模型配置失败', e)
      }
    })()
    return () => { mounted = false }
  }, [])

  // 切换视频模型时，分辨率下拉随该模型支持范围联动（klingAspects/klingDurations 属生图面板，不动）
  const applyModelCaps = useCallback((id, models) => {
    const m = (models || klingModels).find(x => x.id === id)
    if (!m) return
    if (Array.isArray(m.resolutions) && m.resolutions.length) {
      setKlingResolutions(m.resolutions)
      setResolution(m.default_resolution || (m.resolutions.some(x => x.id === '1080p') ? '1080p' : m.resolutions[0].id))
    }
  }, [klingModels])

  // 把图片 url 转成后端可访问的绝对地址（后端 generate 需要 http 才能下载转 data url）
  const absUrl = (u) => {
    if (!u) return ''
    if (u.startsWith('http')) return u
    return 'http://127.0.0.1:8000' + (u.startsWith('/') ? '' : '/') + u
  }

  // ====== 图库选择器 ======
  // mode='ref'  选择参考主图；mode='frame' 选择某个分镜的 frame 图片
  const openImagePicker = async (mode = 'ref', frameIdx = null) => {
    setPickerMode(mode)
    setPickerFrameIdx(frameIdx)
    setShowImagePicker(true)
    setPickerLoading(true)
    try {
      const buckets = [
        { key: 'template_results', label: '模版图' },
        { key: 'synthesized', label: '合成图' },
        { key: 'mains', label: '主图素材' },
        { key: 'cats', label: '猫咪素材' },
      ]
      const results = []
      for (const b of buckets) {
        try {
          const r = await api.images(b.key, { brand }).catch(() => null)
          const images = (r?.images || []).map(im => ({ name: im.name, url: absUrl(api.imageUrl(b.key, im.name, { brand })) }))
          results.push({ ...b, images })
        } catch {
          results.push({ ...b, images: [] })
        }
      }
      setPickerBuckets(results)
      // 默认优先选中「合成图」；若合成图为空则回退到第一个有图片的分类
      const synth = results.find(b => b.key === 'synthesized')
      const firstWithImages = results.find(b => b.images.length > 0)
      setPickerActive((synth && synth.images.length > 0) ? 'synthesized' : (firstWithImages ? firstWithImages.key : 'mains'))
    } finally {
      setPickerLoading(false)
    }
  }

  const onPickerSelect = (img) => {
    if (!img?.url) return
    if (pickerMode === 'frame' && pickerFrameIdx != null) {
      // 把图库图片设为该分镜的 frame（与上传本地图片效果一致）
      setFrames(prev => ({ ...prev, [pickerFrameIdx]: { status: 'done', url: img.url, uploaded: true } }))
      setShowImagePicker(false)
      Toast.success(`已选择图库图片作为分镜${pad2(pickerFrameIdx)}首帧`)
      return
    }
    setRefImage(img.url)      // 预览
    setRefFile(null)          // 非上传文件
    setRefImageUrl(img.url)   // 直接作为后端可访问的 http url
    setShowImagePicker(false)
    Toast.success('已选择图库图片作为参考主图')
  }

  // ====== 提交视频任务（真实链接 ToAPIs）======
  const submitVideos = async () => {
    if (!scenes.length) { Toast.warning('请先填写分镜脚本'); return }
    // 只生成"已生成分镜图"的分镜视频；没有分镜图则提示，不再自动生成
    const doneScenes = scenes.filter(scene => {
      const f = frames[scene.idx]
      return f && f.status === 'done' && f.url
    })
    if (doneScenes.length === 0) {
      Toast.warning('暂时无分镜图片，无法生成视频，请先在第二步生成分镜图')
      return
    }
    setSubmitting(true)
    try {
      const now = Date.now()
      const newItems = doneScenes.map((scene, i) => {
        const frame = frames[scene.idx] || {}
        const dur = durSec(shots[scene.idx - 1]?.duration)
        return {
          id: genId(),
          title: `视频 #${i + 1} · ${productName}`,
          prompt: `[分镜${pad2(scene.idx)}] ${scene.visual}`,
          scenes: [scene],
          frames: [{ idx: scene.idx, ...frame }],
          status: STATUS_RUNNING,
          progress: 5,
          createdAt: now,
          duration: dur,
          index: scene.idx,
          config: { duration: dur, resolution, aspect: aspectKey, videoModel },
          frameUrl: ensureFrameUrl(frame.url, brand, account) || '',
          klingTaskId: null,
          error: '',
        }
      })

      setTasksQueue(prev => [...newItems, ...prev])
      if (newItems.length) setSelectedVideoId(newItems[0].id)
      setStep(3)
      Toast.success(`🚀 已提交 ${newItems.length} 条视频任务到 ToAPIs（真实生成中）`)

      // 批量队列：记录所有待处理任务；若中途失败/积分不足，剩余任务全部取消
      pendingTasksRef.current = newItems
      cancelQueueRef.current = false

      // 逐个真实提交 ToAPIs（串行，避免并发限流）
      for (const item of newItems) {
        // 前序任务失败/积分不足 → 取消队列，剩余任务不再提交
        if (cancelQueueRef.current) {
          const rest = pendingTasksRef.current.filter(t => t.status === STATUS_RUNNING && !t.klingTaskId)
          if (rest.length) {
            setTasksQueue(prev => prev.map(t => (rest.some(p => p.id === t.id) ? { ...t, status: STATUS_CANCELED, error: '因前序任务失败已取消' } : t)))
          }
          break
        }
        runProgress(item.id, estGenSec(item.config?.videoModel || videoModel, item.config?.resolution || resolution))
        await submitOneKling(item)
      }
      pendingTasksRef.current = []
    } catch (e) {
      Toast.error('提交失败：' + (e?.message || e))
      // 整体提交异常也取消剩余队列
      cancelPendingQueue('提交异常，队列已取消')
    } finally {
      setSubmitting(false)
    }
  }

  // ====== 单个分镜生成视频（步骤三逐镜生成，无需点「全部生成」）======
  const submitOneShot = async (idx) => {
    const scene = scenes.find(s => s.idx === idx)
    const frame = frames[idx] || {}
    if (!scene || frame.status !== 'done' || !frame.url) {
      Toast.warning(`分镜${pad2(idx)} 还没有可用的分镜图，请先在第二步生成`)
      return
    }
    const dur = durSec(shots[idx - 1]?.duration)
    const item = {
      id: genId(),
      title: `视频 · ${productName} · 第${idx}镜`,
      prompt: `[分镜${pad2(idx)}] ${scene.visual}`,
      scenes: [scene],
      frames: [{ idx, ...frame }],
      status: STATUS_RUNNING,
      progress: 5,
      createdAt: Date.now(),
      duration: dur,
      index: idx,
      config: { duration: dur, resolution, aspect: aspectKey, videoModel },
      frameUrl: ensureFrameUrl(frame.url, brand, account) || '',
      klingTaskId: null,
      error: '',
    }
    setTasksQueue(prev => [item, ...prev])
    setSelectedVideoId(item.id)
    runProgress(item.id, estGenSec(videoModel, resolution))
    await submitOneKling(item)
  }

  // ====== 批量导出 ======
  const exportVideos = async () => {
    const done = tasksQueue.filter(t => t.status === STATUS_SUCCESS)
    if (!done.length) { Toast.warning('当前没有已通过的视频'); return }
    const names = done.map(t => (t.videoUrl && String(t.videoUrl).split('/').pop()) || t.name || '').filter(Boolean)
    if (!names.length) { Toast.warning('暂无可导出的视频文件'); return }
    try {
      const r = await api.videoExportZip({ names, zip_name: '云眠花园视频', brand })
      if (r?.blob) {
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = r.filename || '云眠花园_视频导出.zip'
        document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500)
        Toast.success(`已导出 ${names.length} 条视频`)
      }
    } catch (e) {
      Toast.error('导出失败：' + (e?.message || e))
    }
  }

  // ====== 已生成视频：多选 + 一键导出 ======
  const toggleSelectVideo = (name) => {
    setSelectedVideos(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })
  }
  const exportSelectedVideos = async () => {
    const names = [...selectedVideos].filter(Boolean)
    if (!names.length) { Toast.warning('请先勾选要导出的视频'); return }
    try {
      const r = await api.videoExportZip({ names, zip_name: '云眠花园视频', brand })
      if (r?.blob) {
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = r.filename || '云眠花园_视频导出.zip'
        document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500)
        Toast.success(`已导出 ${names.length} 条视频`)
        setSelectedVideos(new Set())
      }
    } catch (e) {
      Toast.error('导出失败：' + (e?.message || e))
    }
  }
  const clearSelectedVideos = () => setSelectedVideos(new Set())

  // ====== 批量重新生成 ======
  const regenerateAll = async () => {
    const fails = tasksQueue.filter(t => t.status === STATUS_FAIL)
    if (fails.length) {
      try {
        for (const t of fails) await api.videoRetry({ task_id: t.id }).catch(() => {})
        setTasksQueue(prev => prev.map(t => t.status === STATUS_FAIL ? { ...t, status: STATUS_QUEUED, error: undefined } : t))
        // 重试同样消耗积分 → 立即刷新顶部积分显示
        window.dispatchEvent(new Event('app:refresh-credits'))
        Toast.success(`已重新排队 ${fails.length} 条失败任务`)
      } catch {}
    } else {
      Toast.info('没有需要重新生成的失败任务')
    }
  }

  // ====== 步骤切换 ======
  const goToStep = async (n) => {
    if (n === 2) {
      // 保存并进入下一步：确保 scenes 最新
      reparse(shots)
      if (!shots.some(s => String(s.imagePrompt || s.videoPrompt || s.description || '').trim())) {
        Toast.warning('请至少填写一条分镜提示词')
        return
      }
    }
    if (n === 3) {
      await submitVideos()
      return
    }
    setStep(n)
    window.scrollTo && typeof window.scrollTo === 'function' && window.scrollTo(0, 0)
  }

  // ====== 步骤指示器渲染 ======
  const stepLabels = ['基础配置', '分镜审核', '生成导出']
  const StepIndicator = ({ n }) => {
    const isActive = step === n
    const isDone = step > n
    return (
      <div
        onClick={() => n < step && setStep(n)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: n < step ? 'pointer' : 'default' }}
      >
        <span style={{
          width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${isActive ? '#fff' : isDone ? 'var(--success)' : 'var(--border)'}`,
          background: isActive ? 'var(--success)' : isDone ? 'var(--success)' : 'transparent',
          color: isActive ? '#fff' : isDone ? '#111114' : 'var(--muted-foreground)',
          fontSize: 11, fontWeight: 600, flexShrink: 0, transition: 'all .2s ease',
        }}>
          {isDone ? '✓' : n}
        </span>
        <span style={{ fontSize: 12, color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: isActive ? 600 : 500 }}>
          {stepLabels[n - 1]}
        </span>
      </div>
    )
  }

  const panelStyle = {
    label: { fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 6, display: 'block' },
    groupLabel: { fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6, display: 'block' },
    input: {
      width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13,
      borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-bg-2)',
      color: 'var(--foreground)', outline: 'none',
    },
    textarea: {
      width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13, resize: 'none',
      borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-bg-2)',
      color: 'var(--foreground)', outline: 'none', lineHeight: 1.6,
    },
  }

  // ==================== 渲染 ====================
  return (
    <div className="tk-page-bleed" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ===== 顶部步骤指示条 ===== */}
      <div style={{
        height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)', background: 'var(--surface-bg-2)', padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>批量视频生成</span>
          <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StepIndicator n={1} />
            <span style={{ width: 32, height: 2, background: step > 1 ? 'var(--success)' : 'var(--border)' }} />
            <StepIndicator n={2} />
            <span style={{ width: 32, height: 2, background: step > 2 ? 'var(--success)' : 'var(--border)' }} />
            <StepIndicator n={3} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setShowGenerated('images'); loadGenerated() }}
            style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          ><Icon name="picture" size={14} /> 已生成图片<span style={{ color: 'var(--foreground)', fontFamily: 'ui-monospace, monospace' }}>{generatedImages.length}</span></button>
          <button
            onClick={() => { setShowGenerated('videos'); loadGenerated() }}
            style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          ><Icon name="video" size={14} /> 已生成视频<span style={{ color: 'var(--foreground)', fontFamily: 'ui-monospace, monospace' }}>{generatedVideos.length}</span></button>
        </div>
      </div>

      {/* ToAPIs 服务不可达警告 */}
      {!toapisReachable && (
        <div style={{
          flexShrink: 0, padding: '10px 16px', background: 'rgba(254,44,85,.12)', borderBottom: '1px solid rgba(254,44,85,.28)',
          color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="attention" size={16} />
          <span><b>ToAPIs 视频服务当前不可用</b>（默认域名 toapis.com 无法连接）。视频生成将失败，请联系管理员更换 ToAPIs 域名或在 config.yaml 中配置新的 <code>toapis.base_url</code>。</span>
        </div>
      )}

      {/* ===== 主区：工作区 + 右侧参数面板 ===== */}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* 主工作区 */}
        <section style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* ========== 步骤1：基础配置 ========== */}
          {step === 1 && (
            <div>
              {/* 参考主图上传 */}
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>参考主图上传</h2>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>上传一张包含场景、床品四件套与猫咪的参考主图，AI将以此为基础生成统一风格的分镜画面</p>
                <RefUploadZone image={refImage} onPick={handlePickRef} onClear={handleClearRef} />
                <button
                  onClick={() => openImagePicker('ref')}
                  style={{ marginTop: 10, padding: '6px 14px', borderRadius: 8, border: '1px dashed #fff', background: 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                ><Icon name="picture" size={14} /> 从图库选择图片</button>
              </div>

              {/* 分镜脚本编辑 */}
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>分镜脚本编辑</h2>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>逐镜填写分镜信息，每个分镜将独立生成一条视频</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {shots.map((s, i) => (
                    <div key={i} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-bg-2)', padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>分镜{cnNums[i] || (i + 1)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => autoGenerateScript(i)}
                            disabled={generatingScriptIdx === i || scriptQueue.includes(i)}
                            title="根据预设提示词 + 参考图自动生成该分镜文案"
                            style={{
                              padding: '4px 10px', borderRadius: 8, border: '1px solid color-mix(in srgb, #fff 40%, transparent)',
                              background: 'transparent', color: 'var(--foreground)',
                              fontSize: 12, cursor: generatingScriptIdx === i || scriptQueue.includes(i) ? 'default' : 'pointer',
                              opacity: scriptQueue.includes(i) && generatingScriptIdx !== i ? 0.65 : 1,
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            {generatingScriptIdx === i
                              ? <Spinner size="sm"/>
                              : scriptQueue.includes(i) ? <Icon name="time" size={14} /> : <Icon name="magic" size={14} />}{' '}
                            {generatingScriptIdx === i ? '生成中…' : scriptQueue.includes(i) ? '排队中…' : '生成文案'}
                          </button>
                          <button
                            onClick={() => deleteShot(i)}
                            disabled={shots.length <= 1}
                            title={shots.length <= 1 ? '至少保留一个分镜' : '删除该分镜'}
                            style={{ background: 'transparent', border: 'none', cursor: shots.length <= 1 ? 'not-allowed' : 'pointer', color: 'var(--muted-foreground)', fontSize: 15, opacity: shots.length <= 1 ? 0.4 : 1 }}
                          ><Icon name="close" size={14} /></button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ ...panelStyle.label, fontSize: 11 }}>镜号</label>
                          <HeroInput value={String(i + 1)} onChange={() => {}} isReadOnly className="opacity-60" />
                        </div>
                        <div>
                          <label style={{ ...panelStyle.label, fontSize: 11 }}>时长</label>
                          <HeroSelect value={s.duration} onChange={(v) => updateShot(i, 'duration', v)} options={DURATION_OPTIONS.map(d => ({ value: d, label: d }))} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ ...panelStyle.label, fontSize: 11 }}>图片提示词（用于生成分镜图）</label>
                          <HeroTextArea
 data-shot-image-prompt={i}
 value={s.imagePrompt}
 onChange={(v) => updateShot(i, 'imagePrompt', v)}
 minRows={2}
 maxRows={6}
 autoResize
 placeholder="描述期望生成的分镜图画面…" />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ ...panelStyle.label, fontSize: 11 }}>视频提示词（用于生成视频）</label>
                          <HeroTextArea
 data-shot-video-prompt={i}
 value={s.videoPrompt}
 onChange={(v) => updateShot(i, 'videoPrompt', v)}
 minRows={2}
 maxRows={6}
 autoResize
 placeholder="描述期望生成的视频动态画面…" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addShot}
                    style={{
                      padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--border)',
                      background: 'var(--surface-bg-2)', color: 'var(--muted-foreground)', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >+ 添加分镜</button>
                </div>
              </div>

              {/* 解析结果表格 */}
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>解析结果</h2>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>共 {shots.length} 条分镜，预计总时长 {totalDurationSec}s</p>
                <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <table style={{ width: '100%', textAlign: 'left', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-bg-2)' }}>
                        <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>镜号</th>
                        <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>时长</th>
                        <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--muted-foreground)' }}>提示词</th>
                        <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shots.map((s, i) => (
                        <tr key={i} style={{ borderBottom: i < shots.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <td style={{ padding: '10px 16px', fontFamily: 'ui-monospace, monospace', color: 'var(--foreground)' }}>#{pad2(i + 1)}</td>
                          <td style={{ padding: '10px 16px', fontFamily: 'ui-monospace, monospace', color: 'var(--foreground)' }}>{s.duration}</td>
                          <td style={{ padding: '10px 16px', color: 'var(--foreground)', wordBreak: 'break-word' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div><b style={{ color: 'var(--muted-foreground)', fontWeight: 500 }}>图：</b>{s.imagePrompt || '—'}</div>
                              <div><b style={{ color: 'var(--muted-foreground)', fontWeight: 500 }}>视频：</b>{s.videoPrompt || '—'}</div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', fontSize: 13 }} title="编辑"
                              onClick={() => document.querySelector(`[data-shot-image-prompt="${i}"]`)?.focus()}><Icon name="edit" size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========== 步骤2：分镜审核 ========== */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>分镜图审核</h2>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
                共 <b style={{ color: 'var(--foreground)', fontFamily: 'ui-monospace, monospace' }}>{scenes.length}</b> 张分镜图，已通过{' '}
                <b style={{ color: 'var(--success)', fontFamily: 'ui-monospace, monospace' }}>{frameDoneCount}</b> 张
              </p>
              <div style={{ margin: '0 0 16px', padding: '10px 14px', borderRadius: 10, border: '1px solid color-mix(in srgb, #fff 30%, transparent)', background: 'color-mix(in srgb, #fff 6%, transparent)', fontSize: 12, color: 'var(--foreground)', lineHeight: 1.6, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0 }}><Icon name="lock" size={16} /></span>
                <span>生成的分镜图将<b style={{ color: 'var(--accent)' }}>严格保持参考图中的场景布置、四件套产品（款式/颜色/面料）与猫咪形象完全一致</b>，仅调整镜头景别、构图与动作。</span>
              </div>
              {frameGenProgress && frameGenProgress.running && (
                <div style={{ margin: '0 0 16px', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-bg-2)', fontSize: 12, color: 'var(--foreground)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: 'var(--foreground)' }}><Icon name="time" size={14} /> 分镜图生成中</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--muted-foreground)' }}>
                      {frameGenProgress.total > 1 ? `${frameGenProgress.current || 0} / ${frameGenProgress.total}` : ''}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'rgba(148,163,184,.15)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      background: 'var(--success)',
                      width: `${frameGenProgress.total > 1 ? Math.min(100, Math.round(((frameGenProgress.current || 0) / frameGenProgress.total) * 100)) : 12}%`,
                      transition: 'width .6s ease',
                    }} />
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--muted-foreground)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{frameGenProgress.message || '正在生成…'}</span>
                    <span>{frameGenProgress.total > 1 ? '串行生成，单张约 1-4 分钟' : '单张约 1-4 分钟，请耐心等待'}</span>
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
                {scenes.map((scene, i) => {
                  const frame = frames[scene.idx] || { status: 'idle' }
                  const desc = scene.shot || scene.visual || scene.caption || ''
                  const isSelected = selectedShotIdx === scene.idx
                  return (
                    <div
                      key={scene.idx}
                      onClick={() => setSelectedShotIdx(scene.idx)}
                      style={{
                        borderRadius: 12, border: `1px solid ${isSelected ? '#fff' : 'var(--border)'}`,
                        background: 'var(--surface-bg-2)', padding: 12, cursor: 'pointer', transition: 'all .15s ease',
                      }}
                    >
                      <p
                        onMouseEnter={(e) => setHoverTip({ text: desc, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHoverTip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : { text: desc, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHoverTip(null)}
                        style={{ fontSize: 12, color: 'var(--foreground)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.5, cursor: 'help' }}
                      >{desc}</p>
                      <div style={{ position: 'relative', aspectRatio: '9 / 16', overflow: 'hidden', borderRadius: 8, background: 'var(--surface-bg-2)', marginBottom: 10, border: '1px solid var(--border)' }}>
                        {frame.status === 'done' ? (
                          <img src={ensureFrameUrl(frame.url, brand, account)} alt={`分镜${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : frame.status === 'running' ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <Spinner size="sm"/>
                            <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'ui-monospace, monospace' }}>
                              {fmtFrameElapsed(frameGenProgress, scene.idx)}
                            </span>
                          </div>
                        ) : frame.status === 'fail' ? (
                          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--danger)', fontSize: 12, padding: 8, textAlign: 'center' }} title={frame.error || ''}><Icon name="close" size={16} /> 生成失败{frame.error ? '\n' + frame.error : ''}</div>
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>待绘制</div>
                        )}
                        <span style={{ position: 'absolute', left: 8, top: 8, borderRadius: 6, background: 'rgba(0,0,0,.7)', padding: '2px 6px', fontSize: 10, color: '#fff', fontFamily: 'ui-monospace, monospace', backdropFilter: 'blur(4px)' }}>#{pad2(scene.idx)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // 排队中（尚未开始生成）再次点击 = 取消；否则（重绘/开始绘制）
                            if (frameQueue.includes(scene.idx) && frame.status !== 'running') cancelFrame(scene.idx)
                            else requestGenerate(scene.idx)
                          }}
                          disabled={frame.status === 'running'}
                          style={{
                            flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 12,
                            cursor: frame.status === 'running' ? 'default' : 'pointer',
                            border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)',
                          }}
                        >
                          {frame.status === 'running'
                            ? '绘制中…'
                            : frameQueue.includes(scene.idx)
                              ? '排队中… 取消'
                              : frame.status === 'done' ? <><Icon name="refresh" size={12} /> 重绘</> : frame.status === 'fail' ? '重试' : (step2FirstVisit ? '开始绘制' : <><Icon name="refresh" size={12} /> 重绘</>)}
                        </button>
                        <div style={{ display: 'flex', flexShrink: 0, overflow: 'hidden', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUploadClick(scene.idx) }}
                            title="上传本地图片作为本分镜的视频首帧"
                            style={{
                              padding: '7px 10px', fontSize: 12, cursor: 'pointer',
                              border: 'none', borderRight: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Icon name="upload" size={12} /> 上传图片
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openImagePicker('frame', scene.idx) }}
                            title="从图库选择图片作为本分镜的视频首帧"
                            style={{
                              padding: '7px 8px', fontSize: 12, cursor: 'pointer',
                              border: 'none', background: 'transparent', color: 'var(--muted-foreground)',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <Icon name="picture" size={12} />
                          </button>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: frame.status === 'done' ? 'var(--success)' : frame.status === 'fail' ? 'var(--danger)' : 'var(--muted-foreground)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {frame.status === 'done' ? <><Icon name="check" size={12} /> 已通过</> : frame.status === 'fail' ? <><Icon name="close" size={12} /> 生成失败</> : frame.status === 'running' ? <><Icon name="edit" size={12} /> 绘制中</> : <><Icon name="time" size={12} /> 待审核</>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* 上传分镜图：隐藏 file input，逐镜触发 */}
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleUploadChange}
              />
            </div>
          )}

          {/* ========== 步骤3：生成导出 ========== */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>分镜视频生成</h2>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 16px' }}>
                共 <b style={{ color: 'var(--foreground)', fontFamily: 'ui-monospace, monospace' }}>{scenes.length}</b> 个分镜，
                逐张点击「开始生成」即可单独生成对应视频（模型 / 分辨率见右侧面板）。
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                {scenes.map(scene => {
                  const frame = frames[scene.idx] || {}
                  const hasFrame = frame.status === 'done' && !!frame.url
                  const task = tasksQueue.find(t => t.index === scene.idx)
                  const running = task && (task.status === STATUS_RUNNING || task.status === STATUS_QUEUED)
                  const done = task && task.status === STATUS_SUCCESS
                  const failed = task && task.status === STATUS_FAIL
                  const canceled = task && task.status === STATUS_CANCELED
                  return (
                    <div key={scene.idx} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-bg-2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ position: 'relative', width: '100%', paddingTop: '177.78%', background: '#000' }}>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {done && task.videoUrl ? (
                            <video src={task.videoUrl} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : hasFrame ? (
                            <img src={ensureFrameUrl(frame.url, brand, account)} alt={`分镜${scene.idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ color: 'var(--muted-foreground)', fontSize: 12, textAlign: 'center', padding: 16 }}>请先在第二步<br />生成分镜图</div>
                          )}
                          {(running || failed || canceled) && (
                            <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: failed ? 'rgba(220,38,38,.9)' : canceled ? 'rgba(148,163,184,.85)' : 'rgba(0,0,0,.6)', color: '#fff' }}>
                              {running ? (task.status === STATUS_RUNNING ? '生成中…' : '排队中') : failed ? '生成失败' : '已取消'}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>分镜{cnNums[scene.idx - 1] || scene.idx}</div>
                        <p title={scene.visual || scene.shot || ''} style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34, cursor: 'default' }}>{scene.visual || scene.shot}</p>
                        {running && task && (
                          <div style={{ marginTop: 2 }}>
                            <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                              <div style={{ width: `${task.progress || 0}%`, height: '100%', background: 'var(--success)', transition: 'width .3s ease' }} />
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                              <span>{task.progress >= 95 ? '生成较慢，请稍候…' : '生成中…'}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{task.progress || 0}%</span>
                            </div>
                          </div>
                        )}
                        <Button
                          primary
                          block
                          loading={!!running}
                          disabled={!hasFrame || !!running}
                          onClick={() => submitOneShot(scene.idx)}
                        >
                          {done ? '重新生成' : failed ? '重试' : '开始生成'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* 右侧参数面板（300px） */}
        <aside style={{ width: 300, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid var(--border)', background: 'var(--surface-bg-2)', padding: '16px' }}>

          {/* 步骤1 面板 */}
          {step === 1 && null}

          {/* 步骤2 面板 */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', marginBottom: 14 }}>生图参数</div>
              <div style={{ marginBottom: 14 }}>
                <label style={panelStyle.label}>模型选择</label>
                <ModelSelectDropdown
                  value={nanoModelId}
                  onChange={(id, fullObj) => {
                    setNanoModelId(id)
                    if (fullObj) {
                      const credits = (typeof fullObj.credits === 'number') ? fullObj.credits
                        : (typeof fullObj.credits_per_frame === 'number') ? fullObj.credits_per_frame
                        : MODEL_NANOBANANA2.creditsPerFrame
                      setNanoModelMeta({ id: fullObj.id || fullObj.key || fullObj.model_id || id, label: fullObj.label || fullObj.name || fullObj.display_name || id, creditsPerFrame: credits })
                    } else {
                      setNanoModelMeta(m => ({ ...m, id, label: id }))
                    }
                  }}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={panelStyle.label}>分辨率</label>
                <HeroSelect value={aspectRatio} onChange={setAspectRatio} options={klingAspects.map(a => {
                  const label = a === '16:9' ? '16:9 横屏' : a === '1:1' ? '1:1 方形' : '9:16 竖屏'
                  return { value: label, label }
                })} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={panelStyle.label}>修改意见</label>
                <HeroTextArea minRows={3} maxRows={6} value={shotFeedback} onChange={(v) => setShotFeedback(v)} placeholder="输入修改意见，AI将据此优化生图效果…" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Button theme="light" block onClick={() => requestGenerate(null)}>
                  {step2FirstVisit ? '开始绘制' : '全部重绘'}
                </Button>
                <Button theme="light" block onClick={() => selectedShotIdx != null && requestGenerate(selectedShotIdx)} disabled={selectedShotIdx == null}>
                  选中重绘
                </Button>
              </div>
            </div>
          )}

          {/* 步骤3 面板 */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', marginBottom: 14 }}>视频参数</div>
              <div style={{ marginBottom: 14 }}>
                <label style={panelStyle.label}>模型选择</label>
                <HeroSelect
                  value={videoModel}
                  onChange={(id) => { setVideoModel(id); applyModelCaps(id) }}
                  placeholder="选择视频模型"
                  options={klingModels.map(m => ({ value: m.id, label: formatModelLabel(m.id) }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={panelStyle.label}>分辨率</label>
                <HeroSelect value={resolution} onChange={setResolution} options={klingResolutions.map(r => ({ value: r.id, label: r.label }))} />
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ===== 底部操作栏（60px）===== */}
      <footer style={{
        height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid var(--border)', background: 'var(--surface-bg-2)', padding: '0 20px',
      }}>
        {step === 1 && (
          <>
            <div />
            <div style={{ display: 'flex', gap: 12 }}>
              <Button theme="light" onClick={() => { reparse(shots); Toast.success('已刷新解析结果') }}><Icon name="fileText" size={14} /> 解析脚本</Button>
              <Button primary size="large" onClick={() => goToStep(2)}>保存并进入下一步 <Icon name="right" size={14} /></Button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <Button theme="light" onClick={() => setStep(1)}><Icon name="left" size={14} /> 上一步</Button>
            <Button primary onClick={() => setStep(3)}>下一步 <Icon name="right" size={14} /></Button>
          </>
        )}
        {step === 3 && (
          <>
            <Button theme="light" onClick={() => setStep(2)}><Icon name="left" size={14} /> 上一步</Button>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button theme="light" onClick={submitVideos} loading={submitting}><Icon name="video" size={14} /> 批量生成全部</Button>
              <Button theme="light" onClick={regenerateAll}><Icon name="refresh" size={14} /> 批量重新生成</Button>
              <Button theme="light" onClick={exportVideos}><Icon name="download" size={14} /> 批量导出</Button>
            </div>
          </>
        )}
      </footer>

      {/* ===== 视频预览浮层 ===== */}
      {previewTask && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }}
          onClick={() => setPreviewTask(null)}
        >
          <div style={{ width: 480, maxWidth: '92vw', borderRadius: 16, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 12 }}>视频预览 · {previewTask.title || ''}</div>
            <div style={{ borderRadius: 10, overflow: 'hidden', background: '#000', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '62vh' }}>
              {previewTask.status === STATUS_SUCCESS && previewTask.videoUrl ? (
                <video src={previewTask.videoUrl} controls autoPlay style={{ maxWidth: '100%', maxHeight: '62vh', width: 'auto', height: 'auto', display: 'block', margin: '0 auto' }} />
              ) : (
                <div style={{ color: 'var(--muted-foreground)', fontSize: 12, padding: 40 }}>{previewTask.status === STATUS_FAIL ? '⚠️ ' + (previewTask.error || '生成失败') : '视频尚未生成'}</div>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.7, marginBottom: 12 }}>
              <b style={{ color: 'var(--muted-foreground)' }}>Prompt：</b>{previewTask.prompt || ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button theme="light" onClick={() => setPreviewTask(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 分镜文案 hover 完整展示浮层 ===== */}
      {hoverTip && (
        <div
          style={{
            position: 'fixed', left: hoverTip.x + 14, top: hoverTip.y + 14, zIndex: 2000,
            maxWidth: 360, background: 'rgba(15,17,22,.96)', color: '#f5f5f7',
            fontSize: 12, lineHeight: 1.6, padding: '10px 12px', borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)',
            wordBreak: 'break-word', whiteSpace: 'pre-wrap', pointerEvents: 'none',
          }}
        >{hoverTip.text}</div>
      )}

      {/* ===== 已生成图片/视频面板 ===== */}
      {showGenerated && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }} onClick={() => setShowGenerated(null)}>
          <div style={{ width: 720, maxWidth: '92vw', maxHeight: '82vh', overflowY: 'auto', borderRadius: 16, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={showGenerated === 'images' ? 'picture' : 'video'} size={16} />
                {showGenerated === 'images' ? '已生成图片' : '已生成视频'}
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)', marginLeft: 8, fontWeight: 400 }}>
                  共 {showGenerated === 'images' ? generatedImages.length : generatedVideos.length} 个
                </span>
                {showGenerated === 'videos' && selectedVideos.size > 0 && (
                  <Button size="small" theme="solid" onClick={exportSelectedVideos} style={{ marginLeft: 10 }}>
                    <Icon name="download" size={12} /> 一键导出（{selectedVideos.size}）
                  </Button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {showGenerated === 'videos' && selectedVideos.size > 0 && (
                  <button onClick={clearSelectedVideos} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 12 }}>取消选择</button>
                )}
                <button onClick={() => setShowGenerated(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="关闭"><Icon name="close" size={18} /></button>
              </div>
            </div>
            {showGenerated === 'images' ? (
              generatedImages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>暂无已生成的分镜图</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
                  {generatedImages.map(im => (
                    <div key={im.name} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-bg-2)' }}>
                      {/* 显示走缩略图；im.url 本身是原图，仍用于「用作参考图」提交后端 */}
                      <img src={api.thumbOf(im.url)} alt={im.name} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                      <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--muted-foreground)', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <span>{fmtDay(im.mtime)}</span>
                        <button onClick={() => onPickerSelect(im)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>用作参考图</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              generatedVideos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>暂无已生成的视频</div>
              ) : (
                <div style={{
                  display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, auto)',
                  gridAutoColumns: '185px', gap: 12, overflowX: 'auto', paddingBottom: 8,
                }}>
                  {generatedVideos.map(v => {
                    const vSel = selectedVideos.has(v.name)
                    return (
                      <div key={v.name} onClick={() => toggleSelectVideo(v.name)}
                        style={{
                          borderRadius: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                          border: `1px solid ${vSel ? '#fff' : 'var(--border)'}`,
                          background: 'var(--surface-bg-2)',
                          boxShadow: vSel ? '0 0 0 2px var(--border-strong)' : 'none',
                        }}>
                        <video
                          src={v.url}
                          controls
                          onLoadedMetadata={(e) => {
                            const d = e.currentTarget.duration
                            if (d && isFinite(d)) setGenDurations(prev => ({ ...prev, [v.name]: d }))
                          }}
                          style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', background: '#000' }}
                        />
                        <div style={{ padding: '4px 6px', fontSize: 10, color: 'var(--muted-foreground)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmtDur(genDurations[v.name])}</span>
                          <span>{fmtDay(v.mtime)}</span>
                        </div>
                        {v.credits_used != null && (
                          <div style={{ padding: '0 6px 6px', fontSize: 10, fontWeight: 600, color: 'var(--foreground)' }}>
                            视频消耗积分：<span style={{ fontFamily: 'ui-monospace, monospace' }}>{v.credits_used}</span>
                          </div>
                        )}
                        <span style={{
                          position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 6,
                          background: vSel ? 'var(--tk-brand-gradient)' : 'rgba(0,0,0,.55)',
                          color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900,
                          border: '1px solid rgba(255,255,255,.3)',
                        }}>{vSel ? <Icon name="check" size={12} /> : ''}</span>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ===== 图库选择器 ===== */}
      {showImagePicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }} onClick={() => setShowImagePicker(false)}>
          <div style={{ width: 760, maxWidth: '92vw', maxHeight: '82vh', overflowY: 'auto', borderRadius: 16, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="picture" size={16} /> {pickerMode === 'frame' ? `从图库选择分镜${pad2(pickerFrameIdx)}首帧` : '从图库选择参考图'}
              </div>
              <button onClick={() => setShowImagePicker(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="关闭"><Icon name="close" size={18} /></button>
            </div>
            {pickerLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spinner size="sm"/></div>
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
                  const images = bucket?.images || []
                  return images.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>该图库暂无图片</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
                      {images.map(im => (
                        <div key={im.name} onClick={() => onPickerSelect(im)} style={{ cursor: 'pointer', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-bg-2)' }} title={im.name}>
                          {/* 显示走缩略图；im.url 本身是原图，仍用于「用作参考图」提交后端 */}
                          <img src={api.thumbOf(im.url)} alt={im.name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                          <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{im.name}</div>
                        </div>
                      ))}
                    </div>
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
