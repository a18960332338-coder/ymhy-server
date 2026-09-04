import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Toast, Tooltip, Radio } from '@douyinfe/semi-ui'
import api from '../api'

const { RadioGroup } = Radio

const BUCKET = 'synthesized'

function fmtSize(n) {
  if (n == null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function Chip({ children, color = 'grey' }) {
  const map = {
    cyan: { bg: 'var(--tk-cyan-100)', border: 'var(--tk-cyan-300)', color: 'var(--tk-cyan-700)' },
    red: { bg: 'var(--tk-red-100)', border: 'var(--tk-red-300)', color: 'var(--primary)' },
    grey: { bg: 'var(--tk-white-300)', border: 'var(--tk-white-500)', color: 'var(--tk-black-700)' },
  }
  const s = map[color] || map.grey
  return (
    <span
      className="tk-chip"
      style={{
        background: s.bg, borderColor: s.border, color: s.color,
        padding: '2px 10px',
      }}
    >{children}</span>
  )
}

function groupByDay(items) {
  const groups = new Map()
  for (const it of items) {
    const d = (it.mtimeText || '').slice(0, 10) || '未知'
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d).push(it)
  }
  return Array.from(groups.entries()).sort((a, b) => a[0] < b[0] ? 1 : -1)
}

export default function ResultsLibrary({ brand, buckets }) {
  const [list, setList] = useState([])
  const [kw, setKw] = useState('')
  const [sort, setSort] = useState('mtime') // mtime | name | size
  const [preview, setPreview] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleteMany, setDeleteMany] = useState([])
  const [selected, setSelected] = useState({}) // { name: true }
  const [selMode, setSelMode] = useState(false)
  const [tab, setTab] = useState('synthesized') // 'synthesized' | 'suite'

  const refresh = useCallback(() => {
    api.images(BUCKET, { brand }).then(d => setList(d.images || [])).catch(() => setList([]))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const displayList = useMemo(() => {
    let arr = [...list]
    // 按 tab 过滤：合成图排除 suite_；套图只显示 suite_
    if (tab === 'synthesized') {
      arr = arr.filter(it => !it.name.startsWith('suite_'))
    } else if (tab === 'suite') {
      arr = arr.filter(it => it.name.startsWith('suite_'))
    }
    if (kw) {
      const k = kw.toLowerCase()
      arr = arr.filter(it => it.name.toLowerCase().includes(k))
    }
    if (sort === 'mtime') arr.sort((a, b) => b.mtime - a.mtime)
    else if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    else arr.sort((a, b) => b.size - a.size)
    return arr
  }, [list, kw, sort, tab])

  const toggleSel = (name) => {
    setSelected(prev => {
      const copy = { ...prev }
      if (copy[name]) delete copy[name]
      else copy[name] = true
      return copy
    })
  }
  const clearSel = () => setSelected({})
  const selCount = Object.keys(selected).length

  const downloadFile = async (name) => {
    const a = document.createElement('a')
    a.href = api.imageUrl(BUCKET, name, { brand })
    a.download = name
    document.body.appendChild(a)
    a.click()
    setTimeout(() => a.remove(), 500)
  }

  const deleteOne = async (name) => {
    try {
      await api.deleteImg(BUCKET, name, { brand })
      Toast.success('已删除 ' + name)
      setDeleteConfirm(null)
      setPreview(p => (p && p.name === name ? null : p))
      refresh()
    } catch (e) { Toast.error(e.message) }
  }

  const deleteSelected = async () => {
    const names = Object.keys(selected)
    if (!names.length) return
    let ok = 0, fail = 0
    for (const n of names) {
      try { await api.deleteImg(BUCKET, n, { brand }); ok++ }
      catch { fail++ }
    }
    Toast.success(`已删除 ${ok} 张${fail ? '，失败 ' + fail + ' 张' : ''}`)
    setDeleteMany([]); clearSel(); refresh()
  }

  const grouped = useMemo(() => groupByDay(displayList), [displayList])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {/* 工具条 */}
      <div className="tk-panel" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* tab 切换：合成图 / 套图 */}
        <div className="tk-chip-group" style={{ display: 'flex', gap: 4, borderRadius: 8, background: 'var(--tk-white-300)', padding: 3 }}>
          <span onClick={() => setTab('synthesized')} style={{
            padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            background: tab === 'synthesized' ? 'var(--tk-brand-gradient, var(--accent))' : 'transparent',
            color: tab === 'synthesized' ? '#fff' : 'var(--text-2)',
            transition: 'all .15s',
          }}>合成图</span>
          <span onClick={() => setTab('suite')} style={{
            padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            background: tab === 'suite' ? 'var(--tk-brand-gradient, var(--accent))' : 'transparent',
            color: tab === 'suite' ? '#fff' : 'var(--text-2)',
            transition: 'all .15s',
          }}>套图</span>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 200 }}>
          <Input value={kw} onChange={setKw} placeholder="搜索文件名…" showClear
            prefix={<span style={{ color: 'var(--text-muted)' }}>🔎</span>} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="tk-chip">{tab === 'synthesized' ? list.filter(it => !it.name.startsWith('suite_')).length : list.filter(it => it.name.startsWith('suite_')).length} 张{tab === 'synthesized' ? '合成图' : '套图'}</span>
          {kw && <Chip color="cyan">匹配 {displayList.length}</Chip>}
          {selMode && selCount > 0 && <Chip color="red">已选 {selCount} 张</Chip>}
          <RadioGroup value={sort} onChange={e => setSort(e.target.value)}>
            <Radio value="mtime">按时间</Radio>
            <Radio value="name">按名称</Radio>
            <Radio value="size">按大小</Radio>
          </RadioGroup>
          <Button theme="light" onClick={() => { setSelMode(s => !s); clearSel() }}>
            {selMode ? '取消多选' : '批量选择'}
          </Button>
          {selMode && selCount > 0 && (
            <Button type="danger" theme="solid"
              onClick={() => setDeleteMany(Object.keys(selected))}>
              批量删除 ({selCount})
            </Button>
          )}
          <Button type="primary" theme="solid" onClick={refresh}>⟳ 刷新</Button>
        </div>
      </div>

      {/* 图库 */}
      <div className="tk-panel" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {displayList.length === 0 ? (
          <div className="tk-empty">
            <span className="emoji">{kw ? '🔍' : '✨'}</span>
            {kw ? `没有匹配「${kw}」的结果` : (tab === 'suite' ? '还没有套图，到「套图生成」tab 生成吧！' : '还没有合成图，到「生图工作台」点 ✨ 一键合成吧！')}
          </div>
        ) : (
          <div style={{ padding: '4px 14px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {grouped.map(([day, items]) => (
              <div key={day}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  margin: '10px 2px 12px 2px',
                }}>
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: 'var(--text-2)',
                  }}>
                    📅 {day}
                  </span>
                  <span className="tk-chip">{items.length} 张</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div className="library-grid">
                  {items.map(it => (
                    <div key={it.name} className="library-card" title={it.name}>
                      <div className="thumb"
                        onClick={() => selMode ? toggleSel(it.name) : setPreview(it)}
                        style={{ cursor: selMode ? 'pointer' : 'zoom-in', position: 'relative' }}>
                        <img src={api.thumbUrl(BUCKET, it.name, 300, { brand })} alt={it.name} loading="lazy" />
                        {selMode && selected[it.name] && (
                          <div style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(254, 44, 85, .25)',
                            border: '3px solid var(--primary)',
                            display: 'grid', placeItems: 'center',
                          }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: 999,
                              background: 'var(--tk-brand-gradient)',
                              color: '#fff',
                              display: 'grid', placeItems: 'center',
                              fontWeight: 800, boxShadow: '0 4px 14px rgba(254,44,85,.4)',
                            }}>✓</div>
                          </div>
                        )}
                      </div>
                      <div className="meta">
                        <div className="name" title={it.name}>{it.name}</div>
                        <div className="sub">
                          <span>
                            <Chip>{fmtSize(it.size)}</Chip>
                            <span style={{ marginLeft: 6 }}>{it.mtimeText?.slice(11) || ''}</span>
                          </span>
                          <span style={{ display: 'flex', gap: 4 }}>
                            <Tooltip content="预览大图">
                              <Button size="small" theme="borderless"
                                onClick={() => setPreview(it)}>👁</Button>
                            </Tooltip>
                            <Tooltip content="下载">
                              <Button size="small" theme="borderless"
                                onClick={() => downloadFile(it.name)}>⬇</Button>
                            </Tooltip>
                            <Tooltip content="删除">
                              <Button size="small" theme="borderless" type="danger"
                                onClick={() => setDeleteConfirm(it)}>🗑</Button>
                            </Tooltip>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 预览 */}
      <Modal
        title={preview?.name || '合成结果预览'}
        visible={!!preview}
        onCancel={() => setPreview(null)}
        onOk={() => setPreview(null)}
        okText="关闭"
        cancelProps={{ style: { display: 'none' } }}
        width={860}
        motion={false}
        keepDOM={false}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {preview && (
                <>
                  <Chip>{fmtSize(preview.size)}</Chip>
                  <span style={{ marginLeft: 8 }}>{preview.mtimeText}</span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button theme="light" onClick={() => preview && downloadFile(preview.name)}>⬇ 下载</Button>
              <Button type="danger" theme="light" onClick={() => preview && setDeleteConfirm(preview)}>删除</Button>
              <Button type="primary" theme="solid" onClick={() => setPreview(null)}>关闭</Button>
            </div>
          </div>
        }
      >
        {preview && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
            <img className="modal-img"
              src={api.imageUrl(BUCKET, preview.name, { brand })}
              alt={preview.name}
              style={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain', display: 'block', margin: '0 auto', background: 'var(--tk-white-300)', borderRadius: 12 }}
            />
          </div>
        )}
      </Modal>

      {/* 删除单个确认 */}
      <Modal
        title="确认删除"
        visible={!!deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onOk={() => deleteConfirm && deleteOne(deleteConfirm.name)}
        okType="danger"
        okText="删除"
        motion={false}
        keepDOM={false}
      >
        <p>将删除合成结果 <b>{deleteConfirm?.name}</b>，删除后不可恢复。</p>
      </Modal>

      {/* 删除多个确认 */}
      <Modal
        title="批量删除确认"
        visible={deleteMany.length > 0}
        onCancel={() => setDeleteMany([])}
        onOk={deleteSelected}
        okType="danger"
        okText={`删除 ${deleteMany.length} 张`}
        motion={false}
        keepDOM={false}
      >
        <p>将永久删除以下 <b>{deleteMany.length}</b> 张合成结果：</p>
        <div style={{
          maxHeight: 260, overflow: 'auto',
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {deleteMany.map(n => (
            <Chip key={n} color="red">{n}</Chip>
          ))}
        </div>
      </Modal>
    </div>
  )
}
