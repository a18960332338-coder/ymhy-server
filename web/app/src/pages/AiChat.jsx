import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import Icon from '../components/Icon'
import brandLogo from '../assets/brand-logo.png'
import { getBrandAI } from '../presets'
import { aiSessionsKey, aiPresetKey } from '../accountKeys'
import {
  loadGalleryCategories, mapCategoryImages, defaultCategoryKey, DEFAULT_GALLERY_CATEGORY,
} from '../galleryCategories'
import {
  Button as HeroButton, Chip, Avatar, Modal, Spinner,
  ToggleButton, ToggleButtonGroup,
} from '@heroui/react'
import { HeroTextArea, HeroSelect } from '../components/ui'

// 会话 / 预设记忆全局共用（跨店铺、跨账号同一份，见 accountKeys）
const sessionsStore = () => aiSessionsKey()
const presetStore = () => aiPresetKey()
const AI_NAME = '云眠AI'

const MODEL_OPTIONS = [
  { key: 'doubao', label: '豆包 Doubao', desc: '默认 · Agent Plan' },
  { key: 'deepseek', label: 'DeepSeek-V4-Flash', desc: '备用 · 快' },
]

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36).slice(-4)
}

function formatTime(d) {
  const date = new Date(d)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  const hm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return hm
  return `${date.getMonth() + 1}/${date.getDate()} ${hm}`
}

// 简单 Markdown 渲染（代码块、行内代码、粗体、列表、换行）
// memo：流式输出时避免全部历史消息被重复解析 markdown
const SimpleMarkdown = memo(function SimpleMarkdownBase({ text }) {
  const lines = String(text || '').split('\n')
  const nodes = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      const code = codeLines.join('\n')
      nodes.push(
        <div key={i} style={{ margin: '8px 0', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {lang && (
            <div style={{ padding: '6px 12px', fontSize: 12, background: 'var(--surface-bg-2)', color: 'var(--muted-foreground)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{lang}</span>
              <CopyBtn text={code} size={12} />
            </div>
          )}
          <pre style={{ margin: 0, padding: 12, background: 'var(--surface-bg-2)', overflow: 'auto', fontFamily: 'var(--tk-font-mono)', fontSize: 13, lineHeight: 1.6, color: 'var(--foreground)' }}>
            <code>{code}</code>
          </pre>
        </div>
      )
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length
      const size = Math.max(16, 22 - level * 2)
      nodes.push(<div key={i} style={{ fontSize: size, fontWeight: 700, margin: '12px 0 6px', color: 'var(--foreground)' }}>{line.replace(/^#{1,6}\s/, '')}</div>)
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      nodes.push(
        <ul key={i} style={{ margin: '6px 0', paddingLeft: 20, color: 'var(--foreground)', lineHeight: 1.7 }}>
          {items.map((it, idx) => <li key={idx}><Inline text={it} /></li>)}
        </ul>
      )
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      nodes.push(
        <ol key={i} style={{ margin: '6px 0', paddingLeft: 22, color: 'var(--foreground)', lineHeight: 1.7 }}>
          {items.map((it, idx) => <li key={idx}><Inline text={it} /></li>)}
        </ol>
      )
      continue
    }
    if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: 8 }} />)
      i++
      continue
    }
    nodes.push(<p key={i} style={{ margin: '6px 0', lineHeight: 1.7, color: 'var(--foreground)' }}><Inline text={line} /></p>)
    i++
  }
  return <>{nodes}</>
})

function Inline({ text }) {
  // 行内代码
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((p, idx) => {
        if (p.startsWith('`') && p.endsWith('`')) {
          return <code key={idx} style={{ background: 'var(--surface-tertiary)', padding: '2px 5px', borderRadius: 5, fontFamily: 'var(--tk-font-mono)', fontSize: '0.92em' }}>{p.slice(1, -1)}</code>
        }
        // 粗体
        const boldParts = p.split(/(\*\*[^*]+\*\*|__[^_]+__)/g)
        return (
          <span key={idx}>
            {boldParts.map((b, j) => {
              if ((b.startsWith('**') && b.endsWith('**')) || (b.startsWith('__') && b.endsWith('__'))) {
                return <strong key={j}>{b.slice(2, -2)}</strong>
              }
              // 链接
              return <span key={j} dangerouslySetInnerHTML={{ __html: escapeHtml(b).replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noreferrer" style="color:var(--warning);text-decoration:underline;">$1</a>') }} />
            })}
          </span>
        )
      })}
    </>
  )
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function CopyBtn({ text, size = 14 }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <HeroButton
      isIconOnly
      variant="ghost"
      size="sm"
      onPress={handle}
      aria-label={copied ? '已复制' : '复制'}
      className={`h-6 w-6 min-w-0 p-0 ${copied ? 'text-(--warning)' : 'text-(--muted-foreground)'}`}
    >
      <Icon name={copied ? 'check' : 'copy'} size={size} />
    </HeroButton>
  )
}

// 图片文件 → 压缩后的 base64 data URL（最长边 maxSide，JPEG/PNG）
async function fileToDataUrl(file, maxSide = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSide || height > maxSide) {
          const scale = Math.min(maxSide / width, maxSide / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        resolve(canvas.toDataURL(mime, quality))
      }
      img.onerror = () => reject(new Error('图片解析失败'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

// 写盘前剥离 base64 图片（性能红线，与 ImageGen 同理）
// 用户上传的参考图即便经 canvas 压缩，仍是数 MB 量级的 data URL；
// 进 sessions 后每次持久化都要做全量 JSON.stringify + 同步 localStorage.setItem，
// 主线程被整块占死 → 表现为「发消息卡死 / 切换卡死 / 网页崩溃」（localStorage 上限仅 5MB）。
// 策略：内存里保留真图（当前会话照常显示），只在写盘时换成轻量标记；刷新后用占位块代替。
const STRIPPED_IMG = '__img_stripped__'

function stripChatSessions(list) {
  return (Array.isArray(list) ? list : []).map(s => ({
    ...s,
    messages: Array.isArray(s?.messages)
      ? s.messages.map(m => {
          const imgs = m?.images
          if (!Array.isArray(imgs) || imgs.length === 0) return m
          let changed = false
          const next = imgs.map(u => {
            if (typeof u === 'string' && u.startsWith('data:')) { changed = true; return STRIPPED_IMG }
            return u
          })
          if (!changed) return m
          const n = imgs.filter(x => typeof x === 'string' && x.startsWith('data:')).length
          return { ...m, images: next, strippedImages: (m.strippedImages || 0) + n }
        })
      : s?.messages,
  }))
}

function ImageThumb({ src, size = 120 }) {
  if (src === STRIPPED_IMG) {
    return (
      <div style={{ width: size, height: size, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--surface-bg-2)', color: 'var(--muted-foreground)', fontSize: 11 }}>
        <Icon name="image" size={18} />
        <span>参考图</span>
      </div>
    )
  }
  return <img src={src} alt="" loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
}

function ChatAvatar({ role }) {
  if (role === 'user') {
    return (
      <Avatar
        name="你"
        size="sm"
        className="shrink-0"
        style={{ backgroundColor: 'var(--surface-tertiary)' }}
        showFallback
        fallback={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        }
      />
    )
  }
  return (
    <img
      src={brandLogo}
      alt={AI_NAME}
      style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
    />
  )
}

export default function AiChat({ brand, account }) {
  // 当前品牌的 AI 能力配置（预设 / 快捷任务 / 技能 / 空状态文案 / 默认 system）
  const ai = getBrandAI(brand)
  const [sessions, setSessions] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)
  const [model, setModel] = useState('doubao')
  const [showSidebar, setShowSidebar] = useState(true)
  const [system, setSystem] = useState(() => getBrandAI(brand).defaultSystem)
  const [showSystem, setShowSystem] = useState(false)
  // 当前选中的预设 key（与 system 解耦：用户编辑 system 后改 system；选预设则覆盖 system）
  const [presetKey, setPresetKey] = useState(() => {
    try { return localStorage.getItem(presetStore(brand, account)) || 'default' } catch { return 'default' }
  })
  const [abortCtrl, setAbortCtrl] = useState(null)
  // 流式回复：独立于 sessions 之外承载，避免每个 token 都改 sessions 触发
  // ① 全量 JSON.stringify + localStorage 写入 ② 全部消息重渲染 —— 这两者是流式卡顿的根因
  const [streaming, setStreaming] = useState(null) // { id, content, isError }
  const streamBufRef = useRef('') // 累积流式文本，done 时一次性 commit（保证 setState updater 是纯函数）
  const messagesEndRef = useRef(null)
  // 消息滚动容器：用于监听从隐藏(display:none)切到可见时自动滚到底
  const scrollAreaRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  // 待发送图片 [{ id, url(展示), dataUrl(发给后端), name }]
  const [pendingImages, setPendingImages] = useState([])
  const [showImageMenu, setShowImageMenu] = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerBuckets, setPickerBuckets] = useState([])
  const [pickerTab, setPickerTab] = useState(DEFAULT_GALLERY_CATEGORY)

  // 粘贴图片：window 级监听，粘贴到输入框即可附带图片
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      const files = []
      for (const it of items) {
        if (it.type?.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        e.preventDefault()
        addFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addFiles = async (files) => {
    const list = Array.from(files || []).filter(f => f.type?.startsWith('image/'))
    if (!list.length) return
    if (pendingImages.length + list.length > 6) {
      alert('最多附加 6 张图片')
      return
    }
    const added = []
    for (const f of list) {
      try {
        const dataUrl = await fileToDataUrl(f)
        added.push({ id: genId(), url: dataUrl, dataUrl, name: f.name || '粘贴图片' })
      } catch {}
    }
    setPendingImages(prev => [...prev, ...added])
  }

  const openImagePicker = async () => {
    setShowImageMenu(false)
    setShowImagePicker(true)
    setPickerLoading(true)
    try {
      // 分类统一来自 src/galleryCategories.js，与「图库」页 Tab 保持一致
      // （历史上这里写的是「主图素材库 / 猫咪素材库 / 图库」三项，其中「图库」
      //   把合成图/分镜图/套图/其他生成图全混在一起，和图库页对不上）
      const cats = mapCategoryImages(await loadGalleryCategories(brand), (bucket, im) => ({
        name: im.name,
        url: api.imageUrl(bucket, im.name, { brand }),
      }))
      setPickerBuckets(cats)
      setPickerTab(defaultCategoryKey(cats))
    } finally {
      setPickerLoading(false)
    }
  }

  const onPickerSelect = (img) => {
    if (!img?.url) return
    setPendingImages(prev => {
      if (prev.length >= 6) {
        alert('最多附加 6 张图片')
        return prev
      }
      return [...prev, { id: genId(), url: img.url, dataUrl: img.url, name: img.name }]
    })
    setShowImagePicker(false)
  }

  const removePendingImage = (id) => {
    setPendingImages(prev => prev.filter(p => p.id !== id))
  }

  // 读取本地会话（按品牌隔离；切换品牌时重新加载对应品牌的会话与预设）
  useEffect(() => {
    // 根据记住的预设 key 决定新会话的初始 system
    let initialPresetKey = 'default'
    try { initialPresetKey = localStorage.getItem(presetStore(brand, account)) || 'default' } catch {}
    setPresetKey(initialPresetKey)
    const cfg = getBrandAI(brand)
    const presetSystem = (cfg.presets.find(p => p.key === initialPresetKey) || cfg.presets[0]).system
    try {
      const raw = localStorage.getItem(sessionsStore(brand, account))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 自动删除无消息的空对话（刷新/重开后不保留）
          const filtered = parsed.filter(s => s.messages && s.messages.length > 0)
          if (filtered.length > 0) {
            setSessions(filtered)
            setCurrentId(filtered[0].id)
            if (filtered[0].system) setSystem(filtered[0].system)
            // 异步回写：把过滤后的结果写回 localStorage（清理空会话）
            try { localStorage.setItem(sessionsStore(brand, account), JSON.stringify(stripChatSessions(filtered))) } catch {}
            return
          }
        }
      }
    } catch {}
    // 没有会话 → 用预设 system 新建（确保刷新后预设仍生效）
    setSystem(presetSystem)
    createSession(presetSystem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  // 持久化（按品牌隔离存储）—— debounce 500ms
  // JSON.stringify(全量会话) 是同步阻塞操作，高频调用会卡死主线程；
  // 写盘前先剥离 base64 参考图，避免数 MB 的同步序列化撑爆主线程与 5MB 配额
  useEffect(() => {
    if (sessions.length === 0) return
    const t = setTimeout(() => {
      try { localStorage.setItem(sessionsStore(brand, account), JSON.stringify(stripChatSessions(sessions))) } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [sessions, brand])

  const currentSession = useMemo(() => sessions.find(s => s.id === currentId) || null, [sessions, currentId])

  const messages = useMemo(() => currentSession?.messages || [], [currentSession])

  // 流式中的消息只存在于显示列表，不进 sessions
  const displayMessages = useMemo(() => {
    // 流式消息绑定会话：切走会话时不串台显示
    if (!streaming || streaming.sid !== currentId) return messages
    return [...messages, {
      id: streaming.id,
      role: 'assistant',
      content: streaming.content,
      isError: streaming.isError,
      createdAt: streaming.createdAt || Date.now(),
      streaming: true,
    }]
  }, [messages, streaming, currentId])

  // rAF 节流：流式期间每帧最多滚动一次，避免 smooth 动画排队堆积
  const scrollRafRef = useRef(0)
  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollRafRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])

  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
  }, [])

  useEffect(() => {
    // 流式输出中用 auto（无动画），避免每 token 一次 smooth 动画堆积
    scrollToBottom(!streaming)
  }, [displayMessages, scrollToBottom, streaming])

  // 切换到「云眠AI」tab 时（容器从 display:none 变可见），自动锚定到最新消息
  useEffect(() => {
    const el = scrollAreaRef.current
    if (!el) return
    // 记录上一帧高度，避免隐藏态(0)下的重复触发
    let prevH = el.clientHeight
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight
      // 仅当从「隐藏/0 高度」变为「可见/有高度」时滚到底
      if (prevH <= 0 && h > 0) {
        // 等待一帧让子内容完成布局
        requestAnimationFrame(() => scrollToBottom())
      }
      prevH = h
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToBottom])

  const createSession = (initialSystem) => {
    const id = genId()
    const cfg = getBrandAI(brand)
    const session = {
      id,
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // 使用传入的初始 system（品牌加载时），否则用当前 system state（已被预设/编辑器覆盖）
      system: initialSystem || system || (cfg.presets.find(p => p.key === presetKey) || cfg.presets[0]).system,
      messages: [],
    }
    setSessions(prev => [session, ...prev])
    setCurrentId(id)
    setInput('')
  }

  const updateCurrent = (updater) => {
    setSessions(prev => prev.map(s => (s.id === currentId ? updater(s) : s)))
  }

  const setTitleFromFirstMessage = (text) => {
    if (!currentSession) return
    if (currentSession.title !== '新对话') return
    const title = text.slice(0, 18) + (text.length > 18 ? '…' : '')
    updateCurrent(s => ({ ...s, title }))
  }

  // AI 总结对话标题：首条 AI 回复完成后，若标题仍为"新对话"，异步调用 AI 生成简短标题
  const generateAITitle = useCallback((sessionId, allMessages) => {
    // 取最近几轮对话作为上下文（避免 token 过多）
    const recent = allMessages.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))
    if (recent.length === 0) return
    api.chat({
      messages: [
        { role: 'system', content: '你是对话标题生成助手。根据用户与AI的对话内容，用中文生成一个简洁的对话标题（不超过15个字）。只输出标题文字，不要标点、不要引号、不要解释。' },
        ...recent,
      ],
      max_tokens: 30,
      temperature: 0.3,
      model,
      brand,
    }).then(res => res.json()).then(data => {
      const title = data?.choices?.[0]?.message?.content?.trim() || ''
      if (title && title.length > 0) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: title.slice(0, 20) } : s))
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, brand])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if ((!text && pendingImages.length === 0) || loading || !currentSession) return
    const titleText = text || (pendingImages[0]?.name || '[图片]')

    setTitleFromFirstMessage(titleText)
    const userMsg = {
      id: genId(), role: 'user', content: text, createdAt: Date.now(),
      images: pendingImages.map(p => p.url), // 展示用
    }
    updateCurrent(s => ({ ...s, messages: [...s.messages, userMsg], updatedAt: Date.now() }))
    setInput('')
    const imagesToSend = pendingImages.map(p => p.dataUrl)
    setPendingImages([])
    setLoading(true)
    setTyping(false)

    const chatMessages = [
      { role: 'system', content: currentSession.system || system },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    // 流式占位走独立 state：不进 sessions，避免每个 token 触发全量序列化写盘 + 全量重渲染
    const aiMsgId = genId()
    streamBufRef.current = ''
    setStreaming({ id: aiMsgId, sid: currentSession.id, content: '', isError: false, createdAt: Date.now() })

    // 流式结束时一次性提交到 sessions（整个流只写一次 localStorage）
    const commit = (content, isError = false) => {
      setStreaming(null)
      // 绑定流式开始时的会话：即使用户中途切走会话，结果也写回原会话
      const sid = currentSession.id
      setSessions(prev => prev.map(s => s.id === sid ? {
        ...s,
        messages: [...s.messages, { id: aiMsgId, role: 'assistant', content, isError, createdAt: Date.now() }],
        updatedAt: Date.now(),
      } : s))
    }

    const ctrl = new AbortController()
    setAbortCtrl(ctrl)
    // 兜底保险：若 150s 内流式仍未结束（如网络异常导致连接挂起），强制结束并解除 loading，避免「发送后卡死」
    const safetyTimer = setTimeout(() => {
      try { ctrl.abort() } catch {}
      setLoading(false)
      setTyping(false)
    }, 150000)
    try {
      await api.chatStream(
        { messages: chatMessages, max_tokens: 2000, temperature: 0.7, model, images: imagesToSend, brand },
        ({ content, done, error }) => {
          if (error) {
            commit(`请求失败：${error}`, true)
            setLoading(false)
            return
          }
          if (content) {
            streamBufRef.current += content
            const nextText = streamBufRef.current
            setStreaming(prev => (prev && prev.id === aiMsgId ? { ...prev, content: nextText } : prev))
          }
          if (done) {
            commit(streamBufRef.current || '（无返回）')
            setLoading(false)
            // 首条 AI 回复完成后，若标题仍为"新对话"，异步生成 AI 总结标题
            if (currentSession && currentSession.title === '新对话') {
              const sid = currentSession.id
              const msgs = [...currentSession.messages, { role: 'assistant', content: streamBufRef.current || '' }]
              generateAITitle(sid, msgs)
            }
          }
        },
        ctrl.signal,
      )
    } catch (e) {
      if (e.name !== 'AbortError') {
        commit(`请求失败：${e?.message || '未知错误'}`, true)
      } else {
        // 用户主动中止：保留已收到的部分内容
        commit(streamBufRef.current || '（已停止生成）')
      }
      setLoading(false)
    } finally {
      clearTimeout(safetyTimer)
      // 兜底：无论成功/失败/异常/连接未及时关闭，都强制解除 loading，避免「发送后卡死」
      setAbortCtrl(null)
      setTyping(false)
      setLoading(false)
    }
  }, [input, pendingImages, loading, currentSession, messages, system, model, brand])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const regenerate = async (msgId) => {
    if (!currentSession || loading) return
    const idx = currentSession.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    // 截取到该 assistant 消息前一条 user 为止
    const keep = currentSession.messages.slice(0, idx)
    const userMsg = keep[keep.length - 1]
    if (!userMsg || userMsg.role !== 'user') return
    updateCurrent(s => ({ ...s, messages: keep, updatedAt: Date.now() }))
    setLoading(true)
    setTyping(false)
    const chatMessages = [
      { role: 'system', content: currentSession.system || system },
      ...keep.map(m => ({ role: m.role, content: m.content })),
    ]
    const aiMsgId = genId()
    streamBufRef.current = ''
    setStreaming({ id: aiMsgId, sid: currentSession.id, content: '', isError: false, createdAt: Date.now() })

    const commit = (content, isError = false) => {
      setStreaming(null)
      // 绑定流式开始时的会话：即使用户中途切走会话，结果也写回原会话
      const sid = currentSession.id
      setSessions(prev => prev.map(s => s.id === sid ? {
        ...s,
        messages: [...s.messages, { id: aiMsgId, role: 'assistant', content, isError, createdAt: Date.now() }],
        updatedAt: Date.now(),
      } : s))
    }

    const ctrl = new AbortController()
    setAbortCtrl(ctrl)
    // 兜底保险：若 150s 内流式仍未结束（如网络异常导致连接挂起），强制结束并解除 loading，避免「发送后卡死」
    const safetyTimer = setTimeout(() => {
      try { ctrl.abort() } catch {}
      setLoading(false)
      setTyping(false)
    }, 150000)
    try {
      await api.chatStream(
        { messages: chatMessages, max_tokens: 2000, temperature: 0.7, model, images: userMsg.images || [], brand },
        ({ content, done, error }) => {
          if (error) {
            commit(`请求失败：${error}`, true)
            setLoading(false)
            return
          }
          if (content) {
            streamBufRef.current += content
            const nextText = streamBufRef.current
            setStreaming(prev => (prev && prev.id === aiMsgId ? { ...prev, content: nextText } : prev))
          }
          if (done) {
            commit(streamBufRef.current || '（无返回）')
            setLoading(false)
            // 首条 AI 回复完成后，若标题仍为"新对话"，异步生成 AI 总结标题
            if (currentSession && currentSession.title === '新对话') {
              const sid = currentSession.id
              const msgs = [...currentSession.messages, { role: 'assistant', content: streamBufRef.current || '' }]
              generateAITitle(sid, msgs)
            }
          }
        },
        ctrl.signal,
      )
    } catch (e) {
      if (e.name !== 'AbortError') {
        commit(`请求失败：${e?.message || '未知错误'}`, true)
      } else {
        commit(streamBufRef.current || '（已停止生成）')
      }
      setLoading(false)
    } finally {
      clearTimeout(safetyTimer)
      // 兜底：无论成功/失败/异常/连接未及时关闭，都强制解除 loading，避免「发送后卡死」
      setAbortCtrl(null)
      setTyping(false)
      setLoading(false)
    }
  }

  const deleteSession = (id) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (currentId === id) {
        if (next.length > 0) {
          setCurrentId(next[0].id)
        } else {
          // 全部删除后自动新建
          setTimeout(createSession, 0)
        }
      }
      return next
    })
  }

  const clearCurrent = () => {
    updateCurrent(s => ({ ...s, messages: [], title: '新对话', updatedAt: Date.now() }))
  }

  const deleteMessage = (id) => {
    updateCurrent(s => ({ ...s, messages: s.messages.filter(m => m.id !== id), updatedAt: Date.now() }))
  }

  const updateSystem = (val) => {
    setSystem(val)
    updateCurrent(s => ({ ...s, system: val, updatedAt: Date.now() }))
  }

  // 选择预设：覆盖当前 system 文本 + 持久化预设 key（按品牌）
  const applyPreset = (key) => {
    const p = ai.presets.find(x => x.key === key)
    if (!p) return
    setPresetKey(key)
    try { localStorage.setItem(presetStore(brand, account), key) } catch {}
    updateSystem(p.system)
  }

  const modelLabel = MODEL_OPTIONS.find(m => m.key === model)?.label || model

  return (
    <div className="ai-chat-page tk-page-bleed" style={{ display: 'flex', flexDirection: 'row' }}>
      {/* 左侧会话列表 */}
      {showSidebar && (
        <aside style={{
          width: 230, flex: '0 0 230px', display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border)', background: 'var(--surface-bg-2)', minHeight: 0,
        }}>
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
            <HeroButton fullWidth variant="outline" onPress={createSession}>
              <Icon name="plus" size={16} /> 新对话
            </HeroButton>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => { setCurrentId(s.id); setSystem(s.system || ai.defaultSystem) }}
                style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
                  background: s.id === currentId ? 'var(--surface)' : 'var(--surface-bg-2)',
                  border: `1px solid ${s.id === currentId ? 'var(--accent)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background .15s, border-color .15s',
                }}
              >
                <Icon name="message" size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || '新对话'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>{formatTime(s.updatedAt)} · {s.messages.length} 条</div>
                </div>
                <HeroButton
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                  aria-label="删除会话"
                  className="h-7 w-7 min-w-0 p-0 text-(--muted-foreground) opacity-60 hover:opacity-100"
                >
                  <Icon name="delete" size={14} />
                </HeroButton>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 右侧聊天区 */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--surface-bg-2)' }}>
        {/* 顶部栏 */}
        <header style={{
          height: 56, flex: '0 0 56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-bg-2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HeroButton
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={() => setShowSidebar(v => !v)}
              aria-label={showSidebar ? '收起侧边栏' : '展开侧边栏'}
              className="h-8 w-8 min-w-0 p-0 text-(--muted-foreground)"
            >
              <Icon name={showSidebar ? 'left' : 'right'} size={18} />
            </HeroButton>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={brandLogo}
                alt={AI_NAME}
                style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }}
              />
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>{AI_NAME}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* 模型选择 */}
            <div style={{ position: 'relative' }}>
              <HeroSelect
                value={model}
                onChange={(v) => { if (v) setModel(v) }}
                options={MODEL_OPTIONS.map(m => ({ value: m.key, label: m.label }))}
                className="w-[160px]"
              />
            </div>

            <HeroButton
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={clearCurrent}
              aria-label="清空当前对话"
              className="h-8 w-8 min-w-0 p-0 text-(--muted-foreground)"
            >
              <Icon name="delete" size={16} />
            </HeroButton>
          </div>
        </header>

        {/* 消息区 */}
        <div ref={scrollAreaRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 && !loading && (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted-foreground)', gap: 16, textAlign: 'center', padding: '0 20px',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 999, background: 'var(--surface-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                <img src={brandLogo} alt={AI_NAME} style={{ width: 64, height: 64, objectFit: 'cover' }} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground)', letterSpacing: 0.3 }}>
                {AI_NAME}，我帮你
              </div>
              <div style={{ fontSize: 13, maxWidth: 520, lineHeight: 1.7, color: 'var(--muted-foreground)' }}>
                {ai.emptyHint}
              </div>
              {/* 快捷任务 chips */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 620, marginTop: 4 }}>
                {ai.quickTasks.map((c, idx) => (
                  <Chip key={idx} variant="secondary" onClick={() => setInput(c.prompt)}
                    style={{ cursor: 'pointer', padding: '10px 16px', fontSize: 13, fontWeight: 600 }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={c.icon} size={14} /> {c.label}
                    </span>
                  </Chip>
                ))}
              </div>
              {/* 技能 chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 660, marginTop: 4 }}>
                {ai.skills.map((t, idx) => (
                  <Chip key={idx} variant="secondary" onClick={() => setInput(t)}
                    style={{ cursor: 'pointer', fontSize: 12 }}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {displayMessages.map((m, idx) => (
              <div key={m.id} style={{ marginBottom: 16 }}>
                {m.role === 'assistant' ? (
                  // 助手：logo + 文字（无对话框，文字在 logo 下方左对齐）
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <ChatAvatar role="assistant" brand={brand} />
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
                      {m.isError ? (
                        <span style={{ color: 'var(--danger)', fontSize: 14, lineHeight: 1.7 }}>{m.content}</span>
                      ) : (
                        <SimpleMarkdown text={m.content} />
                      )}
                      {Array.isArray(m.images) && m.images.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                          {m.images.map((src, i) => (
                            <ImageThumb key={i} src={src} size={120} />
                          ))}
                        </div>
                      )}
                      {/* 流式期间：实时显示已累积内容；完成后再显示时间戳 + 操作按钮（避免边生成边点复制/重生成） */}
                      {!m.streaming && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted-foreground)', opacity: 0.7 }}>{formatTime(m.createdAt)}</span>
                          <CopyBtn text={m.content} size={12} />
                          <HeroButton
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            isDisabled={loading}
                            onPress={() => regenerate(m.id)}
                            aria-label="重新生成"
                            className="h-6 w-6 min-w-0 p-0 text-(--muted-foreground)"
                          >
                            <Icon name="refresh" size={12} />
                          </HeroButton>
                          <HeroButton
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            onPress={() => deleteMessage(m.id)}
                            aria-label="删除此条"
                            className="h-6 w-6 min-w-0 p-0 text-(--muted-foreground)"
                          >
                            <Icon name="close" size={12} />
                          </HeroButton>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // 用户：纯色对话框，右对齐，不显示头像
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ maxWidth: '70%' }}>
                      <div style={{
                        padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
                        background: 'var(--surface-bg-2)', color: 'var(--foreground)',
                        fontSize: 14, lineHeight: 1.65,
                      }}>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                        {Array.isArray(m.images) && m.images.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                            {m.images.map((src, i) => (
                              <ImageThumb key={i} src={src} size={96} />
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 4, justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted-foreground)', opacity: 0.7 }}>{formatTime(m.createdAt)}</span>
                        <HeroButton
                          isIconOnly
                          variant="ghost"
                          size="sm"
                          onPress={() => deleteMessage(m.id)}
                          aria-label="删除此条"
                          className="h-6 w-6 min-w-0 p-0 text-(--muted-foreground)"
                        >
                          <Icon name="close" size={12} />
                        </HeroButton>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && typing && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <ChatAvatar role="assistant" brand={brand} />
                <div style={{
                  padding: '12px 16px', borderRadius: '14px 14px 14px 4px', background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--muted-foreground)', animation: 'chatBlink 1.4s infinite 0s' }} />
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--muted-foreground)', animation: 'chatBlink 1.4s infinite 0.2s' }} />
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--muted-foreground)', animation: 'chatBlink 1.4s infinite 0.4s' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 系统提示设置 */}
        {showSystem && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-bg-2)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 6 }}>系统提示词（仅对当前会话生效）</div>
            {/* 预设快捷选择（自动记忆上次选的预设） */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {ai.presets.map(p => (
                <Chip key={p.key} variant={presetKey === p.key ? 'solid' : 'flat'} color={presetKey === p.key ? 'primary' : 'default'} onClick={() => applyPreset(p.key)}
                  title={p.system.slice(0, 80) + '…'}
                  style={{ cursor: 'pointer', fontSize: 12 }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {presetKey === p.key && <Icon name="check" size={11} />}
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>· {p.desc}</span>
                  </span>
                </Chip>
              ))}
            </div>
            <HeroTextArea
              value={system}
              onChange={(v) => updateSystem(v)}
              minRows={6}
              maxRows={12}
            />
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>提示：编辑后自动绑定到当前会话；切换预设将覆盖编辑内容。</div>
          </div>
        )}

        {/* 底部输入区 */}
        <div style={{
          padding: '12px 16px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface-bg-2)',
        }}>
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            {/* 待发送图片缩略图 */}
            {pendingImages.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {pendingImages.map(p => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    {/* 64px 小预览走缩略图；p.url 本身是原图，仍作为附加图片提交给模型 */}
                    <img
                      src={api.thumbOf(p.url)}
                      alt={p.name}
                      style={{
                        width: 64, height: 64, objectFit: 'cover', borderRadius: 10,
                        border: '1px solid var(--border)', background: 'var(--surface-tertiary)',
                      }}
                    />
                    <HeroButton
                      isIconOnly
                      variant="secondary"
                      size="sm"
                      onPress={() => removePendingImage(p.id)}
                      aria-label="移除图片"
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 min-w-0 rounded-full border border-(--border) bg-(--surface-bg-2) p-0 text-(--foreground)"
                    >
                      <Icon name="close" size={12} />
                    </HeroButton>
                  </div>
                ))}
              </div>
            )}
            <div className="ai-input-shell" style={{
              display: 'flex', alignItems: 'flex-end', gap: 8,
              padding: '8px 12px', borderRadius: 28,
              background: 'var(--surface-tertiary)',
            }}>
              {/* 加号：合并「上传图片 / 从图库选择 / 调整预设」三项菜单 */}
              <div style={{ position: 'relative' }}>
                <HeroButton
                  isIconOnly
                  variant={showImageMenu || showSystem ? 'secondary' : 'ghost'}
                  size="sm"
                  onPress={() => { setShowImageMenu(v => !v); setShowSystem(false) }}
                  aria-label="添加图片 / 调整预设"
                  className="h-8 w-8 min-w-0 rounded-full p-0"
                >
                  <Icon name="plus" size={18} />
                </HeroButton>
                {showImageMenu && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 50,
                    minWidth: 200, background: 'var(--surface-bg-2)', border: '1px solid var(--border)',
                    borderRadius: 14, padding: 6, boxShadow: 'var(--surface-shadow)',
                  }}>
                    <div
                      onClick={() => { setShowImageMenu(false); fileInputRef.current?.click() }}
                      style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--foreground)' }}
                    >
                      <Icon name="upload" size={15} /> 上传图片
                    </div>
                    <div
                      onClick={() => { setShowImageMenu(false); openImagePicker() }}
                      style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--foreground)' }}
                    >
                      <Icon name="folder" size={15} /> 从图库选择
                    </div>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <div
                      onClick={() => { setShowImageMenu(false); setShowSystem(true) }}
                      style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--foreground)' }}
                    >
                      <Icon name="adjustment" size={15} /> 调整预设
                    </div>
                    <div style={{ padding: '8px 12px 2px', fontSize: 11, color: 'var(--muted-foreground)' }}>
                      也可直接粘贴截图（⌘V）
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>
              <HeroTextArea
                ref={textareaRef}
                value={input}
                onChange={(v) => setInput(v)}
                onKeyDown={handleKeyDown}
                placeholder="给 AI 发消息…（Shift + Enter 换行）"
                minRows={1}
                maxRows={6}
                autoResize
                isDisabled={loading}
                bare
                className="min-h-0"
                style={{ flex: 1 }}
              />
              <HeroButton
                isIconOnly
                variant="primary"
                size="sm"
                onPress={sendMessage}
                isDisabled={(!input.trim() && pendingImages.length === 0) || loading}
                aria-label="发送"
                className="h-9 w-9 min-w-0 shrink-0 rounded-full p-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </HeroButton>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, padding: '0 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                由 {model === 'deepseek' ? 'DeepSeek v4-flash' : '豆包（火山方舟 Ark）'} 提供支持 · 对话仅在本地与后端间传输
              </div>
              {loading && (
                <HeroButton variant="ghost" color="danger" size="sm" onPress={() => { try { abortCtrl?.abort() } catch {} setLoading(false); setTyping(false) }}>
                  <Icon name="pause" size={12} /> 停止生成
                </HeroButton>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 图库选择器弹窗 — HeroUI Modal */}
      <Modal.Root isOpen={showImagePicker} onOpenChange={(open) => { if (!open) setShowImagePicker(false) }}>
        <Modal.Backdrop />
        <Modal.Container>
          <Modal.Dialog className="flex max-h-[80vh] w-[760px] max-w-[92vw] flex-col gap-0 border border-(--border) bg-(--surface-bg-2)">
            <Modal.Header className="border-b border-(--border) px-5 py-3.5">
              <Modal.Heading className="flex items-center gap-2 text-[15px] font-semibold text-(--foreground)">
                <Icon name="picture" size={16} /> 从图库选择图片
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
              <div className="px-5 pt-3 pb-0">
                <ToggleButtonGroup
                  selectionMode="single"
                  selectedKeys={pickerTab != null ? [String(pickerTab)] : []}
                  onSelectionChange={(keys) => setPickerTab(Array.from(keys)[0])}
                  size="sm"
                  className="flex-wrap gap-1 rounded-full bg-(--surface-tertiary) border border-(--border) p-1"
                >
                  {pickerBuckets.map(b => (
                    <ToggleButton
                      key={b.key}
                      id={String(b.key)}
                      className="rounded-full px-3 py-1.5 text-[13px] text-(--muted-foreground) transition-colors data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow)"
                    >
                      {b.label} ({b.images.length})
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
              <div className="flex-1 overflow-y-auto p-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                {pickerLoading ? (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>
                    <Spinner size="lg" />
                    <div className="mt-2 text-xs text-(--muted)">加载中…</div>
                  </div>
                ) : (
                  (pickerBuckets.find(b => b.key === pickerTab)?.images || []).map(img => (
                    <div
                      key={img.name}
                      onClick={() => onPickerSelect(img)}
                      title={img.name}
                      style={{
                        aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                        border: '1px solid var(--border)', background: 'var(--surface-tertiary)',
                      }}
                    >
                      {/* 网格显示走缩略图；img.url 是原图，仍作为附加图片提交给模型 */}
                      <img src={api.thumbOf(img.url)} alt={img.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                  ))
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Root>

      <style>{`
        @keyframes chatBlink {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
