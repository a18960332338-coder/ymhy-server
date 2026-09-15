import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react'

// 图片尺寸批量预加载（瀑布流横向行优先排版用）
export function useImageDims(names, urlOf) {
  const [dims, setDims] = useState({})
  const listKey = (names || []).join('|')
  useEffect(() => {
    if (!names || !names.length) return
    let alive = true
    const cache = { ...dims }
    Promise.all(names.map(n => new Promise(resolve => {
      if (cache[n]) return resolve()
      const img = new Image()
      img.onload = () => { cache[n] = { w: img.naturalWidth, h: img.naturalHeight }; resolve() }
      img.onerror = () => resolve()
      img.src = urlOf(n)
    }))).then(() => { if (alive) setDims(cache) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])
  // 实时上报（SmartImg onLoad 用）：只 patch 单项，不重跑批量预加载
  const reportDim = useCallback((name, dim) => {
    setDims(prev => {
      const old = prev[name]
      if (old && old.w === dim.w && old.h === dim.h) return prev
      return { ...prev, [name]: dim }
    })
  }, [])
  return [dims, reportDim]
}

// 测量容器真实宽度（直接读 DOM，绕开 React state 时序问题）：
// 每次渲染后都执行 useLayoutEffect —— 切 tab 时 panel 重新挂载、ref 重新绑定，
// 此时能读到新宽度并 setState 触发重渲染（相同值 React bail out 不会死循环）。
export function useContainerWidth(ref) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const v = el.clientWidth || el.offsetWidth || 0
      setW((prev) => (prev === v ? prev : v))
    }
    update()
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(el)
    }
    window.addEventListener('resize', update)
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }) // 刻意不传依赖：每次渲染都执行（ref 绑定/解绑无法用依赖数组表达）
  return w
}

// 行优先(row-major)自适应宽度布局：
// - 列数 cols：n <= bestCols*2 时取 ceil(n/2)（限制 1-2 行），否则用 bestCols（多行）
// - 行内图片均分宽度，但 w 受 n 控制避免 1-2 张图撑满
// - 末行不满时图左对齐，右侧留白
export function layoutMasonryRowMajor(items, dims, containerWidth, colWidth, gap) {
  const safeW = Math.max(containerWidth || 0, colWidth * 1.5)
  // 容器最佳列数：让 actualColWidth ≥ 80 且距 colWidth 目标最近
  let bestCols = 1
  let bestDist = Infinity
  for (let tryCols = 1; tryCols <= 12; tryCols++) {
    const cw = (safeW - (tryCols - 1) * gap) / tryCols
    if (cw < 80) break
    const dist = Math.abs(cw - colWidth)
    if (dist < bestDist) { bestDist = dist; bestCols = tryCols }
  }
  const n = items.length
  // ★ 所有 tab 布局统一：一律按容器最佳列数（不随张数变化）
  const cols = bestCols
  const w = Math.floor((safeW - (cols - 1) * gap) / cols)
  // ★ 列贪心（最短列优先）：每张图贴当前最矮列的底部 → 图片紧密堆叠无空隙
  const colHeights = new Array(cols).fill(0)
  const placed = []
  for (const it of items) {
    let ratio = 1
    const d = dims[it.name]
    if (d && d.w && d.h) ratio = d.h / d.w
    const h = Math.max(40, Math.round(w * ratio))
    // 找当前最矮列
    let col = 0
    for (let i = 1; i < cols; i++) {
      if (colHeights[i] < colHeights[col]) col = i
    }
    const x = Math.floor(col * (w + gap))
    const y = colHeights[col]
    colHeights[col] = y + h + gap
    placed.push({ ...it, _x: x, _y: y, _w: w, _h: h })
  }
  return { placed, cols, totalH: Math.max(...colHeights, 0) }
}
