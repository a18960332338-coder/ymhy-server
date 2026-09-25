import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api, { EXPORT_MAX_FILES } from '../api'
import Toast from '../toast'
import Icon from '../components/Icon'
import { Button as HeroButton, Modal as HeroModal, Spinner, ToggleButton, ToggleButtonGroup } from '@heroui/react'
import { HeroInput, HeroSlider, HeroSelect, HeroTextArea } from '../components/ui'
import {
  loadGalleryCategories, mapCategoryImages, defaultCategoryKey, DEFAULT_GALLERY_CATEGORY,
} from '../galleryCategories'

// ============================================================================
// 模版合成工具（国内模版生成 + 跨境主图裁切 + 跨境模版库）
// - 合成 / 裁切均在前端 Canvas 完成，无需额外后端算力
// - 自定义模版存到后端 templates / cross_templates 两个 bucket
// ============================================================================

const TPL_BUCKET = 'templates'               // 国内模版
const CROSS_TPL_BUCKET = 'cross_templates'   // 跨境模版
const RESULTS_BUCKET = 'template_results'    // 历史合成结果
const CROP_RESULTS_BUCKET = 'crops'          // 跨境裁切结果

// 从图库选择弹窗的分类统一来自 src/galleryCategories.js（与「图库」页 Tab 一致）。
// ★ 不要再在本文件里硬编码分类列表 —— 否则图库新增分类时这里又会掉队。
const loadPickerBuckets = async (brand) =>
  mapCategoryImages(await loadGalleryCategories(brand), (bucket, im) => ({
    name: im.name,
    // 列表用 300px 缩略图（性能：上百张原图同时加载会卡死）
    url: api.thumbUrl(bucket, im.name, 300, { brand }),
    // 确认合成 / 裁切时用原图（保证输出质量）
    fullUrl: api.imageUrl(bucket, im.name, { brand }),
    mtime: im.mtime,
  }))

// 国内模版生成：跨页面切换（组件卸载）时保留未完成的上传主图草稿，仅在成功合成后清空
const domesticDraft = {} // brand -> { mainImages, mainIdx }
// 跨境模版生成：同样保留主图草稿
const crossDraft = {} // brand -> { mainImages, mainIdx }

const DOM_PLATFORMS = ['淘宝', '天猫', '京东', '拼多多', '抖音']
const CROSS_CATEGORIES = ['促销标签', '节日限定', '品牌风格', '清仓特卖', '新品上架']

const CROP_SIZES = [
  { key: '1:1', w: 1080, h: 1080 },
  { key: '3:4', w: 1080, h: 1440 },
  { key: '4:5', w: 1080, h: 1350 },
  { key: '9:16', w: 1080, h: 1920 },
  { key: '16:9', w: 1920, h: 1080 },
]
const CROP_MODELS = [
  { value: 'auto', label: '智能主体识别（默认）' },
  { value: 'edge', label: '边缘检测裁切' },
  { value: 'face', label: '人脸 / 宠物优先' },
]
const QUALITY_OPTIONS = [
  { value: '1080p', label: '1080p · 高清' },
  { value: '2K', label: '2K · 超清' },
  { value: '4K', label: '4K · 极致' },
]
const QUALITY_SCALE = { '1080p': 1, '2K': 2, '4K': 4 }
const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG · 无损' },
  { value: 'jpeg', label: 'JPG · 通用' },
  { value: 'webp', label: 'WebP · 高压缩' },
]
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

// ============================================================================
// 工具函数
// ============================================================================
const genId = (p = 'x') => p + '_' + Math.random().toString(36).slice(2, 9)

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const s = Math.max(w / iw, h / ih)
  const dw = iw * s
  const dh = ih * s
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function renderComposite(canvas, mainImg, tplImg, opts = {}) {
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  // 主图：支持缩放、拖拽定位与水平镜像（默认 cover 铺满）
  if (mainImg) {
    const iw = mainImg.naturalWidth
    const ih = mainImg.naturalHeight
    if (iw && ih) {
      const cover = Math.max(W / iw, H / ih)
      const s = cover * (opts.mainScale ?? 1)
      const dw = iw * s
      const dh = ih * s
      const ox = opts.mainX ?? 0
      const oy = opts.mainY ?? 0
      const cx = (W - dw) / 2 + ox
      const cy = (H - dh) / 2 + oy
      ctx.save()
      ctx.translate(cx + dw / 2, cy + dh / 2)
      ctx.scale(opts.mainMirror ? -1 : 1, 1)
      ctx.drawImage(mainImg, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    }
  }
  // 模版（顶层叠加，保持原有缩放/位置/透明度）
  if (tplImg) {
    const scale = (opts.scale ?? 100) / 100
    const tw = W * scale
    const th = H * scale
    let ty = 0
    if (opts.position === 'center') ty = (H - th) / 2
    else if (opts.position === 'bottom') ty = H - th
    const tx = (W - tw) / 2
    ctx.globalAlpha = (opts.opacity ?? 100) / 100
    ctx.drawImage(tplImg, tx, ty, tw, th)
    ctx.globalAlpha = 1
  }
}

// 输出画布尺寸：跟随主图原始宽高比（长边 = long），避免 3:4 主图被裁成 1:1 后再拉伸变形
function pickOutSize(mainImg, long = 1000) {
  const iw = mainImg?.naturalWidth || mainImg?.width
  const ih = mainImg?.naturalHeight || mainImg?.height
  if (!iw || !ih) return { w: long, h: long }
  if (iw >= ih) return { w: long, h: Math.max(1, Math.round(long * ih / iw)) }
  return { w: Math.max(1, Math.round(long * iw / ih)), h: long }
}

function renderCrop(canvas, img, size, comp = {}) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!img) return
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const cover = Math.max(size.w / iw, size.h / ih)
  const s = cover * (comp.scale ?? 1)
  const dw = iw * s
  const dh = ih * s
  const cx = (size.w - dw) / 2 + (comp.x ?? 0)
  const cy = (size.h - dh) / 2 + (comp.y ?? 0)
  ctx.drawImage(img, cx, cy, dw, dh)
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => a.remove(), 500)
}

function downloadAll(items, prefix) {
  items.forEach((it, i) => {
    setTimeout(() => downloadDataUrl(it.dataUrl, `${prefix}_${i + 1}.png`), i * 350)
  })
  Toast.success(`开始下载 ${items.length} 张图`)
}

// 批量导出：后端签发 COS 预签名直链，浏览器**直连 COS** 逐张下载。
// ★ 不要再改回「后端打包 zip」★（2026-09-24）：服务器上行只有 ~20KB/s，
// 打包的 zip 在传输时会一直卡在「打包中」（用户实际遇到的现象）；
// 直链实测快约 220 倍。
async function exportLibraryZip(names, bucket, brand, zipName) {
  if (!names || !names.length) return
  if (names.length > EXPORT_MAX_FILES) {
    Toast.warn(`单次最多导出 ${EXPORT_MAX_FILES} 张，已选 ${names.length} 张，请分批导出`)
    return
  }
  try {
    const r = await api.exportPresign({ bucket, names, brand })
    const list = Array.isArray(r?.items) ? r.items : []
    if (!list.length) { Toast.warn('没有可导出的文件'); return }
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      const a = document.createElement('a')
      a.href = it.url
      a.download = it.name
      document.body.appendChild(a); a.click(); a.remove()
      // 逐张间隔：避免浏览器把多次下载合并成一次询问
      await new Promise(res => setTimeout(res, 350))
    }
    Toast.success(`已开始下载 ${list.length} 张图`)
  } catch (e) {
    Toast.error('导出失败：' + (e?.message || e))
  }
}

function fmtSize(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
function fmtDay(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ============================================================================
// 基础 UI 组件
// ============================================================================
// Slider — 基于 HeroUI Slider（轨道/滑块走 HeroUI 样式，label 与数值沿用原布局）
function Slider({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '', style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</span>
      </div>
      <HeroSlider
        value={value}
        onChange={onChange}
        minValue={min}
        maxValue={max}
        step={step}
        showOutput={false}
      />
    </div>
  )
}

// 顶部切换器（国内 / 跨境） — 基于 HeroUI ToggleButtonGroup
function SegSwitch({ options, value, onChange, size = 'md' }) {
  return (
    <ToggleButtonGroup
      selectionMode="single"
      selectedKeys={value != null ? [String(value)] : []}
      onSelectionChange={(keys) => {
        if (onChange && keys) onChange(Array.from(keys)[0])
      }}
      size={size}
      className="inline-flex bg-(--surface-tertiary) border border-(--border) rounded-(--radius-xl) p-1 gap-1"
    >
      {options.map(o => (
        <ToggleButton
          key={String(o.value)}
          id={String(o.value)}
          className="px-4 text-[13px] font-medium text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) data-[pressed=true]:opacity-80 transition-colors rounded-(--radius-lg)"
        >
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

function Steps({ current, items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {items.map((it, i) => {
        const done = i < current
        const active = i === current
        const num = done ? <Icon name="check" size={12} /> : i + 1
        return (
          <React.Fragment key={it}>
            {i > 0 && <div style={{ width: 32, height: 2, background: i <= current ? 'var(--success)' : 'var(--border)', borderRadius: 2 }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 800,
                background: active || done ? 'var(--success)' : 'var(--muted)',
                color: active || done ? '#fff' : 'var(--muted-foreground)',
              }}>{num}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--foreground)' : 'var(--muted-foreground)' }}>{it}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Field({ label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{label}</span>}
      {children}
    </div>
  )
}

/** HeroUI v3 的 Modal 是命名空间复合组件：
 *  Root(DialogTrigger) > [Backdrop, Container(Modal) > Dialog > Header/Body/Footer]
 *  v2 的 size / hideCloseButton / classNames / title 等 props 在 v3 都不存在。 */
function Modal({ title, visible, onClose, children, width = 560, footer }) {
  // 关闭时彻底卸载，避免 HeroUI Modal 的 backdrop 节点残留（高斯模糊遮罩挡住操作）
  if (!visible) return null
  const w = typeof width === 'number' ? `${width}px` : width
  return (
    <HeroModal.Root isOpen onOpenChange={(open) => { if (!open) { onClose && onClose() } }}>
      <HeroModal.Backdrop className="backdrop-blur-sm" />
      <HeroModal.Container>
        <HeroModal.Dialog
          className="border border-(--border) bg-(--surface-bg-2)"
          style={{ width: w, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        >
          {title ? (
            <HeroModal.Header className="border-b border-(--border) px-6 py-4 flex-shrink-0">
              <HeroModal.Heading>{title}</HeroModal.Heading>
            </HeroModal.Header>
          ) : null}
          <HeroModal.Body className="px-6 py-5 overflow-auto" style={{ minHeight: 0, flex: 1 }}>
            {children}
          </HeroModal.Body>
          {footer != null ? (
            <HeroModal.Footer className="border-t border-(--border) px-6 py-4 flex justify-end gap-3 flex-shrink-0">
              {footer}
            </HeroModal.Footer>
          ) : null}
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Root>
  )
}

// 粘贴新增图片：仅在 enabled 时监听全局 paste，从剪贴板提取图片文件
// 跳过输入框/可编辑元素，避免覆盖用户粘贴文本
function usePasteImages(enabled, onFiles) {
  const onFilesRef = useRef(onFiles)
  useEffect(() => { onFilesRef.current = onFiles }, [onFiles])
  useEffect(() => {
    if (!enabled) return
    const handler = (e) => {
      const ae = document.activeElement
      if (ae) {
        const tag = (ae.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea' || ae.isContentEditable) return
      }
      const items = e.clipboardData && e.clipboardData.items
      if (!items) return
      const files = []
      for (const it of items) {
        if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        e.preventDefault()
        onFilesRef.current && onFilesRef.current(files)
      }
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [enabled])
}

// ============================================================================
// 国内模版生成
// ============================================================================
function DomesticTpl({ brand }) {
  const canvasRef = useRef(null)
  const [pvSize, setPvSize] = useState({ w: 1000, h: 1000 })   // 预览/输出画布尺寸：跟随主图宽高比
  const [templates] = useState([])                       // 内置模版已移除，留空
  const [customTpls, setCustomTpls] = useState([])      // 从 bucket 加载的自定义模版
  const [mainImages, setMainImages] = useState(() => domesticDraft[brand]?.mainImages || [])      // 上传的主图（data URL）
  const [mainIdx, setMainIdx] = useState(() => domesticDraft[brand]?.mainIdx || 0)
  const [selTpl, setSelTpl] = useState('')               // 默认空，加载后自动选第一张
  const [opacity, setOpacity] = useState(100)
  const [position, setPosition] = useState('center')
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [results, setResults] = useState([])
  const [resultSel, setResultSel] = useState(() => new Set())
  const [uploading, setUploading] = useState(false)
  const [batching, setBatching] = useState(false)
  const [pasteActive, setPasteActive] = useState(false)
  const [mainScale, setMainScale] = useState(1)
  const [mainX, setMainX] = useState(0)
  const [mainY, setMainY] = useState(0)
  const [mainMirror, setMainMirror] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryTab, setGalleryTab] = useState(DEFAULT_GALLERY_CATEGORY)
  const [galleryBuckets, setGalleryBuckets] = useState([])
  const [gallerySel, setGallerySel] = useState(() => new Set()) // 格式 `${bucket}:${name}`，支持跨分类多选
  const [galleryLoading, setGalleryLoading] = useState(false)

  const galleryItems = useMemo(() => {
    const b = galleryBuckets.find(x => x.key === galleryTab)
    return b?.images || []
  }, [galleryBuckets, galleryTab])

  const currentMain = mainImages[mainIdx] || null
  const allTpls = useMemo(() => [...templates, ...customTpls], [templates, customTpls])
  const selTplObj = allTpls.find(t => t.id === selTpl) || null

  // 加载自定义模版
  const loadCustom = useCallback(async () => {
    try {
      const r = await api.images(TPL_BUCKET, { brand })
      const items = (r?.images || []).map(it => {
        const full = api.imageUrl(TPL_BUCKET, it.name, { brand })
        return {
          id: 'custom_' + it.name,
          builtin: false,
          platform: '自定义',
          title: it.name,
          name: it.name,
          src: full, // 原图：会被 loadImage() 载入做 canvas 合成，禁止换缩略图
          thumb: api.thumbOf(full), // 缩略图：仅列表卡片显示
        }
      })
      setCustomTpls(items)
    } catch { setCustomTpls([]) }
  }, [brand])

  useEffect(() => { loadCustom() }, [loadCustom])

  // 品牌切换时恢复对应草稿（含组件重新挂载后恢复）
  useEffect(() => {
    const d = domesticDraft[brand]
    setMainImages(d?.mainImages || [])
    setMainIdx(d?.mainIdx || 0)
  }, [brand])

  // 上传/删除/切换主图都写回草稿，切到其他页面再回来仍保留
  useEffect(() => {
    domesticDraft[brand] = { mainImages, mainIdx }
  }, [mainImages, mainIdx, brand])

  const deleteMain = (idx) => {
    const next = mainImages.filter((_, i) => i !== idx)
    setMainImages(next)
    setMainIdx(prev => {
      if (idx < prev) return prev - 1
      if (prev >= next.length) return Math.max(0, next.length - 1)
      return prev
    })
    Toast.success('已删除该主图')
  }

  // 实时合成预览
  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return
    ;(async () => {
      const mainImg = currentMain ? await loadImage(currentMain).catch(() => null) : null
      const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
      if (!alive) return
      if (mainImg) setPvSize({ w: mainImg.naturalWidth || 1000, h: mainImg.naturalHeight || 1000 })
      renderComposite(canvas, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
    })()
    return () => { alive = false }
  }, [currentMain, selTplObj, opacity, position, mainScale, mainX, mainY, mainMirror])

  // 画布滚轮缩放（原生 passive:false 才能阻止页面滚动）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      if (!currentMain) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      setMainScale(s => Math.min(3, Math.max(0.5, s * factor)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [currentMain])

  // 主图在画布内拖拽移动
  const onPreviewMouseDown = (e) => {
    if (!currentMain) return
    setDragging(true)
    const rect = canvasRef.current.getBoundingClientRect()
    dragRef.current = {
      sx: e.clientX, sy: e.clientY,
      ox: mainX, oy: mainY,
      k: canvasRef.current.width / rect.width,
    }
  }
  const onPreviewMouseMove = (e) => {
    if (!dragging || !dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) * dragRef.current.k
    const dy = (e.clientY - dragRef.current.sy) * dragRef.current.k
    setMainX(dragRef.current.ox + dx)
    setMainY(dragRef.current.oy + dy)
  }
  const onPreviewMouseUp = () => setDragging(false)
  const resetMainTransform = () => {
    setMainScale(1); setMainX(0); setMainY(0)
    Toast.info('已重置主图位置和缩放')
  }

  // 模版加载完成后自动选中第一张（内置模版已移除）
  useEffect(() => {
    if (!selTpl && allTpls.length) setSelTpl(allTpls[0].id)
  }, [allTpls, selTpl])

  const onUploadMain = (files) => {
    const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'))
    if (!imgs.length) return
    Promise.all(imgs.map(f => new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = () => res(null)
      r.readAsDataURL(f)
    }))).then(urls => {
      const valid = urls.filter(Boolean)
      if (!valid.length) return
      const startIdx = mainImages.length
      setMainImages([...mainImages, ...valid])
      setMainIdx(startIdx) // 跳到第一张新图
      Toast.success(`已添加 ${valid.length} 张主图`)
    })
  }

  const nextMain = () => {
    if (mainImages.length <= 1) { Toast.info('仅有一张主图，可继续上传'); return }
    setMainIdx(i => (i + 1) % mainImages.length)
  }

  // 从图库选择主图（分类与「图库」页一致，见 src/galleryCategories.js）
  const openGallery = async () => {
    setGalleryOpen(true)
    setGalleryLoading(true)
    setGallerySel(new Set())
    try {
      const cats = await loadPickerBuckets(brand)
      setGalleryBuckets(cats)
      // 默认优先选中「合成图」；若合成图为空则回退到第一个有图片的分类
      setGalleryTab(defaultCategoryKey(cats))
    } catch {
      setGalleryBuckets([])
      setGalleryTab(DEFAULT_GALLERY_CATEGORY)
    } finally {
      setGalleryLoading(false)
    }
  }

  const toggleGallerySel = (bucket, name) => {
    const key = `${bucket}:${name}`
    setGallerySel(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  const selectAllActive = () => {
    setGallerySel(prev => {
      const n = new Set(prev)
      galleryItems.forEach(it => n.add(`${galleryTab}:${it.name}`))
      return n
    })
  }

  const confirmGallery = async () => {
    const keys = [...gallerySel]
    if (!keys.length) { Toast.warn('请先勾选图片'); return }
    // 直接存图库原图 URL：避免把 20+ 张大图同步转 canvas 造成的长时间卡顿与内存暴涨
    const list = []
    for (const key of keys) {
      const [bucket, name] = key.split(':')
      const it = galleryBuckets.find(b => b.key === bucket)?.images.find(im => im.name === name)
      if (!it) continue
      list.push(it.fullUrl || it.url)
    }
    if (list.length) {
      const startIdx = mainImages.length
      setMainImages([...mainImages, ...list])
      setMainIdx(startIdx)
      Toast.success(`已从图库加入 ${list.length} 张主图`)
    }
    // 先关弹窗并清空：蒙版立即消失，主图按 URL 懒加载
    setGalleryOpen(false)
    setGallerySel(new Set())
    setGalleryBuckets([])
  }

  const downloadCurrent = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = document.createElement('canvas')
    const mainImg0 = currentMain ? await loadImage(currentMain).catch(() => null) : null
    const sz = pickOutSize(mainImg0)
    c.width = sz.w; c.height = sz.h
    const mainImg = mainImg0
    const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
    renderComposite(c, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
    downloadDataUrl(c.toDataURL('image/png'), `云眠花园_合成_${selTplObj?.title || '模版'}.png`)
    Toast.success('已下载合成图')
  }

  const runBatch = async () => {
    if (!mainImages.length) { Toast.warn('请先上传主图'); return }
    setBatching(true)
    try {
      const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
      const out = []
      for (const src of mainImages) {
        const mainImg = await loadImage(src).catch(() => null)
        if (!mainImg) continue
        const c = document.createElement('canvas')
        const sz = pickOutSize(mainImg)
        c.width = sz.w; c.height = sz.h
        renderComposite(c, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
        out.push({ id: genId('r'), dataUrl: c.toDataURL('image/png') })
      }
      setResults(out)
      setResultSel(new Set())
      // 自动保存到历史合成库
      if (out.length) {
        try {
          const ts = Date.now()
          const files = await Promise.all(out.map(async (r, i) => {
            const blob = await (await fetch(r.dataUrl)).blob()
            return new File([blob], `tpl_${ts}_${i}.png`, { type: 'image/png' })
          }))
          await api.upload(RESULTS_BUCKET, files, { brand })
        } catch (e) {
          // 历史保存失败不影响当前结果展示
          console.warn('保存历史合成记录失败', e)
        }
      }
      Toast.success(`批量合成完成，共 ${out.length} 张`)
      // 合成成功后回到初始状态：清空主图（含跨页保留的草稿）
      setMainImages([])
      setMainIdx(0)
      delete domesticDraft[brand]
    } finally {
      setBatching(false)
    }
  }

  const onAddTemplate = async (files) => {
    const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'))
    if (!imgs.length) return
    setUploading(true)
    try {
      const r = await api.upload(TPL_BUCKET, imgs, { brand })
      Toast.success(`已上传 ${r.savedCount || 0} 个模版`)
      await loadCustom()
    } catch (e) {
      Toast.error('模版上传失败：' + (e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  // 粘贴新增模版（hover 模版面板时生效）
  usePasteImages(pasteActive, onAddTemplate)

  const deleteTemplate = async (t) => {
    try {
      await api.deleteImg(TPL_BUCKET, t.name, { brand })
      Toast.success('已删除模版')
      const next = customTpls.filter(x => x.id !== t.id)
      setCustomTpls(next)
      if (selTpl === t.id) {
        const remaining = [...templates, ...next]
        setSelTpl(remaining.length ? remaining[0].id : '')
      }
    } catch (e) {
      Toast.error('删除失败：' + (e?.message || e))
    }
  }

  const filtered = useMemo(() => {
    let list = allTpls
    if (platformFilter) list = list.filter(t => t.platform === platformFilter)
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(t => (t.title || '').toLowerCase().includes(kw) || (t.platform || '').toLowerCase().includes(kw))
    }
    return list
  }, [allTpls, platformFilter, search])

  const platformOptions = [
    { value: '', label: '全部平台' },
    ...DOM_PLATFORMS.map(p => ({ value: p, label: p })),
    { value: '自定义', label: '自定义' },
  ]

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tk-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="adjustment" size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>国内模版生成</span>
        </div>
        <span className="tk-chip">产品主图 × 电商模版 → 实时合成</span>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(320px, 460px) 1fr', gap: 12 }}>
        {/* 左：预览 + 主图操作 */}
        <div className="tk-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, minHeight: 0, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>合成预览</span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>主图 {mainImages.length ? `${mainIdx + 1}/${mainImages.length}` : '0'} · 拖拽移动 · 滚轮缩放 · 镜像</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <canvas
              ref={canvasRef}
              width={pvSize.w}
              height={pvSize.h}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
              style={{
                width: '100%', maxWidth: 380, aspectRatio: `${pvSize.w} / ${pvSize.h}`, borderRadius: 14,
                border: '1px solid var(--border)', background: 'transparent',
                cursor: currentMain ? (dragging ? 'grabbing' : 'grab') : 'default',
                touchAction: 'none',
              }}
            />
          </div>
          {mainImages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {mainImages.map((src, i) => (
                <div
                  key={i}
                  onClick={() => setMainIdx(i)}
                  style={{ position: 'relative', width: 52, height: 52, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${i === mainIdx ? '#fff' : 'var(--border)'}`, flexShrink: 0 }}
                >
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMain(i) }}
                    title="删除该主图"
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                  ><Icon name="close" size={9} /></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* 主行动点：实心主题色 */}
            <HeroButton variant="primary" size="sm" onPress={runBatch} isDisabled={batching}>
              {batching ? <Spinner size="sm"/> : <Icon name="magic" size={13} />} 立即合成
            </HeroButton>
            {/* 其他按钮：空心圆白色 */}
            <HeroButton variant="outline" size="sm" onPress={openGallery} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="imageFiles" size={13} /> 从图片库选择</HeroButton>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/30 bg-(--surface-tertiary) px-4 py-2 text-[13px] font-medium text-white transition-colors hover:border-white" style={{ cursor: 'pointer', margin: 0 }}>
              <Icon name="upload" size={13} /> 上传主图
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { onUploadMain(e.target.files); e.target.value = '' }} />
            </label>
            <HeroButton variant="outline" size="sm" onPress={nextMain} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="refresh" size={13} /> 下一张</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={() => deleteMain(mainIdx)} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="delete" size={13} /> 删除主图</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={() => setMainMirror(m => !m)}
              style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999, background: mainMirror ? 'var(--surface-bg-2)' : 'transparent' }}
            >
              {mainMirror ? '已镜像' : '镜像主图'}
            </HeroButton>
            <HeroButton variant="outline" size="sm" onPress={downloadCurrent} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="download" size={13} /> 下载合成图</HeroButton>
          </div>

          {/* 批量合成结果 */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>批量结果（{results.length}）</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HeroButton variant="outline" size="sm" onPress={() => setResultSel(resultSel.size === results.length ? new Set() : new Set(results.map(r => r.id)))}><Icon name={resultSel.size === results.length ? 'close' : 'check'} size={13} /> {resultSel.size === results.length ? '取消全选' : '全选'}</HeroButton>
                  {resultSel.size > 0 && (
                    <HeroButton variant="primary" size="sm" onPress={() => downloadAll(results.filter(r => resultSel.has(r.id)), '云眠花园_批量合成')}><Icon name="download" size={13} /> 下载（{resultSel.size}）</HeroButton>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
                {results.map(r => {
                  const sel = resultSel.has(r.id)
                  return (
                    <div key={r.id} onClick={() => setResultSel(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                      <img src={r.dataUrl} alt="" style={{ width: '100%', display: 'block' }} />
                      <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: sel ? '#fff' : 'rgba(0,0,0,.45)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{sel ? <Icon name="check" size={12} /> : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右：模版选择 + 参数 */}
        <div
          className="tk-panel"
          onMouseEnter={() => setPasteActive(true)}
          onMouseLeave={() => setPasteActive(false)}
          onFocus={() => setPasteActive(true)}
          onBlur={() => setPasteActive(false)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, minHeight: 0, overflow: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>选择模版</span>
            <div style={{ flex: '1 1 auto', minWidth: 140 }}>
              <HeroInput
                value={search}
                onChange={setSearch}
                placeholder="搜索模版"
                startContent={<Icon name="search" size={14} />}
              />
            </div>
            <HeroSelect value={platformFilter} onChange={setPlatformFilter} options={platformOptions} style={{ width: 128 }} />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) px-4 py-2 text-[13px] font-medium text-(--foreground) transition-colors hover:border-(--border-strong)" style={{ cursor: 'pointer', margin: 0 }}>
              <Icon name="plus" size={13} /> 新增模版
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { onAddTemplate(e.target.files); e.target.value = '' }} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: -6 }}>
            支持 Ctrl/⌘+V 粘贴新增模版，自定义模版可删除
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {filtered.map(t => {
              const active = t.id === selTpl
              return (
                <div
                  key={t.id}
                  className="tpl-card"
                  onClick={() => setSelTpl(t.id)}
                  style={{
                    borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                    border: `2px solid ${active ? '#fff' : 'var(--border)'}`,
                    boxShadow: active ? '0 0 0 3px var(--border-strong)' : 'none',
                    background: 'transparent', transition: 'all .15s ease',
                  }}
                >
                  <div style={{ aspectRatio: '1 / 1', background: 'transparent', position: 'relative' }}>
                    <img src={t.thumb || t.src} alt={t.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {active && (
                      <span style={{ position: 'absolute', top: 6, left: 6, background: 'var(--success)', color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>✓ 已选</span>
                    )}
                    <button
                      className="tpl-del"
                      onClick={(e) => { e.stopPropagation(); deleteTemplate(t) }}
                      title="删除模版"
                    ><Icon name="delete" size={12} /></button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="tk-empty" style={{ gridColumn: '1 / -1' }}><Icon name="plus" size={20} /><div style={{ marginTop: 6 }}>暂无模版，请上传或粘贴（Ctrl/⌘+V）新增</div></div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 4 }}>
            <Slider label="不透明度" value={opacity} onChange={setOpacity} min={0} max={100} suffix="%" />
            <Field label="模版位置">
              <HeroSelect
                value={position}
                onChange={setPosition}
                options={[
                  { value: 'center', label: '居中' },
                  { value: 'top', label: '顶部对齐' },
                  { value: 'bottom', label: '底部对齐' },
                ]}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)' }}>主图微调 <span style={{ fontSize: 11, fontWeight: 400 }}>拖拽移动 · 滚轮缩放</span></span>
              <HeroButton variant="outline" size="sm" onPress={resetMainTransform} isDisabled={!currentMain}><Icon name="refresh" size={12} /> 重置</HeroButton>
            </div>
            <Slider label="缩放" value={Math.round(mainScale * 100)} onChange={(v) => setMainScale(v / 100)} min={50} max={300} suffix="%" />
          </div>
        </div>
      </div>

      {/* 从图库选择主图弹窗 */}
      <Modal
        title="从图库选择主图"
        visible={galleryOpen}
        // 关闭时清空所有弹窗 state（避免 94 张图的 metadata + DOM 残留导致卡顿）
        onClose={() => { setGalleryOpen(false); setGalleryLoading(false); setGalleryBuckets([]); setGallerySel(new Set()) }}
        width={720}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setGalleryOpen(false)}>取消</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={confirmGallery}>加入（{gallerySel.size}）</HeroButton>
          </>
        }
      >
        {galleryLoading ? (
          <div className="tk-empty"><Spinner size="sm"/><div style={{ marginTop: 8 }}>加载图库中…</div></div>
        ) : (
          <>
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={galleryTab != null ? [String(galleryTab)] : []}
              onSelectionChange={(keys) => { if (keys) setGalleryTab(Array.from(keys)[0]) }}
              size="sm"
              className="inline-flex flex-wrap gap-1 mb-3 bg-(--surface-tertiary) border border-(--border) rounded-full p-1"
            >
              {galleryBuckets.map(b => (
                <ToggleButton
                  key={b.key}
                  id={String(b.key)}
                  className="px-3 py-1.5 text-[12px] font-medium text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-full transition-colors"
                >
                  {b.label} <span style={{ opacity: 0.7 }}>{b.images.length}</span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {galleryItems.length === 0 ? (
              <div className="tk-empty"><Icon name="picture" size={20} /><div style={{ marginTop: 6 }}>{galleryBuckets.find(b => b.key === galleryTab)?.label || '当前分类'}暂无图片</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>共 {galleryItems.length} 张，可多选</span>
                  <HeroButton variant="outline" size="sm" onPress={selectAllActive}>全选</HeroButton>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 400, overflow: 'auto' }}>
                  {galleryItems.map(it => {
                    const sel = gallerySel.has(`${galleryTab}:${it.name}`)
                    return (
                      <div key={it.name} onClick={() => toggleGallerySel(galleryTab, it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}`, width: 96, height: 96, flexShrink: 0 }}>
                        <img src={it.url} alt="" loading="lazy" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {sel && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--success)', color: '#fff', padding: '1px 6px', borderRadius: 999, fontSize: 10 }}><Icon name="check" size={10} /></span>}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center' }}>{fmtDay(it.mtime)}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

// ============================================================================
// 跨境模版生成 · 主图裁切
// ============================================================================
function CrossCrop({ brand }) {
  const canvasRef = useRef(null)
  const [images, setImages] = useState([])        // { id, dataUrl, name }
  const [editIdx, setEditIdx] = useState(0)
  const [sizeKey, setSizeKey] = useState('3:4')
  const [comp, setComp] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const [pasteActive, setPasteActive] = useState(false)
  const [aiModel, setAiModel] = useState('auto')
  const [strength, setStrength] = useState(70)
  const [padding, setPadding] = useState(6)
  const [quality, setQuality] = useState('1080p')
  const [format, setFormat] = useState('png')
  const [results, setResults] = useState([])      // { id, dataUrl, name }
  const [resultSel, setResultSel] = useState(() => new Set())
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryTab, setGalleryTab] = useState(DEFAULT_GALLERY_CATEGORY)
  const [galleryBuckets, setGalleryBuckets] = useState([]) // [{key,label,images:[{name,url,mtime}]}]
  const [gallerySel, setGallerySel] = useState(() => new Set()) // `${bucket}:${name}`
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [processing, setProcessing] = useState(false)

  const size = CROP_SIZES.find(s => s.key === sizeKey) || CROP_SIZES[0]
  const editImg = images[editIdx] || null
  const [editImgLoaded, setEditImgLoaded] = useState(null)

  // 编辑图片对象加载（存入 state，保证加载完成后触发重绘）
  useEffect(() => {
    let alive = true
    setEditImgLoaded(null)
    if (!editImg) return
    loadImage(editImg.dataUrl).then(img => { if (alive) setEditImgLoaded(img) }).catch(() => {})
    return () => { alive = false }
  }, [editImg])

  // 默认构图：边缘留白带来轻微缩放（<1 露出留白边），主体强度越高越居中
  const resetComp = useCallback(() => {
    setComp({ scale: 1 - (padding / 100) * 0.5, x: 0, y: 0 })
  }, [padding])

  useEffect(() => { resetComp() }, [resetComp, sizeKey, editIdx])

  // 实时裁切预览
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderCrop(canvas, editImgLoaded, size, comp)
  }, [editImgLoaded, size, comp])

  // 滚轮缩放：原生 listener（passive:false），否则无法阻止页面滚动
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      setComp(c => ({ ...c, scale: Math.min(5, Math.max(0.5, c.scale * factor)) }))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [editImg])

  const onUpload = (files) => {
    const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'))
    if (!imgs.length) return
    Promise.all(imgs.map(f => new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res({ id: genId('i'), dataUrl: r.result, name: f.name })
      r.onerror = () => res(null)
      r.readAsDataURL(f)
    }))).then(list => {
      const valid = list.filter(Boolean)
      if (!valid.length) return
      setImages(prev => [...prev, ...valid])
      Toast.success(`已添加 ${valid.length} 张主图`)
    })
  }

  const nextImg = () => {
    if (images.length <= 1) { Toast.info('仅有一张主图，可继续上传'); return }
    setEditIdx(i => (i + 1) % images.length)
  }

  // 粘贴上传主图（hover 左侧面板时生效）
  usePasteImages(pasteActive, onUpload)

  const openGallery = async () => {
    setGalleryOpen(true)
    setGalleryLoading(true)
    setGallerySel(new Set())
    try {
      const cats = await loadPickerBuckets(brand)
      setGalleryBuckets(cats)
      // 默认优先选中「合成图」；若合成图为空则回退到第一个有图片的分类
      setGalleryTab(defaultCategoryKey(cats))
    } catch {
      setGalleryBuckets([])
      setGalleryTab(DEFAULT_GALLERY_CATEGORY)
    } finally {
      setGalleryLoading(false)
    }
  }

  const galleryItems = (galleryBuckets.find(b => b.key === galleryTab)?.images) || []

  const toggleGallerySel = (bucket, name) => {
    const key = `${bucket}:${name}`
    setGallerySel(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  const selectAllActive = () => {
    setGallerySel(prev => {
      const n = new Set(prev)
      galleryItems.forEach(it => n.add(`${galleryTab}:${it.name}`))
      return n
    })
  }

  const confirmGallery = async () => {
    const keys = [...gallerySel]
    if (!keys.length) { Toast.warn('请先勾选图片'); return }
    // 先关弹窗并清空，蒙版立即消失（避免大图转换期间卡住）
    setGalleryOpen(false)
    setGallerySel(new Set())
    setGalleryBuckets([])
    const list = []
    for (const key of keys) {
      const [bucket, name] = key.split(':')
      const it = galleryBuckets.find(b => b.key === bucket)?.images.find(im => im.name === name)
      if (!it) continue
      try {
        const img = await loadImage(it.fullUrl || it.url)
        // 转为 dataURL 便于裁切（同源直取）
        const c = document.createElement('canvas')
        c.width = img.naturalWidth; c.height = img.naturalHeight
        c.getContext('2d').drawImage(img, 0, 0)
        list.push({ id: genId('i'), dataUrl: c.toDataURL('image/png'), name: it.name })
      } catch { /* skip */ }
    }
    if (list.length) {
      setImages(prev => [...prev, ...list])
      Toast.success(`已从图库加入 ${list.length} 张`)
    }
  }

  const removeImage = (id) => {
    setImages(prev => prev.filter(x => x.id !== id))
    if (editIdx >= images.length - 1) setEditIdx(Math.max(0, images.length - 2))
  }

  // —— 画布手动调整：拖拽平移 + 滚轮缩放 ——
  const onMouseDown = (e) => {
    if (!editImg) return
    setDragging(true)
    const rect = canvasRef.current.getBoundingClientRect()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: comp.x, oy: comp.y, scaleX: size.w / rect.width, scaleY: size.h / rect.height }
  }
  const onMouseMove = (e) => {
    if (!dragging || !dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) * dragRef.current.scaleX
    const dy = (e.clientY - dragRef.current.sy) * dragRef.current.scaleY
    setComp(c => ({ ...c, x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }))
  }
  const onMouseUp = () => setDragging(false)

  // —— 开始裁切 ——
  const startCrop = async () => {
    if (!images.length) { Toast.warn('请先上传或从图库选择主图'); return }
    setProcessing(true)
    try {
      const qs = QUALITY_SCALE[quality] || 1
      let W = Math.round(size.w * qs)
      let H = Math.round(size.h * qs)
      const cap = 4096
      const mx = Math.max(W, H)
      if (mx > cap) { const k = cap / mx; W = Math.round(W * k); H = Math.round(H * k) }
      const out = []
      const kx = W / size.w
      const ky = H / size.h
      for (const it of images) {
        const img = await loadImage(it.dataUrl).catch(() => null)
        if (!img) continue
        const c = document.createElement('canvas')
        c.width = W; c.height = H
        renderCrop(c, img, { w: W, h: H }, { scale: comp.scale, x: comp.x * kx, y: comp.y * ky })
        out.push({ id: genId('r'), dataUrl: c.toDataURL(MIME[format] || 'image/png'), name: it.name })
      }
      setResults(out)
      setResultSel(new Set())
      Toast.success(`裁切完成，共 ${out.length} 张`)
      // 自动保存到「裁切结果」库（跨境模版生成 · 裁切结果）
      if (out.length) {
        try {
          const ts = Date.now()
          const files = await Promise.all(out.map(async (r, i) => {
            const blob = await (await fetch(r.dataUrl)).blob()
            return new File([blob], `crop_${ts}_${i}.png`, { type: MIME[format] || 'image/png' })
          }))
          await api.upload(CROP_RESULTS_BUCKET, files, { brand })
        } catch (e) {
          // 保存失败不影响当前结果展示
          console.warn('保存裁切结果失败', e)
        }
      }
    } finally {
      setProcessing(false)
    }
  }

  const toggleResult = (id) => {
    setResultSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const selectAllResults = () => setResultSel(new Set(results.map(r => r.id)))
  const clearResults = () => setResultSel(new Set())
  const allSelected = results.length > 0 && resultSel.size === results.length
  const downloadResults = () => {
    const list = results.filter(r => resultSel.has(r.id))
    if (!list.length) { Toast.warn('请先勾选要下载的图'); return }
    downloadAll(list, '云眠花园_裁切')
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tk-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="target" size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>跨境主图裁切</span>
        </div>
        <span className="tk-chip" style={{ color: 'var(--foreground)', background: 'rgba(148,163,184,.10)', borderColor: 'rgba(148,163,184,.22)' }}>主图 × 尺寸模版 → 智能裁切</span>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(320px, 460px) 1fr', gap: 12 }}>
        {/* 左：裁切预览 + 主图操作 */}
        <div
          className="tk-panel"
          onMouseEnter={() => setPasteActive(true)}
          onMouseLeave={() => setPasteActive(false)}
          onFocus={() => setPasteActive(true)}
          onBlur={() => setPasteActive(false)}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, minHeight: 0, overflow: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>裁切预览</span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>主图 {images.length ? `${editIdx + 1}/${images.length}` : '0'} · 支持 Ctrl/⌘+V 粘贴</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {editImg ? (
              <div style={{ width: '100%', maxWidth: 380, aspectRatio: `${size.w} / ${size.h}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--muted)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
                <canvas
                  ref={canvasRef}
                  width={size.w}
                  height={size.h}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                />
                <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, pointerEvents: 'none' }}>
                  {Math.round(comp.scale * 100)}% · {size.key}
                </div>
              </div>
            ) : (
              <div className="tk-empty" style={{ width: '100%', maxWidth: 380, aspectRatio: `${size.w} / ${size.h}`, display: 'grid', placeItems: 'center', background: 'var(--muted)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', placeItems: 'center' }}><Icon name="target" size={22} /><div style={{ marginTop: 6 }}>请先上传或从图库选择主图</div></div>
              </div>
            )}
          </div>
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {images.map((it, i) => (
                <div key={it.id} onClick={() => setEditIdx(i)} style={{ position: 'relative', width: 52, height: 52, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${i === editIdx ? '#fff' : 'var(--border)'}`, flexShrink: 0 }}>
                  <img src={it.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button onClick={(e) => { e.stopPropagation(); removeImage(it.id) }} title="删除该主图" style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="close" size={9} /></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) px-4 py-2 text-[13px] font-medium text-(--foreground) transition-colors hover:border-(--border-strong)" style={{ cursor: 'pointer', margin: 0 }}>
              <Icon name="upload" size={13} /> 上传主图
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
            </label>
            <HeroButton variant="outline" size="sm" onPress={openGallery}><Icon name="imageFiles" size={13} /> 从图库选择</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={nextImg}><Icon name="refresh" size={13} /> 下一张</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={() => { if (editImg) removeImage(editImg.id) }}><Icon name="delete" size={13} /> 删除主图</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={startCrop} isDisabled={processing || !images.length}>
              {processing ? <Spinner size="sm"/> : <Icon name="magic" size={13} />} 开始裁切（{images.length} 张）
            </HeroButton>
          </div>

          {/* 裁切结果 */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>裁切结果（{results.length}）</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HeroButton variant="outline" size="sm" onPress={allSelected ? clearResults : selectAllResults}><Icon name={allSelected ? 'close' : 'check'} size={13} /> {allSelected ? '取消全选' : '全选'}</HeroButton>
                  {resultSel.size > 0 && (
                    <HeroButton variant="primary" size="sm" onPress={downloadResults}><Icon name="download" size={13} /> 下载（{resultSel.size}）</HeroButton>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
                {results.map(r => {
                  const sel = resultSel.has(r.id)
                  return (
                    <div key={r.id} onClick={() => toggleResult(r.id)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                      <img src={r.dataUrl} alt="" style={{ width: '100%', display: 'block' }} />
                      <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: sel ? '#fff' : 'rgba(0,0,0,.45)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{sel ? <Icon name="check" size={12} /> : ''}</span>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右：参数设置 */}
        <div className="tk-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, minHeight: 0, overflow: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>输出尺寸（默认 3:4）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {CROP_SIZES.map(s => {
              const active = s.key === sizeKey
              return (
                <div key={s.key} onClick={() => setSizeKey(s.key)} style={{
                  borderRadius: 10, cursor: 'pointer', padding: '10px 6px', textAlign: 'center',
                  border: `1px solid ${active ? '#fff' : 'var(--border)'}`,
                  background: active ? 'var(--surface-bg-2)' : 'transparent',
                  color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
                }}>
                  <div style={{ width: '60%', aspectRatio: `${s.w} / ${s.h}`, maxWidth: 44, margin: '0 auto 6px', border: `2px solid ${active ? '#fff' : 'var(--border)'}`, borderRadius: 4, background: 'transparent' }} />
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{s.key}</div>
                </div>
              )
            })}
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>构图微调 <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 400 }}>拖拽移动 · 滚轮缩放</span></div>
          {editImg ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Slider label="缩放" value={Math.round(comp.scale * 100)} onChange={(v) => setComp(c => ({ ...c, scale: v / 100 }))} min={50} max={300} suffix="%" />
              <Slider label="水平位置" value={Math.round(comp.x)} onChange={(v) => setComp(c => ({ ...c, x: v }))} min={-size.w} max={size.w} step={2} />
              <Slider label="垂直位置" value={Math.round(comp.y)} onChange={(v) => setComp(c => ({ ...c, y: v }))} min={-size.h} max={size.h} step={2} />
              <Field label=" "><HeroButton variant="outline" size="sm" onPress={resetComp}><Icon name="refresh" size={13} /> 重置构图</HeroButton></Field>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>请先添加主图后再调整构图</div>
          )}

          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>AI 裁切参数</div>
          <Field label="AI 模型">
            <HeroSelect value={aiModel} onChange={setAiModel} options={CROP_MODELS} />
          </Field>
          <Slider label="主体识别强度" value={strength} onChange={setStrength} min={0} max={100} suffix="%" />
          <Slider label="边缘留白" value={padding} onChange={setPadding} min={0} max={30} suffix="%" />

          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>输出质量 / 格式</div>
          <Field label="输出质量">
            <HeroSelect value={quality} onChange={setQuality} options={QUALITY_OPTIONS} />
          </Field>
          <Field label="输出格式">
            <HeroSelect value={format} onChange={setFormat} options={FORMAT_OPTIONS} />
          </Field>

          <HeroButton variant="primary" size="sm" onPress={startCrop} isDisabled={processing || !images.length} style={{ marginTop: 'auto' }}>
            {processing ? <Spinner size="sm"/> : <Icon name="magic" size={16} />} 开始裁切（{images.length} 张）
          </HeroButton>
        </div>
      </div>

      {/* 从图库选择弹窗（分类见 src/galleryCategories.js，与「图库」页 Tab 一致） */}
      <Modal
        title="从图库选择主图"
        visible={galleryOpen}
        onClose={() => { setGalleryOpen(false); setGalleryLoading(false) }}
        width={720}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setGalleryOpen(false)}>取消</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={confirmGallery}>加入（{gallerySel.size}）</HeroButton>
          </>
        }
      >
        {galleryLoading ? (
          <div className="tk-empty"><Spinner size="sm"/><div style={{ marginTop: 8 }}>加载图库中…</div></div>
        ) : (
          <>
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={galleryTab != null ? [String(galleryTab)] : []}
              onSelectionChange={(keys) => { if (keys) setGalleryTab(Array.from(keys)[0]) }}
              size="sm"
              className="inline-flex flex-wrap gap-1 mb-3 bg-(--surface-tertiary) border border-(--border) rounded-full p-1"
            >
              {galleryBuckets.map(b => (
                <ToggleButton
                  key={b.key}
                  id={String(b.key)}
                  className="px-3 py-1.5 text-[12px] font-medium text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-full transition-colors"
                >
                  {b.label} <span style={{ opacity: 0.7 }}>{b.images.length}</span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {galleryItems.length === 0 ? (
              <div className="tk-empty"><Icon name="picture" size={20} /><div style={{ marginTop: 6 }}>{galleryBuckets.find(b => b.key === galleryTab)?.label || '当前分类'}暂无图片</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>共 {galleryItems.length} 张，可多选</span>
                  <HeroButton variant="outline" size="sm" onPress={selectAllActive}>全选</HeroButton>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 400, overflow: 'auto' }}>
                  {galleryItems.map(it => {
                    const sel = gallerySel.has(`${galleryTab}:${it.name}`)
                    return (
                      <div key={it.name} onClick={() => toggleGallerySel(galleryTab, it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}`, width: 96, height: 96, flexShrink: 0 }}>
                        <img src={it.url} alt="" loading="lazy" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {sel && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--success)', color: '#fff', padding: '1px 6px', borderRadius: 999, fontSize: 10 }}><Icon name="check" size={10} /></span>}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center' }}>{fmtDay(it.mtime)}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

// ============================================================================
// 跨境模版生成 · 模版库
// ============================================================================
function CrossTemplateLibrary({ brand }) {
  const [templates] = useState([])                       // 内置模版已移除，留空
  const [custom, setCustom] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selTpl, setSelTpl] = useState('')
  const [detail, setDetail] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [batching, setBatching] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ category: '', title: '' })
  const [delConfirm, setDelConfirm] = useState(null)
  const [pasteActive, setPasteActive] = useState(false)
  const [cropAddOpen, setCropAddOpen] = useState(false)
  const [cropAddItems, setCropAddItems] = useState([])
  const [cropAddSel, setCropAddSel] = useState(() => new Set())
  const [cropAddLoading, setCropAddLoading] = useState(false)
  const [cropAdding, setCropAdding] = useState(false)

  // 合成预览相关状态（与国内模版生成保持一致）
  const canvasRef = useRef(null)
  const [pvSize, setPvSize] = useState({ w: 750, h: 1000 })    // 预览/输出画布尺寸：跟随主图宽高比（默认 3:4）
  const [mainImages, setMainImages] = useState(() => crossDraft[brand]?.mainImages || [])
  const [mainIdx, setMainIdx] = useState(() => crossDraft[brand]?.mainIdx || 0)
  const [opacity, setOpacity] = useState(100)
  const [position, setPosition] = useState('center')
  const [mainScale, setMainScale] = useState(1)
  const [mainX, setMainX] = useState(0)
  const [mainY, setMainY] = useState(0)
  const [mainMirror, setMainMirror] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const [results, setResults] = useState([])
  const [resultSel, setResultSel] = useState(() => new Set())
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryTab, setGalleryTab] = useState(DEFAULT_GALLERY_CATEGORY)
  const [galleryBuckets, setGalleryBuckets] = useState([])
  const [gallerySel, setGallerySel] = useState(() => new Set())
  const [galleryLoading, setGalleryLoading] = useState(false)

  const currentMain = mainImages[mainIdx] || null
  const all = useMemo(() => [...templates, ...custom], [templates, custom])
  const selTplObj = all.find(t => t.id === selTpl) || null

  const galleryItems = useMemo(() => {
    const b = galleryBuckets.find(x => x.key === galleryTab)
    return b?.images || []
  }, [galleryBuckets, galleryTab])

  // 加载自定义模版
  const load = useCallback(async () => {
    try {
      const r = await api.images(CROSS_TPL_BUCKET, { brand })
      setCustom((r?.images || []).map(it => ({
        id: 'custom_' + it.name,
        builtin: false,
        name: it.name,
        title: it.name,
        category: '促销标签',
        size: it.size,
        mtime: it.mtime,
        src: api.imageUrl(CROSS_TPL_BUCKET, it.name, { brand }), // 原图：合成用
        thumb: api.thumbOf(api.imageUrl(CROSS_TPL_BUCKET, it.name, { brand })), // 缩略图：显示用
      })))
    } catch { setCustom([]) }
  }, [brand])

  useEffect(() => { load() }, [load])

  // 品牌切换时恢复主图草稿
  useEffect(() => {
    const d = crossDraft[brand]
    setMainImages(d?.mainImages || [])
    setMainIdx(d?.mainIdx || 0)
  }, [brand])

  // 主图草稿持久化
  useEffect(() => {
    crossDraft[brand] = { mainImages, mainIdx }
  }, [mainImages, mainIdx, brand])

  // 模版加载完成后自动选中第一张
  useEffect(() => {
    if (!selTpl && all.length) setSelTpl(all[0].id)
  }, [all, selTpl])

  // 实时合成预览
  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return
    ;(async () => {
      const mainImg = currentMain ? await loadImage(currentMain).catch(() => null) : null
      const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
      if (!alive) return
      if (mainImg) setPvSize({ w: mainImg.naturalWidth || 750, h: mainImg.naturalHeight || 1000 })
      renderComposite(canvas, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
    })()
    return () => { alive = false }
  }, [currentMain, selTplObj, opacity, position, mainScale, mainX, mainY, mainMirror])

  // 画布滚轮缩放
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      if (!currentMain) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      setMainScale(s => Math.min(3, Math.max(0.5, s * factor)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [currentMain])

  // 主图在画布内拖拽移动
  const onPreviewMouseDown = (e) => {
    if (!currentMain) return
    setDragging(true)
    const rect = canvasRef.current.getBoundingClientRect()
    dragRef.current = {
      sx: e.clientX, sy: e.clientY,
      ox: mainX, oy: mainY,
      k: canvasRef.current.width / rect.width,
    }
  }
  const onPreviewMouseMove = (e) => {
    if (!dragging || !dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) * dragRef.current.k
    const dy = (e.clientY - dragRef.current.sy) * dragRef.current.k
    setMainX(dragRef.current.ox + dx)
    setMainY(dragRef.current.oy + dy)
  }
  const onPreviewMouseUp = () => setDragging(false)
  const resetMainTransform = () => {
    setMainScale(1); setMainX(0); setMainY(0)
    Toast.info('已重置主图位置和缩放')
  }

  // 主图上传
  const onUploadMain = (files) => {
    const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'))
    if (!imgs.length) return
    Promise.all(imgs.map(f => new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = () => res(null)
      r.readAsDataURL(f)
    }))).then(urls => {
      const valid = urls.filter(Boolean)
      if (!valid.length) return
      const startIdx = mainImages.length
      setMainImages([...mainImages, ...valid])
      setMainIdx(startIdx)
      Toast.success(`已添加 ${valid.length} 张主图`)
    })
  }

  const deleteMain = (idx) => {
    const next = mainImages.filter((_, i) => i !== idx)
    setMainImages(next)
    setMainIdx(prev => {
      if (idx < prev) return prev - 1
      if (prev >= next.length) return Math.max(0, next.length - 1)
      return prev
    })
    Toast.success('已删除该主图')
  }

  const nextMain = () => {
    if (mainImages.length <= 1) { Toast.info('仅有一张主图，可继续上传'); return }
    setMainIdx(i => (i + 1) % mainImages.length)
  }

  // 从图库选择主图
  const openGallery = async () => {
    setGalleryOpen(true)
    setGalleryLoading(true)
    setGallerySel(new Set())
    try {
      const cats = await loadPickerBuckets(brand)
      setGalleryBuckets(cats)
      setGalleryTab(defaultCategoryKey(cats))
    } catch {
      setGalleryBuckets([])
      setGalleryTab(DEFAULT_GALLERY_CATEGORY)
    } finally {
      setGalleryLoading(false)
    }
  }

  const toggleGallerySel = (bucket, name) => {
    setGallerySel(prev => {
      const n = new Set(prev)
      const key = `${bucket}:${name}`
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  const selectAllActive = () => {
    setGallerySel(prev => {
      const n = new Set(prev)
      galleryItems.forEach(it => n.add(`${galleryTab}:${it.name}`))
      return n
    })
  }

  const confirmGallery = async () => {
    const keys = [...gallerySel]
    if (!keys.length) { Toast.warn('请先勾选图片'); return }
    // 直接存图库原图 URL：避免把 20+ 张大图同步转 canvas 造成的长时间卡顿与内存暴涨
    const list = []
    for (const key of keys) {
      const [bucket, name] = key.split(':')
      const it = galleryBuckets.find(b => b.key === bucket)?.images.find(im => im.name === name)
      if (!it) continue
      list.push(it.fullUrl || it.url)
    }
    if (list.length) {
      const startIdx = mainImages.length
      setMainImages([...mainImages, ...list])
      setMainIdx(startIdx)
      Toast.success(`已从图库加入 ${list.length} 张主图`)
    }
    // 先关弹窗并清空：蒙版立即消失，主图按 URL 懒加载
    setGalleryOpen(false)
    setGallerySel(new Set())
    setGalleryBuckets([])
  }

  // 下载当前合成图
  const downloadCurrent = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = document.createElement('canvas')
    const mainImg0 = currentMain ? await loadImage(currentMain).catch(() => null) : null
    const sz = pickOutSize(mainImg0)
    c.width = sz.w; c.height = sz.h
    const mainImg = mainImg0
    const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
    renderComposite(c, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
    downloadDataUrl(c.toDataURL('image/png'), `云眠花园_Ozon合成_${selTplObj?.title || '模版'}.png`)
    Toast.success('已下载合成图')
  }

  // 批量合成
  const runBatch = async () => {
    if (!mainImages.length) { Toast.warn('请先上传主图'); return }
    setBatching(true)
    try {
      const tplImg = selTplObj ? await loadImage(selTplObj.src).catch(() => null) : null
      const out = []
      for (const src of mainImages) {
        const mainImg = await loadImage(src).catch(() => null)
        if (!mainImg) continue
        const c = document.createElement('canvas')
        const sz = pickOutSize(mainImg)
        c.width = sz.w; c.height = sz.h
        renderComposite(c, mainImg, tplImg, { opacity, position, mainScale, mainX, mainY, mainMirror })
        out.push({ id: genId('r'), dataUrl: c.toDataURL('image/png') })
      }
      setResults(out)
      setResultSel(new Set())
      if (out.length) {
        try {
          const ts = Date.now()
          const files = await Promise.all(out.map(async (r, i) => {
            const blob = await (await fetch(r.dataUrl)).blob()
            return new File([blob], `cross_tpl_${ts}_${i}.png`, { type: 'image/png' })
          }))
          await api.upload(RESULTS_BUCKET, files, { brand })
        } catch (e) {
          console.warn('保存历史合成记录失败', e)
        }
      }
      Toast.success(`批量合成完成，共 ${out.length} 张`)
      setMainImages([])
      setMainIdx(0)
      delete crossDraft[brand]
    } finally {
      setBatching(false)
    }
  }

  // 从「裁切结果」选择图片作为模版
  const openCropAdd = async () => {
    setCropAddOpen(true)
    setCropAddLoading(true)
    setCropAddSel(new Set())
    try {
      const r = await api.images(CROP_RESULTS_BUCKET, { brand })
      setCropAddItems((r?.images || []).map(it => {
        const full = api.imageUrl(CROP_RESULTS_BUCKET, it.name, { brand })
        return {
          name: it.name,
          url: full, // 原图：加入模版库时会 loadImage→canvas 重绘后上传，禁止换缩略图
          thumb: api.thumbOf(full), // 缩略图：仅弹窗网格显示
          mtime: it.mtime,
        }
      }))
    } catch {
      setCropAddItems([])
    } finally {
      setCropAddLoading(false)
    }
  }

  const toggleCropAdd = (name) => {
    setCropAddSel(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  const selectAllCropAdd = () => setCropAddSel(new Set(cropAddItems.map(it => it.name)))

  const confirmCropAdd = async () => {
    const picked = cropAddItems.filter(it => cropAddSel.has(it.name))
    if (!picked.length) { Toast.warn('请先勾选裁切结果'); return }
    setCropAdding(true)
    try {
      const files = []
      for (const it of picked) {
        try {
          const img = await loadImage(it.fullUrl || it.url)
          const c = document.createElement('canvas')
          c.width = img.naturalWidth; c.height = img.naturalHeight
          c.getContext('2d').drawImage(img, 0, 0)
          const blob = await (await fetch(c.toDataURL('image/png'))).blob()
          files.push(new File([blob], `tpl_from_crop_${Date.now()}_${files.length}.png`, { type: 'image/png' }))
        } catch { /* skip */ }
      }
      if (files.length) {
        const r = await api.upload(CROSS_TPL_BUCKET, files, { brand })
        Toast.success(`已从裁切结果添加 ${r.savedCount || files.length} 个模版`)
        await load()
      } else {
        Toast.warn('没有可添加的图片')
      }
      setCropAddOpen(false)
      setCropAddSel(new Set())
    } catch (e) {
      Toast.error('添加失败：' + (e?.message || e))
    } finally {
      setCropAdding(false)
    }
  }

  const filtered = useMemo(() => {
    let list = all
    if (category) list = list.filter(t => t.category === category)
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(t => (t.title || '').toLowerCase().includes(kw) || (t.category || '').toLowerCase().includes(kw))
    }
    return list
  }, [all, category, search])

  const onUpload = async (files) => {
    const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'))
    if (!imgs.length) return
    setUploading(true)
    try {
      const r = await api.upload(CROSS_TPL_BUCKET, imgs, { brand })
      Toast.success(`已上传 ${r.savedCount || 0} 个模版`)
      await load()
    } catch (e) {
      Toast.error('上传失败：' + (e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  // 粘贴新增模版（hover 模版面板时生效）
  usePasteImages(pasteActive, onUpload)

  const selectDetail = (t) => {
    setSelTpl(t.id)
    setDetail({ ...t, layers: 1, usage: 0 })
  }

  const openEdit = (t) => {
    setEditForm({ category: t.category || '促销标签', title: t.title || '' })
    setDetail({ ...t, layers: 1, usage: 0 })
    setEditOpen(true)
  }
  const saveEdit = () => {
    const key = detail?.id
    setCustom(prev => prev.map(t => t.id === key ? { ...t, category: editForm.category, title: editForm.title } : t))
    setDetail(d => d ? { ...d, category: editForm.category, title: editForm.title } : d)
    setEditOpen(false)
    Toast.success('已保存（展示信息）')
  }
  const doDelete = async () => {
    if (!delConfirm) return
    try {
      await api.deleteImg(CROSS_TPL_BUCKET, delConfirm.name, { brand })
      Toast.success('已删除模版')
      const nextCustom = custom.filter(t => t.id !== delConfirm.id)
      setCustom(nextCustom)
      if (selTpl === delConfirm.id) {
        const remaining = [...templates, ...nextCustom]
        setSelTpl(remaining.length ? remaining[0].id : '')
      }
      if (detail?.id === delConfirm.id) setDetail(null)
    } catch (e) {
      Toast.error('删除失败：' + (e?.message || e))
    } finally {
      setDelConfirm(null)
    }
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tk-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="adjustment" size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Ozon模版生成</span>
        </div>
        <span className="tk-chip" style={{ color: 'var(--foreground)', background: 'rgba(148,163,184,.10)', borderColor: 'rgba(148,163,184,.22)' }}>产品主图 × Ozon模版 → 实时合成</span>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(320px, 460px) 1fr', gap: 12 }}>
        {/* 左：合成预览 + 主图操作 */}
        <div className="tk-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, minHeight: 0, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>合成预览</span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>主图 {mainImages.length ? `${mainIdx + 1}/${mainImages.length}` : '0'} · 拖拽移动 · 滚轮缩放 · 镜像</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <canvas
              ref={canvasRef}
              width={pvSize.w}
              height={pvSize.h}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
              style={{
                width: '100%', maxWidth: 380, aspectRatio: `${pvSize.w} / ${pvSize.h}`, borderRadius: 14,
                border: '1px solid var(--border)', background: 'transparent',
                cursor: currentMain ? (dragging ? 'grabbing' : 'grab') : 'default',
                touchAction: 'none',
              }}
            />
          </div>
          {mainImages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {mainImages.map((src, i) => (
                <div
                  key={i}
                  onClick={() => setMainIdx(i)}
                  style={{ position: 'relative', width: 52, height: 52, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${i === mainIdx ? '#fff' : 'var(--border)'}`, flexShrink: 0 }}
                >
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMain(i) }}
                    title="删除该主图"
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                  ><Icon name="close" size={9} /></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* 主行动点：实心主题色 */}
            <HeroButton variant="primary" size="sm" onPress={runBatch} isDisabled={batching}>
              {batching ? <Spinner size="sm"/> : <Icon name="magic" size={13} />} 立即合成
            </HeroButton>
            {/* 其他按钮：空心圆白色 */}
            <HeroButton variant="outline" size="sm" onPress={openGallery} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="imageFiles" size={13} /> 从图片库选择</HeroButton>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/30 bg-(--surface-tertiary) px-4 py-2 text-[13px] font-medium text-white transition-colors hover:border-white" style={{ cursor: 'pointer', margin: 0 }}>
              <Icon name="upload" size={13} /> 上传主图
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { onUploadMain(e.target.files); e.target.value = '' }} />
            </label>
            <HeroButton variant="outline" size="sm" onPress={nextMain} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="refresh" size={13} /> 下一张</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={() => deleteMain(mainIdx)} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="delete" size={13} /> 删除主图</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={() => setMainMirror(m => !m)}
              style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999, background: mainMirror ? 'var(--surface-bg-2)' : 'transparent' }}
            >
              {mainMirror ? '已镜像' : '镜像主图'}
            </HeroButton>
            <HeroButton variant="outline" size="sm" onPress={downloadCurrent} style={{ borderColor: '#fff', color: '#fff', borderRadius: 9999 }}><Icon name="download" size={13} /> 下载合成图</HeroButton>
          </div>

          {/* 批量合成结果 */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>批量结果（{results.length}）</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HeroButton variant="outline" size="sm" onPress={() => setResultSel(resultSel.size === results.length ? new Set() : new Set(results.map(r => r.id)))}><Icon name={resultSel.size === results.length ? 'close' : 'check'} size={13} /> {resultSel.size === results.length ? '取消全选' : '全选'}</HeroButton>
                  {resultSel.size > 0 && (
                    <HeroButton variant="primary" size="sm" onPress={() => downloadAll(results.filter(r => resultSel.has(r.id)), '云眠花园_Ozon批量合成')}><Icon name="download" size={13} /> 下载（{resultSel.size}）</HeroButton>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
                {results.map(r => {
                  const sel = resultSel.has(r.id)
                  return (
                    <div key={r.id} onClick={() => setResultSel(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                      <img src={r.dataUrl} alt="" style={{ width: '100%', display: 'block' }} />
                      <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: sel ? '#fff' : 'rgba(0,0,0,.45)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{sel ? <Icon name="check" size={12} /> : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右：模版选择 + 参数 */}
        <div
          className="tk-panel"
          onMouseEnter={() => setPasteActive(true)}
          onMouseLeave={() => setPasteActive(false)}
          onFocus={() => setPasteActive(true)}
          onBlur={() => setPasteActive(false)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, minHeight: 0, overflow: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>选择模版</span>
            <div style={{ flex: '1 1 auto', minWidth: 140 }}>
              <HeroInput
                value={search}
                onChange={setSearch}
                placeholder="按名称 / 标签搜索"
                startContent={<Icon name="search" size={14} />}
              />
            </div>
            <HeroSelect
              value={category}
              onChange={setCategory}
              options={[{ value: '', label: '全部分类' }, ...CROSS_CATEGORIES.map(c => ({ value: c, label: c }))]}
              style={{ width: 128 }}
            />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-lg) border border-(--border) bg-(--surface-tertiary) px-4 py-2 text-[13px] font-medium text-(--foreground) transition-colors hover:border-(--border-strong)" style={{ cursor: 'pointer', margin: 0 }}>
              <Icon name="plus" size={13} /> 新增模版
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
            </label>
            <HeroButton variant="outline" size="sm" onPress={openCropAdd}><Icon name="imageFiles" size={13} /> 从裁切结果添加</HeroButton>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: -6 }}>
            支持 Ctrl/⌘+V 粘贴新增模版，自定义模版可编辑 / 删除
          </div>

          {/* 分类 chips */}
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={category != null ? [String(category || 'all')] : []}
            onSelectionChange={(keys) => setCategory(Array.from(keys)[0] === 'all' ? '' : Array.from(keys)[0])}
            size="sm"
            className="flex-wrap gap-1 rounded-full bg-(--surface-tertiary) border border-(--border) p-1"
          >
            {['', ...CROSS_CATEGORIES].map(c => (
              <ToggleButton
                key={c || 'all'}
                id={String(c || 'all')}
                className="px-3 py-1 text-[12px] font-semibold text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-full transition-colors"
              >
                {c || '全部'}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {filtered.map(t => {
              const active = t.id === selTpl
              return (
                <div
                  key={t.id}
                  className="tpl-card"
                  onClick={() => selectDetail(t)}
                  style={{
                    borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                    border: `2px solid ${active ? '#fff' : 'var(--border)'}`,
                    boxShadow: active ? '0 0 0 3px var(--border-strong)' : 'none',
                    background: 'transparent', transition: 'all .15s ease',
                  }}
                >
                  <div style={{ aspectRatio: '3 / 4', background: 'transparent', position: 'relative' }}>
                    <img src={t.thumb || t.src} alt={t.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {active && (
                      <span style={{ position: 'absolute', top: 6, left: 6, background: 'var(--success)', color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>✓ 已选</span>
                    )}
                    <span style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '1px 8px', borderRadius: 999, fontSize: 10 }}>{t.category}</span>
                    <button
                      className="tpl-del"
                      onClick={(e) => { e.stopPropagation(); openEdit(t) }}
                      title="编辑模版"
                      style={{ right: 32 }}
                    ><Icon name="edit" size={12} /></button>
                    <button
                      className="tpl-del"
                      onClick={(e) => { e.stopPropagation(); setDelConfirm(t) }}
                      title="删除模版"
                    ><Icon name="delete" size={12} /></button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="tk-empty" style={{ gridColumn: '1 / -1' }}><Icon name="upload" size={20} /><div style={{ marginTop: 6 }}>暂无模版，请上传或粘贴（Ctrl/⌘+V）新增</div></div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 4 }}>
            <Slider label="不透明度" value={opacity} onChange={setOpacity} min={0} max={100} suffix="%" />
            <Field label="模版位置">
              <HeroSelect
                value={position}
                onChange={setPosition}
                options={[
                  { value: 'center', label: '居中' },
                  { value: 'top', label: '顶部对齐' },
                  { value: 'bottom', label: '底部对齐' },
                ]}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)' }}>主图微调 <span style={{ fontSize: 11, fontWeight: 400 }}>拖拽移动 · 滚轮缩放</span></span>
              <HeroButton variant="outline" size="sm" onPress={resetMainTransform} isDisabled={!currentMain}><Icon name="refresh" size={12} /> 重置</HeroButton>
            </div>
            <Slider label="缩放" value={Math.round(mainScale * 100)} onChange={(v) => setMainScale(v / 100)} min={50} max={300} suffix="%" />
          </div>
        </div>
      </div>

      {/* 从图库选择主图弹窗 */}
      <Modal
        title="从图库选择主图"
        visible={galleryOpen}
        // 关闭时清空所有弹窗 state（避免 94 张图的 metadata + DOM 残留导致卡顿）
        onClose={() => { setGalleryOpen(false); setGalleryLoading(false); setGalleryBuckets([]); setGallerySel(new Set()) }}
        width={720}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setGalleryOpen(false)}>取消</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={confirmGallery}>加入（{gallerySel.size}）</HeroButton>
          </>
        }
      >
        {galleryLoading ? (
          <div className="tk-empty"><Spinner size="sm"/><div style={{ marginTop: 8 }}>加载图库中…</div></div>
        ) : (
          <>
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={galleryTab != null ? [String(galleryTab)] : []}
              onSelectionChange={(keys) => { if (keys) setGalleryTab(Array.from(keys)[0]) }}
              size="sm"
              className="inline-flex flex-wrap gap-1 mb-3 bg-(--surface-tertiary) border border-(--border) rounded-full p-1"
            >
              {galleryBuckets.map(b => (
                <ToggleButton
                  key={b.key}
                  id={String(b.key)}
                  className="px-3 py-1.5 text-[12px] font-medium text-(--muted-foreground) data-[selected=true]:bg-(--accent) data-[selected=true]:text-(--accent-foreground) data-[selected=true]:shadow-(--surface-shadow) rounded-full transition-colors"
                >
                  {b.label} <span style={{ opacity: 0.7 }}>{b.images.length}</span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {galleryItems.length === 0 ? (
              <div className="tk-empty"><Icon name="picture" size={20} /><div style={{ marginTop: 6 }}>{galleryBuckets.find(b => b.key === galleryTab)?.label || '当前分类'}暂无图片</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>共 {galleryItems.length} 张，可多选</span>
                  <HeroButton variant="outline" size="sm" onPress={selectAllActive}>全选</HeroButton>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 400, overflow: 'auto' }}>
                  {galleryItems.map(it => {
                    const sel = gallerySel.has(`${galleryTab}:${it.name}`)
                    return (
                      <div key={it.name} onClick={() => toggleGallerySel(galleryTab, it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}`, width: 96, height: 96, flexShrink: 0 }}>
                        <img src={it.url} alt="" loading="lazy" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {sel && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--success)', color: '#fff', padding: '1px 6px', borderRadius: 999, fontSize: 10 }}><Icon name="check" size={10} /></span>}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center' }}>{fmtDay(it.mtime)}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title="编辑模版"
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        width={420}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setEditOpen(false)}>取消</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={saveEdit}>保存</HeroButton>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="模版名称">
            <HeroInput value={editForm.title} onChange={(v) => setEditForm(f => ({ ...f, title: v }))} placeholder="请输入模版名称" />
          </Field>
          <Field label="分类">
            <HeroSelect value={editForm.category} onChange={(v) => setEditForm(f => ({ ...f, category: v }))} options={CROSS_CATEGORIES.map(c => ({ value: c, label: c }))} />
          </Field>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        title="删除模版"
        visible={!!delConfirm}
        onClose={() => setDelConfirm(null)}
        width={400}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setDelConfirm(null)}>取消</HeroButton>
            <HeroButton variant="outline" size="sm" onPress={doDelete}>删除</HeroButton>
          </>
        }
      >
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>确定删除模版「{delConfirm?.title}」吗？此操作不可恢复。</div>
      </Modal>

      {/* 从裁切结果添加模版 */}
      <Modal
        title="从裁切结果添加模版"
        visible={cropAddOpen}
        onClose={() => setCropAddOpen(false)}
        width={720}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setCropAddOpen(false)}>取消</HeroButton>
            <HeroButton variant="primary" size="sm" onPress={confirmCropAdd} isDisabled={cropAdding}>
              {cropAdding ? <Spinner size="sm"/> : null} 添加（{cropAddSel.size}）
            </HeroButton>
          </>
        }
      >
        {cropAddLoading ? (
          <div className="tk-empty"><Spinner size="sm"/><div style={{ marginTop: 8 }}>加载裁切结果中…</div></div>
        ) : cropAddItems.length === 0 ? (
          <div className="tk-empty"><Icon name="picture" size={20} /><div style={{ marginTop: 6 }}>暂无裁切结果，先去「主图裁切」生成吧</div></div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>共 {cropAddItems.length} 张裁切结果，可多选添加到模版库</span>
              <HeroButton variant="outline" size="sm" onPress={selectAllCropAdd}>全选</HeroButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, maxHeight: 400, overflow: 'auto' }}>
              {cropAddItems.map(it => {
                const sel = cropAddSel.has(it.name)
                return (
                  <div key={it.name} onClick={() => toggleCropAdd(it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                    <img src={it.thumb || it.url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                    {sel && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--success)', color: '#fff', padding: '1px 6px', borderRadius: 999, fontSize: 10 }}><Icon name="check" size={10} /></span>}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtDay(it.mtime)}</div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

// ============================================================================
// 模版合成库：历史合成结果，支持多选 + 批量导出
// ============================================================================
export function TemplateResultLibrary({ brand }) {
  const [images, setImages] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [delConfirm, setDelConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.images(RESULTS_BUCKET, { brand })
      setImages((r?.images || []).slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0)))
    } catch (e) {
      Toast.error('加载历史合成失败：' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load])

  const toggle = (name) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  const exportSelected = () => {
    const names = images.filter(it => selected.has(it.name)).map(it => it.name)
    exportLibraryZip(names, RESULTS_BUCKET, brand, '云眠花园_模版合成库')
    setSelected(new Set())
  }

  const doDelete = async () => {
    const names = images.filter(it => selected.has(it.name)).map(it => it.name)
    if (!names.length) { setDelConfirm(false); return }
    setDeleting(true)
    try {
      const results = await Promise.allSettled(
        names.map(n => api.libraryDelete(RESULTS_BUCKET, n, { brand }))
      )
      const ok = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length
      const fail = results.length - ok
      Toast.success(`已删除 ${ok} 张${fail ? `（${fail} 张失败）` : ''}`)
      setSelected(new Set())
      setDelConfirm(false)
      load()
    } catch (e) {
      Toast.error('删除失败：' + (e?.message || e))
    } finally {
      setDeleting(false)
    }
  }

  const fmtDay = (ts) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="folder" size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>模版合成库</span>
          <span className="tk-chip" style={{ color: 'var(--foreground)', background: 'rgba(148,163,184,.10)', borderColor: 'rgba(148,163,184,.22)' }}>{images.length} 张历史合成</span>
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <HeroButton variant="primary" size="sm" onPress={exportSelected}><Icon name="download" size={13} /> 导出（{selected.size}）</HeroButton>
            <HeroButton variant="danger" size="sm" onPress={() => setDelConfirm(true)} isDisabled={deleting}><Icon name="delete" size={13} /> 删除（{selected.size}）</HeroButton>
            <HeroButton variant="ghost" size="sm" onPress={() => setSelected(new Set())}>清空选中</HeroButton>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)' }}><Spinner size="sm"/> 加载中…</div>
      ) : images.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>暂无历史合成，先去「国内模版生成」批量合成吧</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {images.map(it => {
            const sel = selected.has(it.name)
            const url = api.thumbOf(api.imageUrl(RESULTS_BUCKET, it.name, { brand }))
            return (
              <div key={it.name} onClick={() => toggle(it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                <img src={url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(148,163,184,.20)', color: 'var(--foreground)', padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>合成</span>
                <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: sel ? '#fff' : 'rgba(0,0,0,.45)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{sel ? <Icon name="check" size={12} /> : ''}</span>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center' }}>{fmtDay(it.mtime)}</div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        title="删除模版图"
        visible={delConfirm}
        onClose={() => { if (!deleting) setDelConfirm(false) }}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setDelConfirm(false)} isDisabled={deleting}>取消</HeroButton>
            <HeroButton variant="danger" size="sm" onPress={doDelete} isDisabled={deleting}>
              {deleting ? <Spinner size="sm" /> : null} 确定删除（{selected.size}）
            </HeroButton>
          </>
        }
      >
        <p>将永久删除选中的 <b>{selected.size}</b> 张模版图，删除后不可恢复。</p>
      </Modal>
    </div>
  )
}

// ============================================================================
// 裁切结果库：跨境主图裁切生成的结果，支持多选 + 批量导出
// ============================================================================
function CropResultsLibrary({ brand }) {
  const [images, setImages] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [delConfirm, setDelConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.images(CROP_RESULTS_BUCKET, { brand })
      setImages((r?.images || []).slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0)))
    } catch (e) {
      Toast.error('加载裁切结果失败：' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load])

  const toggle = (name) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  const exportSelected = () => {
    const names = images.filter(it => selected.has(it.name)).map(it => it.name)
    exportLibraryZip(names, CROP_RESULTS_BUCKET, brand, '云眠花园_裁切结果')
    setSelected(new Set())
  }

  const doDelete = async () => {
    const names = images.filter(it => selected.has(it.name)).map(it => it.name)
    if (!names.length) { setDelConfirm(false); return }
    setDeleting(true)
    try {
      const results = await Promise.allSettled(
        names.map(n => api.libraryDelete(CROP_RESULTS_BUCKET, n, { brand }))
      )
      const ok = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length
      const fail = results.length - ok
      Toast.success(`已删除 ${ok} 张${fail ? `（${fail} 张失败）` : ''}`)
      setSelected(new Set())
      setDelConfirm(false)
      load()
    } catch (e) {
      Toast.error('删除失败：' + (e?.message || e))
    } finally {
      setDeleting(false)
    }
  }

  const fmtDay = (ts) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="scissor" size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>裁切结果</span>
          <span className="tk-chip" style={{ color: 'var(--foreground)', background: 'rgba(148,163,184,.10)', borderColor: 'rgba(148,163,184,.22)' }}>{images.length} 张裁切结果</span>
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <HeroButton variant="primary" size="sm" onPress={exportSelected}><Icon name="download" size={13} /> 导出（{selected.size}）</HeroButton>
            <HeroButton variant="danger" size="sm" onPress={() => setDelConfirm(true)} isDisabled={deleting}><Icon name="delete" size={13} /> 删除（{selected.size}）</HeroButton>
            <HeroButton variant="ghost" size="sm" onPress={() => setSelected(new Set())}>清空选中</HeroButton>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)' }}><Spinner size="sm"/> 加载中…</div>
      ) : images.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>暂无裁切结果，先去「主图裁切」生成吧</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {images.map(it => {
            const sel = selected.has(it.name)
            const url = api.thumbOf(api.imageUrl(CROP_RESULTS_BUCKET, it.name, { brand }))
            return (
              <div key={it.name} onClick={() => toggle(it.name)} style={{ position: 'relative', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', border: `2px solid ${sel ? '#fff' : 'var(--border)'}` }}>
                <img src={url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                <span style={{ position: 'absolute', top: 6, left: 6, background: 'var(--surface-bg-2)', color: 'var(--foreground)', padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>裁切</span>
                <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: sel ? '#fff' : 'rgba(0,0,0,.45)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{sel ? <Icon name="check" size={12} /> : ''}</span>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 9, padding: '2px 4px', textAlign: 'center' }}>{fmtDay(it.mtime)}</div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        title="删除裁切结果"
        visible={delConfirm}
        onClose={() => { if (!deleting) setDelConfirm(false) }}
        footer={
          <>
            <HeroButton variant="outline" size="sm" onPress={() => setDelConfirm(false)} isDisabled={deleting}>取消</HeroButton>
            <HeroButton variant="danger" size="sm" onPress={doDelete} isDisabled={deleting}>
              {deleting ? <Spinner size="sm" /> : null} 确定删除（{selected.size}）
            </HeroButton>
          </>
        }
      >
        <p>将永久删除选中的 <b>{selected.size}</b> 张裁切结果，删除后不可恢复。</p>
      </Modal>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================
// ============================================================================
export function TemplateGen({ brand }) {
  const [mode, setMode] = useState('domestic')  // domestic | cross | history
  const [crossTab, setCrossTab] = useState('library') // library | crop | cropResults

  return (
    <div className="tk-page">
      {/* 顶部切换器 */}
      <div className="tk-panel" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SegSwitch
          value={mode}
          onChange={setMode}
          options={[
            { value: 'domestic', label: '国内模版生成' },
            { value: 'cross', label: 'Ozon模版生成' },
            { value: 'history', label: '模版合成库' },
          ]}
        />
        {mode === 'cross' && (
          <SegSwitch
            value={crossTab}
            onChange={setCrossTab}
            size="sm"
            options={[
              { value: 'library', label: '模版库' },
              { value: 'crop', label: '主图裁切' },
              { value: 'cropResults', label: '裁切结果' },
            ]}
          />
        )}
      </div>

      {mode === 'domestic' ? (
        <DomesticTpl brand={brand} />
      ) : mode === 'cross' ? (
        crossTab === 'library' ? <CrossTemplateLibrary brand={brand} /> : crossTab === 'crop' ? <CrossCrop brand={brand} /> : <CropResultsLibrary brand={brand} />
      ) : mode === 'history' ? (
        <TemplateResultLibrary brand={brand} />
      ) : null}
    </div>
  )
}

export default TemplateGen
