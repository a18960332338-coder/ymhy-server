import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import http from 'node:http'

/**
 * Vite 开发模式插件：给前端暴露一个「启停本机 Python 后端 (app.py)」的 HTTP 接口。
 *
 * 为什么要这么做？
 *   浏览器 JS 没有权限 fork 本机进程，但 Vite dev server 本身就是跑在你电脑上的 Node 进程，
 *   它可以直接 spawn/kill python3。所以前端点"连接后端"按钮，实际是：
 *     前端 → POST /__backend__/start → Vite (Node) spawn('python3 -B app.py') → 8000 起服务
 *     前端 → POST /__backend__/stop  → Vite SIGTERM/SIGKILL 掉刚才 spawn 的 python PID
 *
 * 限制：仅 Vite dev mode 可用（vite build / 生产环境下不会有这段中间件），UI 上必须写清楚。
 */
function backendControlPlugin() {
  const projectRoot = path.resolve(__dirname, '../..')
  const backendPort = 8000
  const pythonArgs = ['-B', 'app.py']

  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  let startedAt = null
  /** @type {string[]} ring buffer for tail log; max 120 entries */
  const logBuf = []
  function pushLog(kind, data) {
    const lines = String(data ?? '').split(/\r?\n/)
    for (const l of lines) {
      if (!l) continue
      logBuf.push(`[${kind}] ${l}`)
    }
    while (logBuf.length > 120) logBuf.shift()
  }
  function tailLines(n = 40) {
    return logBuf.slice(-n).join('\n')
  }

  function probeHealth(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: backendPort,
          path: '/api/health',
          method: 'GET',
          timeout: timeoutMs,
          headers: { Accept: 'application/json' },
        },
        (res) => {
          let ok = false
          if (res.statusCode === 200) ok = true
          res.resume()
          res.on('end', () => resolve(ok))
        }
      )
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.on('error', () => resolve(false))
      req.end()
    })
  }

  async function waitUntilHealthy(maxAttempts = 22, intervalMs = 700) {
    for (let i = 0; i < maxAttempts; i++) {
      if (await probeHealth(1500)) return true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return false
  }

  /** Kill the tracked python child (if any). If force, SIGKILL after softSettleMs. */
  function killChild(force = true, softSettleMs = 1800) {
    return new Promise((resolve) => {
      if (!child) { resolve(true); return }
      const pid = child.pid
      let settled = false
      const finish = (killed) => {
        if (settled) return
        settled = true
        child = null
        startedAt = null
        resolve(killed)
      }
      try {
        child.once('exit', () => finish(true))
        process.kill(pid, 'SIGTERM')
      } catch (e) {
        pushLog('stop-error', String(e?.message || e))
      }
      setTimeout(() => {
        if (settled) return
        if (!force) { finish(false); return }
        try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
        // macOS: kill 父级后 python3 app.py 还会 fork uvicorn，所以补一个 pkill -P PPID + uvicorn 按端口兜底
        try { execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { stdio: 'ignore' }) } catch { /* ignore */ }
        try {
          const out = execSync(
            `lsof -n -P -iTCP:${backendPort} -sTCP:LISTEN -Fp 2>/dev/null | head -n 1 | sed 's/^p//'`,
            { encoding: 'utf-8' }
          ).trim()
          if (out) execSync(`kill -9 ${out} 2>/dev/null || true`, { stdio: 'ignore' })
        } catch { /* ignore */ }
        setTimeout(() => finish(true), 200)
      }, softSettleMs)
    })
  }

  function statusPayloadFactory() {
    // 不依赖 child 是否非空：真实以 8000 端口健康为准（用户可能手动在终端启动了后端）
    return probeHealth(900).then((healthy) => {
      const runningByUs = !!(child && !child.killed && child.exitCode == null)
      return {
        // 整体"后端在线吗？"——不管是谁启的，探 8000 健康为准
        online: !!healthy,
        backend_port: backendPort,
        started_by_vite: runningByUs,
        pid: (child && child.pid) || null,
        started_at: startedAt ? new Date(startedAt).toISOString() : null,
        uptime_sec: startedAt && healthy ? Math.floor((Date.now() - startedAt) / 1000) : null,
        log_tail: tailLines(30),
      }
    })
  }

  function readBodyJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let total = 0
      req.on('data', (c) => { total += c.length; if (total > 2e5) return reject(new Error('body too large')); chunks.push(c) })
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8')
          resolve(raw ? JSON.parse(raw) : {})
        } catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  return {
    name: 'vite-plugin-backend-control',
    apply: 'serve', // only on `vite`, not `vite build`
    configureServer(server) {
      // 1) 启动时如果 8000 已经健康就不自动启；否则给日志写一下
      probeHealth(900).then((h) => {
        pushLog('init', h ? `detected backend already online on :${backendPort}` : `backend offline on :${backendPort}; use POST /__backend__/start to launch`)
      })

      // 2) 路由中间件（插在最前面，不走 proxy）
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith('/__backend__/')) return next()
        const route = url.pathname.slice('/__backend__'.length)

        // --- CORS 预检 / 基础头 ---
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

        // --- GET /status ---
        if (route === '/status' && req.method === 'GET') {
          try {
            const p = await statusPayloadFactory()
            res.statusCode = 200
            res.end(JSON.stringify(p))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e?.message || e) }))
          }
          return
        }

        // --- POST /start ---
        if (route === '/start' && req.method === 'POST') {
          try {
            // a) 如果 8000 已经健康（无论谁启动的），不重复 spawn
            const healthyNow = await probeHealth(900)
            if (healthyNow) {
              const online = await statusPayloadFactory()
              online.message = '后端已经在监听 8000，无需重复启动'
              res.statusCode = 200
              res.end(JSON.stringify(online))
              return
            }
            // b) 如果我们自己还挂着一个死不掉的 child，先清理
            if (child && !child.killed) await killChild(true, 1500)
            // c) 清日志环（记录本次启动）
            logBuf.length = 0
            pushLog('cmd', `spawn: python3 ${pythonArgs.join(' ')}  cwd=${projectRoot}`)
            // d) spawn
            child = spawn('python3', pythonArgs, {
              cwd: projectRoot,
              stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
              detached: false,
            })
            startedAt = Date.now()
            child.stdout.on('data', (d) => pushLog('stdout', d))
            child.stderr.on('data', (d) => pushLog('stderr', d))
            child.once('error', (e) => pushLog('child-error', String(e?.message || e)))
            child.once('exit', (code, sig) => {
              pushLog('exit', `pid=${child?.pid} exitCode=${code} signal=${sig}`)
              if (child?.exitCode != null || child?.killed) {
                // 保留 child 一段时间便于 debug 读 pid，但认为不再 running
              }
            })
            // e) 等待探活
            const ok = await waitUntilHealthy(22, 700)
            const statusNow = await statusPayloadFactory()
            if (ok) {
              statusNow.message = '后端已启动并通过 /api/health 健康检查'
              res.statusCode = 200
              res.end(JSON.stringify(statusNow))
            } else {
              // 探活超时：判定为启动失败，直接杀掉避免僵尸
              await killChild(true, 1200)
              const fail = await statusPayloadFactory()
              res.statusCode = 504
              res.end(JSON.stringify({
                error: '后端启动后在 15s 内未通过健康检查，已自动停止',
                log_tail: tailLines(60),
                status: fail,
              }))
            }
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e?.message || e), log_tail: tailLines(50) }))
          }
          return
        }

        // --- POST /stop ---
        if (route === '/stop' && req.method === 'POST') {
          try {
            // 优先停止我们自己 spawn 的进程；同时为了防止用户手动启动 / 残留 uvicorn，按端口兜底 kill
            const killed = await killChild(true, 2500)
            try {
              const out = execSync(
                `lsof -n -P -iTCP:${backendPort} -sTCP:LISTEN -Fp 2>/dev/null | head -n 1 | sed 's/^p//'`,
                { encoding: 'utf-8' }
              ).trim()
              if (out) {
                pushLog('stop-port-kill', `still listening on :${backendPort} pid=${out}, SIGKILL`)
                execSync(`kill -9 ${out} 2>/dev/null || true`, { stdio: 'ignore' })
                try { execSync(`pkill -9 -P ${out} 2>/dev/null || true`, { stdio: 'ignore' }) } catch { /* ignore */ }
                await new Promise((r) => setTimeout(r, 350))
              }
            } catch { /* ignore */ }
            const statusNow = await statusPayloadFactory()
            statusNow.message = killed ? '后端已停止' : '没有发现由 Vite 启动的后端进程；已按 :8000 端口兜底清理'
            res.statusCode = 200
            res.end(JSON.stringify(statusNow))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e?.message || e), log_tail: tailLines(30) }))
          }
          return
        }

        // --- 未知路由 ---
        res.statusCode = 404
        res.end(JSON.stringify({ error: `unknown __backend__ route: ${route}` }))
      })

      // 3) Vite 关闭 / 进程退出时自动杀掉子进程（避免关了 Vite 但 python 还在，下次启 Vite 就"后端明明在线但不是我启动的"）
      const cleanup = async () => {
        if (!child) return
        pushLog('vite-exit', 'Vite server closing, cleaning backend child')
        await killChild(true, 2000)
      }
      server.httpServer?.on('close', cleanup)
      process.once('exit', () => { try { child && process.kill(child.pid, 'SIGKILL') } catch { /* ignore */ } })
      process.once('SIGINT', () => cleanup().finally(() => process.exit(130)))
      process.once('SIGTERM', () => cleanup().finally(() => process.exit(143)))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), backendControlPlugin()],
  root: __dirname,
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3072,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['legacy-js-api'],
      },
    },
  },
})
