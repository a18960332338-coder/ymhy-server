// 云眠花园主图生成工具 - Electron 主进程
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')

const LOG_FILE = '/tmp/garden-electron.log'
fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] === Electron 启动 ===\n`, 'utf-8')
const _log = (m) => fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${m}\n`, 'utf-8')

try {
  _log(`app.isPackaged=${app.isPackaged}`)
  _log(`process.resourcesPath=${process.resourcesPath}`)
  _log(`__dirname=${__dirname}`)
  _log(`cwd=${process.cwd()}`)
} catch(e) { _log(`init error: ${e.message}`) }

const isDev = process.env.NODE_ENV === 'development'
const APP_NAME = '云眠花园主图生成工具'
const PY_PORT = 8000

let mainWindow = null
let backendProcess = null

function resolveResource(...segs) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..')
  const r = path.join(base, ...segs)
  _log(`resolveResource(${JSON.stringify(segs)}) => ${r}`)
  return r
}

function findPython() {
  const candidates = [
    process.platform === 'darwin' ? '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3' : '',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    'python3',
    'python',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      const r = execSync(`${c} --version 2>&1 || true`)
      if (r && /Python 3/.test(r)) {
        _log(`findPython => ${c} (${r.toString().trim()})`)
        return c
      }
    } catch (_) {}
  }
  _log(`findPython => fallback python3`)
  return 'python3'
}

function waitPort(port, host = '127.0.0.1', timeoutMs = 45000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      const s = new net.Socket()
      s.setTimeout(800, () => { s.destroy(); resolvePort() })
      s.on('error', () => { s.destroy(); resolvePort() })
      s.on('connect', () => { s.destroy(); resolve(true) })
      s.connect(port, host)
    }
    const resolvePort = (ok = false) => {
      if (ok) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(check, 600)
    }
    check()
  })
}

function portUsed(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = new net.Socket()
    s.setTimeout(500, () => { s.destroy(); resolve(false) })
    s.on('error', () => { s.destroy(); resolve(false) })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.connect(port, host)
  })
}

function spawnBackend() {
  if (backendProcess) return Promise.resolve(true)
  return new Promise(async (resolve) => {
    try {
      const used = await portUsed(PY_PORT)
      _log(`portUsed(${PY_PORT}) => ${used}`)
      if (used) {
        _log(`[backend] 端口 ${PY_PORT} 已占用，复用`)
        return resolve(true)
      }
      const cwd = resolveResource('.')
      const py = findPython()
      const appPy = resolveResource('app.py')
      _log(`[backend] cwd=${cwd}, py=${py}, app.py exists=${fs.existsSync(appPy)}`)

      const pyOut = fs.createWriteStream('/tmp/garden-python-stdout.log', { flags: 'a' })
      const pyErr = fs.createWriteStream('/tmp/garden-python-stderr.log', { flags: 'a' })
      backendProcess = spawn(py, ['app.py'], {
        cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', pyOut, pyErr],
      })
      _log(`[backend] spawned pid=${backendProcess.pid}`)
      backendProcess.on('error', e => _log(`[backend] error: ${e.message}`))
      backendProcess.on('close', (code) => _log(`[backend] exit code=${code}`))
      const ok = await waitPort(PY_PORT)
      _log(`[backend] waitPort => ${ok}`)
      resolve(ok)
    } catch(e) {
      _log(`[backend] exception: ${e.message}\n${e.stack}`)
      resolve(false)
    }
  })
}

function createWindow() {
  _log('createWindow()')
  mainWindow = new BrowserWindow({
    width: 1240, height: 820, minWidth: 960, minHeight: 640,
    backgroundColor: '#f5f6f8',
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })
  const dist = path.join(__dirname, '..', 'dist', 'index.html')
  _log(`loading dist: ${dist}, exists=${fs.existsSync(dist)}`)
  if (fs.existsSync(dist)) {
    mainWindow.loadFile(dist)
  } else {
    _log('dist not found!')
    dialog.showErrorBox('前端缺失', `找不到: ${dist}`)
  }
  mainWindow.on('closed', () => { mainWindow = null })
}

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('backend:status', async () => ({ used: await portUsed(PY_PORT), pid: backendProcess?.pid || null, python: findPython() }))
ipcMain.handle('backend:restart', async () => {
  if (backendProcess) { try { backendProcess.kill('SIGTERM') } catch (_) {} backendProcess = null; await new Promise(r => setTimeout(r, 800)) }
  return { ok: await spawnBackend() }
})
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url))
ipcMain.handle('shell:showItemInFolder', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p) })

process.on('uncaughtException', (e) => _log(`uncaught: ${e.message}\n${e.stack}`))
process.on('unhandledRejection', (e) => _log(`unhandled: ${e}`))

app.whenReady().then(async () => {
  _log('app.whenReady fired')
  try {
    const ok = await spawnBackend()
    _log(`spawnBackend => ${ok}`)
    createWindow()
    _log('window created')
  } catch(e) {
    _log(`startup error: ${e.message}\n${e.stack}`)
    dialog.showErrorBox('启动错误', e.message)
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (backendProcess) { try { backendProcess.kill('SIGTERM') } catch (_) {} }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProcess) { try { backendProcess.kill('SIGKILL') } catch (_) {} }
})

_log('main.js fully loaded')
