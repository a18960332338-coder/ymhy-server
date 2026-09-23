import React, { useEffect, useState } from 'react'

/**
 * 视频 hover 悬浮预览（浮层）。
 *
 * 为什么抽成共享组件：「视频库」和「复刻视频 · 历史列表」用的是同一套交互，
 * 复制两份必然漂移（改了一处、忘了另一处）。所有视频列表都复用这一个。
 *
 * 三个不显然的设计点：
 * 1. **浮层尺寸按视频真实宽高比算**，不能写死 16:9 —— 本项目的视频几乎都是 9:16 竖屏，
 *    写死横屏比例会让浮层变成一个横着的框，竖屏视频被 objectFit:cover 裁掉上下大半。
 *    做法：先按卡片宽度放大定宽，再用 onLoadedMetadata 读到的真实比例定高；
 *    高度超出视口时反过来压宽度，保证整段视频都能看全。
 * 2. `position: fixed` + 极高 zIndex：卡片通常处在 `overflow: auto` 的滚动容器里，
 *    用 absolute 定位会被容器裁掉。
 * 3. `pointerEvents: none`：浮层绝不能拦截鼠标，否则浮层一出现就把 hover 状态打断、
 *    自己立刻闪没（经典的自杀式浮层）。
 */
export default function VideoHoverPreview({ src, rect, maxScale = 1.3 }) {
  const [ratio, setRatio] = useState(9 / 16) // 宽 / 高，默认按竖屏

  // 换视频时先回到默认比例，避免用上一个视频的比例先渲染一帧（会看到跳一下）
  useEffect(() => { setRatio(9 / 16) }, [src])

  if (!src || !rect) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const GAP = 10   // 浮层与卡片之间的间距
  const EDGE = 16  // 距视口边缘的安全距离

  let W = Math.min(Math.round(rect.width * maxScale), vw - EDGE * 2)
  let H = W / ratio
  const maxH = vh - EDGE * 2
  if (H > maxH) { H = maxH; W = H * ratio }

  // 默认贴卡片右侧、与卡片垂直居中；右侧放不下退到左侧；再放不下就贴边
  let left = rect.right + GAP
  let top = rect.top + (rect.height - H) / 2
  if (left + W > vw - EDGE) left = rect.left - W - GAP
  if (left < EDGE) left = EDGE
  if (top < EDGE) top = EDGE
  if (top + H > vh - EDGE) top = vh - H - EDGE

  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 99999,
        left, top, width: W, height: H,
        borderRadius: 12,
        border: '2px solid #fff',
        boxShadow: '0 12px 36px rgba(0,0,0,.6)',
        overflow: 'hidden',
        backgroundColor: '#000',
        pointerEvents: 'none',
      }}
    >
      <video
        src={src}
        autoPlay
        muted
        playsInline
        loop
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight)
        }}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  )
}
