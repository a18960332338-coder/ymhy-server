// 轻量 Toast 提示（tk 风格）
let _host = null
function ensureHost() {
  if (_host) return _host
  _host = document.createElement('div')
  _host.className = 'tk-toast-host'
  document.body.appendChild(_host)
  return _host
}
let seed = 0
function show(type, msg, duration = 2800) {
  if (typeof msg !== 'string' && msg != null) msg = String(msg)
  if (!msg) return
  const host = ensureHost()
  const el = document.createElement('div')
  el.className = `tk-toast ${type}`
  const icons = { success: '✓', warn: '!', error: '✕', info: 'i' }
  el.innerHTML = `
    <span class="em">${icons[type] || 'i'}</span>
    <span class="m"></span>
  `
  el.querySelector('.m').textContent = msg
  host.appendChild(el)
  const id = ++seed
  el.dataset.id = id
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease'
    el.style.opacity = '0'
    el.style.transform = 'translateY(-6px)'
    setTimeout(() => { el.remove() }, 280)
  }, duration)
}

export const Toast = {
  success: (m, d) => show('success', m, d),
  warn:    (m, d) => show('warn', m, d),
  // 兼容别名：项目里历史上大量调用 Toast.warning(...)，而本文件只导出过 warn，
  // 结果是调用即抛 TypeError（错误提示被吞、真实报错被掩盖）。此处补上别名兜底，
  // 避免以后再有人写 warning 时静默炸掉整条错误处理链路。
  warning: (m, d) => show('warn', m, d),
  error:   (m, d) => show('error', m, d),
  info:    (m, d) => show('info', m, d),
}

export default Toast
