import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button as HeroButton, Chip, Spinner, Modal as HeroModal } from '@heroui/react'
import api from '../api'

// 茄境 · 图库
// 把「产品图片生产」生成的图片统一在这里展示：支持按批次筛选、按角度/分辨率看来源、
// 点击看大图、下载、删除。数据来自后端 /api/cigar/gallery（扫描 images 目录 + 合并生成历史）。

const fmtSize = (n) => {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

const fmtTime = (s) => {
  if (!s) return ''
  // 后端给的是 "YYYY-MM-DD HH:mm:ss"
  return String(s).slice(5, 16)
}

export default function CigarGallery({ brand = 'cigarrealm', account }) {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [batches, setBatches] = useState([])
  const [batchFilter, setBatchFilter] = useState('')   // '' = 全部
  const [preview, setPreview] = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.cigarGallery()
      setItems(Array.isArray(r?.items) ? r.items : [])
      setTotal(Number(r?.count || 0))
      setBatches(Array.isArray(r?.batches) ? r.batches : [])
    } catch (e) {
      setErr(e?.message || String(e))
      setItems([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(
    () => (batchFilter ? items.filter(it => it.batchId === batchFilter) : items),
    [items, batchFilter]
  )

  const doDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      await api.cigarGalleryDelete({ name: delTarget.name })
      setItems(prev => prev.filter(x => x.name !== delTarget.name))
      setTotal(t => Math.max(0, t - 1))
      setDelTarget(null)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally { setDeleting(false) }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
      {/* 工具条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px',
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
        <b style={{ fontSize: 14 }}>图库</b>
        <Chip size="sm" variant="flat" color="primary">
          {batchFilter ? `${shown.length} / ${total} 张` : `${total} 张`}
        </Chip>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>生图结果统一归档，点图片看大图</span>
        <div style={{ flex: 1 }} />
        <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)}
          aria-label="按批次筛选"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--foreground)', fontSize: 12, padding: '5px 9px', cursor: 'pointer', maxWidth: 260 }}>
          <option value="">全部批次（{items.length}）</option>
          {batches.map((b, i) => (
            <option key={b.id} value={b.id}>
              #{batches.length - i} · {fmtTime(b.createdAt)} · {b.count} 张{b.resolution ? ` · ${b.resolution}` : ''}
            </option>
          ))}
        </select>
        <HeroButton size="sm" variant="flat" onPress={load} isLoading={loading}>刷新</HeroButton>
      </div>

      {/* 内容区 */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
        {loading && !items.length ? (
          <div style={{ display: 'grid', placeItems: 'center', height: 260 }}>
            <div style={{ textAlign: 'center' }}>
              <Spinner size="lg" />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>正在加载图库…</div>
            </div>
          </div>
        ) : err ? (
          <div style={{ textAlign: 'center', padding: 50, color: 'var(--danger)', fontSize: 13 }}>加载失败：{err}</div>
        ) : !shown.length ? (
          <div style={{ display: 'grid', placeItems: 'center', height: 300, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 40, marginBottom: 10, opacity: .5 }}>🗂️</div>
              <div style={{ fontSize: 13.5, color: 'var(--foreground)', marginBottom: 6 }}>
                {batchFilter ? '这个批次里还没有图片' : '图库还是空的'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {batchFilter ? '换个批次看看' : '去「产品图片生产」跑一次生成，结果会自动归档到这里'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {shown.map(it => (
              <div key={it.name}
                style={{ border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden',
                  background: 'var(--surface-2)', position: 'relative' }}>
                {/* 图片 */}
                <div title="点击查看大图" onClick={() => setPreview(it)}
                  style={{ aspectRatio: '3 / 4', background: '#0a0c10', cursor: 'zoom-in', position: 'relative' }}>
                  <img src={it.url} alt={it.name} loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {it.resolution && <span style={{ position: 'absolute', top: 7, left: 7, fontSize: 9.5,
                    background: 'rgba(0,0,0,.62)', color: '#fff', borderRadius: 5, padding: '2px 6px', fontWeight: 600 }}>
                    {it.resolution}
                  </span>}
                  {it.code && <span style={{ position: 'absolute', top: 7, right: 7, fontSize: 9.5,
                    background: 'var(--accent)', color: 'var(--accent-foreground)', borderRadius: 5,
                    padding: '2px 6px', fontWeight: 700 }}>{it.code}</span>}
                </div>
                {/* 信息条 */}
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fmtTime(it.createdAt)} · {fmtSize(it.size)}
                    </div>
                  </div>
                  <button title="下载" onClick={() => {
                    const a = document.createElement('a')
                    a.href = it.url; a.download = it.name; a.click()
                  }} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--muted)', fontSize: 10.5, padding: '2px 7px', cursor: 'pointer' }}>下载</button>
                  <button title="删除这张图" onClick={() => setDelTarget(it)}
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--danger)', fontSize: 10.5, padding: '2px 7px', cursor: 'pointer' }}>删</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 大图预览（用 HeroModal，才能盖在其它浮层之上） */}
      <HeroModal.Root isOpen={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <HeroModal.Backdrop style={{ zIndex: 100000 }} />
        <HeroModal.Container style={{ position: 'fixed', inset: 0, zIndex: 100001,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog style={{ width: 'auto', maxWidth: '92vw', zIndex: 100001, padding: 0, overflow: 'hidden' }}>
            {preview && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
                <b style={{ fontSize: 13 }}>{preview.code ? `角度 ${preview.code}` : '生成图'}</b>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {preview.createdAt}{preview.resolution ? ` · ${preview.resolution}` : ''}{preview.size ? ` · ${fmtSize(preview.size)}` : ''}
                </span>
                <div style={{ flex: 1 }} />
                <HeroButton size="sm" variant="flat"
                  onPress={() => { const a = document.createElement('a'); a.href = preview.url; a.download = preview.name; a.click() }}>下载</HeroButton>
                <button onClick={() => setPreview(null)} title="关闭"
                  style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--muted)', fontSize: 13, width: 26, height: 26, lineHeight: '22px', cursor: 'pointer', padding: 0 }}>✕</button>
              </div>
              {/* 浅色棋盘底，深色图也能看出边界 */}
              <div style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#e9ebef',
                backgroundImage: 'linear-gradient(45deg,#d8dbe1 25%,transparent 25%),linear-gradient(-45deg,#d8dbe1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d8dbe1 75%),linear-gradient(-45deg,transparent 75%,#d8dbe1 75%)',
                backgroundSize: '18px 18px', backgroundPosition: '0 0,0 9px,9px -9px,-9px 0' }}>
                <img src={preview.url} alt={preview.name}
                  style={{ maxWidth: '76vw', maxHeight: '68vh', objectFit: 'contain', display: 'block',
                    borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,.35)' }} />
              </div>
              <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--muted)',
                display: 'flex', gap: 10 }}>
                <span>{preview.name}</span>
                <div style={{ flex: 1 }} />
                <span>点击空白处或右上角 ✕ 关闭</span>
              </div>
            </>}
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>

      {/* 删除确认 */}
      <HeroModal.Root isOpen={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null) }}>
        <HeroModal.Backdrop style={{ zIndex: 100000 }} />
        <HeroModal.Container style={{ position: 'fixed', inset: 0, zIndex: 100001,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <HeroModal.Dialog style={{ width: 440, maxWidth: '92vw', zIndex: 100001 }}>
            <HeroModal.Header><HeroModal.Heading>删除这张图</HeroModal.Heading></HeroModal.Header>
            <HeroModal.Body>
              {/* 显示缩略图，避免在多张相似图里删错 */}
              {delTarget && <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <img src={delTarget.url} alt="待删除" style={{ width: 86, aspectRatio: '3/4', objectFit: 'cover',
                  borderRadius: 8, border: '1px solid var(--border)', background: '#0a0c10', flex: '0 0 86px' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--foreground)', wordBreak: 'break-all' }}>
                    {delTarget.code ? `角度 ${delTarget.code} · ` : ''}{delTarget.createdAt}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>
                    {delTarget.name} · {fmtSize(delTarget.size)}
                  </div>
                </div>
              </div>}
              <p style={{ fontSize: 13, lineHeight: 1.7 }}>确定从图库删除这张生成图吗？</p>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, marginTop: 8 }}>
                文件会从磁盘移除，历史记录里该条目会标记为已删除。此操作不可恢复。
              </p>
            </HeroModal.Body>
            <HeroModal.Footer>
              <HeroButton variant="ghost" onPress={() => setDelTarget(null)}>取消</HeroButton>
              <div style={{ flex: 1 }} />
              <HeroButton color="danger" onPress={doDelete} isLoading={deleting}>确认删除</HeroButton>
            </HeroModal.Footer>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Root>
    </div>
  )
}
