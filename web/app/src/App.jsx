import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles/tiktok-tokens.css'
import './styles/mini-ui.css'
import './App.css'
import brandLogo from './assets/brand-logo.jpg'
import { DesignStudio, ResultsLibrary, Import1688Page } from './pages/DesignStudio'
import VideoBatchStudio from './pages/VideoBatchStudio'
import VideoReplicate from './pages/VideoReplicate'
import { VideoLibrary } from './pages/VideoLibrary'
import { TemplateGen } from './pages/TemplateStudio'
import AiChat from './pages/AiChat'
import SuiteGenerator from './pages/SuiteGenerator'
import { ImageGen } from './pages/ImageGen'
import Icon from './components/Icon'
import PageErrorBoundary from './components/PageErrorBoundary'
import api from './api'
import { activeTabKey, migrateLegacyRecords, brandPerms } from './accountKeys'

// ── 全局 ErrorBoundary：防止任何子组件崩溃导致整个应用白屏/卡死 ──
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, errorInfo) {
    console.error('[AppErrorBoundary] 子组件崩溃:', error, errorInfo)
    this.setState({ errorInfo })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 32, background: 'var(--background)', color: 'var(--foreground)' }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>页面出错了</div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', textAlign: 'center', maxWidth: 480 }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            type="button"
            onClick={() => { this.setState({ error: null, errorInfo: null }); window.location.reload() }}
            style={{ padding: '8px 24px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-secondary)', color: 'var(--foreground)', cursor: 'pointer', fontSize: 13 }}
          >
            刷新页面
          </button>
          <button
            type="button"
            onClick={() => this.setState({ error: null, errorInfo: null })}
            style={{ padding: '8px 24px', borderRadius: 12, border: 'none', background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 13 }}
          >
            忽略并继续
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// HeroUI v3 shell components
import {
  Badge,
  Button as HeroButton,
  Card,
  Chip,
  Description,
  Input as HeroInput,
  Separator,
  Spinner,
  Surface,
  Switch,
  Tabs,
  Tooltip,
} from '@heroui/react'

const APP_NAME = '云眠花园'
const APP_SUB = '电商工具'

const DEFAULT_BRAND = 'cloudsleepgarden'

// —— 假登录：账号与品牌权限（一台设备只登一次，存 localStorage）——
const AUTH_KEY = 'ydp.auth.v1'
function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null') } catch { return null }
}
function saveAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)) } catch {} }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY) } catch {} }
const USER_PWD = '123456'
const FALLBACK_BRANDS = [
  { key: 'cloudsleepgarden', label: '云眠花园' },
  { key: 'sofawithcat', label: '软居与猫' },
  { key: 'lyrosdream', label: 'Luluna月下谣' },
  { key: 'oblachny_sad', label: 'Облачный Сад' },
  { key: 'wuduomian', label: '五朵棉袜子' },
]

// 搜索框（HeroUI Input 封装）
function TkSearch({ value, onChange, placeholder, onSubmit }) {
  return (
    <div className="tk-top-search">
      <span className="ico"><Icon name="search" size={16} /></span>
      <input
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange && onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit && onSubmit(e.target.value) }}
      />
      <button className="kbd">⌘K</button>
    </div>
  )
}

// 品牌切换下拉（相对定位，不用 portal —— 避免 HeroUI Popover 与 Semi UI ConfigProvider 的 z-index/事件冲突）
function BrandSwitcher({ brands, brand, onChange }) {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const ref = useRef(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const list = (Array.isArray(brands) && brands.length > 0) ? brands : [
    { key: 'cloudsleepgarden', label: '云眠花园' },
    { key: 'sofawithcat',     label: '软居与猫' },
    { key: 'lyrosdream',      label: 'Luluna月下谣' },
    { key: 'oblachny_sad',    label: 'Облачный Сад' },
    { key: 'wuduomian',       label: '五朵棉袜子' },
  ]
  const current = list.find(b => b.key === brand) || list[0]

  const handleSelect = (key) => {
    if (switching) return // 防止重复点击
    setOpen(false)
    console.log('[BrandSwitcher] 用户选择:', key, '当前品牌:', brand)
    try {
      if (onChange) onChange(key)
      console.log('[BrandSwitcher] onChange 已调用, 新品牌应为:', key)
    } catch (e) {
      console.error('[BrandSwitcher] 切换品牌时出错:', e)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !switching && setOpen(v => !v)}
        className={`flex h-8 items-center gap-1.5 rounded-(--radius-lg) border border-(--border) bg-(--surface-secondary) px-3 py-1 text-[13px] font-medium text-(--foreground) outline-none transition-colors hover:border-(--border-strong) ${switching ? 'opacity-60 cursor-wait' : ''}`}
        disabled={switching}
      >
        <span>{current?.label || '选择店铺'}</span>
        {switching
          ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-(--muted-foreground) border-t-transparent" />
          : <Icon name="down" size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        }
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[99999] mt-1.5 min-w-[160px] flex flex-col gap-0.5 rounded-(--radius-xl) border border-(--border) bg-(--surface) p-1.5 shadow-(--surface-shadow)">
          {list.map(b => {
            const active = b.key === brand
            return (
              <button
                key={b.key}
                type="button"
                disabled={switching && !active}
                onClick={() => handleSelect(b.key)}
                className={[
                  'flex w-full items-center gap-2 rounded-(--radius-lg) px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors',
                  active
                    ? 'bg-(--accent-soft) text-(--accent)'
                    : 'text-(--foreground) hover:bg-(--surface-secondary)',
                  switching && !active ? 'cursor-wait opacity-50' : '',
                ].join(' ')}
              >
                {active && <Icon name="check" size={14} />}
                <span>{b.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 性能红线（「切换品牌卡死 → 网页崩溃」的根因防线）────────────────────────
// DesignStudio(3208行) / VideoBatchStudio(2056) / AiChat(1162) / VideoReplicate(1075)
// / ImageGen(765) 五个页面在 App 里是**常驻挂载**的（用 display:none 保活后台任务，
// 例如长达数分钟的视频生成队列）。代价是：App 的任何一次 state 变化都会让它们
// 全部跟着重渲染。配合 App 层的后端状态轮询（3s）/ 积分轮询 / 运行时长计时，
// 主线程会被持续占满，切换品牌时 5 个页面同时 key-remount，直接卡死并 OOM 崩溃。
// 解法：用 React.memo 切断这条传导链 —— 只要 brand / account / brandsMeta 没变，
// 页面就不重渲染。注意 onSwitchTab 必须用 useCallback 稳定引用，否则 memo 失效。
const MemoDesignStudio    = React.memo(DesignStudio)
const MemoVideoBatchStudio = React.memo(VideoBatchStudio)
const MemoVideoReplicate  = React.memo(VideoReplicate)
const MemoImageGen        = React.memo(ImageGen)
const MemoAiChat          = React.memo(AiChat)
const MemoSuiteGenerator  = React.memo(SuiteGenerator)

const TAB_KEY_STUDIO = 'studio'
const TAB_KEY_RESULTS = 'results'
const TAB_KEY_1688 = 'import1688'   // 1688链接导入
const TAB_KEY_VIDEO = 'video_batch' // 生成视频（原 AI 视频批量生成）
const TAB_KEY_VIDEOLIB = 'video_lib' // 视频库
const TAB_KEY_REPLICATE = 'video_replicate' // 复刻视频
const TAB_KEY_TEMPLATE = 'template'  // 模版合成
const TAB_KEY_IMGGEN = 'image_gen'   // 图片生成（AI 聊天式生图，一级独立页）
const TAB_KEY_CHAT = 'ai_chat'      // AI 大模型对话
const TAB_KEY_SUITE = 'suite_gen'   // 套图生成（豆包 function-calling Agent）

// 主导航分组（icon 使用 iconpark 图标名）
const NAV_GROUPS = [
  {
    label: '图片生成',
    icon: 'picture',
    items: [
      { key: TAB_KEY_STUDIO,  label: '主图合成',   icon: 'picture' },
      { key: TAB_KEY_SUITE,   label: '套图生成',   icon: 'magic',       hot: true },
      { key: TAB_KEY_IMGGEN,  label: '图片生成',   icon: 'wand',        hot: true },
      { key: TAB_KEY_TEMPLATE,label: '模版合成',   icon: 'adjustment' },
      { key: TAB_KEY_RESULTS, label: '图库',       icon: 'imageFiles' },
    ],
  },
  {
    label: '视频生成',
    icon: 'video',
    items: [
      { key: TAB_KEY_VIDEO,   label: '生成视频',     icon: 'video',   hot: true },
      { key: TAB_KEY_REPLICATE,label: '复刻视频',    icon: 'copy' },
      { key: TAB_KEY_VIDEOLIB,label: '视频库',       icon: 'play' },
    ],
  },
  {
    label: '其他功能',
    icon: 'more',
    items: [
      { key: TAB_KEY_CHAT,    label: '云眠AI',       icon: 'message' },
      { key: TAB_KEY_1688,    label: '1688链接导入', icon: 'link' },
    ],
  },
]

function TkSideNav({ activeKey, onKeyChange, counts, auth, onLogout }) {
  return (
    <Surface
      variant="default"
      className="flex h-full w-[220px] shrink-0 flex-col rounded-(--radius-2xl) border border-(--border) bg-(--surface) shadow-(--surface-shadow)"
      aria-label="主导航"
    >
      {/* 品牌区：Logo + 名称 */}
      <div className="flex items-center gap-3 border-b border-(--border) p-4">
        <img
          src={brandLogo}
          alt={APP_NAME}
          title={APP_NAME}
          className="h-10 w-10 rounded-(--radius-lg) object-cover"
          onError={(e) => {
            const el = e.currentTarget
            const ph = document.createElement('div')
            ph.className = 'grid h-10 w-10 place-items-center rounded-(--radius-lg) bg-(--surface-tertiary) text-sm font-bold text-(--foreground)'
            ph.textContent = '云'
            el.parentNode && el.parentNode.replaceChild(ph, el)
          }}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-bold text-(--foreground)">{APP_NAME}</span>
          <span className="text-xs text-(--muted)">{APP_SUB}</span>
        </div>
      </div>

      {/* 导航区 */}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label || `g_${gi}`} className="flex flex-col gap-1">
            <span className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--muted)">
              {group.label}
            </span>
            {group.items.map(item => {
              const active = activeKey === item.key
              const count = counts?.[item.key]
              return (
                <HeroButton
                  key={item.key}
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  fullWidth
                  className="h-9 justify-start gap-2 px-3 text-left text-[13px]"
                  onPress={() => onKeyChange && onKeyChange(item.key)}
                  title={item.label}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="flex-1">{item.label}</span>
                  {typeof count === 'number' && count > 0 && (
                    <Chip size="sm" variant="secondary" color="default">{count}</Chip>
                  )}
                </HeroButton>
              )
            })}
          </div>
        ))}
      </nav>

      {/* 底部：当前账号 + 退出登录 */}
      <div className="flex flex-col gap-2 border-t border-(--border) p-3">
        <HeroButton variant="secondary" size="sm" fullWidth onPress={onLogout}>
          <Icon name="logout" size={14} /> 退出登录
        </HeroButton>
      </div>
    </Surface>
  )
}

// 假登录层：首次打开 / 已退出时显示（仅密码登录，131418→云眠A，123456→云眠B）
function LoginScreen({ onLogin }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const handleLoginPw = () => {
    const p = pw.trim()
    if (p === '131418') {
      onLogin({ type: 'a', name: '云眠A' })
    } else if (p === USER_PWD) {
      onLogin({ type: 'b', name: '云眠B' })
    } else {
      setErr('密码错误，请重试')
    }
  }

  return (
    <div className="app-hero grid min-h-screen w-full place-items-center p-6" data-brand={DEFAULT_BRAND}>
      <Card variant="secondary" className="w-[420px] max-w-[92vw]">
        <Card.Header className="flex-col items-start gap-1">
          <div className="mb-1 flex items-center gap-3">
            <img
              src={brandLogo}
              alt={APP_NAME}
              className="h-10 w-10 rounded-(--radius-lg) object-cover"
              onError={(e) => {
                const el = e.currentTarget
                const ph = document.createElement('div')
                ph.className = 'grid h-10 w-10 place-items-center rounded-(--radius-lg) bg-(--surface-tertiary) text-sm font-bold text-(--foreground)'
                ph.textContent = '云'
                el.parentNode && el.parentNode.replaceChild(ph, el)
              }}
            />
            <div className="flex flex-col">
              <span className="text-base font-bold text-(--foreground)">{APP_NAME}</span>
              <span className="text-xs text-(--muted)">{APP_SUB}</span>
            </div>
          </div>
          <Card.Title>请输入密码登录</Card.Title>
          <Description>登录信息仅保存在本机，一台设备只需登录一次</Description>
        </Card.Header>

        <Card.Content className="flex-col gap-3">
          <HeroInput
            autoFocus
            type="password"
            value={pw}
            placeholder="默认密码 123456"
            onChange={(e) => { setPw(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLoginPw() }}
          />
          {err && <span className="text-xs text-(--danger)">{err}</span>}
          <HeroButton variant="primary" fullWidth onPress={handleLoginPw}>登录</HeroButton>
        </Card.Content>
      </Card>
    </div>
  )
}


// 简单 toast（页面右下角浮层，3s 自动消失；失败 6s）
function useToast() {
  const [items, setItems] = useState([])
  const push = (msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setItems(prev => [...prev, { id, msg, kind }])
    setTimeout(() => {
      setItems(prev => prev.filter(x => x.id !== id))
    }, kind === 'error' ? 6000 : 3000)
  }
  const ToastLayer = () => (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {items.map(it => (
        <div key={it.id} style={{
          minWidth: 220, maxWidth: 420, padding: '10px 14px', borderRadius: 10,
          background: it.kind === 'error'
            ? 'rgba(254,44,85,.96)' : it.kind === 'success'
              ? 'rgba(37,244,238,.96)' : 'rgba(24,24,27,.92)',
          color: it.kind === 'error' || it.kind === 'success' ? '#111114' : '#fff',
          boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          fontSize: 13, fontWeight: 500, lineHeight: 1.45,
        }}>
          {it.msg}
        </div>
      ))}
    </div>
  )
  return [push, ToastLayer]
}

export default function App() {
  // ── 版本诊断：在控制台可见，确认用户加载了最新代码 ──
  console.log('[App] v2026-08-31-remount-fix 已加载 | 品牌切换不再整树重建(memo+去key) | uptime 15s')
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem(activeTabKey()) || TAB_KEY_STUDIO } catch { return TAB_KEY_STUDIO }
  })
  // 稳定引用：传给常驻页面的 onSwitchTab，避免 React.memo 被每次新建的箭头函数击穿
  const handleSwitchTab = useCallback((k) => setActiveTab(k), [])
  const [buckets, setBuckets] = useState({ mains: 0, cats: 0, synthesized: 0, template_results: 0 })
  const [engineStatus, setEngineStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [credits, setCredits] = useState(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [imageCredits, setImageCredits] = useState(null)
  const [videoCredits, setVideoCredits] = useState(null)
  const [llmCredits, setLlmCredits] = useState(null)
  const [llmBalanceCny, setLlmBalanceCny] = useState(null)
  const [creditsMessage, setCreditsMessage] = useState('')
  const [creditsDegraded, setCreditsDegraded] = useState(false)
  const [doubao, setDoubao] = useState(null) // 豆包（火山方舟 Ark）连通/余额状态

  // 品牌：优先读 localStorage（用户上次手动选的品牌），否则用 DEFAULT_BRAND
  const [brand, setBrand] = useState(() => {
    try {
      const saved = localStorage.getItem('ymhy_current_brand')
      if (saved && VALID_BRAND_KEY(saved)) return saved
    } catch {}
    return DEFAULT_BRAND
  })
  const [brandsMeta, setBrandsMeta] = useState([])
  // 假登录状态：null = 未登录（显示登录层）
  const [auth, setAuth] = useState(() => loadAuth())
  const handleLogin = (acc) => {
    const a = { type: acc.type, name: acc.name || (acc.type === 'a' ? '云眠A' : '云眠B') }
    saveAuth(a)
    setAuth(a)
  }
  const handleLogout = () => {
    clearAuth()
    setAuth(null)
    setBrand(DEFAULT_BRAND)
  }

  // 后端进程控制：/__backend__/* 仅 Vite dev mode 生效（apply: 'serve'）
  // - backendCtrlStatus: { online, started_by_vite, pid, uptime_sec, log_tail } 或 null（未知/非 dev）
  // - backendCtrlError: 非 dev 或接口 404 时设为 string，隐藏 Switch
  const [backendCtrlStatus, setBackendCtrlStatus] = useState(null)
  const [backendCtrlError, setBackendCtrlError] = useState(null)
  const [backendStarting, setBackendStarting] = useState(false)
  const [backendStopping, setBackendStopping] = useState(false)
  const [backendRestarting, setBackendRestarting] = useState(false)
  // 非 Vite 场景（桌面 .app）前端自计时：engineStatus 第一次 ready 起开始累计"已连接"时长
  const [uptimeSec, setUptimeSec] = useState(0)
  const [uptimeReadyAt, setUptimeReadyAt] = useState(null)
  const [toastPush, ToastLayer] = useToast()
  // 账号数据迁移（首次运行把旧记录复制进两个账号，幂等）
  migrateLegacyRecords()
  // 同步当前登录账号给 api 层，使所有后端请求附带 ?account= 实现图片/记录数据隔离
  useEffect(() => { api.setAccount(auth?.type) }, [auth])

  // 加载品牌元数据
  useEffect(() => {
    let mounted = true
    api.brands().then(r => {
      if (!mounted) return
      const list = Array.isArray(r?.brands) ? r.brands : []
      setBrandsMeta(list)
      // 只在当前 brand 无效时才回退到后端 default（不覆盖用户上次手动选的 brand）
      if (!VALID_BRAND_KEY(brand) && r?.default && VALID_BRAND_KEY(r.default)) setBrand(r.default)
    }).catch(() => {})
    return () => { mounted = false }
  }, [auth?.type])

  // 账号可见品牌：按账号权限过滤（云眠A见全部，云眠B不见软居与猫）
  const availableBrands = useMemo(() => {
    if (!auth) return []
    const keys = brandPerms(auth.type)
    const meta = (brandsMeta && brandsMeta.length) ? brandsMeta : FALLBACK_BRANDS
    return meta.filter(b => keys.includes(b.key))
  }, [auth, brandsMeta])

  // 品牌初始化：仅在首次加载且 brand 为空时设置默认值
  // （已移除旧逻辑：不再根据 auth.type 强制锁定品牌 —— 用户应能自由切换）
  useEffect(() => {
    if (auth && !brand) {
      const preferred = DEFAULT_BRAND
      if (VALID_BRAND_KEY(preferred)) setBrand(preferred)
    }
  }, [auth])

  // 当前 brand 持久化：刷新后保留用户选的店铺（而不是回到云眠花园默认值）
  useEffect(() => {
    try { if (brand) localStorage.setItem('ymhy_current_brand', brand) } catch {}
  }, [brand])

  // 当前激活 Tab 持久化：刷新后保持在离开前的模块
  useEffect(() => {
    try { if (auth?.type) localStorage.setItem(activeTabKey(), activeTab) } catch {}
  }, [activeTab])

  useEffect(() => {
    let t
    const probe = async () => {
      try {
        const h = await api.health()
        // 返回同一个值 → React 跳过重渲染
        setEngineStatus(prev => (prev === 'ready' ? prev : 'ready'))
        // 只在数值真的变化时更新：health 每 8s 轮询一次，无脑 setBuckets(新对象)
        // 会让整个 App（含 5 个常驻巨型页面）每 8 秒全量重渲染一次
        const nb = h.buckets || { mains: 0, cats: 0, synthesized: 0, template_results: 0 }
        setBuckets(prev => {
          const keys = ['mains', 'cats', 'synthesized', 'template_results']
          if (prev && keys.every(k => (prev[k] ?? 0) === (nb[k] ?? 0))) return prev
          return nb
        })
      } catch (e) {
        setEngineStatus('down')
      }
    }
    probe()
    t = setInterval(probe, 8000)
    return () => clearInterval(t)
  }, [])

  // 查询 NanoBanana 账户剩余积分（首次加载 + 每 5 分钟刷新一次；生成视频/图片成功后立即刷新一次）
  useEffect(() => {
    let t
    let mounted = true
    const load = async () => {
      setCreditsLoading(true)
      try {
        const r = await api.credits()
        if (!mounted) return
        setCredits(r.total_credits ?? 0)
        setImageCredits(r.image_credits ?? null)
        setVideoCredits(r.video_credits ?? null)
        setLlmCredits(r.llm_credits ?? null)
        setLlmBalanceCny(r.llm_balance_cny ?? null)
        setCreditsDegraded(r.degraded || false)
        setCreditsMessage(r.message || '')
      } catch (e) {
        if (mounted) {
          setCredits(null)
          setImageCredits(null)
          setVideoCredits(null)
          setLlmCredits(null)
          setLlmBalanceCny(null)
          setCreditsDegraded(false)
          setCreditsMessage('')
        }
      } finally {
        if (mounted) setCreditsLoading(false)
      }
    }
    load()
    t = setInterval(load, 300000) // 5 分钟轮询，避免频繁请求上游触发限流
    const onRefreshCredits = () => { load() }
    window.addEventListener('app:refresh-credits', onRefreshCredits)
    return () => {
      mounted = false
      clearInterval(t)
      window.removeEventListener('app:refresh-credits', onRefreshCredits)
    }
  }, [])

  // 豆包（火山方舟 Ark）状态：加载时拉一次 + 生成后（积分刷新事件）再拉一次，不挂 5 分钟轮询
  useEffect(() => {
    let mounted = true
    const loadDoubao = async () => {
      try {
        const r = await api.doubaoStatus()
        if (mounted) setDoubao(r)
      } catch (e) {
        if (mounted) setDoubao({ ok: false, model: '', latency_ms: null, message: '豆包状态获取失败', balance: null, balance_source: null, needs_ak_sk: false })
      }
    }
    loadDoubao()
    const onRefresh = () => loadDoubao()
    window.addEventListener('app:refresh-credits', onRefresh)
    return () => {
      mounted = false
      window.removeEventListener('app:refresh-credits', onRefresh)
    }
  }, [])

  // dev 模式后端状态接口自带 uptime_sec（每 3s 刷新），此时不需要本地计时
  const backendHasUptime = !!(backendCtrlStatus && backendCtrlStatus.uptime_sec)

  // 非 Vite 场景（桌面 .app）自计后端已连接时长：engineStatus 第一次变 ready 起算，断开自动归零
  // ⚠️ 性能红线：这里原来是 1000ms。每次 tick 都 setState，会让整个 App 每秒重渲染一次，
  // 而 DesignStudio / VideoBatchStudio / ImageGen / AiChat / VideoReplicate 五个巨型页面
  // 是常驻挂载的（display:none 保活后台任务），会跟着全量重渲染 ——
  // 用户切换品牌时 5 个页面同时 remount + 高频重渲染 → 主线程饱和卡死 → 渲染进程 OOM 崩溃。
  // 运行时长只出现在一个 hover 提示文案里，完全不需要秒级精度，故放宽到 15s。
  useEffect(() => {
    let t
    if (engineStatus === 'ready') {
      if (uptimeReadyAt == null) { setUptimeReadyAt(Date.now()); return }
      if (backendHasUptime) return // dev：直接用后端返回的 uptime_sec
      t = setInterval(() => {
        setUptimeSec(uptimeReadyAt ? Math.max(0, Math.floor((Date.now() - uptimeReadyAt) / 1000)) : 0)
      }, 15000)
    } else if (engineStatus === 'down') {
      setUptimeReadyAt(null); setUptimeSec(0)
    }
    return () => { if (t) clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineStatus, uptimeReadyAt, backendHasUptime])

  // ====== 后端进程控制（开关 / 重启）======
  // 控件显示策略（保证永远不会"不见"）：
  // - 只要页面加载后 backend 状态有过一次结论（ready/down），就显示 pill；
  // - Switch 开关 + handleBackendToggle/handleBackendRestart 真正能启停后端只在 Vite dev 场景（isViteCtrl=true）；
  // - 桌面 .app 场景（isViteCtrl=false）：Switch 隐藏，"↻" 变成刷新页面按钮，提示用户"双击桌面图标重启后端"
  const isViteCtrl = !!backendCtrlStatus || (!backendCtrlError && api.isDev)
  const showBackendPill =
    backendCtrlStatus != null || backendCtrlError != null || engineStatus !== 'loading'
  const backendOnline_ = !!(backendCtrlStatus && backendCtrlStatus.online) || engineStatus === 'ready'
  // —— 以下几行必须在 backendFinalUptime 之前，避免 TDZ
  const backendOnline = !!(backendCtrlStatus && backendCtrlStatus.online) || engineStatus === 'ready'
  const backendSwitchOn = backendOnline || backendStarting
  const backendByUs = !!(backendCtrlStatus && backendCtrlStatus.started_by_vite)
  const backendPid = backendCtrlStatus?.pid || null
  const backendUptimeSec = backendCtrlStatus?.uptime_sec || 0
  const backendFinalUptime = backendUptimeSec || uptimeSec || 0
  function fmtUptime(s) {
    if (!s || s < 60) return `${s || 0}s`
    const m = Math.floor(s / 60); const sec = s % 60
    if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`
    const h = Math.floor(m / 60); const mm = m % 60
    return mm ? `${h}h ${mm}m` : `${h}h`
  }

  // 轮询 /__backend__/status（首次 + 每 3s）
  useEffect(() => {
    let t
    let mounted = true
    const probe = async () => {
      try {
        const r = await api.backendStatus()
        if (!mounted) return
        setBackendCtrlStatus(r)
        setBackendCtrlError(null)
      } catch (e) {
        if (!mounted) return
        // 404 或 fetch error → 非 dev 模式，或 vite.config.js 没装插件 → 隐藏控件
        const msg = String(e?.message || e || '')
        if (/404|未找到|not found/i.test(msg) || !api.isDev) {
          setBackendCtrlError(api.isDev ? 'backend-control-404' : 'not-dev')
        }
        setBackendCtrlStatus(null)
      }
    }
    probe()
    t = setInterval(probe, 3000)
    return () => { mounted = false; clearInterval(t) }
  }, [])

  // 是否"由我们控制的开关状态"：如果 started_by_vite=false 但 online=true（用户手动启动），Switch 也显示开；但切换会按端口兜底 kill

  const handleBackendToggle = async (checked) => {
    if (backendStarting || backendStopping || backendRestarting) return
    if (checked) {
      // → 开：POST /start
      setBackendStarting(true)
      try {
        const r = await api.backendStart()
        toastPush(r?.message || '后端已连接', 'success')
      } catch (e) {
        const msg = String(e?.message || e)
        toastPush(`后端启动失败：${msg}`, 'error')
      } finally {
        setBackendStarting(false)
        // 立即刷新一次状态
        try { const r = await api.backendStatus(); setBackendCtrlStatus(r) } catch { /* ignore */ }
      }
    } else {
      // → 关：POST /stop
      setBackendStopping(true)
      try {
        const r = await api.backendStop()
        toastPush(r?.message || '后端已断开', 'info')
      } catch (e) {
        const msg = String(e?.message || e)
        toastPush(`停止失败：${msg}`, 'error')
      } finally {
        setBackendStopping(false)
        try { const r = await api.backendStatus(); setBackendCtrlStatus(r) } catch { /* ignore */ }
      }
    }
  }

  const handleBackendRestart = async () => {
    if (backendStarting || backendStopping || backendRestarting) return
    setBackendRestarting(true)
    try {
      // 先 stop 再 start
      const stopRes = await api.backendStop().catch(() => null)
      await new Promise(r => setTimeout(r, 350))
      const startRes = await api.backendStart()
      toastPush(startRes?.message || stopRes?.message || '后端已重启', 'success')
    } catch (e) {
      const msg = String(e?.message || e)
      toastPush(`重启失败：${msg}`, 'error')
    } finally {
      setBackendRestarting(false)
      try { const r = await api.backendStatus(); setBackendCtrlStatus(r) } catch { /* ignore */ }
    }
  }

  const statusDot = useMemo(() => {
    if (engineStatus === 'ready') return { color: '#17c964', text: '后端已连接' }
    if (engineStatus === 'down') return { color: 'var(--danger)', text: '后端未连接' }
    return { color: 'var(--tk-cyan-500)', text: '连接中…' }
  }, [engineStatus])

  const counts = useMemo(() => ({
    [TAB_KEY_STUDIO]: 0,
    [TAB_KEY_TEMPLATE]: 0,
    [TAB_KEY_RESULTS]: buckets.synthesized || 0,
    [TAB_KEY_VIDEO]: 0,
    [TAB_KEY_VIDEOLIB]: 0,
    [TAB_KEY_CHAT]: 0,
    [TAB_KEY_1688]: 0,
  }), [buckets])

  const activeLabel = NAV_GROUPS.reduce((acc, g) => {
    if (acc) return acc
    if (g.key === activeTab) return g.label
    const it = (g.items || []).find(n => n.key === activeTab)
    return it ? it.label : ''
  }, '') || '工作台'
  const currentBrandLabel = brandsMeta.find(b => b.key === brand)?.label || '云眠花园'

  // ===== 后端状态：语义色（success / warning / danger），不使用品牌主题色 =====
  const backendBusy = backendStarting || backendStopping
  const backendTone = backendBusy ? 'warning' : backendOnline_ ? 'success' : 'danger'
  const backendText = backendStarting
    ? '启动中…'
    : backendStopping
      ? '停止中…'
      : backendOnline_
        ? '已连接'
        : '未连接'
  const backendTip = backendOnline_
    ? (isViteCtrl
        ? `后端在线（${backendByUs ? 'Vite 启动' : '外部启动'}，PID ${backendPid || '—'}，运行 ${fmtUptime(backendFinalUptime)}）· Vite 模式可一键启停`
        : `后端在线（桌面 / 生产模式），已连接 ${fmtUptime(backendFinalUptime)} · 如需重启后端请双击桌面「${APP_NAME}」图标`)
    : (isViteCtrl
        ? '点击开关一键启动 Python 后端（app.py → :8000）· Vite 开发模式'
        : '后端未连接 · 请确认 Python app.py 已启动在 8000 端口，或双击桌面「' + APP_NAME + '」图标')

  // 未登录：显示假登录层（一台设备只登一次）
  if (!auth) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <AppErrorBoundary>
    <div className="app-shell app-hero" data-brand={brand}>
        {/* 左侧竖栏导航（HeroUI Surface + Button）*/}
        <TkSideNav
          activeKey={activeTab}
          onKeyChange={(k) => setActiveTab(k)}
          counts={counts}
          auth={auth}
          onLogout={handleLogout}
        />

        {/* 右区：顶栏 + 主内容（HeroUI Surface）*/}
        <Surface variant="default" className="flex flex-1 flex-col rounded-(--radius-2xl) border border-(--border) bg-(--background)">
          {/* 顶栏：左上 = 品牌开关 + 面包屑；右 = 状态chip + 账户积分 */}
          <Surface variant="secondary" className="mx-4 mt-4 flex h-14 shrink-0 items-center justify-between gap-4 rounded-(--radius-xl) border border-(--border) px-4">
            <div className="left" style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
              {availableBrands.length > 1 && (
                <BrandSwitcher
                  brands={availableBrands}
                  brand={brand}
                  onChange={(k) => { if (VALID_BRAND_KEY(k)) setBrand(k) }}
                />
              )}
              <div className="crumbs" style={{ minWidth: 0, flexShrink: 1 }}>
                <span className="c-crumb">{APP_SUB}</span>
                <span className="c-sep">›</span>
                <span className="c-crumb active">{activeLabel}</span>
              </div>
            </div>

            {/* 右侧：后端（状态 + 开关 + 重启） + 账户积分 */}
            <div className="right flex shrink-0 flex-wrap items-center justify-end gap-2">
              {/* 后端控件：永远显示 pill，避免「开关不见了」
                  - isViteCtrl=true（Vite dev）：状态灯 + 文字 + Switch + 真重启
                  - isViteCtrl=false（桌面 / 生产）：状态灯 + 文字 + 刷新页面重连 */}
              {showBackendPill && (
                <Surface
                  variant="tertiary"
                  title={backendTip}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-(--border) py-0 pl-2.5 pr-1"
                >
                  <StatusDot tone={backendTone} />
                  <span className="whitespace-nowrap text-xs font-semibold text-(--foreground)">{backendText}</span>
                  {isViteCtrl && (
                    <Switch
                      size="sm"
                      isSelected={backendSwitchOn}
                      isDisabled={backendBusy}
                      onChange={(v) => handleBackendToggle(v)}
                      aria-label="启动或停止后端"
                    />
                  )}
                  <HeroButton
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    className="h-6 w-6 rounded-full"
                    isDisabled={backendBusy || backendRestarting}
                    onPress={() => {
                      if (isViteCtrl) handleBackendRestart()
                      else {
                        toastPush('刷新页面重新连接后端…', 'info')
                        setTimeout(() => window.location.reload(), 300)
                      }
                    }}
                    aria-label={isViteCtrl ? '重启后端' : '刷新页面重连后端'}
                  >
                    {backendRestarting ? <Spinner size="sm" /> : <Icon name="refresh" size={12} />}
                  </HeroButton>
                </Surface>
              )}

              {/* 兜底：后端 pill 未显示时保留最小状态提示 */}
              {!showBackendPill && (
                <Chip
                  size="sm"
                  variant="secondary"
                  color={engineStatus === 'ready' ? 'success' : 'danger'}
                  className="h-7 shrink-0 gap-1.5 whitespace-nowrap"
                >
                  <StatusDot tone={engineStatus === 'ready' ? 'success' : 'danger'} />
                  {statusDot.text}
                </Chip>
              )}

              {/* 图片积分（NanoBanana / Seedance 图模型）*/}
              <Chip
                size="sm"
                variant="secondary"
                color="default"
                className="h-7 shrink-0 gap-1.5 whitespace-nowrap"
                title={creditsLoading ? '积分刷新中…' : '图片生成剩余积分（nanobannan · Seedance）'}
              >
                <Icon name="picture" size={13} />
                <span className="font-semibold">
                  {imageCredits == null
                    ? (creditsLoading ? '图积分…' : '未连接')
                    : `${imageCredits.toLocaleString()} 图积分${creditsDegraded ? ' (回退)' : ''}`}
                </span>
              </Chip>

              {/* 视频积分（ToAPIs 视频模型）*/}
              <Chip
                size="sm"
                variant="secondary"
                color="default"
                className="h-7 shrink-0 gap-1.5 whitespace-nowrap"
                title={[
                  creditsLoading ? '积分刷新中…' : '视频生成剩余积分（ToAPIs）',
                  creditsMessage ? `· ${creditsMessage}` : '',
                  creditsDegraded ? '· 当前为降级回退模式' : '',
                ].filter(Boolean).join(' ')}
              >
                <Icon name="video" size={13} />
                <span className="font-semibold">
                  {videoCredits == null
                    ? (creditsLoading ? '视频积分…' : '未连接')
                    : `${videoCredits.toLocaleString()} 视频积分${creditsDegraded ? ' (回退)' : ''}`}
                </span>
              </Chip>

              {/* 大模型积分（DeepSeek v4-flash）*/}
              <Chip
                size="sm"
                variant="secondary"
                color="default"
                className="h-7 shrink-0 gap-1.5 whitespace-nowrap"
                title={creditsLoading ? '积分刷新中…' : 'DeepSeek v4-flash · 文案/脚本/拆解默认使用，不可更改'}
              >
                <Icon name="brain" size={13} />
                <span className="font-semibold">
                  {llmCredits == null
                    ? (creditsLoading ? 'LLM积分…' : '未连接')
                    : (llmBalanceCny != null && Number.isFinite(llmCredits)
                        ? `${llmBalanceCny.toFixed(2)}元${creditsDegraded ? ' (回退)' : ''}`
                        : `${llmCredits.toLocaleString()} LLM积分${creditsDegraded ? ' (回退)' : ''}`)}
                </span>
              </Chip>

              {/* 豆包（火山方舟 Ark）状态 */}
              <Chip
                size="sm"
                variant="secondary"
                color={!doubao ? 'default' : doubao.ok ? 'success' : 'danger'}
                className="h-7 shrink-0 gap-1.5 whitespace-nowrap"
                title={
                  doubao
                    ? [
                        '豆包（火山方舟 Ark）' + (doubao.model ? ` · ${doubao.model}` : ''),
                        doubao.ok ? `连通正常${doubao.latency_ms != null ? ` · ${doubao.latency_ms}ms` : ''}` : `异常 · ${doubao.message}`,
                        doubao.needs_ak_sk ? '余额需配置火山 AK/SK 后显示' : (doubao.balance != null ? `剩余额度：${doubao.balance}` : ''),
                      ].filter(Boolean).join(' · ')
                    : '豆包状态加载中…'
                }
              >
                <Icon name="magic" size={13} />
                <span className="font-semibold">
                  {!doubao
                    ? '豆包…'
                    : !doubao.ok
                      ? '豆包异常'
                      : (doubao.balance != null ? `豆包 ${doubao.balance}` : '豆包 正常')}
                </span>
              </Chip>
            </div>
          </Surface>

        {/* 主内容区：移除 tk-subtabs 胶囊切换区 */}
        <main className="tk-main-body flex min-h-0 flex-1 flex-col">
          <section className="tk-content">
            {activeTab === TAB_KEY_STUDIO && (
              <PageErrorBoundary name="主题合成">
                <MemoDesignStudio brand={brand} brandsMeta={brandsMeta} account={auth?.type} onSwitchTab={handleSwitchTab} />
              </PageErrorBoundary>
            )}
            {activeTab === TAB_KEY_1688 && (
              <PageErrorBoundary name="1688 导入">
                <Import1688Page brand={brand} brandsMeta={brandsMeta} onSwitchTab={handleSwitchTab} />
              </PageErrorBoundary>
            )}
            {/* 套图生成保持常驻挂载（切 tab 只隐藏不卸载），保留对话上下文与生成轮询状态 */}
            <div style={{ display: activeTab === TAB_KEY_SUITE ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="套图生成">
                <MemoSuiteGenerator brand={brand} account={auth?.type} />
              </PageErrorBoundary>
            </div>
            {/* 视频批量生成保持常驻挂载（切 tab 只隐藏不卸载），保留编辑进度/分镜/任务队列状态 */}
            <div style={{ display: activeTab === TAB_KEY_VIDEO ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="视频批量生成">
                <MemoVideoBatchStudio brand={brand} brandsMeta={brandsMeta} account={auth?.type} onSwitchTab={handleSwitchTab} />
              </PageErrorBoundary>
            </div>
            {/* 复刻视频保持常驻挂载，保留上传/生成状态 */}
            <div style={{ display: activeTab === TAB_KEY_REPLICATE ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="复刻视频">
                <MemoVideoReplicate brand={brand} brandsMeta={brandsMeta} account={auth?.type} onSwitchTab={handleSwitchTab} />
              </PageErrorBoundary>
            </div>
            {/* 视频库保持常驻挂载（切 tab 只隐藏不卸载），保留列表数据与选择状态 */}
            <div style={{ display: activeTab === TAB_KEY_VIDEOLIB ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="视频库">
                <VideoLibrary brand={brand} />
              </PageErrorBoundary>
            </div>
            {/* 模版图保持常驻挂载（切 tab 只隐藏不卸载），保留列表数据 */}
            <div style={{ display: activeTab === TAB_KEY_TEMPLATE ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="模版图">
                <TemplateGen brand={brand} />
              </PageErrorBoundary>
            </div>
            {/* 图片生成保持常驻挂载（切 tab 只隐藏不卸载），保留历史会话与生成轮询状态 */}
            <div style={{ display: activeTab === TAB_KEY_IMGGEN ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="图片生成">
                <MemoImageGen brand={brand} />
              </PageErrorBoundary>
            </div>
            {/* AI 对话同样常驻挂载，保留当前对话上下文 */}
            <div style={{ display: activeTab === TAB_KEY_CHAT ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="云眠AI">
                <MemoAiChat brand={brand} account={auth?.type} />
              </PageErrorBoundary>
            </div>
            {/* 图库保持常驻挂载（切 tab 只隐藏不卸载），保留列表数据与搜索状态 */}
            <div style={{ display: activeTab === TAB_KEY_RESULTS ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
              <PageErrorBoundary name="图库">
                <ResultsLibrary brand={brand} buckets={buckets} />
              </PageErrorBoundary>
            </div>
          </section>
        </main>
        </Surface>
      </div>
      <ToastLayer />
    </AppErrorBoundary>
  )
}

// 状态灯：语义色（success / warning / danger / muted），不使用品牌主题色
const STATUS_DOT_COLOR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--muted)',
}
function StatusDot({ tone = 'muted', pulse = false }) {
  const color = STATUS_DOT_COLOR[tone] || STATUS_DOT_COLOR.muted
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
      }}
    />
  )
}


function VALID_BRAND_KEY(k) {
  return k === 'cloudsleepgarden' || k === 'sofawithcat' || k === 'lyrosdream' || k === 'oblachny_sad'
}
