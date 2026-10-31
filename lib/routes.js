/**
 * dsh-chat-plugin — 浏览器（Web GUI）调用的 HTTP API。
 *
 * 全部挂在 prefix 路由 /dsh-chat-plugin/api 下，同源调用，不需要 CORS：
 *   GET  /state          当前房间快照（成员、消息、连接状态、设置）
 *   POST /send           { text }
 *   POST /config         { nickname?, room?, passphrase?, relayKind?, relayUrl?, enabled? }
 *   GET  /invite         当前房间的邀请码（含房间名/口令/中继）
 *   POST /join           { code } 用邀请码加入房间
 *   POST /upload         上传附件（原始字节 + x-file-name/x-file-type 头）
 *   GET  /file/<id>      读取本机缓存/中继上的附件（解密后返回）
 *   POST /typing         广播一次"正在输入"
 *   GET  /health         { ok, connected }
 * @module dsh-chat-plugin/routes
 */

import { createBridge, externalPeerId } from './bridge.js'

const API_PREFIX = '/dsh-chat-plugin/api'
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

/** 读取原始二进制请求体（带大小上限）。 */
function readBinary(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('文件太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
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
export function registerRoutes(ctx, app, social, chats) {
  const webServer = ctx.get?.('webServer')
  if (!webServer) {
    ctx.logger?.warn?.('dsh-chat: 没有 webServer 服务，Web UI 面板将无法工作')
    return undefined
  }

  const bridge = createBridge(ctx, app)

  /** @type {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} */
  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname.startsWith(API_PREFIX)
      ? url.pathname.slice(API_PREFIX.length) || '/'
      : url.pathname
    const method = (req.method || 'GET').toUpperCase()

    try {
      // ── 外部 agent 桥接（Hermes / WorkBuddy / 任何 CLI agent）──────────
      if (path.startsWith('/bridge')) {
        if (!bridge.authorized(req, url)) {
          return sendJson(res, 401, { ok: false, error: 'bridge token 无效（见 ~/.dsh/dsh-chat/bridge.json）' })
        }
        if (method === 'GET' && path === '/bridge/info') {
          return sendJson(res, 200, {
            ok: true,
            room: app.room,
            relay: app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
            encrypted: app.encrypted,
            latestSeq: app.seq,
          })
        }
        if (method === 'GET' && path === '/bridge/read') {
          const since = Number(url.searchParams.get('since')) || 0
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
          const state = app.getState()
          const messages = state.messages
            .filter((message) => message.seq > since)
            .slice(-limit)
            .map((message) => ({
              seq: message.seq,
              id: message.id,
              ts: message.ts,
              from: message.from,
              nick: message.nick,
              text: message.text,
              via: message.via || 'human',
              mine: message.mine === true,
            }))
          return sendJson(res, 200, {
            ok: true,
            room: state.room,
            latestSeq: state.latestSeq,
            messages,
            peers: state.peers.map((peer) => ({ id: peer.id, nick: peer.nick, online: peer.online })),
          })
        }
        if (method === 'POST' && path === '/bridge/send') {
          const body = await readJson(req)
          if (!body?.nick || !body?.text) {
            return sendJson(res, 400, { ok: false, error: '需要 nick 和 text' })
          }
          const message = await app.sendAs(body.nick, body.text, {
            toAgent: body.toAgent === true,
            replyTo: typeof body.replyTo === 'string' ? body.replyTo : undefined,
          })
          return sendJson(res, 200, {
            ok: true,
            message: {
              seq: message.seq,
              id: message.id,
              ts: message.ts,
              nick: message.nick,
              from: message.from,
              text: message.text,
            },
          })
        }
        if (method === 'POST' && path === '/bridge/typing') {
          const body = await readJson(req)
          if (body?.nick) void app.publishTypingAs(body.nick)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 404, { ok: false, error: `未知桥接接口 ${method} ${path}` })
      }

      if (method === 'GET' && (path === '/state' || path === '/')) {
        return sendJson(res, 200, app.getState())
      }
      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { ok: true, connected: app.connected, room: app.room })
      }
      if (method === 'POST' && path === '/send') {
        const body = await readJson(req)
        const message = await app.send(body?.text, {
          replyTo: typeof body?.replyTo === 'string' ? body.replyTo : undefined,
        })
        return sendJson(res, 200, { ok: true, message })
      }
      if (method === 'POST' && path === '/upload') {
        if ((Number(req.headers['content-length']) || 0) > 12 * 1024 * 1024) {
          return sendJson(res, 413, { ok: false, error: '文件太大（上限 10MB）' })
        }
        let bytes
        try {
          bytes = await readBinary(req)
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '读取失败' })
        }
        const name = decodeURIComponent(String(req.headers['x-file-name'] || 'file'))
        const mime = String(req.headers['x-file-type'] || 'application/octet-stream')
        const replyTo = typeof req.headers['x-reply-to'] === 'string' ? req.headers['x-reply-to'] : undefined
        const message = await app.sendFile({ name, mime, bytes, replyTo })
        return sendJson(res, 200, { ok: true, message })
      }
      if (method === 'GET' && path.startsWith('/file/')) {
        const id = decodeURIComponent(path.slice('/file/'.length))
        const message = app.findFileMessage(id)
        if (!message || !message.file) {
          return sendJson(res, 404, { ok: false, error: '附件不存在（可能超出本机消息窗口）' })
        }
        const { bytes, mime, name } = await app.getFile(message.file)
        res.statusCode = 200
        res.setHeader('Content-Type', mime || 'application/octet-stream')
        res.setHeader('Content-Length', bytes.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.setHeader(
          'Content-Disposition',
          `${mime && mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        )
        res.end(bytes)
        return undefined
      }
      if (method === 'POST' && path === '/react') {
        const body = await readJson(req)
        if (!body?.id || !body?.emoji) {
          return sendJson(res, 400, { ok: false, error: '需要 id 和 emoji' })
        }
        const chips = await app.react(String(body.id), String(body.emoji))
        return sendJson(res, 200, { ok: true, reactions: chips })
      }
      if (method === 'GET' && path === '/diagnostics') {
        const relayUrl = String(app.config.relayUrl || 'https://ntfy.sh').replace(/\/+$/, '')
        const healthUrl = app.config.relayKind === 'custom' ? `${relayUrl}/health` : `${relayUrl}/v1/health`
        const started = Date.now()
        let reachable = false
        let status = 0
        let error = ''
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
          status = response.status
          reachable = response.ok
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught)
        }
        return sendJson(res, 200, {
          ok: true,
          relay: {
            kind: app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
            url: relayUrl,
            healthUrl,
            reachable,
            status,
            latencyMs: Date.now() - started,
            error: error || undefined,
          },
          room: app.room,
          connected: app.connected,
          lastError: app.lastError,
          peers: app.peers.size,
        })
      }
      if (method === 'POST' && path === '/config') {
        const body = await readJson(req)
        const state = await app.updateConfig(body || {})
        return sendJson(res, 200, { ok: true, state })
      }
      // ── 会话列表 / 群聊 ─────────────────────────────────────────────
      if (method === 'GET' && path === '/chats') {
        return sendJson(res, 200, { ok: true, ...(chats?.snapshot?.() || { currentRoom: app.room, chats: [] }) })
      }
      if (method === 'POST' && path === '/chats/create') {
        const body = await readJson(req)
        const entry = await chats.createGroup(body?.title)
        return sendJson(res, 200, { ok: true, entry, state: app.getState(), ...(chats.snapshot()) })
      }
      if (method === 'POST' && path === '/chats/switch') {
        const body = await readJson(req)
        await chats.switchTo(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, state: app.getState(), ...(chats.snapshot()) })
      }
      if (method === 'POST' && path === '/chats/rename') {
        const body = await readJson(req)
        const entry = chats.rename(String(body?.id || ''), body?.title)
        return sendJson(res, 200, { ok: true, entry, ...(chats.snapshot()) })
      }
      if (method === 'POST' && path === '/chats/leave') {
        const body = await readJson(req)
        await chats.leave(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, state: app.getState(), ...(chats.snapshot()) })
      }

      // ── 社交发现 / 通讯录 ────────────────────────────────────────────
      if (method === 'GET' && path === '/social') {
        return sendJson(res, 200, { ok: true, ...(social?.snapshot?.() || {}) })
      }
      if (method === 'POST' && path === '/social/discoverable') {
        const body = await readJson(req)
        await app.updateConfig({ discoverable: body?.enabled === true })
        await social?.publishPresence?.()
        return sendJson(res, 200, { ok: true, ...(social?.snapshot?.() || {}) })
      }
      if (method === 'POST' && path === '/social/connect') {
        const body = await readJson(req)
        const target = body?.agentId ? String(body.agentId) : body?.id ? String(body.id) : ''
        if (!target) return sendJson(res, 400, { ok: false, error: '缺少目标（Agent ID 或目录 id）' })
        const result = await social.connect(target)
        return sendJson(res, 200, { ok: true, state: result.state, contact: result.contact })
      }
      if (method === 'POST' && path === '/social/accept') {
        const body = await readJson(req)
        const result = await social.accept(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, state: result.state, ...(social.snapshot()) })
      }
      if (method === 'POST' && path === '/social/dismiss') {
        const body = await readJson(req)
        social.dismiss(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, ...(social.snapshot()) })
      }
      if (method === 'POST' && path === '/social/join') {
        const body = await readJson(req)
        const result = await social.joinContact(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, state: result.state, ...(social.snapshot()) })
      }
      if (method === 'POST' && path === '/social/remove') {
        const body = await readJson(req)
        social.removeContact(String(body?.id || ''))
        return sendJson(res, 200, { ok: true, ...(social.snapshot()) })
      }

      if (method === 'GET' && path === '/invite') {
        return sendJson(res, 200, {
          ok: true,
          code: app.inviteCode(),
          room: app.room,
          encrypted: app.encrypted,
          relay: app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        })
      }
      if (method === 'POST' && path === '/join') {
        const body = await readJson(req)
        if (!body?.code || typeof body.code !== 'string') {
          return sendJson(res, 400, { ok: false, error: '缺少邀请码' })
        }
        const state = await app.join(body.code)
        return sendJson(res, 200, { ok: true, state })
      }
      if (method === 'POST' && path === '/typing') {
        void app.publishTyping()
        return sendJson(res, 200, { ok: true })
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
