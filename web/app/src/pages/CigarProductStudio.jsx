import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button as HeroButton, Card, Chip, Spinner,
  Modal as HeroModal, Input, TextArea,
} from '@heroui/react'
import api from '../api'
import usePasteImages, { normalizePastedImage } from '../hooks/usePasteImages'

// 茄境 · 产品图片生产（6 步向导）
// ① 选模板  ② 背景/雪茄预设  ③ 上传产品图  ④ 模型/清晰度
// ⑤ AI 生成提示词并确认  ⑥ 调用生图模型产出
const STEPS = ['选择模板', '背景与雪茄', '上传产品图', '模型清晰度', '确认提示词', '生成结果']
const MODELS = [
  { id: 'gemini-nano-banana-2.1', name: 'gemini-nano-banana-2.1', sub: '可用 · 推荐', ok: true },
  { id: 'nano_banana_pro', name: 'nano_banana_pro', sub: '403 无权限', ok: false },
]
const RESOLUTIONS = ['1K', '2K', '4K']

function imgSrc(u) {
  if (!u) return ''
  if (u.startsWith('/')) return (api.baseUrl || '') + u
  return u
}

function StepBar({ current, onJump, maxReached }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 22, overflowX: 'auto' }}>
      {STEPS.map((name, i) => {
        const n = i + 1
        const done = n < current, active = n === current
        const jumpable = n <= maxReached || done
        return (
          <React.Fragment key={name}>
            <div onClick={() => jumpable && onJump(n)} title={name}
              style={{ display: 'flex', alignItems: 'center', gap: 9, flex: '0 0 auto', cursor: jumpable ? 'pointer' : 'default', opacity: jumpable ? 1 : 0.45 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
                fontSize: 12, fontWeight: 700, flex: '0 0 auto',
                background: active ? 'var(--accent)' : done ? 'var(--accent-soft)' : 'var(--surface-tertiary)',
                color: active ? 'var(--accent-foreground)' : done ? 'var(--accent)' : 'var(--muted)' }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: active ? 700 : 500,
                color: active ? 'var(--foreground)' : 'var(--muted)' }}>{name}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ height: 1, flex: '1 1 26px', minWidth: 14, margin: '0 10px',
              background: done ? 'var(--accent)' : 'var(--border)' }} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Panel({ title, step, sub, children, actions }) {
  return (
    <Card variant="default" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <Card.Content style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
          <Chip size="sm" variant="flat" color="primary">{step}</Chip>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 18, lineHeight: 1.6 }}>{sub}</p>
        {children}
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border)' }}>{actions}</div>}
      </Card.Content>
    </Card>
  )
}

// 自动增高的文本域：内容多长就显示多长，提示词不再被裁切
function AutoTextArea({ value, onChange, ariaLabel, placeholder }) {
  const ref = useRef(null)
  const resize = (el) => { if (el) { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 44) + 'px' } }
  useEffect(() => { resize(ref.current) }, [value])
  return <textarea
    ref={ref} value={value || ''} placeholder={placeholder} aria-label={ariaLabel}
    onChange={e => { onChange(e.target.value); resize(e.target) }}
    style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 44, lineHeight: 1.5,
      background: 'var(--surface-tertiary)', border: '1px solid var(--border)', borderRadius: 8,
      color: 'var(--foreground)', fontSize: 12.5, padding: '8px 10px', outline: 'none', overflow: 'hidden' }}
  />
}

export default function CigarProductStudio({ brand = 'cigarrealm', account }) {
  const [step, setStep] = useState(1)
  const [maxReached, setMaxReached] = useState(1)
  const [templates, setTemplates] = useState([])
  const [presets, setPresets] = useState({ backgrounds: [], cigars: [] })
  const [selectedTpl, setSelectedTpl] = useState(null)
  const [editingTplId, setEditingTplId] = useState(null)
  const [editingName, setEditingName] = useState('')
  // 模板详情弹窗
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTpl, setDetailTpl] = useState(null)   // 编辑中的模板副本
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailReanalyzing, setDetailReanalyzing] = useState(false)  // 详情弹窗 AI 重新拆解中
  const [translatingKey, setTranslatingKey] = useState('')           // 正在翻译的那一条：'cam-0' / 'common'
  const [detailSaving, setDetailSaving] = useState(false)            // 保存中（与 AI 分析分开，避免按钮误导）
  const [previewImg, setPreviewImg] = useState(null)   // 放大预览：{ url, name }
  const [expandedAngle, setExpandedAngle] = useState(-1)  // 详情弹窗里展开的角度索引（-1=全收起）
  const detailScrollRef = useRef(null)               // 详情弹窗滚动容器（打开时回到顶部）
  const [background, setBackground] = useState('bg_clean')
  const [cigar, setCigar] = useState('cohiba')
  const [uploaded, setUploaded] = useState([])       // [{url,name}]
  const [model, setModel] = useState('gemini-nano-banana-2.1')
  const [resolution, setResolution] = useState('2K')
  const [prompts, setPrompts] = useState([])         // [{code,name,cam,common,prompt}]
  const [results, setResults] = useState([])
  const [history, setHistory] = useState([])          // 历史生成批次（刷新后仍在）
  const [busy, setBusy] = useState(false)
  const [genProgress, setGenProgress] = useState(null)  // { done, total, startedAt } 生图真实进度
  const [notice, setNotice] = useState('')
  const [toast, setToast] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)  // 待删除的模板
  const [deleting, setDeleting] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)       // 已隐藏的内置模板数
  const fileRef = useRef(null)
  const addFileRef = useRef(null)  // 新增模板弹窗内的上传输入
  const [addOpen, setAddOpen] = useState(false)

  // 新增模板弹窗状态
  const [addPhase, setAddPhase] = useState(1)
  const [addImages, setAddImages] = useState([])
  const [addAngles, setAddAngles] = useState([])
  const [addCommon, setAddCommon] = useState('')
  const [addCommonZh, setAddCommonZh] = useState('')   // 通用提示词中文说明
  const [addName, setAddName] = useState('')
  const [addCat, setAddCat] = useState('')
  const [addSplitting, setAddSplitting] = useState(false)
  const [addTranslating, setAddTranslating] = useState('')  // 新增模板弹窗里正在翻译的条目

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200) }

  // 载入模板与预设
  const loadBase = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.cigarTemplates(), api.cigarPresets()])
      const tpls = Array.isArray(t?.templates) ? t.templates : []
      setTemplates(tpls)
      setSelectedTpl(prev => prev || tpls[0] || null)
      setHiddenCount(Number(t?.hiddenCount || 0))
      setPresets(p || { backgrounds: [], cigars: [] })
    } catch (e) { setNotice('加载模板/预设失败：' + (e?.message || e)) }
  }, [])
  const loadHistory = useCallback(async () => {
    try { const r = await api.cigarHistory(); setHistory(Array.isArray(r?.items) ? r.items : []) } catch {}
  }, [])
  useEffect(() => { loadBase(); loadHistory() }, [loadBase, loadHistory])

  // 全局粘贴：当前页有上传区时接管图片粘贴（新增模板弹窗优先，其次步骤③上传区）。
  // 用共享 hook，只有剪贴板里确实有图片时才拦截，不影响输入框粘贴文本。
  const uploadAddFilesRef = useRef(null)   // 指向最新的 uploadAddFiles
  const uploadStepFilesRef = useRef(null)  // 指向最新的 uploadStepFiles
  const pasteEnabled = (addOpen && addPhase === 1) || step === 3
  const pasteHandler = useCallback((files) => {
    if (addOpen && addPhase === 1) uploadAddFilesRef.current?.(files)
    else uploadStepFilesRef.current?.(files)
  }, [addOpen, addPhase])
  usePasteImages(pasteEnabled, pasteHandler)

  // ★ HeroUI v3 的 Modal Backdrop 关闭时靠 CSS 退场动画卸载，
  // 本项目注入的 .modal__backdrop !important 样式让退场 animationend 不触发，
  // 导致黑色蒙层(data-exiting=true)永久残留、盖住整页点不动。
  // 用全局定时巡检兜底：任何处于 data-exiting 且没有配套 dialog 的孤儿蒙层都清掉。
  // 不依赖 React state（关闭可能经 ESC / 点遮罩 / onOpenChange），最稳。
  useEffect(() => {
    const cleanup = () => {
      const exiting = document.querySelectorAll('.modal__backdrop[data-exiting="true"]')
      if (!exiting.length) return
      const liveDialogs = document.querySelectorAll('[role="dialog"]').length
      if (liveDialogs > 0) return  // 有弹窗正开着/正在退场配对中，别误删
      exiting.forEach(el => el.remove())
    }
    const timer = setInterval(cleanup, 600)
    return () => clearInterval(timer)
  }, [])

  // 详情弹窗每次打开都强制回到顶部。HeroModal 挂载/恢复滚动有延迟，
  // 单次 setTimeout 会落空（用户看到直接从角度03开始），故用 rAF + 多次尝试兜底。
  useEffect(() => {
    if (!detailOpen) return
    const reset = () => {
      const box = detailScrollRef.current?.querySelector?.('.modal__body--scroll-inside')
        || document.querySelector('.modal__body--scroll-inside')
      if (box) box.scrollTop = 0
      if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    }
    const r1 = requestAnimationFrame(reset)
    const t1 = setTimeout(reset, 40)
    const t2 = setTimeout(reset, 150)
    const t3 = setTimeout(reset, 350)
    return () => { cancelAnimationFrame(r1); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [detailOpen, detailTpl?.id])

  // 选项变更 → 提示词作废
  const invalidatePrompts = () => { setPrompts([]); setResults([]) }
  const changeBg = (id) => { setBackground(id); invalidatePrompts() }
  const changeCigar = (id) => { setCigar(id); invalidatePrompts() }
  const changeRes = (r) => { setResolution(r); invalidatePrompts() }

  const pickTpl = (t) => { setSelectedTpl(t); invalidatePrompts() }
  const startRename = (e, t) => {
    e.stopPropagation()
    setEditingTplId(t.id)
    setEditingName(t.name)
  }
  const commitRename = async (e, t) => {
    e.stopPropagation()
    const name = (editingName || '').trim()
    setEditingTplId(null)
    if (!name || name === t.name) return
    try {
      await api.cigarRenameTemplate({ id: t.id, name })
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, name } : x))
      setSelectedTpl(prev => prev?.id === t.id ? { ...prev, name } : prev)
      showToast('模板已改名为「' + name + '」')
    } catch (er) { showToast('改名失败：' + (er?.message || er)) }
  }

  // ── 删除模板（带确认；内置模板删除后可从底部「恢复」入口找回） ──
  const openDelete = (e, t) => { e.stopPropagation(); setDeleteTarget(t) }
  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const r = await api.cigarDeleteTemplate({ id: deleteTarget.id })
      const removedId = deleteTarget.id
      setTemplates(prev => prev.filter(x => x.id !== removedId))
      setSelectedTpl(prev => (prev?.id === removedId ? null : prev))
      if (selectedTpl?.id === removedId) invalidatePrompts()
      if (r?.builtin) setHiddenCount(c => c + 1)
      setDeleteTarget(null)
      showToast(`已删除模板「${r?.name || ''}」${r?.builtin ? '（内置模板，可在底部恢复）' : ''}`)
    } catch (er) { showToast('删除失败：' + (er?.message || er)) }
    finally { setDeleting(false) }
  }
  const doRestoreBuiltins = async () => {
    try {
      await api.cigarRestoreTemplates()
      await loadBase()
      setHiddenCount(0)
      showToast('已恢复所有内置模板')
    } catch (er) { showToast('恢复失败：' + (er?.message || er)) }
  }

  // ── 模板详情：查看/手改/AI 重析 ──
  const openDetail = (e, t) => {
    e.stopPropagation()
    setDetailTpl(JSON.parse(JSON.stringify(t)))  // 深拷贝，编辑不污染列表
    setExpandedAngle(-1)  // 默认全部收起：5 个角度一屏全可见，点哪行展开哪行
    setDetailOpen(true)
    // 置顶由下方 useEffect(detailOpen) 负责（rAF + 多次兜底，抗 HeroModal 挂载延迟）
  }
  const detailSetAngle = (i, field, val) => setDetailTpl(prev => ({
    ...prev, angles: (prev.angles || []).map((a, j) => j === i ? { ...a, [field]: val } : a),
  }))
  // 「同步英文」：中文改动后手动点按钮，调 AI 把中文翻译成英文提示词回填
  const detailSyncEn = async (i, kind) => {
    if (!detailTpl) return
    const zh = kind === 'common'
      ? (detailTpl.commonPromptZh || '')
      : (detailTpl.angles?.[i]?.camZh || '')
    if (!zh.trim()) { showToast('请先填写中文说明'); return }
    const key = kind === 'common' ? 'common' : `cam-${i}`
    setDetailBusy(true)
    setTranslatingKey(key)   // 只让被点的那一条显示「翻译中…」，其他照常
    try {
      const r = await api.cigarTranslate({ text: zh, kind: kind === 'common' ? 'common' : 'cam' })
      if (kind === 'common') {
        setDetailTpl(prev => ({ ...prev, commonPrompt: r.text }))
      } else {
        setDetailTpl(prev => ({ ...prev,
          angles: (prev.angles || []).map((a, j) => j === i ? { ...a, cam: r.text } : a) }))
      }
      showToast('已同步英文（AI 翻译）')
    } catch (er) { showToast('翻译失败：' + (er?.message || er)) }
    finally { setDetailBusy(false); setTranslatingKey('') }
  }
  const detailAddAngle = () => {
    // 注意：JS 没有 zfill（Python 才有），这里用 padStart，否则点「添加角度」直接抛错
    setDetailTpl(prev => {
      const next = [...(prev.angles || []), {
        code: String((prev.angles?.length || 0) + 1).padStart(2, '0'), name: '新角度', cam: '', camZh: '', img: '',
      }]
      setExpandedAngle(next.length - 1)  // 新增后自动展开该角度
      return { ...prev, angles: next }
    })
  }
  const detailDelAngle = (i) => {
    setDetailTpl(prev => ({
      ...prev,
      angles: (prev.angles || []).filter((_, j) => j !== i).map((a, j) => ({ ...a, code: String(j + 1).padStart(2, '0') })),
    }))
    setExpandedAngle(prev => (prev === i ? -1 : prev > i ? prev - 1 : prev))
  }
  const detailSetRef = (i, field, val) => setDetailTpl(prev => ({
    ...prev, refImages: (prev.refImages || []).map((r, j) => j === i ? { ...r, [field]: val } : r),
  }))
  const detailDelRef = (i) => setDetailTpl(prev => ({
    ...prev, refImages: (prev.refImages || []).filter((_, j) => j !== i),
  }))
  const detailAddRef = () => setDetailTpl(prev => ({
    ...prev, refImages: [...(prev.refImages || []), { name: '新垫图', url: '', note: '' }],
  }))
  // AI 重新分析：用垫图 URL 调 split，重生成角度结构 + 通用提示词（不自动保存，用户确认后再存）
  const detailReanalyze = async () => {
    if (!detailTpl) return
    setDetailBusy(true)
    setDetailReanalyzing(true)
    try {
      const imgs = (detailTpl.refImages || []).map(r => r.url).filter(Boolean)
        .map(u => (u.startsWith('http') ? u : (api.baseUrl || '') + u))
      const r = await api.cigarSplit({
        images: imgs, cat: detailTpl.cat || detailTpl.name || '雪茄周边',
        count: (detailTpl.angles || []).length,  // 保持模板原有角度数量，不再随机变少
        imgs: (detailTpl.angles || []).map(a => a.img || ''),  // 各角度缩略图按 index 带回，不丢图
      })
      if (Array.isArray(r?.angles) && r.angles.length) {
        setDetailTpl(prev => ({ ...prev, angles: r.angles,
          commonPrompt: r.commonPrompt || prev.commonPrompt,
          commonPromptZh: r.commonPromptZh || prev.commonPromptZh || '' }))
        showToast(r.fallback
          ? (r.message || 'AI 未成功，已回填内置五视角，可手动修改')
          : `AI 重新分析完成，生成 ${r.angles.length} 个角度（请确认后保存）`)
      } else {
        showToast('AI 未返回角度，请手动修改')
      }
    } catch (er) { showToast('AI 分析失败：' + (er?.message || er)) }
    finally { setDetailBusy(false); setDetailReanalyzing(false) }
  }
  // 保存详情
  const detailSave = async () => {
    if (!detailTpl) return
    if (!detailTpl.angles?.length) { showToast('至少保留一个角度'); return }
    setDetailBusy(true)
    setDetailSaving(true)
    try {
      const r = await api.cigarUpdateTemplate({
        id: detailTpl.id, name: (detailTpl.name || '').trim(), cat: detailTpl.cat || '',
        desc: detailTpl.desc || '', thumb: detailTpl.thumb || '',
        angles: detailTpl.angles, commonPrompt: detailTpl.commonPrompt || '',
        commonPromptZh: detailTpl.commonPromptZh || '', refImages: detailTpl.refImages || [],
      })
      const updated = r?.template || detailTpl
      setTemplates(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x))
      setSelectedTpl(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
      setDetailOpen(false)
      invalidatePrompts()
      showToast('模板详情已保存')
    } catch (er) { showToast('保存失败：' + (er?.message || er)) }
    finally { setDetailBusy(false); setDetailSaving(false) }
  }

  // 上传产品图（真实上传到后端）
  const onFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) await uploadStepFiles(files)
    if (fileRef.current) fileRef.current.value = ''
  }
  // 真正上传一批文件到 uploaded（文件选择与 ⌘V 粘贴共用）
  const uploadStepFiles = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      let ok = 0
      for (const f of files) {
        const file = normalizePastedImage(f)   // 粘贴来的图常无文件名，补名再传
        const saved = await api.cigarUploadRef(file, brand)
        if (saved?.url) { setUploaded(prev => [...prev, { url: saved.url, name: file.name }]); ok += 1 }
      }
      invalidatePrompts()
      showToast(ok ? `已上传 ${ok} 张产品图` : '上传失败：未拿到图片地址')
    } catch (er) { showToast('上传失败：' + (er?.message || er)) }
    finally { setBusy(false) }
  }
  uploadStepFilesRef.current = uploadStepFiles  // 供全局粘贴监听器调用最新版

  // 使用示例产品图（无需上传，便于演示）
  const useDemoImages = () => {
    setUploaded([
      { url: '/api/cigar/preset/product_front.png', name: '产品正面.png' },
      { url: '/api/cigar/preset/product_45.png', name: '产品45°.png' },
    ])
    invalidatePrompts()
    showToast('已填入 2 张示例产品图')
  }

  // 第 5 步：AI 组装提示词
  const doGenPrompts = async () => {
    if (!selectedTpl) { showToast('请先选择模板'); return }
    if (!uploaded.length) { showToast('请先在步骤③上传产品图——AI 需读图才会按模板骨架生成最终提示词'); return }
    setBusy(true)
    try {
      // 传本次上传的产品图：后端调 Vision 提炼产品事实，与模板骨架拼成最终提示词
      const r = await api.cigarGenPrompts({
        templateId: selectedTpl.id, angles: selectedTpl.angles,
        commonPrompt: selectedTpl.commonPrompt, background, cigar,
        refImages: uploaded.map(u => u.url),
      })
      setPrompts(Array.isArray(r?.prompts) ? r.prompts : [])
      showToast(r?.fromAI
        ? `AI 已读图生成 ${r?.count || 0} 条最终提示词（含产品实拍细节）`
        : `已生成 ${r?.count || 0} 条（${r?.reason || '模板骨架'}）`)
    } catch (e) { showToast('生成提示词失败：' + (e?.message || e)) }
    finally { setBusy(false) }
  }

  // 第 6 步：真实生图
  const doGenerate = async () => {
    if (!prompts.length) { showToast('请先生成并确认提示词'); return }
    setBusy(true)
    const refImgs = [...uploaded.map(u => u.url)]
    const bgReady = presets.backgrounds.find(b => b.id === background)?.ready
    const cgReady = presets.cigars.find(c => c.id === cigar)?.ready
    if (bgReady) refImgs.push('/api/cigar/preset/bg_clean.png')
    if (cgReady) refImgs.push('/api/cigar/preset/cigar_cohiba.jpg')
    try {
      // 逐张调用（而不是一次提交整批）：这样每完成一张就能立刻出图，
      // 用户能看到"第 2/5 张 · 已用时 1:20"的真实进度，而不是干等几分钟黑屏。
      const list = prompts.map(p => p.prompt)
      const initial = list.map((_, i) => ({ code: String(i + 1).padStart(2, '0'), status: 'pending' }))
      setResults(initial)
      setGenProgress({ done: 0, total: list.length, startedAt: Date.now() })
      const collected = []
      for (let i = 0; i < list.length; i += 1) {
        setResults(prev => prev.map((x, j) => (j === i ? { ...x, status: 'running' } : x)))
        try {
          const r = await api.cigarGenerate({
            brand, prompts: [list[i]], refImages: refImgs, model, resolution, ratio: '3:4',
            recordHistory: false,                  // 逐张调用不写历史，全部完成后汇总记一条
          })
          const item = (r?.items && r.items[0]) || { code: initial[i].code, status: 'fail', error: '无返回' }
          const withCode = { ...item, code: initial[i].code }
          collected.push(withCode)
          setResults(prev => prev.map((x, j) => (j === i ? withCode : x)))
        } catch (e) {
          const failed = { code: initial[i].code, status: 'fail', error: (e?.message || String(e)).slice(0, 200) }
          collected.push(failed)
          setResults(prev => prev.map((x, j) => (j === i ? failed : x)))
        }
        setGenProgress(p => (p ? { ...p, done: p.done + 1 } : p))
      }
      // 汇总写一条历史
      try { await api.cigarHistoryRecord({ model, resolution, items: collected }) } catch {}
      loadHistory()
      const okCount = collected.filter(x => x.status === 'done').length
      showToast(`生图完成：成功 ${okCount}/${collected.length} 张，已归档到「图库」`)
    } catch (e) { showToast('生图失败：' + (e?.message || e)) }
    finally { setBusy(false); setGenProgress(null) }
  }

  // 新增模板：AI 自动拆解
  const openAdd = () => { setAddPhase(1); setAddImages([]); setAddAngles([]); setAddCommon(''); setAddCommonZh(''); setAddName(''); setAddCat(''); setAddOpen(true) }
  const addDemoImages = () => setAddImages(['/api/cigar/preset/product_front.png', '/api/cigar/preset/product_45.png'])
  // 新增模板弹窗内真实上传产品图（支持多选），与步骤③同一后端上传接口
  const onAddFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) await uploadAddFiles(files)
    if (addFileRef.current) addFileRef.current.value = ''
  }
  // 真正上传一批文件到 addImages（文件选择与粘贴共用）
  const uploadAddFiles = async (files) => {
    if (!files?.length) return
    setAddSplitting(true)
    try {
      const urls = []
      for (const f of files) {
        const file = normalizePastedImage(f)   // 粘贴图无文件名时按 MIME 补名
        const saved = await api.cigarUploadRef(file, brand)
        if (saved?.url) urls.push(saved.url)
      }
      if (urls.length) {
        setAddImages(prev => [...prev, ...urls])
        showToast(`已添加 ${urls.length} 张产品图（准备交给 AI 拆解）`)
      } else {
        showToast('上传失败：未拿到图片地址')
      }
    } catch (er) { showToast('上传失败：' + (er?.message || er)) }
    finally { setAddSplitting(false) }
  }
  uploadAddFilesRef.current = uploadAddFiles  // 供全局粘贴监听器调用最新版
  const doSplit = async () => {
    if (!addImages.length) { showToast('请至少上传一张产品图'); return }
    setAddSplitting(true); setAddPhase(2)
    try {
      // Vision 模型分析参考图，产出角度结构；失败后端自动回退内置五视角
      const imgs = addImages.map(u => (u.startsWith('http') ? u : (api.baseUrl || '') + u))
      const r = await api.cigarSplit({ images: imgs, cat: addCat || '雪茄周边' })
      setAddAngles(Array.isArray(r?.angles) ? r.angles : [])
      setAddCommon(r?.commonPrompt || '')
      setAddCommonZh(r?.commonPromptZh || '')
      if (r?.fallback) showToast(r.message || '已回退到内置五视角结构')
      else showToast(`AI 已拆解出 ${r?.angles?.length || 0} 个角度`)
    } catch (e) { showToast('AI 拆解失败：' + (e?.message || e)) }
    finally { setAddSplitting(false) }
  }
  // 新增模板阶段：中文说明 → 英文提示词（供「同步英文」按钮，与详情弹窗同一套 AI 翻译）
  const addSyncEn = async (i, kind) => {
    const zh = kind === 'common' ? addCommonZh : (addAngles?.[i]?.camZh || '')
    if (!zh.trim()) { showToast('请先填写中文说明'); return }
    setAddSplitting(true)
    setAddTranslating(kind === 'common' ? 'common' : `cam-${i}`)
    try {
      const r = await api.cigarTranslate({ text: zh, kind: kind === 'common' ? 'common' : 'cam' })
      if (kind === 'common') setAddCommon(r.text)
      else setAddAngles(prev => prev.map((x, j) => (j === i ? { ...x, cam: r.text } : x)))
      showToast('已同步英文（AI 翻译）')
    } catch (er) { showToast('翻译失败：' + (er?.message || er)) }
    finally { setAddSplitting(false); setAddTranslating('') }
  }
  const saveTpl = async () => {
    if (!addName.trim() || !addAngles.length) { showToast('请填写模板名称并完成拆解'); return }
    try {
      const r = await api.cigarSaveTemplate({
        name: addName.trim(), cat: addCat.trim(), angles: addAngles,
        commonPrompt: addCommon, commonPromptZh: addCommonZh,
        refCount: addImages.length, thumb: addImages[0] || '',
      })
      await loadBase()
      if (r?.template) { setSelectedTpl(r.template); invalidatePrompts() }
      setAddOpen(false)
      showToast(`模板「${addName.trim()}」已保存并选中`)
    } catch (e) { showToast('保存模板失败：' + (e?.message || e)) }
  }

  const goStep = (n) => { if (n < 1 || n > 6) return; setStep(n); setMaxReached(m => Math.max(m, n)) }
  const next = () => {
    if (step === 4) { goStep(5); if (!prompts.length) showToast('请在第 5 步点击「生成提示词」'); return }
    if (step === 5 && !prompts.length) { showToast('请先生成并确认提示词'); return }
    goStep(step + 1)
  }

  const bgName = presets.backgrounds.find(b => b.id === background)?.name || '—'
  const cgName = presets.cigars.find(c => c.id === cigar)?.name || '—'

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '26px 30px 60px' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--accent-soft)',
          border: '1px solid var(--accent)', display: 'grid', placeItems: 'center', fontSize: 22 }}>🚬</div>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700 }}>产品图片生产</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 3, maxWidth: 720 }}>
            选择训练好的模板，指定背景与雪茄，上传产品多角度实拍，AI 自动拆解提示词并批量生成电商产品图。
          </p>
        </div>
        <Chip size="sm" variant="flat" color="primary" style={{ marginLeft: 'auto' }}>茄境 CIGARREALM</Chip>
      </div>

      <StepBar current={step} onJump={goStep} maxReached={maxReached} />
      {notice && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{notice}</div>}

      {/* STEP 1 模板 */}
      {step === 1 && <Panel step={`STEP 1`} title="选择产品模板"
        sub="模板由 AI 训练沉淀：每个模板内置「通用提示词 + 机位角度拆解 + 参考图槽位」，决定后续生成几个角度、怎么拆提示词。"
        actions={<><div style={{ flex: 1 }} /><HeroButton variant="secondary" onPress={() => goStep(2)}>下一步 →</HeroButton></>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 14 }}>
          {templates.map(t => {
            const sel = selectedTpl?.id === t.id
            const editing = editingTplId === t.id
            return <div key={t.id} onClick={() => !editing && pickTpl(t)}
              style={{ border: sel ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 12,
                cursor: 'pointer', overflow: 'hidden', aspectRatio: '3 / 4', background: '#0a0c10', position: 'relative' }}>
              {t.thumb
                ? <img src={imgSrc(t.thumb)} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 11,
                    background: 'repeating-linear-gradient(45deg,#1a1d25,#1a1d25 8px,#151820 8px,#151820 16px)' }}>暂无训练图</div>}
              {/* 查看详情 */}
              <button title="查看/编辑模板详情" onClick={e => openDetail(e, t)}
                style={{ position: 'absolute', top: 7, right: 7, background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.35)',
                  borderRadius: 6, color: '#fff', fontSize: 10.5, padding: '3px 8px', cursor: 'pointer', zIndex: 2 }}>详情</button>
              {/* 删除模板 */}
              <button title="删除此模板" onClick={e => openDelete(e, t)}
                style={{ position: 'absolute', top: 7, left: 7, background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.35)',
                  borderRadius: 6, color: '#ff6b6b', fontSize: 11, width: 22, height: 22, lineHeight: '20px', padding: 0,
                  cursor: 'pointer', zIndex: 2 }}>✕</button>
              {/* 标题浮在图片底部：10% 透明度黑色蒙层 + 白字；点标题可直接改名 */}
              <div onClick={e => { e.stopPropagation(); startRename(e, t) }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.1)',
                  padding: '12px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, cursor: 'text' }}>
                {editing ? <input
                  autoFocus onFocus={e => e.target.select()} value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => commitRename(e, t)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(e, t); if (e.key === 'Escape') setEditingTplId(null) }}
                  style={{ width: '100%', background: 'rgba(0,0,0,.55)', border: '1px solid var(--accent)',
                    borderRadius: 6, color: '#fff', fontSize: 13, padding: '4px 7px', textAlign: 'center' }}
                /> : <b style={{ color: '#fff', fontSize: 13.5, textAlign: 'center', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,.6)' }}>{t.name}</b>}
              </div>
            </div>
          })}
          {/* 新增模板 */}
          <div onClick={openAdd}
            style={{ border: '1.5px dashed var(--border)', borderRadius: 12, background: 'transparent', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, aspectRatio: '3 / 4' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', border: '1.5px dashed var(--border)', display: 'grid', placeItems: 'center', fontSize: 24, color: 'var(--accent)' }}>＋</div>
              <b style={{ fontSize: 13.5 }}>新增模板</b>
            </div>
          </div>
        </div>
        {hiddenCount > 0 && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
          已删除 {hiddenCount} 个内置模板 ·{' '}
          <button onClick={doRestoreBuiltins}
            style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            恢复内置模板
          </button>
        </div>}
        {selectedTpl && <div style={{ marginTop: 18, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 15 }}>
          <h4 style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 11 }}>该模板的角度拆解 · {selectedTpl.name}</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(selectedTpl.angles || []).map(a => <Chip key={a.code} size="sm" variant="flat">
              <span style={{ color: 'var(--accent)', fontWeight: 700, marginRight: 5 }}>{a.code}</span>{a.name}</Chip>)}
          </div>
        </div>}
      </Panel>}

      {/* STEP 2 背景与雪茄 */}
      {step === 2 && <Panel step="STEP 2" title="选择背景与雪茄"
        sub="背景与雪茄均为系统预设，可快速选择。已训练的预设能 100% 还原材质与光影，未训练项标注「待训练」。"
        actions={<><HeroButton variant="ghost" onPress={() => goStep(1)}>← 上一步</HeroButton><div style={{ flex: 1 }} /><HeroButton color="primary" onPress={() => goStep(3)}>下一步 →</HeroButton></>}>
        <PresetRow label="背景预设" presets={presets.backgrounds} selected={background} onSelect={changeBg} />
        <div style={{ height: 18 }} />
        <PresetRow label="雪茄预设" presets={presets.cigars} selected={cigar} onSelect={changeCigar} />
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--warn)', background: 'rgba(240,169,59,.08)',
          border: '1px solid rgba(240,169,59,.28)', borderRadius: 8, padding: '9px 11px' }}>
          ⚠ 交接文档铁律：背景必须用已清理干净的图片作参考；提示词禁止出现中文，否则模型会把中文渲染到图上。
        </div>
      </Panel>}

      {/* STEP 3 上传产品图 */}
      {step === 3 && <Panel step="STEP 3" title="上传产品多角度实拍"
        sub="按模板要求上传雪茄托 / 雪茄周边产品的不同角度。产品必须与实拍完全一致，AI 不会臆造造型。"
        actions={<><HeroButton variant="ghost" onPress={() => goStep(2)}>← 上一步</HeroButton><div style={{ flex: 1 }} /><HeroButton color="primary" onPress={() => goStep(4)}>下一步 →</HeroButton></>}>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} style={{ display: 'none' }} />
        <div onClick={() => fileRef.current?.click()}
          style={{ border: '1.5px dashed var(--border)', borderRadius: 12, minHeight: 120, display: 'grid', placeItems: 'center',
            textAlign: 'center', color: 'var(--muted)', background: 'var(--surface-2)', cursor: 'pointer' }}>
          <div><div style={{ fontSize: 28, color: 'var(--accent)' }}>＋</div>
            {busy ? '上传中…' : '点击上传产品图片（支持多选）'}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>也可直接 ⌘V / Ctrl+V 粘贴剪贴板图片</div></div>
        </div>
        <HeroButton size="sm" variant="flat" onPress={useDemoImages} style={{ marginTop: 12 }}>填入 2 张示例产品图</HeroButton>
        {uploaded.length > 0 && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          {uploaded.map((u, i) => <div key={i} style={{ width: 130, border: '1px solid var(--accent)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}>
            <img src={imgSrc(u.url)} alt={u.name} style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block', background: '#fff' }} />
            <div style={{ fontSize: 10, color: 'var(--muted)', padding: '5px 7px', textAlign: 'center' }}>产品图 {i + 1}</div>
          </div>)}
        </div>}
        <div style={{ marginTop: 16, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: 12, fontSize: 12, color: 'var(--muted)' }}>
          <b style={{ color: 'var(--foreground)' }}>参考图槽位：</b> 产品图（本步上传） + 雪茄 + 干净背景（步骤 2 已选），生成时自动上传公网后传入模型。当前产品图 <b style={{ color: 'var(--accent)' }}>{uploaded.length}</b> 张 · 背景 <b style={{ color: 'var(--accent)' }}>{bgName}</b> · 雪茄 <b style={{ color: 'var(--accent)' }}>{cgName}</b>
        </div>
      </Panel>}

      {/* STEP 4 模型与清晰度 */}
      {step === 4 && <Panel step="STEP 4" title="选择模型与清晰度"
        sub="生图模型与清晰度按账户可用能力选择。交接文档验证：当前账户仅 gemini-nano-banana-2.1 可用。"
        actions={<><HeroButton variant="ghost" onPress={() => goStep(3)}>← 上一步</HeroButton><div style={{ flex: 1 }} /><HeroButton color="primary" onPress={next}>生成提示词 →</HeroButton></>}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>生图模型</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
          {MODELS.map(m => <div key={m.id} onClick={() => m.ok && (setModel(m.id), invalidatePrompts())}
            style={{ border: m.id === model ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 10,
              padding: '11px 14px', background: 'var(--surface-2)', minWidth: 190, cursor: m.ok ? 'pointer' : 'not-allowed', opacity: m.ok ? 1 : 0.45, position: 'relative' }}>
            {m.ok && <span style={{ position: 'absolute', top: -8, right: 8, fontSize: 9, background: 'var(--accent)', color: 'var(--accent-foreground)', borderRadius: 5, padding: '1px 6px', fontWeight: 700 }}>推荐</span>}
            <b style={{ fontSize: 12.5, display: 'block' }}>{m.name}</b>
            <span style={{ fontSize: 10.5, color: m.ok ? 'var(--success)' : 'var(--danger)' }}>{m.sub}</span>
          </div>)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>清晰度</div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {RESOLUTIONS.map(r => {
            const sel = r === resolution
            return <div key={r} onClick={() => changeRes(r)} role="radio" aria-checked={sel} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); changeRes(r) } }}
              style={{ border: sel ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 10,
                padding: sel ? '8px 22px' : '9px 23px',      // 边框变粗时补偿 1px，避免选中时跳动
                cursor: 'pointer', background: sel ? 'var(--surface-3)' : 'var(--surface-2)',
                color: sel ? 'var(--accent)' : 'var(--foreground)', fontWeight: sel ? 700 : 500, fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s ease',
                outline: 'none', userSelect: 'none' }}>
              {r}{sel && <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>}
            </div>
          })}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, margin: '22px 0 10px' }}>画面比例</div>
        <Chip variant="flat" color="primary">3:4（模板固定）</Chip>
      </Panel>}

      {/* STEP 5 确认提示词 */}
      {step === 5 && <Panel step="STEP 5" title="AI 生成提示词 · 人工确认"
        sub="AI 会先读取步骤③上传的产品图，提炼产品的真实材质/颜色/形态，再结合模板骨架（各角度机位句 + 通用提示词）生成每条最终英文提示词。同一模板换产品图，角度一致、产品细节跟着图走。确认无误后再生产。"
        actions={<><HeroButton variant="ghost" onPress={() => goStep(4)}>← 上一步</HeroButton><div style={{ flex: 1 }} />
          <HeroButton variant="flat" color="primary" onPress={doGenPrompts} isLoading={busy}>
            {busy ? '生成中…' : (prompts.length ? '🔄 重新生成提示词' : '✨ 生成提示词')}
          </HeroButton>
          <HeroButton color="primary" onPress={() => goStep(6)} isDisabled={!prompts.length || busy}>确认提示词并生产 →</HeroButton></>}>
        {!prompts.length ? (busy
          ? <div style={{ textAlign: 'center', padding: 44 }}>
              <Spinner size="lg" />
              <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 14, fontWeight: 600 }}>AI 正在读你上传的产品图…</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.7 }}>
                提炼产品的材质 / 颜色 / 形态，再按模板骨架组装 {selectedTpl?.angles?.length || 0} 条英文提示词
                <br />通常需要 10–30 秒，请稍候
              </div>
            </div>
          : <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
              点击下方「生成提示词」：AI 读图后按模板骨架生成 {selectedTpl?.angles?.length || 0} 条最终提示词（需先在步骤③上传产品图）
            </div>) : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: busy ? 0.45 : 1, transition: 'opacity .2s', pointerEvents: busy ? 'none' : 'auto' }}>
          {busy && <div style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--accent)',
            borderRadius: 9, background: 'rgba(240,169,59,.08)', padding: '9px 12px' }}>
            <Spinner size="sm" />
            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>正在重新生成提示词…（AI 读图中，10–30 秒）</span>
          </div>}
          {prompts.map((p, i) => <PromptCard key={p.code} p={p} defaultOpen={i === 0}
            onChange={(field, val) => setPrompts(prev => prev.map((x, j) => j === i ? {
              ...x, [field]: val,
              // 若当前是 AI 读图生成的最终提示词，编辑骨架后不覆盖它；点「重新生成提示词」会以新骨架重生成
              ...(x.fromAI ? {} : { prompt: [x.cam, x.common].filter(Boolean).join(' ') }),
            } : x))} />)}
        </div>}
      </Panel>}

      {/* STEP 6 结果 */}
      {step === 6 && <Panel step="STEP 6" title="生成结果"
        sub="按确认的提示词逐角度调用生图模型。每张图片真实生成，结果与提示词一一对应。"
        actions={<><HeroButton variant="ghost" onPress={() => goStep(5)} isDisabled={busy && !!genProgress}>← 上一步</HeroButton><div style={{ flex: 1 }} />
          <HeroButton color="primary" onPress={doGenerate} isLoading={busy}
            isDisabled={busy && !!genProgress}>
            {busy && genProgress ? `生成中 ${genProgress.done}/${genProgress.total}…` : `🚀 开始生产 ${prompts.length} 张产品图`}
          </HeroButton></>}>
        {/* 生成中的强反馈：进度条 + 计时 + 说明，让人一眼知道"正在跑" */}
        {genProgress && <div style={{ marginBottom: 16, border: '1px solid var(--accent)', borderRadius: 11,
          background: 'rgba(240,169,59,.08)', padding: '13px 15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <Spinner size="sm" />
            <b style={{ fontSize: 13, color: 'var(--accent)' }}>
              AI 正在生成第 {Math.min(genProgress.done + 1, genProgress.total)} / {genProgress.total} 张…
            </b>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              已完成 {genProgress.done} 张 · 已用 <GenElapsed startedAt={genProgress.startedAt} />
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)',
              width: `${genProgress.total ? (genProgress.done / genProgress.total) * 100 : 0}%`,
              transition: 'width .35s ease' }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8 }}>
            每张约 40–130 秒，请保持页面打开。完成的图会立刻出现在下方。
          </div>
        </div>}
        {!results.length ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          点击「开始生产」后，{prompts.length} 个角度将逐一调用生图模型（每张约 40-130 秒）
        </div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 13 }}>
          {results.map((r, i) => <Card key={i} variant="default" style={{ border: r.status === 'running' ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: 11, overflow: 'hidden', background: 'var(--surface-2)' }}>
            <div style={{ aspectRatio: '3/4', background: '#0a0c10', position: 'relative' }}>
              {r.status === 'done' && r.url
                ? <img src={imgSrc(r.url)} alt={`角度${r.code}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : r.status === 'running'
                  ? <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 10 }}>
                      <Spinner size="lg" />
                      <span style={{ fontSize: 11, color: 'var(--accent)' }}>生成中…</span>
                    </div>
                  : r.status === 'pending'
                    ? <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)', fontSize: 11 }}>排队中</div>
                    : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--danger)', fontSize: 11, padding: 10, textAlign: 'center' }}>{r.error || '生成失败'}</div>}
              {r.status === 'done' && <Chip size="sm" color="success" variant="flat" style={{ position: 'absolute', top: 7, left: 7 }}>✓ {resolution} 完成</Chip>}
              {r.status === 'running' && <Chip size="sm" variant="flat" style={{ position: 'absolute', top: 7, left: 7 }}>⏳ 生成中</Chip>}
            </div>
            <Card.Content style={{ padding: '9px 10px' }}>
              <b style={{ fontSize: 11.5 }}>{r.code} {prompts[i]?.name || ''}</b>
            </Card.Content>
          </Card>)}
        </div>}
        {history.length > 0 && <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <b style={{ fontSize: 13 }}>历史生成记录</b>
            <Chip size="sm" variant="flat">{history.length} 批</Chip>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.slice(0, 8).map((h) => (
              <div key={h.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, fontSize: 11, color: 'var(--muted)' }}>
                  <span>{h.createdAt}</span><Chip size="sm" variant="flat">{h.model}</Chip><Chip size="sm" variant="flat">{h.resolution}</Chip>
                  <span>{h.items?.length || 0} 张</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(h.items || []).filter(x => x.status === 'done' && x.url).map((x, j) => (
                    <img key={j} src={imgSrc(x.url)} alt={`历史${x.code}`} title={`${x.code} ${x.filename || ''}`}
                      style={{ width: 62, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', background: '#0a0c10' }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>}
      </Panel>}

      {/* 新增模板弹窗 */}
      <HeroModal.Root isOpen={addOpen} onOpenChange={(o) => setAddOpen(o)}>
        <HeroModal.Backdrop style={{ zIndex: 99998 }} />
        <HeroModal.Container className="z-[99999]" style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog style={{ width: 860, maxWidth: '92vw', zIndex: 99999 }}>
            <HeroModal.Header><HeroModal.Heading>新增产品模板</HeroModal.Heading></HeroModal.Header>
            <HeroModal.Body>
              <div style={{ fontSize: 12, color: addPhase >= 1 ? 'var(--accent)' : 'var(--muted)' }}>① 上传产品多角度实拍</div>
              {addPhase === 1 && <div style={{ padding: '10px 0' }}>
                <input ref={addFileRef} type="file" accept="image/*" multiple onChange={onAddFiles} style={{ display: 'none' }} />
                <div onClick={() => addFileRef.current?.click()} style={{ border: '1.5px dashed var(--border)', borderRadius: 12, minHeight: 120,
                  display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', background: 'var(--surface-2)', cursor: 'pointer' }}>
                  <div><div style={{ fontSize: 28, color: 'var(--accent)' }}>＋</div>
                    {addSplitting ? '上传中…' : '点击上传产品多角度实拍（支持多选）'}
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>也可直接 ⌘V / Ctrl+V 粘贴剪贴板图片</div></div>
                </div>
                <HeroButton size="sm" variant="flat" onPress={addDemoImages} style={{ marginTop: 10 }}>填入 2 张示例产品图（演示用）</HeroButton>
                {addImages.length > 0 && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  {addImages.map((u, i) => <div key={i} style={{ position: 'relative' }}>
                    <img src={imgSrc(u)} alt={`产品图${i+1}`} style={{ width: 96, height: 110, objectFit: 'contain', borderRadius: 8, background: '#fff', border: '1px solid var(--border)' }} />
                    <button title="移除此图" onClick={() => setAddImages(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, background: 'var(--surface-3)', border: '1px solid var(--border)',
                        borderRadius: '50%', color: 'var(--danger)', fontSize: 11, width: 20, height: 20, lineHeight: '18px', cursor: 'pointer' }}>✕</button>
                  </div>)}
                </div>}
                <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 10 }}>图片会上传到本机图库（synthesized 桶），再交给 Vision 模型分析并生成角度模板。</div>
              </div>}
              <div style={{ fontSize: 12, color: addPhase >= 2 ? 'var(--accent)' : 'var(--muted)', marginTop: 14 }}>② AI 自动拆解结构</div>
              {addPhase === 2 && <div style={{ padding: '10px 0' }}>
                {addSplitting ? <div style={{ textAlign: 'center', padding: 30 }}><Spinner size="lg" /><p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>AI 正在识别产品、拆分角度、生成机位句…</p></div>
                  : <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, padding: 14 }}>
                    <div style={{ fontSize: 12.5, marginBottom: 12 }}>✓ 已拆解出 <b style={{ color: 'var(--accent)' }}>{addAngles.length}</b> 个角度（可编辑）</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
                      每个角度 = 角度名 + 中文说明（给人看）+ 英文机位句（进生图）。可改中文后点「↻ 同步英文」让 AI 重新翻译英文。
                    </div>
                    {addAngles.map((a, i) => <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 10, marginBottom: 8, display: 'flex', gap: 10 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, paddingTop: 4 }}>{a.code}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Input size="sm" value={a.name} onChange={e => setAddAngles(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="角度名" placeholder="角度名" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>中文说明（可改 · 不进生图）</span>
                          <button onClick={() => addSyncEn(i, 'cam')} disabled={addSplitting}
                            title="用 AI 把这段中文翻译成下方英文"
                            style={{ background: addTranslating === `cam-${i}` ? 'var(--accent)' : 'transparent',
                              border: '1px solid var(--accent)', borderRadius: 5,
                              color: addTranslating === `cam-${i}` ? 'var(--accent-foreground)' : 'var(--accent)',
                              fontSize: 10, padding: '1px 7px', cursor: addSplitting ? 'wait' : 'pointer' }}>
                            {addTranslating === `cam-${i}` ? '翻译中…' : '↻ 同步英文'}</button>
                        </div>
                        <AutoTextArea value={a.camZh || ''} onChange={v => setAddAngles(prev => prev.map((x, j) => j === i ? { ...x, camZh: v } : x))}
                          ariaLabel="机位句中文" placeholder="这个机位的中文说明" />
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '8px 0 4px' }}>英文机位句（进生图 · 零中文）</div>
                        <AutoTextArea value={a.cam || ''} onChange={v => setAddAngles(prev => prev.map((x, j) => j === i ? { ...x, cam: v } : x))}
                          ariaLabel="机位句" placeholder="English camera sentence" />
                      </div>
                    </div>)}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 4px' }}>
                      <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>通用提示词 · 中文说明（可改 · 不进生图）</span>
                      <button onClick={() => addSyncEn(0, 'common')} disabled={addSplitting}
                        title="用 AI 把这段中文翻译成下方英文"
                        style={{ background: addTranslating === 'common' ? 'var(--accent)' : 'transparent',
                          border: '1px solid var(--accent)', borderRadius: 5,
                          color: addTranslating === 'common' ? 'var(--accent-foreground)' : 'var(--accent)',
                          fontSize: 10, padding: '1px 7px', cursor: addSplitting ? 'wait' : 'pointer' }}>
                        {addTranslating === 'common' ? '翻译中…' : '↻ 同步英文'}</button>
                    </div>
                    <AutoTextArea value={addCommonZh} onChange={v => setAddCommonZh(v)} ariaLabel="通用提示词中文" placeholder="通用提示词的中文说明" />
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '8px 0 4px' }}>通用提示词 · 英文（进生图 · 零中文）</div>
                    <AutoTextArea value={addCommon} onChange={v => setAddCommon(v)} ariaLabel="通用提示词" placeholder="English common prompt" />
                  </div>}
              </div>}
              <div style={{ fontSize: 12, color: addPhase >= 3 ? 'var(--accent)' : 'var(--muted)', marginTop: 14 }}>③ 确认并保存为模板</div>
              {addPhase === 3 && <div style={{ padding: '10px 0' }}>
                <Input label="模板名称" value={addName} onChange={e => setAddName(e.target.value)} placeholder="例：骑士雪茄托 · 五视角套图" />
                <Input label="适用品类" value={addCat} onChange={e => setAddCat(e.target.value)} placeholder="例：雪茄托 / 雪茄周边" style={{ marginTop: 12 }} />
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {addAngles.map(a => <Chip key={a.code} size="sm" variant="flat"><span style={{ color: 'var(--accent)', marginRight: 5 }}>{a.code}</span>{a.name}</Chip>)}
                </div>
              </div>}
            </HeroModal.Body>
            <HeroModal.Footer>
              {/* 取消：任意阶段都可退出，避免用户中途想放弃却只能按 ESC 才能关 */}
              <HeroButton variant="ghost" onPress={() => setAddOpen(false)} isDisabled={addSplitting}>取消</HeroButton>
              {addPhase > 1 && <HeroButton variant="ghost" onPress={() => setAddPhase(p => p - 1)}>上一步</HeroButton>}
              <div style={{ flex: 1 }} />
              {addPhase === 1 && <HeroButton color="primary" onPress={doSplit} isDisabled={!addImages.length}>开始 AI 拆解 →</HeroButton>}
              {addPhase === 2 && <HeroButton color="primary" onPress={() => setAddPhase(3)} isDisabled={addSplitting || !addAngles.length}>下一步：确认保存 →</HeroButton>}
              {addPhase === 3 && <HeroButton color="primary" onPress={saveTpl}>✓ 保存为模板</HeroButton>}
            </HeroModal.Footer>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {/* 模板详情弹窗：角度提示词模板 + 垫图信息，可手改或 AI 重析 */}
      <HeroModal.Root isOpen={detailOpen} onOpenChange={(o) => setDetailOpen(o)}>
        <HeroModal.Backdrop style={{ zIndex: 99998 }} />
        <HeroModal.Container className="z-[99999]" style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog ref={detailScrollRef} style={{ width: 960, maxWidth: '94vw', maxHeight: '88vh', zIndex: 99999, overflow: 'auto' }}>
            <HeroModal.Header><HeroModal.Heading>模板详情 · {detailTpl?.name || ''}</HeroModal.Heading></HeroModal.Header>
            {detailTpl && <HeroModal.Body>
              {/* 基本信息（压缩成一行，给角度列表让出高度） */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Input size="sm" value={detailTpl.name || ''} onChange={e => setDetailTpl(p => ({ ...p, name: e.target.value }))}
                  aria-label="模板名称" placeholder="模板名称" style={{ flex: 1 }} />
                <Input size="sm" value={detailTpl.cat || ''} onChange={e => setDetailTpl(p => ({ ...p, cat: e.target.value }))}
                  aria-label="适用品类" placeholder="适用品类" style={{ width: 140 }} />
              </div>

              {/* ① 角度提示词模板 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>① 角度提示词模板</b>
                <Chip size="sm" variant="flat" color="primary">{(detailTpl.angles || []).length} 个角度（{(detailTpl.angles || [])[0]?.code || '01'}–{(detailTpl.angles || []).slice(-1)[0]?.code || '05'}）</Chip>
                <div style={{ flex: 1 }} />
                <HeroButton size="sm" variant="flat" color="primary" onPress={detailReanalyze} isLoading={detailReanalyzing}>
                  {detailReanalyzing ? '分析中…' : '✨ AI 重新分析生成'}
                </HeroButton>
              </div>
              {detailReanalyzing && <div style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--accent)',
                borderRadius: 9, background: 'rgba(240,169,59,.08)', padding: '10px 12px', marginBottom: 10 }}>
                <Spinner size="sm" />
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>AI 正在按垫图重新拆解角度…</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>约 15–30 秒，完成后角度列表会自动刷新</span>
              </div>}
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
                提示词是<b style={{ color: 'var(--accent)' }}>模板骨架</b>：点角度行展开编辑，最终生图提示词由步骤⑤ AI 结合上传图生成。缩略图可点开放大。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                {(detailTpl.angles || []).map((a, i) => {
                  const isOpen = expandedAngle === i
                  return (
                  <div key={i} style={{ border: isOpen ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 9,
                    background: 'var(--surface-2)', overflow: 'hidden' }}>
                    {/* 折叠头：任何状态都能看到角度编号+名称+缩略图，不再"消失" */}
                    <div onClick={(e) => {
                      const willOpen = !isOpen
                      setExpandedAngle(willOpen ? i : -1)
                      // 展开后把这张卡片滚到可视区顶部附近，避免展开内容在屏幕外
                      if (willOpen) {
                        const card = e.currentTarget.parentElement
                        setTimeout(() => {
                          const box = document.querySelector('.modal__body--scroll-inside')
                          if (box && card) box.scrollTop = Math.max(0, card.offsetTop - box.offsetTop - 8)
                        }, 60)
                      }
                    }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer' }}>
                      <div style={{ width: 22, height: 28, flex: '0 0 22px', borderRadius: 4, overflow: 'hidden',
                        background: '#0a0c10', display: 'grid', placeItems: 'center', border: '1px solid var(--border)' }}>
                        {a.img ? <img src={imgSrc(a.img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <span style={{ color: 'var(--muted)', fontSize: 7 }}>—</span>}
                      </div>
                      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 11.5 }}>{a.code}</span>
                      <b style={{ fontSize: 12 }}>{a.name || '未命名角度'}</b>
                      {!isOpen && <span style={{ fontSize: 10, color: 'var(--muted)', opacity: .75 }}>· 点击展开编辑</span>}
                      <div style={{ flex: 1 }} />
                      <button title="删除此角度" onClick={e => { e.stopPropagation(); detailDelAngle(i) }}
                        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 5,
                          color: 'var(--danger)', fontSize: 10, padding: '0 6px', cursor: 'pointer', marginRight: 4 }}>✕</button>
                      <span style={{ color: 'var(--muted)', fontSize: 9, transform: isOpen ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </div>
                    {isOpen && <div style={{ padding: '0 12px 12px' }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      {/* 缩略图：点击放大预览 */}
                      <div style={{ flex: '0 0 110px' }}>
                        <div title="点击放大预览" onClick={() => a.img && setPreviewImg({ url: a.img, name: `${a.code} ${a.name || '角度缩略图'}` })}
                          style={{ width: 110, aspectRatio: '3 / 4', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)',
                            background: '#0a0c10', cursor: a.img ? 'zoom-in' : 'default', display: 'grid', placeItems: 'center' }}>
                          {a.img ? <img src={imgSrc(a.img)} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            : <span style={{ color: 'var(--muted)', fontSize: 10 }}>无缩略图</span>}
                        </div>
                        <Input size="sm" value={a.img || ''} onChange={e => detailSetAngle(i, 'img', e.target.value)} aria-label="缩略图地址"
                          placeholder="缩略图地址" style={{ marginTop: 6 }} />
                      </div>
                      {/* 关键词：角度名 + 机位句（提示词完整展示，自动增高） */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4 }}>角度名</div>
                        <Input size="sm" value={a.name || ''} onChange={e => detailSetAngle(i, 'name', e.target.value)} aria-label="角度名" placeholder="如：正面平视" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>中文说明（可改 · 不进生图）</span>
                          <button onClick={() => detailSyncEn(i, 'cam')} disabled={detailBusy}
                            title="用 AI 把这段中文同步翻译成下方英文"
                            style={{ background: translatingKey === `cam-${i}` ? 'var(--accent)' : 'transparent',
                              border: '1px solid var(--accent)', borderRadius: 5,
                              color: translatingKey === `cam-${i}` ? 'var(--accent-foreground)' : 'var(--accent)',
                              fontSize: 10, padding: '1px 7px', cursor: detailBusy ? 'wait' : 'pointer' }}>
                            {translatingKey === `cam-${i}` ? '翻译中…' : '↻ 同步英文'}</button>
                        </div>
                        <AutoTextArea value={a.camZh || ''} onChange={v => detailSetAngle(i, 'camZh', v)} ariaLabel="机位句中文"
                          placeholder="这个机位用中文说明，方便理解" />
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '8px 0 4px' }}>机位句 / 关键词（英文，完整显示 · 进生图）</div>
                        <AutoTextArea value={a.cam || ''} onChange={v => detailSetAngle(i, 'cam', v)} ariaLabel="机位句"
                          placeholder="English camera sentence（零中文）" />
                      </div>
                    </div>
                    </div>}
                  </div>
                )})}
                <HeroButton size="sm" variant="ghost" onPress={detailAddAngle}>＋ 添加角度</HeroButton>
              </div>

              {/* 通用提示词 */}
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>通用提示词（所有角度共用）</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>中文说明（可改 · 不进生图）</span>
                <button onClick={() => detailSyncEn(0, 'common')} disabled={detailBusy}
                  title="用 AI 把这段中文同步翻译成下方英文"
                  style={{ background: translatingKey === 'common' ? 'var(--accent)' : 'transparent',
                    border: '1px solid var(--accent)', borderRadius: 5,
                    color: translatingKey === 'common' ? 'var(--accent-foreground)' : 'var(--accent)',
                    fontSize: 10, padding: '1px 7px', cursor: detailBusy ? 'wait' : 'pointer' }}>
                  {translatingKey === 'common' ? '翻译中…' : '↻ 同步英文'}</button>
              </div>
              <AutoTextArea value={detailTpl.commonPromptZh || ''} onChange={v => setDetailTpl(p => ({ ...p, commonPromptZh: v }))} ariaLabel="通用提示词中文" placeholder="通用提示词中文说明" />
              <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '8px 0 4px' }}>英文原文（进生图，零中文）</div>
              <AutoTextArea value={detailTpl.commonPrompt || ''} onChange={v => setDetailTpl(p => ({ ...p, commonPrompt: v }))} ariaLabel="通用提示词" placeholder="English common prompt" />
              <div style={{ fontSize: 10.5, color: 'var(--warn)', margin: '6px 0 20px' }}>⚠ 零中文铁律：提示词不可出现中文，否则会被渲染到图上。</div>

              {/* ② 垫图信息 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <b style={{ fontSize: 13 }}>② 垫图信息</b>
                <Chip size="sm" variant="flat">{(detailTpl.refImages || []).length} 张</Chip>
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                垫图是生成时参考的产品实拍 / 背景 / 雪茄图。可修改名称与备注、增删垫图；AI 重新分析会依据这些垫图拆解角度。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(detailTpl.refImages || []).map((r, i) => (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 10, background: 'var(--surface-2)', display: 'flex', gap: 10 }}>
                    <div title="点击放大预览" onClick={() => r.url && setPreviewImg({ url: r.url, name: r.name || '垫图' })}
                      style={{ width: 56, height: 74, flex: '0 0 56px', borderRadius: 6, overflow: 'hidden', background: '#0a0c10', display: 'grid', placeItems: 'center', cursor: r.url ? 'zoom-in' : 'default' }}>
                      {r.url ? <img src={imgSrc(r.url)} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: 'var(--muted)', fontSize: 10 }}>无图</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Input size="sm" value={r.name || ''} onChange={e => detailSetRef(i, 'name', e.target.value)} aria-label="垫图名称" placeholder="垫图名称" />
                      <Input size="sm" value={r.url || ''} onChange={e => detailSetRef(i, 'url', e.target.value)} aria-label="垫图地址" placeholder="图片地址 /api/cigar/preset/..." style={{ marginTop: 5 }} />
                      <Input size="sm" value={r.note || ''} onChange={e => detailSetRef(i, 'note', e.target.value)} aria-label="垫图备注" placeholder="备注说明" style={{ marginTop: 5 }} />
                    </div>
                    <button title="删除此垫图" onClick={() => detailDelRef(i)}
                      style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--danger)', fontSize: 13, padding: '3px 9px', cursor: 'pointer', flex: '0 0 auto' }}>✕</button>
                  </div>
                ))}
                <HeroButton size="sm" variant="ghost" onPress={detailAddRef}>＋ 添加垫图</HeroButton>
              </div>
            </HeroModal.Body>}
            <HeroModal.Footer>
              <HeroButton variant="ghost" onPress={() => setDetailOpen(false)}>取消</HeroButton>
              <div style={{ flex: 1 }} />
              <HeroButton color="primary" onPress={detailSave} isLoading={detailSaving} isDisabled={detailBusy}>✓ 保存修改</HeroButton>
            </HeroModal.Footer>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {/* 删除模板确认 */}
      <HeroModal.Root isOpen={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <HeroModal.Backdrop style={{ zIndex: 99998 }} />
        <HeroModal.Container className="z-[99999]" style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog style={{ width: 460, maxWidth: '92vw', zIndex: 99999 }}>
            <HeroModal.Header><HeroModal.Heading>删除模板</HeroModal.Heading></HeroModal.Header>
            <HeroModal.Body>
              <p style={{ fontSize: 13, lineHeight: 1.7 }}>
                确定删除模板「<b style={{ color: 'var(--accent)' }}>{deleteTarget?.name || ''}</b>」吗？
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, marginTop: 8 }}>
                {deleteTarget?.builtin
                  ? '这是内置模板，删除后不会出现在列表里，之后可以从模板区底部「恢复内置模板」找回。'
                  : '这是你自建的模板，删除后不可恢复（角度结构、垫图信息会一并删除）。'}
              </p>
            </HeroModal.Body>
            <HeroModal.Footer>
              <HeroButton variant="ghost" onPress={() => setDeleteTarget(null)}>取消</HeroButton>
              <div style={{ flex: 1 }} />
              <HeroButton color="danger" onPress={doDelete} isLoading={deleting}>确认删除</HeroButton>
            </HeroModal.Footer>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {/* 缩略图放大预览：用 HeroModal 渲染（与详情弹窗同一套机制/top layer），
          否则普通 div 无论 z-index 多高都会被 HeroUI 的 modal 盖住。 */}
      <HeroModal.Root isOpen={!!previewImg} onOpenChange={(o) => { if (!o) setPreviewImg(null) }}>
        <HeroModal.Backdrop style={{ zIndex: 100000 }} />
        <HeroModal.Container style={{ position: 'fixed', inset: 0, zIndex: 100001,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog style={{ width: 'auto', maxWidth: '92vw', zIndex: 100001, padding: 0, overflow: 'hidden' }}>
            {previewImg && <>
              {/* 标题栏 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
                <b style={{ fontSize: 13 }}>{previewImg.name || '图片预览'}</b>
                <div style={{ flex: 1 }} />
                <button onClick={() => setPreviewImg(null)} title="关闭"
                  style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--muted)', fontSize: 13, width: 26, height: 26, lineHeight: '22px', cursor: 'pointer', padding: 0 }}>✕</button>
              </div>
              {/* 图片区：浅色棋盘底，深色/透明图都能看出边界 */}
              <div style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#e9ebef',
                backgroundImage: 'linear-gradient(45deg,#d8dbe1 25%,transparent 25%),linear-gradient(-45deg,#d8dbe1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d8dbe1 75%),linear-gradient(-45deg,transparent 75%,#d8dbe1 75%)',
                backgroundSize: '18px 18px', backgroundPosition: '0 0,0 9px,9px -9px,-9px 0' }}>
                <img src={imgSrc(previewImg.url)} alt="预览"
                  style={{ maxWidth: '78vw', maxHeight: '66vh', objectFit: 'contain', display: 'block',
                    borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,.35)' }} />
              </div>
              {/* 底部提示 */}
              <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--muted)' }}>
                点击空白处或右上角 ✕ 关闭
              </div>
            </>}
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {toast && <div style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)',
        background: 'var(--surface-3)', border: '1px solid var(--accent)', borderRadius: 10, padding: '11px 18px',
        fontSize: 13, zIndex: 200, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>{toast}</div>}
    </div>
  )
}

// 已用时长（m:ss），每秒自增，让长耗时任务看得出"还在动"
function GenElapsed({ startedAt }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const sec = Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000))
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
}

function PresetRow({ label, presets, selected, onSelect }) {  return <div>
    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      {label}<Chip size="sm" variant="flat" color="primary">系统预设</Chip>
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {(presets || []).map(p => {
        const sel = p.id === selected
        return <div key={p.id} onClick={() => p.ready && onSelect(p.id)}
          style={{ width: 132, border: sel ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 11,
            overflow: 'hidden', background: 'var(--surface-2)', cursor: p.ready ? 'pointer' : 'not-allowed', opacity: p.ready ? 1 : 0.5, position: 'relative' }}>
          {p.img ? <img src={imgSrc(p.img)} alt={p.name} style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block', background: '#0a0c10' }} />
            : <div style={{ height: 96, display: 'grid', placeItems: 'center', color: 'var(--muted)', background: '#0a0c10', fontSize: 11 }}>待训练</div>}
          {sel && <div style={{ position: 'absolute', top: 6, right: 6, width: 19, height: 19, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-foreground)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>✓</div>}
          <div style={{ padding: '8px 9px' }}><b style={{ fontSize: 11.5, display: 'block' }}>{p.name}</b>
            <span style={{ fontSize: 10, color: p.ready ? 'var(--success)' : 'var(--muted)' }}>{p.sub}</span></div>
        </div>
      })}
    </div>
  </div>
}

function PromptCard({ p, defaultOpen, onChange }) {
  const [open, setOpen] = useState(defaultOpen)
  return <Card variant="default" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
    <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', cursor: 'pointer', background: 'rgba(255,255,255,.02)' }}>
      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12 }}>{p.code}</span>
      <b style={{ fontSize: 12.5 }}>{p.name} · 提示词</b>
      {p.fromAI && <Chip size="sm" variant="flat" color="success">AI 读图生成</Chip>}
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11, transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
    </div>
    {open && <Card.Content style={{ padding: '0 13px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: 'var(--surface-3)', border: '1px solid var(--accent)', borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 5 }}>最终提示词（真正送给生图模型 · {p.fromAI ? 'AI 读图生成' : '模板骨架拼接'}）</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.prompt || '(空)'}</div>
      </div>
      <div><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>机位句骨架（本角度独有）· ANGLE · 改动后点「重新生成提示词」生效</div>
        <TextArea size="sm" value={p.cam} onChange={e => onChange('cam', e.target.value)} rows={2} /></div>
      {p.camZh && <div style={{ marginTop: -4 }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>↳ 中文说明</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{p.camZh}</div></div>}
      <div><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>通用骨架（模板固定）· COMMON</div>
        <TextArea size="sm" value={p.common} onChange={e => onChange('common', e.target.value)} rows={5} /></div>
      {p.commonZh && <div style={{ marginTop: -4 }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>↳ 中文说明</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{p.commonZh}</div></div>}
      <div style={{ fontSize: 10.5, color: 'var(--warn)' }}>⚠ 零中文铁律：最终提示词不可出现中文，否则会被渲染到图片上。</div>
    </Card.Content>}
  </Card>
}
