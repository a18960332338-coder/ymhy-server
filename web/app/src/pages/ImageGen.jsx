import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import Icon from '../components/Icon'
import { Button as HeroButton, Avatar, Spinner, ToggleButton, ToggleButtonGroup } from '@heroui/react'
import { HeroSelect, HeroTextArea } from '../components/ui'

// 图片 URL 解析：相对路径拼接 api.baseUrl（dev 走 vite proxy / 生产走同源）
function imgSrc(u) {
  if (!u) return ''
  if (u.startsWith('/') && api.baseUrl) return api.baseUrl + u
  return u
}

// ── 意图路由：解析豆包的结构化输出 ──────────────────────────────
// 输出约定（三行）：
//   意图：<chat|clarify|generate>
//   回复：<chat/clarify 时的中文回复；generate 时留空>
//   提示词：<generate 时的英文生图 prompt；chat/clarify 时留空>
// 逐行解析（格式是行式的，比跨行正则稳；正则版会在「回复：」为空时把提示词一并吞掉）
function parseAgentReply(raw) {
  const lines = String(raw || '').replace(/```/g, '').split(/\r?\n/)
  let intent = ''
  let reply = []
  let prompt = []
  let cur = null
  for (const line of lines) {
    const m = line.match(/^\s*(意图|回复|提示词)\s*[:：]\s?(.*)$/)
    if (m) {
      const key = m[1]
      const rest = (m[2] || '').trim()
      if (key === '意图') {
        const im = rest.match(/\b(chat|clarify|generate)\b/i)
        intent = im ? im[1].toLowerCase() : ''
        cur = null
      } else if (key === '回复') {
        reply = []
        cur = reply
        if (rest) reply.push(rest)
      } else {
        prompt = []
        cur = prompt
        if (rest) prompt.push(rest)
      }
    } else if (cur) {
      cur.push(line) // 续行归入上一个字段（支持多行回复/多行提示词）
    }
  }
  return { intent, reply: reply.join('\n').trim(), prompt: prompt.join('\n').trim() }
}

// 流式过程中的可读文本：剥离标签行，只留正在累积的正文
function thinkingBody(raw) {
  const { intent, reply, prompt } = parseAgentReply(raw)
  if (intent === 'generate') return prompt
  if (intent === 'chat' || intent === 'clarify') return reply
  return ''
}

// 解析失败时的兜底决策（宁可聊天，也不要把中文结构化文本当 prompt 丢给生图模型）
function fallbackIntent({ reply, prompt }) {
  if (prompt) return { intent: 'generate', reply, prompt }
  if (reply) return { intent: 'chat', reply, prompt: '' }
  return { intent: 'chat', reply: '抱歉，我没太理解。可以描述一下你想生成的产品、风格或场景吗？', prompt: '' }
}

// 页面刷新 / 请求中断后，会话里可能残留 thinking / generating 的「孤儿消息」
// —— 此时轮询已停止，若不收尾就会永久转圈。加载时统一标记为已中断。
function sanitizeMessages(list = []) {
  return (Array.isArray(list) ? list : []).map(m => {
    if (!m || (!m.thinking && !m.generating)) return m
    return { ...m, thinking: false, generating: false, error: '生成已中断（页面刷新或连接断开）' }
  })
}

const IMG_GEN_STORAGE_KEY = 'imggen_sessions'

// 模型列表改为从后端 /api/models 动态拉取（NanoBanana 官方实时可用图生图模型）。
// 写死的 seedream-* 不是 NanoBanana 合法 id，传过去会被忽略/回退，故不再内置。
// models: [{ id, displayName, creditsCost, quality, ... }]
const IMG_GEN_MODELS_FALLBACK = [
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana（默认）' },
]

const ASPECT_RATIOS = [
  { key: 'auto', label: '智能' },
  { key: '21:9', label: '21:9' },
  { key: '16:9', label: '16:9' },
  { key: '3:2', label: '3:2' },
  { key: '4:3', label: '4:3' },
  { key: '1:1', label: '1:1' },
  { key: '3:4', label: '3:4' },
  { key: '2:3', label: '2:3' },
  { key: '9:16', label: '9:16' },
]

const IMG_GEN_QUALITY = [
  { key: 'sd', label: '标清 1.5K' },
  { key: 'hd', label: '高清 2K' },
  { key: 'uhd', label: '超清 4K' },
]

const QUANTITY_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 写盘前剥离 base64 图片（性能红线）
// 用户上传的参考图是 FileReader 的**原始** data URL，手机照片动辄 5–10MB/张，
// base64 还要再膨胀 1.33 倍。只要它进了 sessions，每 500ms 的持久化就要做一次
// 数 MB 的 JSON.stringify + 同步 localStorage.setItem —— 主线程被整块占死，
// 表现就是「发消息卡死」「切换品牌卡死」「网页崩溃」（localStorage 上限仅 5MB，
// 超限还会抛 QuotaExceededError）。
// 因此：内存里保留真图（当前会话照常显示），**只在写盘时**换成轻量标记 + 张数。
// 刷新后用占位块代替缩略图 —— 远好于整页卡死。
// ─────────────────────────────────────────────────────────────────────────────
const STRIPPED_IMG = '__img_stripped__'

function stripMessageImages(msg) {
  const imgs = msg?.images
  if (!Array.isArray(imgs) || imgs.length === 0) return msg
  let n = 0
  let changed = false
  const next = imgs.map(u => {
    if (typeof u === 'string' && u.startsWith('data:')) { n++; changed = true; return STRIPPED_IMG }
    return u
  })
  if (!changed) return msg
  return { ...msg, images: next, strippedImages: n }
}

function stripSessionsImages(list) {
  return (Array.isArray(list) ? list : []).map(s => ({
    ...s,
    messages: Array.isArray(s?.messages) ? s.messages.map(stripMessageImages) : s?.messages,
  }))
}

/**
 * 图片生成 —— 一级独立子功能页（AI 聊天式图片生成）
 * 流程：用户输入/参考图 → 豆包整理需求 → 套图 Agent（豆包编排 + 图片模型生图）→ 聊天流返回图片
 * 全程自动推进 confirm / select，一键到底；历史会话自动存 localStorage。
 */
export function ImageGen({ brand }) {
  const fileInputRef = useRef(null)
  const chatEndRef = useRef(null)
  const chatContainerRef = useRef(null)
  const abortRef = useRef(null)          // 当前进行中的请求 AbortController
  const [dragOver, setDragOver] = useState(false)
  const [previewImg, setPreviewImg] = useState(null)

  // 组件卸载 / brand 切换时自动 abort 所有进行中的请求（防止"切换卡死"）
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null }, [brand])

  // ---- 会话管理 ----
  const [sessions, setSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(IMG_GEN_STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [activeSid, setActiveSid] = useState(() => sessions[0]?.id || null)
  const activeSession = useMemo(() => sessions.find(s => s.id === activeSid) || null, [sessions, activeSid])
  const [messages, setMessages] = useState(() => sanitizeMessages(activeSession?.messages || []))
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState([]) // data URL array
  const [loading, setLoading] = useState(false)
  const [thinkingText, setThinkingText] = useState('')   // 豆包整理需求的流式输出（实时可见）

  // ---- 生成参数 ----
  // 模型列表从后端 /api/models 动态拉取（NanoBanana 官方实时可用图生图模型）
  const [models, setModels] = useState(IMG_GEN_MODELS_FALLBACK)   // [{ value, label, creditsCost, quality }]
  const [model, setModel] = useState('')          // 选中的模型 id（拉取成功后默认取首个/默认项）
  const [modelLoading, setModelLoading] = useState(false)
  const [aspectRatio, setAspectRatio] = useState('auto')
  const [quality, setQuality] = useState('hd')
  const [quantity, setQuantity] = useState('1')

  // 清晰度选项：跟随当前选中模型动态过滤（每个模型有自己的 quality 字段：['sd','hd'] / ['hd','uhd'] 等）
  const qualityOptions = useMemo(() => {
    if (!model) return IMG_GEN_QUALITY
    const m = models.find(x => x.value === model)
    if (!m || !Array.isArray(m.quality) || m.quality.length === 0) return IMG_GEN_QUALITY
    return IMG_GEN_QUALITY.filter(q => m.quality.includes(q.key))
  }, [model, models])

  // 切换模型时，如果当前 quality 不在新模型的清晰度列表中，自动重置为第一个
  useEffect(() => {
    if (!qualityOptions.some(q => q.key === quality)) {
      setQuality(qualityOptions[0]?.key || 'hd')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // 自动滚动到底
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 切换会话时加载对应消息
  useEffect(() => { setMessages(sanitizeMessages(activeSession?.messages || [])) }, [activeSid]) // eslint-disable-line

  // 自动持久化：sessions 即时更新（纯内存），写盘 debounce 500ms
  // —— 避免高频（生图进度轮询）触发全量 JSON.stringify 阻塞主线程
  useEffect(() => {
    setSessions(prev => prev.map(s => s.id === activeSid ? { ...s, messages, updatedAt: Date.now() } : s))
  }, [messages, activeSid])

  // 写盘：先剥离 base64 参考图再 stringify，避免数 MB 的同步序列化阻塞主线程
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(IMG_GEN_STORAGE_KEY, JSON.stringify(stripSessionsImages(sessions))) } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [sessions])

  // 动态拉取 NanoBanana 可用模型列表（/api/models），填充模型下拉
  // 首个选项为「智能（按清晰度）」(value='')：不指定具体模型，后端按 quality 选对应档位模型，
  // 这样清晰度选择器能真正改变出图引擎/分辨率。
  useEffect(() => {
    let alive = true
    setModelLoading(true)
    api.models()
      .then(res => {
        if (!alive) return
        const list = Array.isArray(res?.models) ? res.models : []
        const opts = list.map(m => ({
          value: m.id,
          label: m.displayName || m.id,
          creditsCost: m.creditsCost,
          quality: m.quality,
          speed: m.speed,
        }))
        // 默认模型排到顶部提示
        const def = res?.default
        if (def && opts.length && opts[0].value !== def) {
          const di = opts.findIndex(o => o.value === def)
          if (di > 0) { const [d] = opts.splice(di, 1); opts.unshift(d) }
        }
        setModels([{ value: '', label: '智能（按清晰度）' }, ...opts])
        if (!model) setModel('')   // 默认走「智能」：让清晰度决定档位
      })
      .catch(e => {
        if (!alive) return
        console.warn('模型列表拉取失败，使用兜底默认:', e?.message || e)
        setModels(IMG_GEN_MODELS_FALLBACK)
        if (!model) setModel(IMG_GEN_MODELS_FALLBACK[0].value)
      })
      .finally(() => { if (alive) setModelLoading(false) })
    return () => { alive = false }
  }, []) // eslint-disable-line

  const saveSessions = useCallback((updater) => {
    setSessions(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try { localStorage.setItem(IMG_GEN_STORAGE_KEY, JSON.stringify(stripSessionsImages(next))) } catch {}
      return next
    })
  }, [])

  const createSession = useCallback(() => {
    const sid = 'ig_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    const s = { id: sid, title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    saveSessions(prev => [s, ...prev])
    setActiveSid(sid)
    setMessages([])
  }, [saveSessions])

  const pushMessage = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ts: Date.now() }])
  }, [])

  const updateMessages = useCallback((updater) => {
    setMessages(prev => (typeof updater === 'function' ? updater(prev) : updater))
  }, [])

  // 上传参考图（选择）
  const onFileSelected = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const readers = files.map(f => new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => resolve({ name: f.name, url: r.result })
      r.readAsDataURL(f)
    }))
    const results = await Promise.all(readers)
    setPendingImages(prev => [...prev, ...results])
    e.target.value = ''
  }

  // 粘贴图片
  const onPaste = (e) => {
    const items = Array.from(e.clipboardData?.items || [])
    items.forEach(item => {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) {
          const r = new FileReader()
          r.onload = () => setPendingImages(prev => [...prev, { name: f.name || 'pasted.png', url: r.result }])
          r.readAsDataURL(f)
        }
      }
    })
  }

  // 拖拽图片
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    const readers = files.map(f => new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => resolve({ name: f.name, url: r.result })
      r.readAsDataURL(f)
    }))
    Promise.all(readers).then(results => setPendingImages(prev => [...prev, ...results]))
  }

  const removePendingImg = (idx) => setPendingImages(prev => prev.filter((_, i) => i !== idx))

  // 删除会话
  const deleteSession = (sid, e) => {
    e?.stopPropagation()
    const next = sessions.filter(s => s.id !== sid)
    saveSessions(next)
    if (activeSid === sid) setActiveSid(next[0]?.id || null)
  }

  // 发送消息 + 触发生成
  const doSend = async () => {
    const text = input.trim()
    if (!text && !pendingImages.length) return
    const sendingImages = [...pendingImages]
    const userMsg = { role: 'user', content: text, images: pendingImages.map(p => p.url) }
    pushMessage(userMsg)
    setInput('')
    setPendingImages([])
    setLoading(true)

    try {
      // 1. 豆包意图识别（流式展示，实时可见思考过程）
      setThinkingText('')
      pushMessage({ role: 'agent', content: '', thinking: true })

      const systemPrompt = `你是「云眠花园」AI 图片生成助手。
用户以对话方式与你交流。你必须先判断用户这一句话的意图，再严格按格式输出。

【能力范围】不限制领域——logo、人物、风景、家纺、电商产品图、抽象插画、漫画、宠物、二次元等任何主题都可以生成。
只有「完全没主体信息」或「明显是聊天/提问」才走其他分支。

【意图类别】
- chat：闲聊、打招呼、问你能做什么、问价格/用法、对上文的追问、无法成图的描述
- clarify：完全无法识别主体（如「帮我画一下」「出一张图」零主体信息）
  重要：如果对话历史里已经问过澄清、用户回复了任何内容（哪怕只是「Luluna 品牌的 logo」），立即转 generate，不要再重复问同样的问题
- generate：能识别出主体（产品/场景/风格/对象至少有其一），立即生成

【输出格式】严格三行，不要有多余内容、不要用 markdown 代码块包裹：
意图：<chat|clarify|generate>
回复：<chat/clarify 时给用户的中文回复，简短友好，2-3 句；generate 时留空>
提示词：<generate 时的精炼英文生图 prompt；chat/clarify 时留空>

【提示词规范】英文，含主体、材质、风格、构图、光影、画质，60-90 词，不要多余解释。

【强制约束·不画人物的手】只要画面里出现人物，一律不要画出手部：
- prompt 中必须明确包含负面描述：no hands, hands not visible, no visible hands, no fingers, hands cropped out of frame
- 用构图或道具让手自然不出现：手背在身后 / 插在口袋 / 抱臂 / 握着道具被遮挡 / 特写只到胸部以上 / 手部裁切到画面外
- 绝对不要生成手指、手掌、手腕等任何手部细节（AI 画手极易失真，这是硬性要求）`

      const chatMessages = [
        ...(activeSession?.messages || []).filter(m => m.role === 'user' && m !== userMsg).slice(-10).map(m => ({ role: 'user', content: m.content })),
        { role: 'user', content: text ? (sendingImages.length ? `${text}（附带了参考图）` : text) : '（用户只上传了参考图，没有文字说明，请据此生图）' },
      ]

      // 意图决策：{ intent: 'chat' | 'clarify' | 'generate', reply, prompt }
      let decision
      try {
        // 创建 AbortController：品牌切换 / 组件卸载时自动 abort（防止卡死）
        const ctrl = new AbortController()
        abortRef.current = ctrl
        // 30 秒超时保险（豆包正常 2-7s；超时说明后端挂了或网络断了）
        const timer = setTimeout(() => ctrl.abort(), 30000)

        // 流式：豆包边写边展示，用户能实时看到思考过程（不再是一行静态 spinner）
        let acc = ''
        await api.chatStream({
          messages: chatMessages,
          system: systemPrompt,
          model: 'doubao',
          max_tokens: 500,
          temperature: 0.4,
          brand,
        }, ({ content }) => {
          if (content) { acc += content; setThinkingText(acc) }
        }, ctrl.signal)

        clearTimeout(timer)
        abortRef.current = null
        const parsed = parseAgentReply(acc)
        decision = parsed.intent ? parsed : fallbackIntent(parsed)
      } catch (e) {
        abortRef.current = null
        // 用户主动中止（切换品牌等）→ 不显示错误，静默收尾
        if (e.name === 'AbortError') {
          updateMessages(prev => {
            const next = [...prev]
            const idx = next.findIndex(m => m.thinking)
            if (idx >= 0) next[idx] = { ...next[idx], thinking: false, content: '已取消' }
            return next
          })
          setThinkingText('')
          setLoading(false)
          return
        }
        console.warn('LLM 调用失败，按启发式兜底:', e?.message || e)
        // 无意图可用时的保守兜底：附图 / 描述较长才生图，否则当闲聊，避免"你好"也触发生图
        const hasSignal = sendingImages.length > 0 || (text || '').length >= 8
        decision = hasSignal
          ? { intent: 'generate', reply: '', prompt: text }
          : { intent: 'chat', reply: '我这边暂时有点卡，稍后再试一次？如果想生成图片，可以描述一下产品、风格和场景。' }
      }

      // 2. 分支：闲聊 / 追问 → 只回文本，绝不调用生图模型
      if (decision.intent !== 'generate') {
        const replyText = decision.reply || '抱歉，我没太理解。可以描述一下你想生成的产品、风格或场景吗？'
        updateMessages(prev => {
          const next = [...prev]
          const idx = next.findIndex(m => m.thinking)
          if (idx >= 0) next[idx] = { ...next[idx], thinking: false, content: replyText }
          else next.push({ role: 'agent', content: replyText })
          return next
        })
        setThinkingText('')
        setLoading(false)
        return
      }

      const refinedPrompt = (decision.prompt || text || '').trim()

      // thinking → generating（保留整理出的 prompt，生图期间仍可查看）
      const finalThink = (refinedPrompt || '').trim()
      updateMessages(prev => {
        const next = [...prev]
        const idx = next.findIndex(m => m.thinking)
        if (idx >= 0) next[idx] = { ...next[idx], thinking: false, thinkText: finalThink, generating: true, ts: Date.now() }
        else next.push({ role: 'agent', content: '', thinkText: finalThink, generating: true, ts: Date.now() })
        return next
      })
      setThinkingText('')

      // 3. 调用套图 Agent，自动推进 confirm / select
      const suiteBody = {
        brand,
        platform: 'douyin',
        language: 'zh',
        size: aspectRatio === 'auto' ? '1:1' : aspectRatio,
        description: refinedPrompt,
        model,
        quality,
        source: 'imggen',
        num_images: Number(quantity) || 4,
      }
      if (sendingImages.length > 0) {
        try {
          const img = sendingImages[0]
          const resp = await fetch(img.url)
          const blob = await resp.blob()
          const file = new File([blob], img.name || 'ref.png', { type: blob.type || 'image/png' })
          const uploaded = await api.suiteUploadRef(file, brand)
          if (uploaded?.path) suiteBody.ref_image = uploaded.path
        } catch (e) { console.warn('参考图上传失败:', e?.message || e) }
      }

      const suiteRes = await api.suiteStart(suiteBody)
      const sid = suiteRes?.sid
      if (!sid) throw new Error(suiteRes?.error || suiteRes?.message || '启动图片生成失败')

      // 3. 轮询并自动推进（品牌切换时 abortRef 会被 abort，循环检测到后立即退出）
      let pollCount = 0
      const maxPoll = 240
      let done = false
      let finalImages = []
      while (pollCount < maxPoll) {
        // 品牌切换 / 组件卸载 → 立即停止轮询
        if (abortRef.current?.signal.aborted) {
          updateMessages(prev => {
            const next = [...prev]
            const idx = next.findIndex(m => m.generating)
            if (idx >= 0) next[idx] = { ...next[idx], generating: false, error: '已取消（切换品牌或刷新页面）' }
            return next
          })
          setLoading(false)
          return
        }
        await new Promise(r => setTimeout(r, 3000))
        const status = await api.suiteStatus(sid)
        const phase = status?.phase
        const running = status?.running

        if (phase === 'await_confirm' && !running) {
          await api.suiteAction({ sid, action: 'confirm' })
          pollCount++
          continue
        }
        if (phase === 'await_select' && !running) {
          const plan = status?.plan || []
          const ids = plan.slice(0, Math.max(1, Number(quantity) || 4)).map(p => p.type_id || p.id).filter(Boolean)
          await api.suiteAction({ sid, action: 'select', type_ids: ids.length ? ids : (plan[0]?.type_id ? [plan[0].type_id] : []) })
          pollCount++
          continue
        }
        if (phase === 'generating') {
          updateMessages(prev => {
            const next = [...prev]
            const idx = next.findIndex(m => m.generating)
            if (idx >= 0) {
              const d = status?.progress?.done || 0
              const t = status?.progress?.total || 0
              next[idx] = { ...next[idx], progress: t ? `生成中 ${d}/${t}` : '生成中…' }
            }
            return next
          })
          pollCount++
          continue
        }
        if (phase === 'done') {
          finalImages = (status?.images || []).filter(it => it.status === 'done' && it.url).map(it => ({ url: imgSrc(it.url), title: it.title || '' }))
          done = true
          break
        }
        if (status?.error) throw new Error(status.error)
        if (!running && phase !== 'await_confirm' && phase !== 'await_select' && phase !== 'generating') {
          throw new Error(status?.message || '生成未能继续，请尝试更具体的描述')
        }
        pollCount++
      }

      if (!done) {
        const st = await api.suiteStatus(sid).catch(() => null)
        finalImages = (st?.images || []).filter(it => it.status === 'done' && it.url).map(it => ({ url: imgSrc(it.url), title: it.title || '' }))
        if (!finalImages.length) throw new Error('生成超时，请稍后重试或调小数量')
      }

      updateMessages(prev => {
        const next = [...prev]
        const idx = next.findIndex(m => m.generating)
        if (idx >= 0) next[idx] = { role: 'agent', content: '', images: finalImages, ts: Date.now() }
        else next.push({ role: 'agent', content: '', images: finalImages, ts: Date.now() })
        return next
      })
    } catch (e) {
      const errMsg = e?.message || '生成失败'
      updateMessages(prev => {
        const next = [...prev]
        const idx = next.findIndex(m => m.generating || m.thinking)
        if (idx >= 0) next[idx] = { role: 'agent', content: '', error: errMsg, ts: Date.now() }
        else next.push({ role: 'agent', content: '', error: errMsg, ts: Date.now() })
        return next
      })
    } finally {
      setLoading(false)
      if (messages.length === 0 && text) {
        saveSessions(prev => prev.map(s =>
          s.id === activeSid ? { ...s, title: text.slice(0, 20) + (text.length > 20 ? '…' : '') } : s
        ))
      }
    }
  }

  // 渲染单条消息（统一间距：消息间距 mb-3，图片网格 gap-2）
  const renderMsg = (m) => {
    if (m.role === 'user') {
      return (
        <div key={m.id} className="mb-3 flex justify-end">
          <div className="max-w-[80%]">
            {m.images?.length > 0 && (
              <div className="mb-2 flex flex-wrap justify-end gap-2">
                {m.images.map((url, i) => (
                  url === STRIPPED_IMG
                    // 刷新后：参考图未持久化（避免 MB 级 localStorage 写盘卡死主线程），用占位块代替
                    ? <div key={i} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-(--radius-lg) border border-dashed border-(--border) bg-(--surface-bg-2) text-[10.5px] text-(--muted-foreground)">
                        <Icon name="image" size={16} />
                        <span>参考图</span>
                      </div>
                    : <img key={i} src={url} alt="" className="h-20 w-20 rounded-(--radius-lg) border border-(--border) object-cover" />
                ))}
              </div>
            )}
            {m.content && (
              <div className="rounded-(--radius-xl) bg-(--accent) px-3 py-2.5 text-[13px] leading-relaxed text-(--accent-foreground)">
                {m.content}
              </div>
            )}
          </div>
        </div>
      )
    }
    if (m.thinking) {
      const tk = m.thinkText || thinkingBody(thinkingText)
      return (
        <div key={m.id} className="mb-3 flex justify-start">
          <div className="max-w-[86%]">
            <div className="rounded-(--radius-xl) border border-(--border) bg-(--surface-tertiary) px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-(--muted-foreground)">
                <Spinner size="sm" />
                正在理解你的需求…
              </div>
              {tk
                ? <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-(--muted-foreground)">{tk}</div>
                : <div className="text-[12.5px] text-(--muted-foreground) opacity-60">正在判断是否需要生成图片…</div>}
            </div>
          </div>
        </div>
      )
    }
    if (m.generating) {
      return (
        <div key={m.id} className="mb-3 flex justify-start">
          <div className="max-w-[86%]">
            {m.thinkText && (
              <div className="mb-2 rounded-(--radius-xl) border border-(--border) bg-(--surface-tertiary) px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-(--muted-foreground)">
                  <Icon name="magic" size={12} />
                  整理后的生图 Prompt
                </div>
                <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-(--muted-foreground)">{m.thinkText}</div>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-xs text-(--muted-foreground)">
              <Spinner size="sm" />
              <span>{m.progress || '正在生成图片…'}</span>
            </div>
          </div>
        </div>
      )
    }
    if (m.error) {
      return (
        <div key={m.id} className="mb-3">
          <div className="rounded-(--radius-xl) border border-(--danger) bg-(--danger-soft, rgba(254,44,85,.1)) px-3 py-2.5 text-[12.5px] text-(--danger)">
            生成失败：{m.error}
          </div>
        </div>
      )
    }
    return (
      <div key={m.id} className="mb-3 flex justify-start">
        <div className="max-w-[86%]">
          {m.content && (
            <div className="mb-2 whitespace-pre-wrap rounded-(--radius-xl) bg-(--surface-tertiary) px-3 py-2.5 text-[13px] leading-relaxed text-(--foreground)">
              {m.content}
            </div>
          )}
          {m.images?.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {m.images.map((img, i) => (
                <div key={i} className="overflow-hidden rounded-(--radius-xl) border border-(--border)">
                  <img src={img.url} alt={img.title || ''} className="block aspect-square w-full object-cover" />
                  {img.title && (
                    <div className="bg-(--surface-bg-2) px-2 py-1.5 text-[11.5px] text-(--muted-foreground)">{img.title}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── 统一间距常量（4px 基数盒子模型）─────────────────────────────
  // 章节内边距：sp=16px(p-4) / sp-sm=12px(p-3)
  // 元素间距：gap-md=12px(gap-3) / gap-sm=8px(gap-2)

  return (
    <div className="flex h-full min-h-0 w-full gap-3 rounded-(--radius-2xl) bg-(--background) p-3">
      {/* ═══ 左侧：历史会话 ═══ */}
      <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-(--radius-xl) border-r border-(--border) bg-(--surface-bg-2)">
        {/* 头部：新对话按钮 — p-4 统一章节间距 */}
        <div className="border-b border-(--border) p-4">
          <HeroButton variant="flat" color="primary" size="sm" fullWidth startContent={<Icon name="plus" size={14} />} onPress={createSession}>
            新对话
          </HeroButton>
        </div>
        {/* 列表区 — p-3 紧凑内边距，列表项 gap-2 统一间隔 */}
        <div className="flex-1 overflow-y-auto p-3">
          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center text-xs text-(--muted-foreground)">
              <Icon name="message" size={24} className="opacity-40" />
              <span>暂无对话</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
          {sessions.map(s => {
            const active = s.id === activeSid
            return (
              <div
                key={s.id}
                onClick={() => setActiveSid(s.id)}
                onDoubleClick={() => { const t = prompt('重命名对话:', s.title); if (t) saveSessions(prev => prev.map(x => x.id === s.id ? { ...x, title: t.slice(0, 40) } : x)) }}
                className={`group flex cursor-pointer items-center gap-2.5 rounded-(--radius-xl) border px-3 py-2.5 transition-colors ${active ? 'border-(--accent) bg-(--accent-soft, rgba(254,44,85,.08)) text-(--foreground)' : 'border-transparent bg-(--surface-secondary) text-(--muted-foreground) hover:bg-(--surface-tertiary)'}`}
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-(--radius-lg) bg-(--surface-tertiary) text-(--muted-foreground) transition-colors group-[&:not(:hover)]:bg-transparent">
                  <Icon name="message" size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{s.title}</div>
                  <div className="mt-0.5 text-[11px] text-(--muted-foreground)">{s.messages?.length || 0} 条消息</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                  title="删除对话"
                  className="shrink-0 rounded-(--radius-md) p-1.5 text-(--muted-foreground) opacity-0 outline-none transition-all hover:bg-(--danger-soft, rgba(254,44,85,.1)) hover:text-(--danger) group-hover:opacity-100"
                  aria-label="删除对话"
                >
                  <Icon name="delete" size={14} />
                </button>
              </div>
            )
          })}
          </div>
        </div>
      </aside>

      {/* ═══ 右侧：聊天区 ═══ */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-(--radius-xl)">
        {/* 消息列表 — p-4 统一章节间距 */}
        <div
          ref={chatContainerRef}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          className={`flex-1 overflow-y-auto rounded-(--radius-xl) border border-(--border) p-4 transition-colors ${dragOver ? 'bg-(--accent-soft)' : ''}`}
        >
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-(--muted-foreground)">
              <Icon name="magic" size={28} className="opacity-60" />
              <div className="text-[13px]">输入描述或粘贴参考图，开始 AI 图片生成</div>
              <div className="text-[11px]">支持 Ctrl+V 粘贴图片 · 拖拽文件到此处</div>
            </div>
          )}
          {messages.map(renderMsg)}
          <div ref={chatEndRef} />
        </div>

        {/* ═══ 底部面板：输入 + 工具栏 ═══ */}
        {/* p-4 统一章节间距；内部子区间 gap-3(12px) */}
        <div className="rounded-(--radius-xl) border-t border-(--border) bg-(--surface-bg-2) p-4">
          {/* 待发送图片 — 与下方输入区 gap-3 */}
          {pendingImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingImages.map((img, i) => (
                <div
                  key={i}
                  onClick={() => setPreviewImg(img)}
                  className="group relative inline-flex h-8 max-w-[200px] cursor-pointer items-center gap-1.5 rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) pl-2 pr-1 text-[12px] text-(--foreground) transition-colors hover:bg-(--surface-secondary)"
                >
                  <Icon name="image" size={14} className="shrink-0 text-(--muted-foreground)" />
                  <span className="truncate">{img.name || '图片'}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removePendingImg(i) }}
                    aria-label="移除"
                    className="shrink-0 rounded-(--radius-md) p-0.5 text-(--muted-foreground) transition-colors hover:bg-(--surface-bg-2) hover:text-(--danger)"
                  >
                    <span className="text-[12px] leading-none">×</span>
                  </button>
                  {/* hover 大缩略图：向上方浮出 */}
                  <div className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100">
                    <div className="overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--surface) shadow-(--surface-shadow)">
                      <img src={img.url} alt="" className="h-32 w-32 object-cover" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 输入行 — 输入框与发送按钮 gap-3 */}
          <div className="flex items-end gap-3">
            <HeroTextArea
              value={input}
              onChange={setInput}
              onKeyDown={(e) => {
                // Enter 换行（默认，避免输入中误触）；Cmd/Ctrl+Enter 显式发送
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSend() }
              }}
              onPaste={onPaste}
              placeholder="上传参考图、输入文字或 @ 主体，描述你想生成的图片（Enter 换行，⌘+Enter 发送）"
              minRows={2}
              autoResize
              className="flex-1"
              inputClassName="bg-(--surface-tertiary) text-(--foreground) border-(--border) rounded-(--radius-lg)"
            />
            <HeroButton isIconOnly variant="solid" color="primary" size="lg" onPress={doSend} isDisabled={loading || (!input.trim() && !pendingImages.length)} aria-label="发送" className="shrink-0">
              {loading ? <Spinner size="sm" color="current" /> : <Icon name="send" size={16} />}
            </HeroButton>
          </div>

          {/* 工具栏 — 与上方输入行 mt-3，控件间 gap-2 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <HeroSelect
              value={model}
              onChange={setModel}
              className="w-44"
              options={models}
              placeholder="选择模型"
              isDisabled={modelLoading && models.length === 0}
              direction="up"
            />
            <HeroSelect
              value={aspectRatio}
              onChange={setAspectRatio}
              className="w-28"
              options={ASPECT_RATIOS.map(a => ({ value: a.key, label: a.label }))}
              direction="up"
            />
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={[quality]}
              onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setQuality(v) }}
              className="inline-flex rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) p-0.5"
            >
              {qualityOptions.map(q => (
                <ToggleButton key={q.key} id={q.key} className="rounded-(--radius-lg) px-3 py-1.5 text-[11.5px] text-(--muted-foreground) data-[selected=true]:bg-(--surface-secondary) data-[selected=true]:text-(--foreground) data-[selected=true]:font-semibold transition-colors">
                  {q.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={[quantity]}
              onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setQuantity(v) }}
              className="inline-flex rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) p-0.5"
            >
              {QUANTITY_OPTIONS.map(q => (
                <ToggleButton key={q.value} id={q.value} className="rounded-(--radius-lg) px-3.5 py-1.5 text-[11.5px] text-(--muted-foreground) data-[selected=true]:bg-(--surface-secondary) data-[selected=true]:text-(--foreground) data-[selected=true]:font-semibold transition-colors">
                  {q.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <HeroButton isIconOnly variant="light" size="sm" className="shrink-0 border border-(--border) text-(--muted-foreground)" onPress={() => fileInputRef.current?.click()} aria-label="上传参考图">
              <Icon name="upload" size={14} />
            </HeroButton>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileSelected} />
            <span className="ml-auto text-[11px] text-(--muted-foreground)">8 张 / 千积分</span>
          </div>
        </div>
      </section>

      {/* 全屏图片查看器（点击 chip 触发） */}
      {previewImg && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
          onClick={() => setPreviewImg(null)}
        >
          <div className="relative max-h-full max-w-full">
            <img
              src={previewImg.url}
              alt={previewImg.name || ''}
              className="max-h-[85vh] max-w-[90vw] rounded-(--radius-xl) object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setPreviewImg(null)}
              aria-label="关闭"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <span className="text-lg leading-none">×</span>
            </button>
            {previewImg.name && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-(--radius-md) bg-black/60 px-3 py-1 text-[12px] text-white">
                {previewImg.name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ImageGen
