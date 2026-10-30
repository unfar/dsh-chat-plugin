/**
 * dsh-chat-plugin — 浏览器（Web GUI）调用的 HTTP API。
 *
 * 全部挂在 prefix 路由 /dsh-chat-plugin/api 下，同源调用，不需要 CORS：
 *   GET  /state          当前房间快照（成员、消息、连接状态、设置）
 *   POST /send           { text }
 *   POST /config         { nickname?, room?, passphrase?, relayKind?, relayUrl?, enabled? }
 *   GET  /invite         当前房间的邀请码（含房间名/口令/中继）
 *   POST /join           { code } 用邀请码加入房间
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
        const message = await app.send(body?.text)
        return sendJson(res, 200, { ok: true, message })
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
        if (!body?.id) return sendJson(res, 400, { ok: false, error: '缺少目标 id' })
        const result = await social.connect(String(body.id))
        return sendJson(res, 200, { ok: true, state: result.state, contact: result.contact, messages: undefined })
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
