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

// ---------- 缩略图「COS 直链」映射表 ----------
//
// 为什么需要它（2026-09-28 实测数据）：
//   连本机服务器首字节 **2.24s**（TLS 握手 1.19s，服务器在境外）；连 COS 只要 **0.39s**。
//   缩略图虽然已由后端 302 到 COS，但**每张仍要先交一次这次跨境往返**（实测 ~0.8s/张）。
//
// 解法：/api/images 支持 `?thumbs=480`，在**列表响应里**顺带把最前面几张图的 COS 直链
// 一起带回来 —— 等于用「列表本来就要发的这一次请求」把 N 张图的直链一次带回，
// 省掉 N 次往返。这里把它存成映射表，thumbUrl() / thumbOf() 一算出来就换成直链，
// 于是 <img> 直接指向 COS，一次到位。
//
// ⚠️ 两条不要越过的边界 ⚠️
//   1) **不要把预热范围扩大**：本机上行只有约 20KB/s，而一条预签名 URL 约 320 字节 ——
//      多带 100KB 就要用户多等 5 秒。所以后端只签最前面 40 张、只签一档
//      （见 app.py 的 _THUMB_WARM_* 注释，那里有完整算账）。
//   2) **不要在 thumbUrl() 未命中时临时补签**：会引发请求风暴；更要紧的是 URL 变了会让
//      同一个 <img> 把同一张图下载两遍（先 302 路径、再直链），反而更慢。
const _thumbDirect = new Map() // 后端缩略图路径（含查询串） → { url, at }
// 后端签的直链有效期 6 小时。这里 5 小时后主动失效，留 1 小时余量 ——
// 宁可退回「后端 302 路径」（慢约 0.4s），也不要让页面开着几小时后整屏图片 403。
const _THUMB_DIRECT_TTL_MS = 5 * 60 * 60 * 1000

// 取直链（顺带做过期检查）。过期即丢弃，下次渲染自然回退到后端路径。
function _directOf(key) {
  const hit = _thumbDirect.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > _THUMB_DIRECT_TTL_MS) {
    _thumbDirect.delete(key)
    return null
  }
  return hit.url
}

// 缩略图宽度档位：**全站归一到这两档**。
// 档位越多、预热的命中率越低 —— 归一，是「直连」能真正生效的前提
// （原先 120/300/480/720/960 五档并存，一档预热只能覆盖约 1/5 的显示场景）。
export const W_ICON = 480   // 小图标 / 列表 / 网格 / 卡片：显示区 ≤ 480px 都用它
export const W_LARGE = 960  // 只有需要看清细节的大预览才用它

function _catOf(bucket) {
  return bucket === 'cats' ? 'cat' : bucket === 'mains' ? 'crawled' : bucket
}

// 后端缩略图路径 —— **所有查表都走这里**。
// 必须与 thumbUrl() 的产物逐字节一致，否则映射表查不到（查询串顺序也算）。
function _thumbUrlRaw(bucket, name, width, brand) {
  return fullUrl(
    `/api/image/${encodeURIComponent(_catOf(bucket))}/${encodeURIComponent(name)}${_qs({ brand, w: width })}`,
  )
}

// 从「原图 URL」反解出 bucket / name / brand，供 thumbOf 复用 _thumbUrlRaw。
// 反解失败返回 null（调用方退化为原来的字符串拼接）。
function _parseImageUrl(url) {
  const m = String(url).match(/\/api\/image\/([^/?#]+)\/([^/?#]+)(\?[^#]*)?/)
  if (!m) return null
  const cat = decodeURIComponent(m[1])
  let brand
  try {
    brand = new URLSearchParams(m[3] || '').get('brand') || undefined
  } catch {
    brand = undefined
  }
  return {
    bucket: cat === 'cat' ? 'cats' : cat === 'crawled' ? 'mains' : cat,
    name: decodeURIComponent(m[2]),
    brand,
  }
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

// 上传：**浏览器直传 COS**。
//
// ★ 为什么不再走后端 FormData 中转 ★（2026-09-28 实测）
//   经服务器中转：5.61MB 用了 30.2 秒（195 KB/s）
//   浏览器直传  ：同一文件 4.2 秒（1.39 MB/s）—— 快 7 倍
// 用户原来的体感是「上传不了」：其实后端每次都是 200 成功，只是几 MB 的图要等半分钟，
// 而界面只有一个没有进度的「正在上传…」，看起来就像卡死。
// 现在流程：要 PUT 直链 → 逐张直传 COS → confirm 登记。
// **返回结构与原来的 FormData 上传完全一致**，所以所有上传调用点都不用改。
async function upload(bucket, files /* File[] */, opts = {} /* { brand } */) {
  const list = Array.from(files || [])
  if (!list.length) {
    return { bucket, saved: [], skipped: [], total: 0, savedCount: 0 }
  }

  // 1) 取直链。后端在这一步就定好最终文件名（含重名处理），前端照用即可。
  const pre = await request(`/api/upload-presign${_qs({ brand: opts.brand })}`, {
    method: 'POST',
    body: JSON.stringify({
      bucket,
      brand: opts.brand,
      files: list.map((f) => ({ name: f.name || '', size: f.size || 0 })),
    }),
  })
  const items = Array.isArray(pre?.items) ? pre.items : []
  const preSkipped = Array.isArray(pre?.skipped) ? pre.skipped : []
  if (!items.length) {
    // 全被后端拒了（扩展名不支持 / 超过 20MB）→ 按旧结构返回，让调用方正常提示
    return { ...pre, saved: [], savedCount: 0, total: list.length, skipped: preSkipped }
  }

  // 2) 逐张直传。串行、单张失败不中断整批（一张传不上去不该让其余的白做）。
  const done = []
  for (const it of items) {
    const f = list[it.index]
    if (!f) continue
    try {
      const r = await fetch(it.url, { method: 'PUT', body: f })
      if (r.ok) done.push({ name: it.finalName, key: it.key })
    } catch (e) {
      /* 失败的留到最后统一统计，不打断其余文件 */
    }
  }

  // 3) 登记：后端校验对象确实在 COS 上，并把它们取回本地（后续缩略图/合成都基于本地文件）
  if (!done.length) {
    return {
      bucket,
      saved: [],
      skipped: [...preSkipped, ...items.map((i) => ({ name: i.name, reason: '直传失败' }))],
      total: list.length,
      savedCount: 0,
      brand: opts.brand,
    }
  }
  const conf = await request(`/api/upload-confirm${_qs({ brand: opts.brand })}`, {
    method: 'POST',
    body: JSON.stringify({ bucket, brand: opts.brand, items: done }),
  })
  const confSkipped = Array.isArray(conf?.skipped) ? conf.skipped : []
  return { ...conf, skipped: [...preSkipped, ...confSkipped], total: list.length }
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
    return fullUrl(`/api/image/${encodeURIComponent(_catOf(bucket))}/${encodeURIComponent(name)}${_qs({ brand: opts.brand })}`)
  },
  // 生成缩略图 URL（默认 W_ICON=480；见文件上方「缩略图直链映射表」的档位归一说明）。
  //
  // 若该 URL 的 COS 直链已在映射表里（列表接口 ?thumbs= 顺带签好的），直接返回直链 ——
  // 浏览器于是跳过「先连服务器拿 302」那次跨境往返（约 0.8s/张）。
  thumbUrl(bucket, name, width = W_ICON, opts = {} /* { brand } */) {
    const u = _thumbUrlRaw(bucket, name, width, opts.brand)
    return _directOf(u) || u
  },
  // 丢弃某个缩略图的直链，并返回后端路径。
  // 用途：COS 预签名直链有效期 6 小时，超时后访问会 403；<img> 的 onError 里应调用本函数
  // 回退到「后端路径」——后端会 302 到新签名、或就地生成，是一条永远不会 403 的兜底路径。
  dropThumbDirect(bucket, name, width = W_ICON, opts = {}) {
    const raw = _thumbUrlRaw(bucket, name, width, opts.brand)
    _thumbDirect.delete(raw)
    return raw
  },
  // 把「已经拼好的图片 URL」就地转成缩略图 URL —— 供列表 / 网格 / 卡片等小尺寸显示使用。
  //
  // 为什么需要它：生成图原图是 4–7MB 的 PNG（NanoBanana 出图未压缩），而服务器公网上行
  // 只有 ~70KB/s，一张原图要 85 秒才传完 —— 卡片墙会成片「转圈」。缩略图由后端 Pillow
  // 生成 JPEG（480 宽约 60–80KB，1–2 秒）并长期缓存，视觉上在卡片尺寸内几乎无差别。
  //
  // 使用边界（重要）：**只用于显示**。下载（a.href）、大图预览、提交给后端的参考图路径
  // 一律继续用原图 URL，切勿用本函数，否则会牺牲成品质量。
  thumbOf(url, width = W_ICON) {
    if (!url || typeof url !== 'string') return url || ''
    if (!url.includes('/api/image/')) return url // COS 直链 / data URL / blob 原样返回
    if (/[?&]w=\d/.test(url)) return url // 已带 w 参数，避免重复叠加
    // 用 _thumbUrlRaw 重算（而不是简单拼 &w=）：只有查询串的拼法与 thumbUrl 完全一致，
    // 才能命中列表接口签好的直链映射。反解不出 bucket/name 时退回字符串拼接。
    const p = _parseImageUrl(url)
    const u = p
      ? _thumbUrlRaw(p.bucket, p.name, width, p.brand)
      : url + (url.includes('?') ? '&' : '?') + 'w=' + width
    return _directOf(u) || u
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
  // 图库列表。默认顺带把最前面几张图的**缩略图 COS 直链**一起签回来（见文件上方映射表说明）——
  // 这些图随后渲染时会直接指向 COS，省掉逐张「先连服务器拿 302」的跨境往返。
  // opts.thumbWidths 可指定档位；传 null 关闭预热（列表响应会小一些）。
  images: async (bucket, opts = {}) => {
    const widths = opts.thumbWidths === null
      ? []
      : (Array.isArray(opts.thumbWidths) && opts.thumbWidths.length ? opts.thumbWidths : [W_ICON])
    const d = await request(
      `/api/images/${bucket}${_qs({ brand: opts.brand, thumbs: widths.length ? widths.join(',') : undefined })}`,
      { cache: 'no-store' },
    )
    // 灌进映射表：键必须与 thumbUrl()/thumbOf() 算出的完全一致，否则查不到
    if (d && d.thumbs) {
      const at = Date.now()
      for (const [wStr, map] of Object.entries(d.thumbs)) {
        const w = Number(wStr)
        for (const [name, link] of Object.entries(map || {})) {
          if (link) _thumbDirect.set(_thumbUrlRaw(bucket, name, w, opts.brand), { url: link, at })
        }
      }
    }
    return d
  },
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
  // 导出（**推荐路径**）：后端只签发 COS 预签名直链，下载由浏览器**直连 COS** 完成。
  // 为什么不走上面的 exportZip：那条路是「服务器把文件转发给你」，而服务器上行只有 ~20KB/s。
  // 实测同一张 7MB 的图：走服务器 20 秒只传了 393KB；走 COS 直链 1.7 秒传完（快约 220 倍）。
  // 用户选 12 张导出时 zip 有 96MB，走服务器要传 85 分钟 —— 界面会永远停在「打包中」。
  exportPresign: (body) => request('/api/export/presign', { method: 'POST', body: JSON.stringify(body) }),
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

// 单次导出的文件数上限 —— 这是**浏览器内存**的限制，不是后端的。
//
// 导出流程：后端签发 COS 直链（毫秒级、零带宽）→ 浏览器直连 COS 取图
// → **在浏览器本地打包 zip**（见 utils/packZip.js）。
// 打包时内存约等于「原始数据 + zip 输出」≈ 总大小的 2 倍，而单张套图约 8MB：
//   60 张 ≈ 480MB 数据 ≈ 峰值约 1GB 内存 —— Chrome 能稳住的量级；
//   300 张 ≈ 2.4GB 数据 ≈ 峰值约 5GB —— **标签页会直接崩溃**，所以这个值不能随便调大。
// 超限时前端会提示「请分批导出」。
// 注意后端另有一个 `_EXPORT_PRESIGN_MAX_FILES`（300），那是签发接口自身的安全上限，
// 它只签 URL、不吃内存，两者语义不同、不需要一致。
export const EXPORT_MAX_FILES = 60
