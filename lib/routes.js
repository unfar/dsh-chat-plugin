/**
 * dsh-chat-plugin — 浏览器（Web GUI）调用的 HTTP API。
 *
 * 全部挂在 prefix 路由 /dsh-chat-plugin/api 下，同源调用，不需要 CORS：
 *   GET  /state          当前房间快照（成员、消息、连接状态、设置）
 *   POST /send           { text }
 *   POST /config         { nickname?, room?, passphrase?, relayKind?, relayUrl?, enabled? }
 *   GET  /profile        { ok, me, settings }
 *   POST /profile        { nickname?, status? } → 更新资料
 *   POST /avatar         原始字节 + x-file-type 头（≤2MB）→ { ok, avatar }
 *   GET  /avatar         当前头像文件（二进制，404 表示未设置）
 *   GET  /search         ?q=... 全局搜索（跨会话消息 + 会话标题）
 *   POST /edit           { id, text } 编辑自己的文本消息
 *   POST /delete         { id } 撤回自己的消息
 *   POST /forward        { id, chatId } 转发到另一个会话
 *   GET  /invite         当前房间的邀请码（含房间名/口令/中继）
 *   POST /join           { code } 用邀请码加入房间
 *   POST /upload         上传附件（原始字节 + x-file-name/x-file-type 头）
 *   GET  /file/<id>      读取本机缓存/中继上的附件（解密后返回）
 *   POST /typing         广播一次"正在输入"
 *   GET  /health         { ok, connected }
 * @module dsh-chat-plugin/routes
 */

import { existsSync, readFileSync } from 'node:fs'

import { createBridge, externalPeerId } from './bridge.js'
import { deriveTopic } from './crypto.js'

const API_PREFIX = '/dsh-chat-plugin/api'
const MAX_BODY_BYTES = 64 * 1024
/** 头像上限 2MB（足够一张压缩后的头像）。 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
/** 全局搜索最多返回多少条消息。 */
const MAX_SEARCH_RESULTS = 40
/** 头像扩展名 → Content-Type。 */
const AVATAR_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/** 由头像文件名推断 Content-Type。 */
function avatarMime(file) {
  const match = String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return (match && AVATAR_MIME[match[1]]) || 'application/octet-stream'
}

/**
 * 全局搜索的纯函数实现（路由只是它的薄包装，便于单测）。
 * 遍历会话列表 → deriveTopic → 本地消息记录，按正文或附件名大小写不敏感匹配。
 * @param {{ list?: object[], store: import('./store.js').ChatStore, query?: string, limit?: number }} input
 * @returns {{ messages: object[], chats: object[] }} messages 按时间倒序，最多 limit 条
 */
export function searchMessages({ list, store, query, limit = MAX_SEARCH_RESULTS }) {
  const q = String(query ?? '').trim().toLowerCase()
  const out = { messages: [], chats: [] }
  if (!q) return out
  const entries = Array.isArray(list) ? list : []
  const hits = []
  for (const entry of entries) {
    if (!entry || typeof entry.room !== 'string') continue
    const title = String(entry.title || entry.room || '群聊').slice(0, 40)
    if (title.toLowerCase().includes(q)) {
      out.chats.push({ id: entry.id, title, room: entry.room })
    }
    let messages = []
    try {
      const topic = deriveTopic(entry.room, entry.passphrase || '')
      messages = store.loadMessages(topic, 400)
    } catch {
      continue // 单个会话读失败不影响其它会话的搜索结果
    }
    for (const message of messages) {
      const text = String(message.text || '')
      const fileName = message.file?.name ? String(message.file.name) : ''
      if (!text.toLowerCase().includes(q) && !fileName.toLowerCase().includes(q)) continue
      hits.push({
        chatId: entry.id,
        chatTitle: title,
        room: entry.room,
        id: message.id,
        seq: message.seq,
        ts: message.ts,
        nick: message.nick,
        text,
        ...(message.file ? { file: message.file } : {}),
      })
    }
  }
  hits.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
  return { messages: hits.slice(0, Math.max(1, Number(limit) || MAX_SEARCH_RESULTS)), chats: out.chats }
}

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
      // ── 个人资料 / 头像 ─────────────────────────────────────────────
      if (method === 'GET' && path === '/profile') {
        const state = app.getState()
        return sendJson(res, 200, { ok: true, me: state.me, settings: state.settings })
      }
      if (method === 'POST' && path === '/profile') {
        const body = await readJson(req)
        const patch = {}
        if (typeof body?.nickname === 'string') patch.nickname = body.nickname
        if (typeof body?.status === 'string') patch.status = body.status
        const state = await app.updateConfig(patch)
        return sendJson(res, 200, { ok: true, state, me: state.me, settings: state.settings })
      }
      if (method === 'POST' && path === '/avatar') {
        if ((Number(req.headers['content-length']) || 0) > MAX_AVATAR_BYTES) {
          return sendJson(res, 413, { ok: false, error: '头像太大（上限 2MB）' })
        }
        let bytes
        try {
          bytes = await readBinary(req, MAX_AVATAR_BYTES)
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '读取失败' })
        }
        let avatar
        try {
          avatar = app.store.saveAvatar(bytes, String(req.headers['x-file-type'] || ''))
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '头像保存失败' })
        }
        await app.updateConfig({ avatar })
        return sendJson(res, 200, { ok: true, avatar })
      }
      if (method === 'GET' && path === '/avatar') {
        const avatar = String(app.config.avatar || '')
        if (!avatar) return sendJson(res, 404, { ok: false, error: '还没有设置头像' })
        const avatarFile = app.store.avatarPath(avatar)
        if (!existsSync(avatarFile)) return sendJson(res, 404, { ok: false, error: '头像文件不存在' })
        const bytes = readFileSync(avatarFile)
        res.statusCode = 200
        res.setHeader('Content-Type', avatarMime(avatar))
        res.setHeader('Content-Length', bytes.length)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.end(bytes)
        return undefined
      }
      // ── 全局搜索 ───────────────────────────────────────────────────
      if (method === 'GET' && path === '/search') {
        const query = url.searchParams.get('q') || ''
        const found = searchMessages({ list: chats?.list || [], store: app.store, query })
        return sendJson(res, 200, { ok: true, query: query.trim(), ...found })
      }
      if (method === 'POST' && path === '/send') {
        const body = await readJson(req)
        const message = await app.send(body?.text, {
          replyTo: typeof body?.replyTo === 'string' ? body.replyTo : undefined,
        })
        return sendJson(res, 200, { ok: true, message })
      }
      // ── 消息管理：编辑 / 撤回 / 转发 ────────────────────────────────
      if (method === 'POST' && path === '/edit') {
        const body = await readJson(req)
        if (!body?.id) return sendJson(res, 400, { ok: false, error: '需要 id' })
        const message = await app.editMessage(String(body.id), body?.text)
        return sendJson(res, 200, { ok: true, message })
      }
      if (method === 'POST' && path === '/delete') {
        const body = await readJson(req)
        if (!body?.id) return sendJson(res, 400, { ok: false, error: '需要 id' })
        const message = await app.deleteMessage(String(body.id))
        return sendJson(res, 200, { ok: true, message })
      }
      if (method === 'POST' && path === '/forward') {
        const body = await readJson(req)
        const id = String(body?.id || '')
        const chatId = String(body?.chatId || '')
        if (!id || !chatId) return sendJson(res, 400, { ok: false, error: '需要 id 和 chatId' })
        if (!chats) return sendJson(res, 400, { ok: false, error: '会话列表不可用' })
        const source = app.messages.find((message) => message.id === id)
        if (!source) return sendJson(res, 404, { ok: false, error: '消息不存在（可能超出本机消息窗口）' })
        if (source.deleted) return sendJson(res, 400, { ok: false, error: '消息已删除' })
        const text = String(source.text || '')
        const fromNick = String(source.nick || '')
        await chats.switchTo(chatId)
        const message = await app.send(text, { forwardedFrom: fromNick })
        return sendJson(res, 200, { ok: true, message, state: app.getState() })
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
      if (method === 'POST' && path === '/chats/mute') {
        const body = await readJson(req)
        chats.setMuted(String(body?.id || ''), body?.muted === true)
        return sendJson(res, 200, { ok: true, ...(chats.snapshot()) })
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
