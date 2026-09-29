import { zip as fflateZip } from 'fflate'

/**
 * 把一组 COS 直链对应的图片下载下来，**在浏览器本地打包成 zip** 再保存。
 *
 * ★ 为什么在浏览器打包，而不是让后端打（2026-09-28 用户明确要求「要一个压缩包」）★
 * 后端打 zip 的方案在本项目**物理上不可行**：服务器上行只有 ~20KB/s，
 * 12 张图打出来的包有 96MB，从服务器发出需要 85 分钟 —— 界面会永远停在「打包中」
 *（2026-09-24 真实事故，Nginx 日志里只发出了 128KB）。
 * 改成「浏览器直连 COS 取图 + 前端打包」后：
 *   · 图片走 COS 直链（实测 4MB/s，比走服务器快约 200 倍）
 *   · 服务器零带宽、零 CPU 占用
 *   · 用户拿到的仍然是一个完整的 zip（体验不变）
 * 前提：COS 桶需配置 CORS 允许 ymhy.online —— fetch 跨域读取需要，
 * 单纯用 <img> 显示则不需要（这也是为什么缩略图直链不需要配 CORS）。
 *
 * @param {Array<{url: string, outName: string}>} items 每张图的直链与 zip 内文件名
 * @param {string} zipName 下载的 zip 文件名
 * @param {(msg: string) => void} onProgress 进度回调（用于按钮/提示文案）
 * @returns {Promise<{count: number, size: number}>}
 */
export async function downloadAsZip(items, zipName, onProgress = () => {}) {
  if (!items || !items.length) throw new Error('没有可导出的文件')

  // 1) 逐张拉取（走 COS 直链）。串行而不是 Promise.all：
  //    并发几十个大图会瞬间占满浏览器连接数、也让进度无法显示。
  const files = {}
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (onProgress) onProgress(`下载中 ${i + 1}/${items.length}`)
    const res = await fetch(it.url)
    if (!res.ok) throw new Error(`${it.name || it.outName} 下载失败（HTTP ${res.status}）`)
    files[it.outName || it.name] = new Uint8Array(await res.arrayBuffer())
  }

  // 2) 打包。level: 0 = 只归档、不重压 —— 图片本身已是压缩格式，
  //    DEFLATE 几乎零收益却慢好几倍（后端那版就是栽在 compresslevel=6 上）。
  if (onProgress) onProgress('打包中…')
  const data = await new Promise((resolve, reject) => {
    fflateZip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)))
  })

  // 3) 保存
  if (onProgress) onProgress('保存中…')
  const blob = new Blob([data], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1500)
  return { count: items.length, size: blob.size }
}
