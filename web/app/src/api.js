// 后端 API 封装（Designer 模式扩展：多了上传/删除/图库列表/批量合成 + 品牌切换）
// - 浏览器 Vite dev: 走 /api 前缀 -> Vite proxy -> 127.0.0.1:8000
// - 桌面版/生产构建: 直连 127.0.0.1:8000（后端固定端口）

const isElectron = typeof window !== 'undefined' && !!window.__electron_env
const DEV = (typeof import.meta !== 'undefined' && import.meta?.env?.DEV) || window.__electron_env === 'development'

const BASE_URL = (() => {
  if (isElectron) return window.__api_base__ || 'http://127.0.0.1:8000'
  if (DEV) return ''
  // 使用页面自身 origin，确保图片地址与页面同源（localhost:8000 与 127.0.0.1:8000 视为不同源，
  // 否则 <img> 能显示但绘制到 canvas 后 toDataURL 会因跨域污染而抛 SecurityError，导致从图库选择的图片无法加入）
  return window.location.origin
})()

import { accId } from './accountKeys'

// 当前登录账号（与 auth.type 对应）：云眠花园 -> 'ymhy'，创作者 -> 'creator'。
// 所有后端请求都附带 ?account=，使后端按账号隔离图片/记录数据。
let _currentAccount = null
export function setAccount(a) {
  _currentAccount = a ? accId(a) : null
}

function _qs(params) {
  const p = new URLSearchParams()
  let any = false
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue
    p.append(k, String(v))
    any = true
  }
  if (_currentAccount) { p.append('account', _currentAccount); any = true }
  return any ? `?${p.toString()}` : ''
}

function _withAccount(path) {
  if (!_currentAccount) return path
  if (typeof path === 'string' && path.includes('account=')) return path
  const sep = (typeof path === 'string' && path.includes('?')) ? '&' : '?'
  return `${path}${sep}account=${encodeURIComponent(_currentAccount)}`
}

async function handle(res) {
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = (data && data.detail) || data || res.statusText || '请求失败'
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

function fullUrl(path) {
  if (path.startsWith('http')) return path
  // /__backend__/* 是 Vite dev server 专属接口（apply: serve），永远走当前 origin
  // 如果是 vite 启动就命中 vite；如果不是 vite，404 也正好让 UI 隐藏该控件，符合预期
  if (path.startsWith('/__backend__/')) return path
  if (isElectron) return BASE_URL + path
  return (DEV ? '' : BASE_URL) + path
}

async function request(path, opts = {}) {
  return fetch(fullUrl(_withAccount(path)), {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  }).then(handle)
}

async function requestBlob(path, opts = {}) {
  const res = await fetch(fullUrl(_withAccount(path)), {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('application/json') ? await res.json() : await res.text()
    const msg = (data && data.detail) || data || res.statusText || '请求失败'
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  let filename = null
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/)
  if (utf8Match) filename = decodeURIComponent(utf8Match[1])
  else {
    const m = disposition.match(/filename="?([^";\r\n]+)"?/)
    if (m) filename = m[1]
  }
  return { blob, filename }
}

async function upload(bucket, files /* File[] */, opts = {} /* { brand } */) {
  const fd = new FormData()
  for (const f of files) fd.append('files', f, f.name || `file-${Date.now()}.png`)
  const res = await fetch(fullUrl(`/api/upload/${bucket}${_qs({ brand: opts.brand })}`), { method: 'POST', body: fd })
  return handle(res)
}

export const api = {
  isElectron,
  isDev: DEV,
  baseUrl: BASE_URL,
  setAccount,
  // 品牌元数据：返回 [{ key, label, en_label, main_category, main_hint, cat_hint }]
  brands: () => request('/api/brands'),
  // bucket: cats | mains (=crawled) | synthesized
  imageUrl(bucket, name, opts = {} /* { brand } */) {
    const cat = bucket === 'cats' ? 'cat' : bucket === 'mains' ? 'crawled' : bucket
    return fullUrl(`/api/image/${encodeURIComponent(cat)}/${encodeURIComponent(name)}${_qs({ brand: opts.brand })}`)
  },
  // 生成缩略图 URL，列表视图用（默认宽度 300px）
  thumbUrl(bucket, name, width = 300, opts = {} /* { brand } */) {
    const cat = bucket === 'cats' ? 'cat' : bucket === 'mains' ? 'crawled' : bucket
    return fullUrl(`/api/image/${encodeURIComponent(cat)}/${encodeURIComponent(name)}${_qs({ brand: opts.brand, w: width })}`)
  },
  // 把「已经拼好的图片 URL」就地转成缩略图 URL —— 供列表 / 网格 / 卡片等小尺寸显示使用。
  //
  // 为什么需要它：生成图原图是 4–7MB 的 PNG（NanoBanana 出图未压缩），而服务器公网上行
  // 只有 ~70KB/s，一张原图要 85 秒才传完 —— 卡片墙会成片「转圈」。缩略图由后端 Pillow
  // 生成 JPEG（480 宽约 60–80KB，1–2 秒）并长期缓存，视觉上在卡片尺寸内几乎无差别。
  //
  // 使用边界（重要）：**只用于显示**。下载（a.href）、大图预览、提交给后端的参考图路径
  // 一律继续用原图 URL，切勿用本函数，否则会牺牲成品质量。
  thumbOf(url, width = 480) {
    if (!url || typeof url !== 'string') return url || ''
    if (!url.includes('/api/image/')) return url // COS 直链 / data URL / blob 原样返回
    if (/[?&]w=\d/.test(url)) return url // 已带 w 参数，避免重复叠加
    return url + (url.includes('?') ? '&' : '?') + 'w=' + width
  },
  // 与 imageUrl 相同，但返回 Promise 用于需要鉴权/签名/回退的场景
  async resolveImageUrl(bucket, name, opts = {}) {
    const raw = this.imageUrl(bucket, name, opts)
    const fallbackExts = opts.fallbackExts || (bucket === 'synthesized' ? ['.jpg', '.jpeg', '.webp', '.png'] : null)
    if (!fallbackExts) return raw
    if (name && /\.(jpg|jpeg|png|webp)$/i.test(name)) return raw
    try {
      const head = await fetch(raw, { method: 'HEAD', cache: 'no-store' })
      if (head.ok) return raw
    } catch { /* ignore */ }
    const base = raw.replace(/\.[^.\/?#]*($|\?|#)/, '$1')
    for (const ext of fallbackExts) {
      const u = base + ext
      try {
        const h = await fetch(u, { method: 'HEAD', cache: 'no-store' })
        if (h.ok) return u
      } catch { /* ignore */ }
    }
    return raw
  },
  health: () => request('/api/health'),
  config: () => request('/api/config'),
  images: (bucket, opts = {}) => request(`/api/images/${bucket}${_qs({ brand: opts.brand })}`, { cache: 'no-store' }),
  // NanoBanana 模型枚举（含 displayName/creditsCost/tags）
  models: () => request('/api/models'),
  // 查询 NanoBanana 账户剩余积分
  credits: async () => {
    const r = await request('/api/credits');
    const pick = (k, fallback=0) => {
      const v = r?.[k] ?? r?.data?.[k] ?? null;
      return (typeof v === 'number' && v >= 0) ? v : fallback;
    };
    return {
      raw: r,
      total_credits: pick('total_credits', pick('credits', 0)),
      image_credits: pick('image_credits', Math.floor(pick('credits', 0) * 0.7)),
      video_credits: pick('video_credits', Math.ceil(pick('credits', 0) * 0.3)),
      llm_credits: pick('llm_credits', null),
      llm_balance_cny: (() => { const v = r?.llm_balance_cny ?? r?.data?.llm_balance_cny ?? null; return typeof v === 'number' ? v : null; })(),
      llm_model: r?.llm_model ?? r?.data?.llm_model ?? 'deepseek-v4-flash',
      degraded: !!r?.degraded,
      message: r?.message || ''
    };
  },
  // 豆包（火山方舟 Ark）连通性 / 余额探针
  doubaoStatus: async () => {
    try {
      const r = await request('/api/doubao/status');
      return {
        ok: !!r?.ok,
        model: r?.model || '',
        latency_ms: (typeof r?.latency_ms === 'number') ? r.latency_ms : null,
        message: r?.message || '',
        balance: (typeof r?.balance === 'number') ? r.balance : null,
        balance_source: r?.balance_source || null,
        needs_ak_sk: !!r?.needs_ak_sk,
      };
    } catch (e) {
      return { ok: false, model: '', latency_ms: null, message: '豆包状态接口调用失败', balance: null, balance_source: null, needs_ak_sk: false };
    }
  },
  upload,
  deleteImg: (bucket, name, opts = {}) =>
    request(`/api/delete/${bucket}/${encodeURIComponent(name)}${_qs({ brand: opts.brand })}`, { method: 'POST' }),

  // ===== 套图生成（Suite Generator · 豆包 function-calling Agent）=====
  // 开启会话：body = { brand, platform, language, size, description, ref_image }
  suiteStart: (body) =>
    request('/api/suite/start', { method: 'POST', body: JSON.stringify(body) }),
  // 用户操作：confirm / cancel(带 extra 补充说明) / select(带 type_ids)
  suiteAction: (body) =>
    request('/api/suite/action', { method: 'POST', body: JSON.stringify(body) }),
  // 轮询会话状态（聊天流 / 勾选卡片 / 生图进度与结果）
  suiteStatus: (sid) =>
    request(`/api/suite/status/${encodeURIComponent(sid)}`, { cache: 'no-store' }),
  // 流式会话状态（Server-Sent Events），返回 EventSource 实例，onMessage 回调
  suiteStream: (sid, onMessage, onError, onComplete) => {
    const es = new EventSource(fullUrl(`/api/suite/stream/${encodeURIComponent(sid)}`))
    es.onmessage = (event) => {
      if (event.data === '[DONE]') {
        es.close()
        if (onComplete) onComplete()
        return
      }
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
        if (data.error) {
          es.close()
          if (onError) onError(data.error)
        } else if (!data.running) {
          es.close()
          if (onComplete) onComplete()
        }
      } catch (e) {
        console.error('suiteStream parse error', e, event.data)
      }
    }
    es.onerror = () => {
      // 连接中断（网络抖动 / 反向代理长连接超时）时**不要 close** ——
      // EventSource 自带自动重连，close() 会把它杀掉，导致「一直报连接断开且不再恢复」。
      // 只有浏览器彻底放弃（readyState=2 CLOSED，如 4xx / 服务不可达）才上报错误。
      if (es.readyState === 2) {
        console.warn('suiteStream 已关闭（浏览器放弃重连）')
        if (onError) onError('连接断开')
      } else {
        console.warn('suiteStream 连接中断，浏览器自动重连中…')
      }
    }
    return es
  },
  // 上传参考商品图（品牌隔离），返回 { path, filename }
  suiteUploadRef: async (file, brand) => {
    const fd = new FormData()
    fd.append('file', file, file.name || 'ref.png')
    const res = await fetch(fullUrl(`/api/suite/upload_ref${_qs({ brand })}`), { method: 'POST', body: fd })
    return handle(res)
  },

  // 1688 链接导入：解析主图（支持单条和多条），选择（支持单张和批量）入库
  parse1688: (url, brand) =>
    request('/api/1688/parse', { method: 'POST', body: JSON.stringify({ url, brand }) }),
  parse1688Batch: (urls, brand, limit_per_product = 5) =>
    request('/api/1688/parse/batch', { method: 'POST', body: JSON.stringify({ urls, brand, limit_per_product }) }),
  save1688: (body) =>
    request('/api/1688/save', { method: 'POST', body: JSON.stringify(body) }),
  save1688Batch: (items, brand) =>
    request('/api/1688/save/batch', { method: 'POST', body: JSON.stringify({ items, brand }) }),
  // 浏览器预热过码：启动 Chrome 弹窗等用户手动拖滑块，过码后 cookie 落盘，批量解析自动复用
  warmup1688: (url) =>
    request('/api/1688/warmup', { method: 'POST', body: JSON.stringify({ url }) }),
  // 打开 1688 登录页（常驻浏览器），用户登录一次后免重复验证
  login1688: () =>
    request('/api/1688/login', { method: 'POST', body: JSON.stringify({}) }),

  // 素材库：list / delete（带大小和修改时间）
  libraryList: (bucket, opts = {}) =>
    request(`/api/library/list${_qs({ bucket, brand: opts.brand })}`),
  libraryDelete: (bucket, name, opts = {}) =>
    request(`/api/library/item${_qs({ bucket, name, brand: opts.brand })}`, { method: 'DELETE' }),

  // 合成相关（body 可选 brand/model 字段）
  synthesize: (body) => request('/api/synthesize', { method: 'POST', body: JSON.stringify(body) }),
  // v2 批量接口：后台线程依次排队提交给 NanoBanana，返回 { batch_id, total }
  batch: (body) => request('/api/batch/submit', { method: 'POST', body: JSON.stringify(body) }),
  batchStatus: (id, opts = {}) => request(`/api/batch/status${_qs({ id, brand: opts.brand })}`),
  batchList: (opts = {}) => request(`/api/batch/list${_qs({ brand: opts.brand })}`),
  // 结果图库批量导出：打包成 zip 返回 Blob + 文件名（Content-Disposition）
  exportZip: (body) => requestBlob('/api/export/zip', { method: 'POST', body: JSON.stringify(body) }),
  crawl: () => Promise.reject(new Error('1688模板功能已停用，请使用1688链接导入页面')),

  // 视频批量生成：提交任务（含 prompt 列表、参数、参考图 bucket/name）
  videoSubmit: (body) => request('/api/video/submit', { method: 'POST', body: JSON.stringify(body) }),
  // 视频批量：状态查询（任务列表、单条进度、状态）
  videoBatchStatus: (id, opts = {}) => request(`/api/video/status${_qs({ id, brand: opts.brand })}`),
  videoBatchList: (opts = {}) => request(`/api/video/list${_qs({ brand: opts.brand })}`),
  // 视频单条重生成 / 取消 / 删除
  videoRetry: (body) => request('/api/video/retry', { method: 'POST', body: JSON.stringify(body) }),
  videoCancel: (body) => request('/api/video/cancel', { method: 'POST', body: JSON.stringify(body) }),
  videoDelete: (body) => request('/api/video/delete', { method: 'POST', body: JSON.stringify(body) }),
  // 视频参考图上传（统一 / 一对一 都走这个 bucket=video_refs）
  videoUploadRef: (files, opts = {}) => upload('video_refs', files, opts),
  // 视频结果访问 URL
  videoUrl: (name, opts = {}) => fullUrl(`/api/image/videos/${encodeURIComponent(name)}${_qs({ brand: opts.brand })}`),
  // 视频批量下载（打包 .zip）、单条下载（Blob）
  videoExportZip: (body) => requestBlob('/api/video/export/zip', { method: 'POST', body: JSON.stringify(body) }),

  // AI 优化脚本（分镜脚本智能润色 / 补全字段 / 电商化增强）
  videoOptimizeScript: async (payload = {}) => {
    const DEFAULT_BRAND = 'cloudsleepgarden'
    try {
      return await request('/api/video/optimize_script', {
        method: 'POST',
        body: JSON.stringify({
          script_text: payload.script_text || '',
          brand: payload.brand || DEFAULT_BRAND,
          tips: payload.tips || '',
        })
      })
    } catch (e) {
      // 浏览器 fallback：和后端同逻辑（给缺少的字段补默认 + 加"电影质感"前缀）
      const raw = String(payload.script_text || '').trim()
      const lines = raw.split(/\r?\n/).filter(ln => ln.trim())
      const out = []
      for (const ln of lines) {
        const parts = ln.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean)
        while (parts.length < 3) parts.push('')
        if (parts.length === 3) parts.push('夏日好物种草，养宠家庭必备 · 质感高级 氛围感拉满')
        if (parts.length === 4) parts.push('多景别运镜，节奏紧凑，转场自然')
        if (!/高清|电影|4K|cinematic/i.test(parts[2])) {
          parts[2] = '电影质感，暖色调，高清 4K，' + parts[2]
        }
        out.push(parts.join(' | '))
      }
      return { optimized_script_text: out.join('\n'), message: '本地 fallback 优化完成' }
    }
  },

  // AI 解析脚本并生成每条分镜的图片提示词（结构化 scenes，每一条带 image_prompt）
  videoParseScript: async (payload = {}) => {
    const DEFAULT_BRAND = 'cloudsleepgarden'
    try {
      const r = await request('/api/video/parse_script', {
        method: 'POST',
        body: JSON.stringify({
          script_text: payload.script_text || '',
          brand: payload.brand || DEFAULT_BRAND,
          tips: payload.tips || '',
        }),
      })
      if (r && Array.isArray(r.scenes)) return r
    } catch (_) { /* ignore — go fallback */ }
    // 浏览器 fallback：本地切分 + 给 visual 加前缀生成 image_prompt
    const raw = String(payload.script_text || '').trim()
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    const scenes = []
    const ends = []
    for (const ln of lines) {
      const parts = ln.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean)
      if (parts.length < 3) continue
      while (parts.length < 5) parts.push('')
      const [idxRaw, time, visual, caption, shot] = parts
      if (!visual || visual.length < 2) continue
      let idx = parseInt(idxRaw || String(scenes.length + 1), 10) || scenes.length + 1
      const m = (time || '').match(/(\d+)\s*-\s*(\d+)\s*s/)
      if (m) ends.push(parseInt(m[2], 10))
      const brandFallback = (payload.brand || 'cloudsleepgarden')
      let prefix = brandFallback === 'sofawithcat'
        ? '电商商业摄影，8K高清，超写实，电影质感，柔和自然光影，景深虚化背景，高级感色调，软体家具沙发布特写，'
        : '电商商业摄影，8K高清，超写实，电影质感，柔和自然光影，景深虚化背景，高级感色调，家纺床品四件套特写，'
      if (/猫|毛|粘毛/i.test((caption || '') + (visual || ''))) {
        prefix += '浅色猫毛轻盈散落于面料之上，一拂即落细节真实，'
      }
      if (/冰|凉|丝/.test(visual || '')) {
        prefix += '冰丝面料光滑冷冽，丝绸般光泽在光下细腻流转，'
      } else if (/棉/.test(visual || '')) {
        prefix += '长绒棉面料软糯亲肤，棉纱纹理清晰自然，'
      }
      scenes.push({ idx, time: time || '', visual, caption, shot, image_prompt: (prefix + visual).trim() })
    }
    return {
      scenes,
      est_duration_sec: ends.length > 0 ? Math.max(...ends) : 5,
      message: '本地 fallback 解析完成',
      used_llm: false,
    }
  },

  // ToAPIs 视频生成提交（图生视频：首帧 + Prompt + 时长/分辨率/比例）
  videoToapisSubmit: async (payload = {}) => {
    try {
      return await request('/api/video/toapis/submit', {
        method: 'POST',
        body: JSON.stringify({
          prompt: payload.prompt || '',
          model: payload.model || 'kling-v3',
          image_url: payload.image_url || null,
          duration: payload.duration || 5,
          resolution: payload.resolution || '1080p',
          aspect_ratio: payload.aspect_ratio || '9:16',
          audio: payload.audio !== false,
          brand: payload.brand || 'cloudsleepgarden',
        })
      })
    } catch (e) {
      return { code: -1, message: String(e?.message || e), data: null }
    }
  },
  videoToapisStatus: async (task_id) => request('/api/video/toapis/status' + (task_id ? `?task_id=${encodeURIComponent(task_id)}` : '')),
  videoToapisCredits: async () => request('/api/video/toapis/credits'),
  // ToAPIs 视频生成可用模型 / 分辨率 / 比例 / 时长配置（按 API 返回的模型动态生成）
  videoToapisModels: async () => request('/api/video/toapis/models'),
  // 把 ToAPIs 生成的视频下载到本地 videos 目录（附带消耗积分/模型/分辨率/时长/来源/提示词元数据）
  videoToapisDownload: async (payload = {}) => request('/api/video/toapis/download', {
    method: 'POST',
    body: JSON.stringify({
      url: payload.url || '',
      filename: payload.filename || null,
      brand: payload.brand || 'cloudsleepgarden',
      credits_used: (typeof payload.credits_used === 'number' || typeof payload.credits_used === 'string') ? payload.credits_used : null,
      model: payload.model || null,
      resolution: payload.resolution || null,
      duration: payload.duration || null,
      source: payload.source || null,
      prompt: payload.prompt || null,
    })
  }),
  // 补下载同步：把已提交但未入库（页面刷新/后端重启导致漏轮询）的 ToAPIs 完成视频拉到视频库
  videoToapisSync: async (brand) => request('/api/video/toapis/sync' + (brand ? `?brand=${encodeURIComponent(brand)}` : '')),

  // 复刻视频提交（R2V：垫图 + 垫视频，仅支持视频参考的模型）
  videoReplicateSubmit: async (payload = {}) => {
    try {
      return await request('/api/video/replicate/submit', {
        method: 'POST',
        body: JSON.stringify({
          video_url: payload.video_url || '',
          image_url: payload.image_url || null,
          prompt: payload.prompt || '',
          model: payload.model || 'kling-v3',
          duration: payload.duration || 5,
          resolution: payload.resolution || '1080p',
          aspect_ratio: payload.aspect_ratio || '9:16',
          audio: payload.audio !== false,
          brand: payload.brand || 'cloudsleepgarden',
        })
      })
    } catch (e) {
      return { code: -1, message: String(e?.message || e), data: null }
    }
  },

  deepseekChat: async ({ prompt, system, max_tokens = 2000, temperature = 0.3 } = {}) => request('/api/llm/deepseek/chat', { method: 'POST', body: JSON.stringify({ prompt, system, max_tokens, temperature }) }),

  // 通用多轮对话接口（AI 对话页）；model: 'doubao'(默认) | 'deepseek' | 具体 Model/Endpoint ID；images: 多模态图片 data URL / 本机图库 http url
  chat: async ({ messages, system, max_tokens = 2000, temperature = 0.7, stream = false, model, images, brand } = {}) => request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, system, max_tokens, temperature, stream, model, images, brand }),
  }),
  // SSE 流式对话：逐块回调 onChunk({ content, done, error })；支持 signal 中断
  chatStream: async ({ messages, system, max_tokens = 2000, temperature = 0.7, model, images, brand } = {}, onChunk, signal) => {
    const res = await fetch(fullUrl(_withAccount('/api/chat')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system, max_tokens, temperature, stream: true, model, images, brand }),
      signal,
    })
    if (!res.ok) {
      const ct = res.headers.get('content-type') || ''
      const data = ct.includes('application/json') ? await res.json() : await res.text()
      const msg = (data && data.detail) || data || res.statusText || '请求失败'
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const line = block.split('\n').find(l => l.startsWith('data:'))
        if (!line) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          onChunk && onChunk({ done: true })
          return
        }
        let obj = null
        try { obj = JSON.parse(payload) } catch { continue }
        if (obj.error) {
          onChunk && onChunk({ error: obj.error, done: true })
          return
        }
        if (obj.content) onChunk && onChunk({ content: obj.content })
      }
    }
    onChunk && onChunk({ done: true })
  },

  // 后端进程控制（仅 Vite dev mode 可用：/__backend__/* 由 vite-plugin-backend-control 实现）
  // - status: 探活 8000，返回 { online, started_by_vite, pid, uptime_sec, log_tail }
  // - start:  spawn python3 app.py，等待 /api/health 通过（最长约 15s）
  // - stop:   kill 我们 spawn 的进程 + 按 :8000 端口兜底清理
  backendStatus: () => request('/__backend__/status'),
  backendStart: () => request('/__backend__/start', { method: 'POST' }),
  backendStop: () => request('/__backend__/stop', { method: 'POST' }),

  // 兼容旧API
  cats: () => request('/api/cats'),
  crawled: () => request('/api/crawled'),
  synthesized: () => request('/api/synthesized'),
  logs: () => request('/api/logs'),
  logDetail: (name) => request(`/api/log/${encodeURIComponent(name)}`),
  oldBatch: (body) => request('/api/batch', { method: 'POST', body: JSON.stringify(body) }),

  // 批量生成分镜图（NanoBanana 模型，步骤3「开始生成图片」调用）
  videoGenerateFrames: async (payload = {}) => {
    const DEFAULT_BRAND = 'cloudsleepgarden'
    try {
      return await request('/api/video/generate_frames', {
        method: 'POST',
        body: JSON.stringify({
          brand: payload.brand || DEFAULT_BRAND,
          ref_image: payload.ref_image || null,
          scenes: Array.isArray(payload.scenes) ? payload.scenes : [],
          prompts: Array.isArray(payload.prompts) ? payload.prompts : [],
          idx_only: typeof payload.idx_only === 'number' ? payload.idx_only : null,
          model_id: payload.model_id || null,
        })
      })
    } catch (e) {
      throw e
    }
  },

  // 分镜图生成进度（轮询）：{ running, current, total, items:[{idx,status,elapsed,error}], message }
  videoFrameProgress: (opts = {}) => request(`/api/video/generate_frames/progress${_qs({ brand: opts.brand })}`),

  // 已生成的分镜图 + 视频列表（「已生成图片/视频」板块）
  // opts.source 可选：仅返回 meta.source 等于该值的视频（如 'replicate' 仅返回复刻视频）
  // opts.allBrands=true：跨当前账号下所有品牌聚合视频（视频库统一展示用）
  videoGenerated: (opts = {}) => request(`/api/video/generated${_qs({ brand: opts.brand, source: opts.source, all_brands: opts.allBrands ? '1' : undefined })}`),
}

export default api
