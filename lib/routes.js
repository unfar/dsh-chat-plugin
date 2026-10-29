/**
 * dsh-hermes — 浏览器（Web GUI）调用的 HTTP API。
 *
 * 全部挂在 prefix 路由 /dsh-hermes/api 下，同源调用，不需要 CORS：
 *   GET  /state          当前房间快照（成员、消息、连接状态、设置）
 *   POST /send           { text }
 *   POST /config         { nickname?, room?, passphrase?, relayKind?, relayUrl?, enabled? }
 *   GET  /health         { ok, connected }
 * @module dsh-hermes/routes
 */

const API_PREFIX = '/dsh-hermes/api'
const MAX_BODY_BYTES = 64 * 1024

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, value) {
  try {
    const body = JSON.stringify(value)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  } catch {
    try {
      res.statusCode = 500
      res.end('{"ok":false,"error":"response serialization failed"}')
    } catch {
      /* ignore */
    }
  }
}

/** 读取并解析 JSON 请求体（带大小上限）。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 注册 API 路由；返回 disposer。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./peerchat.js').PeerChat} app
 * @returns {(() => void) | undefined}
 */
export function registerRoutes(ctx, app) {
  const webServer = ctx.get?.('webServer')
  if (!webServer) {
    ctx.logger?.warn?.('dsh-hermes: 没有 webServer 服务，Web UI 面板将无法工作')
    return undefined
  }

  /** @type {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} */
  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname.startsWith(API_PREFIX)
      ? url.pathname.slice(API_PREFIX.length) || '/'
      : url.pathname
    const method = (req.method || 'GET').toUpperCase()

    try {
      if (method === 'GET' && (path === '/state' || path === '/')) {
        return sendJson(res, 200, app.getState())
      }
      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { ok: true, connected: app.connected, room: app.room })
      }
      if (method === 'POST' && path === '/send') {
        const body = await readJson(req)
        const message = await app.send(body?.text)
        return sendJson(res, 200, { ok: true, message })
      }
      if (method === 'POST' && path === '/config') {
        const body = await readJson(req)
        const state = await app.updateConfig(body || {})
        return sendJson(res, 200, { ok: true, state })
      }
      if (method === 'POST' && path === '/read') {
        const body = await readJson(req)
        const lastReadSeq = app.markRead(body?.seq ?? app.seq, 'human')
        return sendJson(res, 200, { ok: true, lastReadSeq, unread: app.countUnread('human') })
      }
      return sendJson(res, 404, { ok: false, error: `未知接口 ${method} ${path}` })
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
}
