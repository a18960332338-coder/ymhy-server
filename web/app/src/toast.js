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
  error:   (m, d) => show('error', m, d),
  info:    (m, d) => show('info', m, d),
}

export default Toast
