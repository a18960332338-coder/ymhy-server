import { useEffect, useRef } from 'react'

/**
 * 从 paste 事件里取出剪贴板中的图片文件。
 * 剪贴板图片的 File 往往没有 name（甚至 type 不全），后端按桶兜 .png 会把 jpg 存成 png，
 * 这里按 MIME 推导扩展名并重建 File，保证落盘格式正确。
 */
export function normalizePastedImage(f) {
  if (!f) return f
  if (f.name && /\.[a-z0-9]+$/i.test(f.name)) return f
  const ext = (f.type?.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
  return new File([f], `pasted_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, {
    type: f.type || 'image/png',
  })
}

/** 提取 clipboardData 中的图片文件（已补名） */
export function imageFilesFromClipboard(e) {
  const items = e?.clipboardData?.items
  if (!items) return []
  const out = []
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) out.push(normalizePastedImage(f))
    }
  }
  return out
}

/**
 * 粘贴图片上传：enabled 为 true 时监听全局 paste。
 *
 * 关键设计：**只有剪贴板里确实有图片时才接管**（preventDefault）。
 * 早期版本是"焦点在 input/textarea 就一律跳过"，导致用户在输入框里粘贴图片时
 * 图片被静默丢掉、什么都不发生。改成按内容判断后：
 *   - 粘贴图片 → 触发上传（哪怕焦点在输入框，符合直觉）
 *   - 粘贴文本 → 不拦截，正常粘贴
 *
 * @param {boolean} enabled 是否启用（通常传"当前页面/弹窗的上传区是否可见"）
 * @param {(files: File[]) => void} onFiles 拿到图片文件后的处理函数
 */
export default function usePasteImages(enabled, onFiles) {
  const onFilesRef = useRef(onFiles)
  useEffect(() => { onFilesRef.current = onFiles })

  // 用 ref 读取 enabled，保证监听器只注册一次，避免频繁增删
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  useEffect(() => {
    const handler = (e) => {
      if (!enabledRef.current) return
      const files = imageFilesFromClipboard(e)
      if (!files.length) return          // 纯文本等 → 放行，不影响正常粘贴
      e.preventDefault()
      onFilesRef.current?.(files)
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [])
}
