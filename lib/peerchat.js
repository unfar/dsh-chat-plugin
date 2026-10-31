/**
 * dsh-chat-plugin — Host 侧核心：房间状态 + 收发 + 成员。
 *
 * 生命周期：new PeerChat({ctx, config}) → start()（返回 disposer）。
 * 所有网络/文件写入都围在 try/catch 里：插件出错不能拖垮整个 dsh。
 * @module dsh-chat-plugin/peerchat
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'

import { generateAgentId, normalizeAgentId } from './agentid.js'
import { deriveKey, deriveTopic, open, openBuffer, seal, sealBuffer } from './crypto.js'
import { externalPeerId } from './bridge.js'
import { decodeInvite, encodeInvite } from './invite.js'
import { createRelay } from './relay.js'
import { ChatStore, DEFAULT_CONFIG } from './store.js'

/** 单条消息最大字符数（再受中继字节上限二次约束）。 */
const MAX_TEXT = 1000
/** 超过这个时间没活动就算离线。 */
const PEER_ONLINE_MS = 5 * 60 * 1000
/** 超过这个时间没活动就不再出现在成员快照里（防止历史重放把 ghost 成员越积越多）。 */
const PEER_STALE_MS = 24 * 60 * 60 * 1000
/** 内存里保留的消息条数。 */
const MAX_MEMORY = 400
/** 内存里去重用的 id 集合上限。 */
const MAX_SEEN = 4000
/** "正在输入"的存活时间：超过这个时间没有新的 typing 就当作停止输入。 */
const TYPING_TTL_MS = 6000

/** 单个附件上限（ntfy 公共实例默认 15MB，这里保守取 10MB）。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024
/** 附件文件名最大长度。 */
const MAX_FILE_NAME = 120

function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_FILE_NAME) || 'file'
}

function extensionOf(name) {
  const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i)
  return match ? '.' + match[1].toLowerCase() : ''
}

function normalizeFileMeta(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.replace(/[^\w-]/g, '').slice(0, 64) : ''
  const url = typeof raw.url === 'string' ? raw.url.slice(0, 2000) : ''
  if (!id || !url) return null
  return {
    id,
    url,
    name: sanitizeFileName(raw.name),
    mime: String(raw.mime || 'application/octet-stream').slice(0, 120),
    size: Math.max(0, Number(raw.size) || 0),
    encrypted: raw.encrypted !== false,
  }
}

function defaultNick() {
  try {
    const name = hostname()
    return name && name.length > 0 ? name.slice(0, 32) : 'dsh-user'
  } catch {
    return 'dsh-user'
  }
}

function shortId(id) {
  return String(id || '').slice(0, 6)
}

export class PeerChat {
  /**
   * @param {{ ctx: import('@deepseek-ai/cordis').Context, config?: Record<string, unknown> }} options
   */
  constructor({ ctx, config }) {
    this.ctx = ctx
    this.logger = ctx?.logger
    this.store = new ChatStore()

    // 优先级：UI 保存的 config.json > cordis.patch.yml 的 config > 默认值。
    const saved = this.store.loadConfig()
    this.config = { ...DEFAULT_CONFIG, ...(config || {}), ...(saved || {}) }
    if (!this.config.peerId) this.config.peerId = randomUUID().slice(0, 8)
    if (!this.config.agentId || !normalizeAgentId(this.config.agentId)) {
      this.config.agentId = generateAgentId()
    }
    this.store.saveConfig(this.config)

    this.me = {
      id: this.config.peerId,
      agentId: this.config.agentId,
      nick: this.nickname(),
      avatar: String(this.config.avatar || ''),
      status: String(this.config.status || ''),
    }
    this.messages = []
    this.peers = new Map()
    this.seen = new Set()
    this.seq = 0
    this.connected = false
    this.lastError = null
    this.relay = null
    this.stopTransport = null
    this.room = 'lobby'
    this.topic = ''
    this.key = null
    this.encrypted = false
    // 两条已读游标：人（Web 面板）与 agent（chat_read 工具）互不影响。
    this.readState = this.store.loadReadState()
    this.humanReadSeq = 0
    this.agentReadSeq = 0
    // agent 自动回复相关（由 AgentReplier 接线；这里只做持有与状态透出）
    this.onPeerMessage = null
    this.agentStatus = null
    this.waiters = new Map()
    /** 正在输入的人：peerId → { nick, ts }。 */
    this.typing = new Map()
    /** agent 自动回复进行中时的输入状态（可选，由 AgentReplier 设置）。 */
    this.agentBusy = false
    /** 配置变化后的通知（social 层用它重连目录/收件箱中继）。 */
    this.onConfigChanged = null
    /** 对方已读到哪条：peerId → seq（内存态，重连后由对方重新回执）。 */
    this.readReceipts = new Map()
    this.lastReceiptAt = 0
    /** 表情回应：messageId → Map(emoji → Set(peerId))。 */
    this.reactions = new Map()
  }

  nickname() {
    const configured = String(this.config.nickname || '').trim()
    return (configured || defaultNick()).slice(0, 40)
  }

  /** 加载房间记录并启动传输，返回清理函数。 */
  start() {
    this.loadRoom()
    this.startTransport()
    this.logger?.info?.(
      `dsh-chat: room="${this.room}" relay=${this.config.relayKind} encrypted=${this.encrypted}`,
    )
    return () => this.dispose()
  }

  /** 根据当前 config 计算房间主题、密钥，并加载本地记录。 */
  loadRoom() {
    this.room = String(this.config.room || 'lobby').trim().slice(0, 64) || 'lobby'
    this.config.room = this.room
    const passphrase = String(this.config.passphrase || '')
    this.topic = deriveTopic(this.room, passphrase)
    this.key = passphrase ? deriveKey(passphrase) : null
    this.encrypted = Boolean(this.key)

    this.readReceipts.clear()
    this.reactions = this.hydrateReactions(this.store.loadReactions(this.topic))
    const loaded = this.store.loadMessages(this.topic, MAX_MEMORY)
    const byId = new Map()
    const stored = []
    for (const message of loaded) {
      if (!message?.id) continue
      if (byId.has(message.id)) continue
      byId.set(message.id, true)
      stored.push(message)
    }
    this.messages = stored
    this.seq = stored.length > 0 ? stored[stored.length - 1].seq ?? 0 : 0
    const read = this.readState[this.topic] || {}
    // 本地记录被清空/重建时 seq 归零，旧游标一并作废，否则新消息会被误判成已读。
    this.humanReadSeq = this.seq === 0 ? 0 : Math.min(Number(read.human) || 0, this.seq)
    this.agentReadSeq = this.seq === 0 ? 0 : Math.min(Number(read.agent) || 0, this.seq)
    for (const msg of stored) {
      this.seen.add(msg.id)
      if (msg.from !== this.me.id) this.touchPeer(msg.from, msg.nick, msg.ts)
    }
    this.peers.delete(this.me.id)
  }

  /** 未读条数（只算别人发的消息；人的游标与 agent 游标分开）。 */
  countUnread(who = 'human') {
    const cursor = who === 'agent' ? this.agentReadSeq : this.humanReadSeq
    let count = 0
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.messages[i]
      if (msg.seq <= cursor) break
      if (!msg.mine) count += 1
    }
    return count
  }

  /** 广播已读回执（节流：最多 2 秒一次）。 */
  async publishReadReceipt(seq) {
    if (!this.relay) return
    const now = Date.now()
    if (now - this.lastReceiptAt < 2000) return
    this.lastReceiptAt = now
    try {
      const { body } = this.encode({ kind: 'read', seq: Math.min(Number(seq) || 0, this.seq) })
      await this.relay.publish(body)
    } catch {
      /* 回执失败不影响聊天 */
    }
  }

  /**
   * 推进已读游标并持久化。
   * @param {number} [seq] 已读到的消息 seq，默认最新
   * @param {'human'|'agent'} [who]
   */
  markRead(seq = this.seq, who = 'human') {
    const value = Math.min(Math.max(0, Number(seq) || 0), this.seq)
    const previous = who === 'agent' ? this.agentReadSeq : this.humanReadSeq
    if (who === 'agent') {
      if (value > this.agentReadSeq) this.agentReadSeq = value
    } else if (value > this.humanReadSeq) {
      this.humanReadSeq = value
    }
    // 人读了就把回执广播给房间里的人（用于"已读 ✓✓"）；agent 读取不算人已读。
    if (who === 'human' && value > previous) void this.publishReadReceipt(value)
    this.readState[this.topic] = {
      human: this.humanReadSeq,
      agent: this.agentReadSeq,
    }
    this.store.saveReadState(this.readState)
    return this.humanReadSeq
  }

  /** 给 agent 的 system prompt 用的动态片段：没有未读时返回空串。 */
  promptText() {
    const unread = this.countUnread('agent')
    if (unread === 0) return ''
    this.prunePeers()
    const duplicates = this.duplicateNicks()
    const preview = this.messages
      .filter((msg) => !msg.mine && msg.seq > this.agentReadSeq)
      .slice(-3)
      .map((msg) => `- ${this.messageAuthor(msg, duplicates)}: ${String(msg.text).replace(/\s+/g, ' ').slice(0, 160)}`)
      .join('\n')
    return [
      '## dsh Chat (dsh peer chat — instant messaging between dsh installations)',
      `You are in room "${this.room}" with ${this.peers.size} other peer(s) (${this.onlinePeerCount()} online). There are ${unread} unread message(s):`,
      preview,
      `Call chat_read (sinceSeq=${this.agentReadSeq}) to read them, and chat_send to reply. Reading marks them as read.`,
    ].join('\n')
  }

  startTransport() {
    try {
      this.stopTransport?.()
    } catch {
      /* ignore */
    }
    this.stopTransport = null
    this.relay = null
    this.connected = false
    this.lastError = null

    if (this.config.enabled === false) return

    const relay = createRelay({
      kind: this.config.relayKind === 'custom' ? 'custom' : 'ntfy',
      url: this.config.relayUrl || 'https://ntfy.sh',
      topic: this.topic,
      onStatus: (status, error) => {
        this.connected = status === 'connected'
        this.lastError = status === 'error' ? error || '中继连接失败' : null
      },
      onEvent: (evt) => this.onInbound(evt),
    })
    this.relay = relay
    relay.start()
    this.stopTransport = () => relay.stop()
    void this.announce()
  }

  /** 广播在线信息（每次连接/换房时一条）。 */
  async announce() {
    try {
      const { body } = this.encode({ kind: 'hello' })
      await this.relay?.publish(body)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** 组一个信封并加密。 */
  encode(payload) {
    const envelope = {
      v: 1,
      id: randomUUID(),
      from: this.me.id,
      agentId: this.me.agentId,
      nick: this.me.nick,
      ts: Date.now(),
      kind: 'message',
      text: '',
      ...payload,
    }
    return { body: seal(envelope, this.key), envelope }
  }

  /** 处理中继上收到的一行消息体。 */
  onInbound(evt) {
    let payload
    try {
      payload = open(String(evt?.body || ''), this.key)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return
    }
    if (!payload || payload.v !== 1) return
    const id = typeof payload.id === 'string' ? payload.id : ''
    const from = typeof payload.from === 'string' ? payload.from : ''
    if (!id || !from) return
    if (this.seen.has(id)) return
    this.seen.add(id)
    if (this.seen.size > MAX_SEEN) {
      this.seen = new Set([...this.seen].slice(-MAX_SEEN / 2))
    }

    const ts = Number(payload.ts) || Number(evt?.ts) || Date.now()
    if (from === this.me.id) return // 自己发的会由本地写入，回显只用于去重
    this.touchPeer(from, payload.nick, ts)
    if (payload.kind === 'reaction') {
      this.applyReaction({
        messageId: String(payload.to || ''),
        emoji: String(payload.emoji || ''),
        from,
        add: payload.add !== false,
      })
      return
    }
    if (payload.kind === 'read') {
      const seq = Number(payload.seq)
      if (Number.isFinite(seq) && seq > 0) {
        this.readReceipts.set(from, Math.max(seq, this.readReceipts.get(from) || 0))
      }
      return
    }
    if (payload.kind === 'typing') {
      // 输入状态是瞬时的：只更新内存，不进消息列表、不落盘。
      this.typing.set(from, { nick: String(payload.nick || shortId(from)).slice(0, 40), ts })
      return
    }
    if (payload.kind === 'hello') return

    // 编辑 / 撤回：只作用于「原发送者本人」发来的那条消息，不改动别人的消息。
    // 必须在下面的 text 空值检查之前处理（delete 信封没有 text）。
    if (payload.kind === 'edit' || payload.kind === 'delete') {
      const targetId = String(payload.to || '')
      const target = this.messages.find((item) => item.id === targetId && item.from === from)
      if (!target) return
      if (payload.kind === 'edit') {
        const nextText = String(payload.text || '').slice(0, MAX_TEXT)
        if (!nextText) return
        target.text = nextText
        target.edited = true
      } else {
        target.deleted = true
        target.text = ''
        if (target.file) {
          try {
            unlinkSync(this.fileCachePath(target.file))
          } catch {
            /* 缓存文件可能已不存在 */
          }
          delete target.file
        }
      }
      this.persistMessages()
      return
    }

    if (payload.kind === 'file') {
      const file = normalizeFileMeta(payload.file)
      if (!file) return
      const caption = String(payload.text || '').slice(0, MAX_TEXT)
      const msg = {
        id,
        ts,
        from,
        nick: String(payload.nick || shortId(from)).slice(0, 40),
        text: caption || file.name,
        mine: false,
        via: typeof payload.via === 'string' ? payload.via : 'human',
        replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : undefined,
        file,
      }
      const storedFileMsg = this.pushMessage(msg)
      this.resolveWaiter(payload)
      try {
        this.onPeerMessage?.(storedFileMsg)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
      return
    }

    const text = String(payload.text || '').slice(0, MAX_TEXT)
    if (!text) return
    const msg = {
      id,
      ts,
      from,
      nick: String(payload.nick || shortId(from)).slice(0, 40),
      text,
      mine: false,
      via: typeof payload.via === 'string' ? payload.via : 'human',
      replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : undefined,
      toAgent: payload.toAgent === true,
      agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
      forwardedFrom: typeof payload.forwardedFrom === 'string' ? payload.forwardedFrom.slice(0, 40) : undefined,
    }
    const stored = this.pushMessage(msg)
    this.resolveWaiter(payload)
    try {
      this.onPeerMessage?.(stored)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** chat_ask 的等待者：优先用 replyTo 关联，其次接受对方 agent 的第一条新消息。 */
  resolveWaiter(payload) {
    if (this.waiters.size === 0) return
    const now = Date.now()
    for (const [askId, waiter] of this.waiters) {
      if (waiter.resolve === null) continue
      const ts = Number(payload.ts) || now
      // chat_dispatch：只认指定 agent 在派活之后发来的消息。
      if (waiter.expectFrom) {
        if (payload.from !== waiter.expectFrom || ts < waiter.since) continue
      } else {
        const correlated = payload.replyTo === askId
        const fromAgent = (payload.via === 'agent' || payload.via === 'bridge') && ts >= waiter.since
        if (!correlated && !fromAgent) continue
      }
      this.waiters.delete(askId)
      waiter.resolve({
        askId,
        ok: true,
        from: payload.nick,
        text: String(payload.text || ''),
        via: payload.via || 'human',
        seq: this.seq,
      })
    }
  }

  touchPeer(from, nick, ts) {
    if (!from || from === this.me.id) return
    const now = Date.now()
    const previous = this.peers.get(from)
    // ntfy 会重放缓存的历史事件，hello/旧消息的 ts 都是旧的：只保留原始时间戳并夹到
    // "现在"以内，让重放不会把成员误标成在线。
    const seen = Number(ts) > 0 ? Math.min(Number(ts), now) : now
    this.peers.set(from, {
      id: from,
      nick: (nick && String(nick).slice(0, 40)) || previous?.nick || shortId(from),
      lastSeen: Math.max(seen, previous?.lastSeen || 0),
    })
  }

  /** 清掉长时间没有任何活动的成员（只影响成员快照，不影响历史消息）。 */
  prunePeers(now = Date.now()) {
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_STALE_MS) this.peers.delete(id)
    }
  }

  /** 当前在线的成员数（PEER_ONLINE_MS 内有活动）。 */
  onlinePeerCount(now = Date.now()) {
    let count = 0
    for (const peer of this.peers.values()) {
      if (now - peer.lastSeen < PEER_ONLINE_MS) count += 1
    }
    return count
  }

  /** 昵称重复的集合：重名时在展示里补短 id，避免分不清是哪一台 dsh。 */
  duplicateNicks() {
    const counts = new Map()
    for (const peer of this.peers.values()) {
      counts.set(peer.nick, (counts.get(peer.nick) || 0) + 1)
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([nick]) => nick))
  }

  /** 消息 / 成员的展示名：重名时追加 #短id。 */
  messageAuthor(msg, duplicates = this.duplicateNicks()) {
    const nick = msg.nick || shortId(msg.from)
    return duplicates.has(nick) && msg.from ? `${nick}#${shortId(msg.from)}` : nick
  }

  /** 中继根地址（去掉结尾斜杠）。 */
  relayBase() {
    return String(this.config.relayUrl || 'https://ntfy.sh').replace(/\/+$/, '')
  }

  /** 附件在本地缓存中的路径。 */
  fileCachePath(file) {
    return this.store.fileCachePath(file.id, file.name)
  }

  /**
   * 上传加密后的附件字节，返回可访问 URL。
   * ntfy 用 PUT + Filename 头（服务端附件仓库）；自建 relay 用 PUT /blob。
   */
  async uploadAttachment(id, bytes, uploadName, mime) {
    const base = this.relayBase()
    if (this.config.relayKind === 'custom') {
      const url = `${base}/blob/${encodeURIComponent(this.topic)}/${encodeURIComponent(id)}`
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!response.ok) throw new Error(`附件上传失败 HTTP ${response.status}`)
      return url
    }
    const response = await fetch(`${base}/${encodeURIComponent(this.topic)}`, {
      method: 'PUT',
      headers: {
        Filename: encodeURIComponent(uploadName),
        'Content-Type': mime,
      },
      body: bytes,
    })
    if (!response.ok) throw new Error(`附件上传失败 HTTP ${response.status}`)
    const payload = await response.json().catch(() => null)
    const url = payload && payload.attachment && payload.attachment.url
    if (!url) throw new Error('中继没有返回附件地址（ntfy 附件可能被禁用）')
    return String(url)
  }

  /**
   * 发送附件：加密后上传中继，再广播 file 信封；本地保留一份明文供预览/重发。
   * @param {{ name: string, mime?: string, bytes: Buffer|Uint8Array, replyTo?: string }} input
   */
  async sendFile(input) {
    const name = sanitizeFileName(input?.name)
    const mime = String(input?.mime || 'application/octet-stream').slice(0, 120)
    const raw = Buffer.from(input?.bytes || [])
    if (raw.length === 0) throw new Error('文件为空')
    if (raw.length > MAX_FILE_BYTES) {
      throw new Error(`文件太大（${(raw.length / 1024 / 1024).toFixed(1)}MB，上限 10MB）`)
    }
    const id = randomUUID()
    const encrypted = Boolean(this.key)
    const bytes = sealBuffer(raw, this.key)
    const uploadName = encrypted ? `${id}.bin` : `${id}${extensionOf(name)}`
    const url = await this.uploadAttachment(id, bytes, uploadName, encrypted ? 'application/octet-stream' : mime)
    const file = { id, url, name, mime, size: raw.length, encrypted }
    const cache = this.fileCachePath(file)
    try {
      writeFileSync(cache, raw)
    } catch {
      /* 本地缓存失败不影响发送 */
    }
    const payload = { kind: 'file', file, text: name }
    if (input?.replyTo) payload.replyTo = input.replyTo
    const { body, envelope } = this.encode(payload)
    await this.relay.publish(body)
    this.seen.add(envelope.id)
    const msg = {
      id: envelope.id,
      ts: envelope.ts,
      from: this.me.id,
      nick: this.me.nick,
      text: name,
      mine: true,
      via: 'human',
      file,
    }
    if (input?.replyTo) msg.replyTo = input.replyTo
    return this.pushMessage(msg)
  }

  /** 读取附件字节：优先本地缓存，否则按 URL 下载并用房间密钥解密后缓存。 */
  async getFile(file) {
    const meta = normalizeFileMeta(file)
    if (!meta) throw new Error('附件信息不完整')
    const cache = this.store.fileCachePath(meta.id, meta.name)
    if (existsSync(cache)) {
      return { bytes: readFileSync(cache), mime: meta.mime, name: meta.name }
    }
    const absolute = /^https?:\/\//i.test(meta.url) ? meta.url : `${this.relayBase()}${meta.url.startsWith('/') ? '' : '/'}${meta.url}`
    const response = await fetch(absolute, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`附件下载失败 HTTP ${response.status}`)
    const encrypted = Buffer.from(await response.arrayBuffer())
    if (encrypted.length > MAX_FILE_BYTES * 1.4) throw new Error('附件超过大小上限')
    const bytes = openBuffer(encrypted, this.key)
    try {
      writeFileSync(cache, bytes)
    } catch {
      /* ignore */
    }
    return { bytes, mime: meta.mime, name: meta.name }
  }

  /** 在已加载的消息里找一个附件（供 /file 路由使用）。 */
  findFileMessage(id) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i]
      if (message?.file?.id === id) return message
    }
    return null
  }

  hydrateReactions(raw) {
    const map = new Map()
    for (const [messageId, byEmoji] of Object.entries(raw || {})) {
      if (!byEmoji || typeof byEmoji !== 'object') continue
      const inner = new Map()
      for (const [emoji, peers] of Object.entries(byEmoji)) {
        if (!Array.isArray(peers) || peers.length === 0) continue
        inner.set(emoji, new Set(peers.map(String)))
      }
      if (inner.size > 0) map.set(messageId, inner)
    }
    return map
  }

  reactionsToJson() {
    const out = {}
    for (const [messageId, byEmoji] of this.reactions) {
      const peers = {}
      for (const [emoji, set] of byEmoji) {
        if (set.size > 0) peers[emoji] = [...set]
      }
      if (Object.keys(peers).length > 0) out[messageId] = peers
    }
    return out
  }

  persistReactions() {
    try {
      this.store.saveReactions(this.topic, this.reactionsToJson())
    } catch {
      /* ignore */
    }
  }

  /** 应用一次回应（本地点击或远端事件）。 */
  applyReaction({ messageId, emoji, from, add = true }) {
    if (!messageId || !emoji) return
    const clean = String(emoji).slice(0, 8)
    let byEmoji = this.reactions.get(messageId)
    if (!byEmoji) {
      byEmoji = new Map()
      this.reactions.set(messageId, byEmoji)
    }
    let peers = byEmoji.get(clean)
    if (!peers) {
      peers = new Set()
      byEmoji.set(clean, peers)
    }
    if (add) peers.add(String(from))
    else peers.delete(String(from))
    if (peers.size === 0) byEmoji.delete(clean)
    if (byEmoji.size === 0) this.reactions.delete(messageId)
    this.persistReactions()
  }

  /** 聚合给 UI：{ messageId: [{ emoji, count, mine }] }。 */
  reactionsForState() {
    const out = {}
    for (const [messageId, byEmoji] of this.reactions) {
      const chips = []
      for (const [emoji, peers] of byEmoji) {
        if (peers.size === 0) continue
        chips.push({ emoji, count: peers.size, mine: peers.has(this.me.id) })
      }
      if (chips.length > 0) out[messageId] = chips
    }
    return out
  }

  /** 点一次表情：本地立即生效并广播（同一 emoji 再点取消）。 */
  async react(messageId, emoji) {
    const clean = String(emoji || '').slice(0, 8)
    if (!messageId || !clean) throw new Error('缺少消息或表情')
    const byEmoji = this.reactions.get(messageId)
    const peers = byEmoji?.get(clean)
    const add = !(peers && peers.has(this.me.id))
    this.applyReaction({ messageId, emoji: clean, from: this.me.id, add })
    if (this.relay) {
      try {
        const { body } = this.encode({ kind: 'reaction', to: messageId, emoji: clean, add })
        await this.relay.publish(body)
      } catch {
        /* 回应失败不回滚，等对方重试 */
      }
    }
    return this.reactionsForState()[messageId] || []
  }

  pushMessage(msg) {
    // 同一 id 只入库一次：中继回显与本地写入可能竞态（尤其是桥接消息）。
    if (msg?.id) {
      const existing = this.messages.find((item) => item.id === msg.id)
      if (existing) return existing
    }
    this.seq += 1
    const stored = { ...msg, seq: this.seq }
    this.messages.push(stored)
    if (this.messages.length > MAX_MEMORY) this.messages.splice(0, this.messages.length - MAX_MEMORY)
    this.store.appendMessage(this.topic, stored)
    return stored
  }

  /** 编辑 / 撤回后整文件重写本地消息记录（原子替换）。 */
  persistMessages() {
    try {
      this.store.saveMessages(this.topic, this.messages)
    } catch {
      /* 落盘失败不应影响当前会话 */
    }
  }

  /**
   * 编辑自己发的一条文本消息：本地更新 + 落盘 + 广播 edit 信封。
   * @param {string} id
   * @param {string} text
   * @returns {Promise<object>} 更新后的消息
   */
  async editMessage(id, text) {
    const messageId = String(id || '')
    const target = this.messages.find((item) => item.id === messageId)
    if (!target) throw new Error('消息不存在（可能超出本机消息窗口）')
    if (target.from !== this.me.id) throw new Error('只能编辑自己的消息')
    if (target.deleted) throw new Error('消息已删除')
    if (target.file) throw new Error('附件消息不能编辑')
    const value = String(text ?? '').trim()
    if (!value) throw new Error('消息不能为空')
    if (value.length > MAX_TEXT) throw new Error(`消息太长（最多 ${MAX_TEXT} 字）`)
    target.text = value
    target.edited = true
    this.persistMessages()
    if (this.relay) {
      try {
        const { body, envelope } = this.encode({ kind: 'edit', to: messageId, text: value })
        await this.relay.publish(body)
        this.seen.add(envelope.id)
      } catch (error) {
        // 广播失败不回滚本地编辑（对方可通过重连/重放收敛）。
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    return target
  }

  /**
   * 撤回（删除）自己发的一条消息：标记 deleted + 清空正文 + 删除本地附件缓存 + 广播 delete 信封。
   * 保留消息占位（tombstone），这样两边 seq 不错位。
   * @param {string} id
   * @returns {Promise<object>} 更新后的消息
   */
  async deleteMessage(id) {
    const messageId = String(id || '')
    const target = this.messages.find((item) => item.id === messageId)
    if (!target) throw new Error('消息不存在（可能超出本机消息窗口）')
    if (target.from !== this.me.id) throw new Error('只能删除自己的消息')
    if (!target.deleted) {
      target.deleted = true
      target.text = ''
      if (target.file) {
        try {
          unlinkSync(this.fileCachePath(target.file))
        } catch {
          /* 缓存文件可能已不存在 */
        }
        delete target.file
      }
      this.persistMessages()
    }
    if (this.relay) {
      try {
        const { body, envelope } = this.encode({ kind: 'delete', to: messageId })
        await this.relay.publish(body)
        this.seen.add(envelope.id)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    return target
  }

  /**
   * 发送一条消息：先发布到中继，成功后再落本地。
   * @param {string} text
   * @param {{ via?: 'human'|'agent', replyTo?: string, toAgent?: boolean, askId?: string, forwardedFrom?: string }} [options]
   * @returns {Promise<object>} 已写入的本地消息
   */
  async send(text, options = {}) {
    const value = String(text ?? '').trim()
    if (!value) throw new Error('消息不能为空')
    if (value.length > MAX_TEXT) throw new Error(`消息太长（最多 ${MAX_TEXT} 字）`)
    if (!this.relay) throw new Error('传输未启动：请先在设置里启用')
    const payload = {
      kind: 'message',
      text: value,
      via: options.via === 'agent' ? 'agent' : 'human',
    }
    if (options.replyTo) payload.replyTo = options.replyTo
    if (options.toAgent === true) payload.toAgent = true
    if (options.askId) payload.askId = options.askId
    if (typeof options.forwardedFrom === 'string' && options.forwardedFrom.trim()) {
      payload.forwardedFrom = options.forwardedFrom.trim().slice(0, 40)
    }
    const { body, envelope } = this.encode(payload)
    await this.relay.publish(body)
    this.seen.add(envelope.id)
    const msg = {
      id: envelope.id,
      ts: envelope.ts,
      from: this.me.id,
      nick: this.me.nick,
      text: value,
      mine: true,
      via: payload.via,
    }
    if (options.replyTo) msg.replyTo = options.replyTo
    if (payload.toAgent) msg.toAgent = true
    if (payload.forwardedFrom) msg.forwardedFrom = payload.forwardedFrom
    return this.pushMessage(msg)
  }

  /**
   * 以外部 agent 的身份发一条消息（桥接用：Hermes / WorkBuddy / 任何 CLI agent）。
   * 消息的 from 用昵称派生的稳定 id，所以在 UI 里是房间里的一个独立成员。
   * @param {string} nick
   * @param {string} text
   * @param {{ toAgent?: boolean, replyTo?: string }} [options]
   */
  async sendAs(nick, text, options = {}) {
    const cleanNick = String(nick ?? '').trim().slice(0, 40) || 'external-agent'
    const value = String(text ?? '').trim()
    if (!value) throw new Error('消息不能为空')
    if (value.length > MAX_TEXT) throw new Error(`消息太长（最多 ${MAX_TEXT} 字）`)
    if (!this.relay) throw new Error('传输未启动：请先在设置里启用')
    const from = externalPeerId(cleanNick)
    const payload = {
      kind: 'message',
      text: value,
      via: 'bridge',
      nick: cleanNick,
      from,
    }
    if (options.toAgent === true) payload.toAgent = true
    if (options.replyTo) payload.replyTo = options.replyTo
    const { body, envelope } = this.encode(payload)
    // 先登记 seen，再发布会：否则中继回显可能先到，导致同一条消息入库两次。
    this.seen.add(envelope.id)
    await this.relay.publish(body)
    this.touchPeer(from, cleanNick, envelope.ts)
    const msg = {
      id: envelope.id,
      ts: envelope.ts,
      from,
      nick: cleanNick,
      text: value,
      mine: false,
      via: 'bridge',
    }
    if (options.toAgent === true) msg.toAgent = true
    if (options.replyTo) msg.replyTo = options.replyTo
    return this.pushMessage(msg)
  }

  /** 桥接 agent 的"正在输入"。 */
  async publishTypingAs(nick) {
    if (!this.relay) return
    try {
      const cleanNick = String(nick ?? '').trim().slice(0, 40) || 'external-agent'
      const { body } = this.encode({
        kind: 'typing',
        nick: cleanNick,
        from: externalPeerId(cleanNick),
      })
      await this.relay.publish(body)
    } catch {
      /* ignore */
    }
  }

  /**
   * agent 之间的一次性问答：发一条消息，等房间里某个 agent 的回复（默认 60s）。
   * 对端需要开启 agent 自动回复（或由人手动回复，但手动回复不参与关联）。
   * @param {string} text
   * @param {{ timeoutMs?: number }} [options]
   */
  async ask(text, options = {}) {
    const askId = randomUUID()
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 60000, 5000), 140000)
    const promise = new Promise((resolve) => {
      const waiter = { since: Date.now(), resolve: null }
      const timer = setTimeout(() => {
        this.waiters.delete(askId)
        resolve({ askId, ok: false, error: '等待对方 agent 回复超时' })
      }, timeoutMs)
      waiter.resolve = (value) => {
        clearTimeout(timer)
        resolve(value)
      }
      waiter.timer = timer
      this.waiters.set(askId, waiter)
    })
    try {
      await this.send(text, { via: 'agent', toAgent: true, askId })
    } catch (error) {
      const waiter = this.waiters.get(askId)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.waiters.delete(askId)
        waiter.resolve({ askId, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return promise
  }

  /**
   * 把任务派给房间里某个具名 agent（桥接成员，如 Hermes/WorkBuddy）并等它回复。
   * 发送 `@昵称 <任务>`，只接受该昵称在派活之后发来的消息作为结果。
   * @param {string} agentName
   * @param {string} text
   * @param {{ timeoutMs?: number }} [options]
   */
  async dispatch(agentName, text, options = {}) {
    const nick = String(agentName ?? '').trim()
    if (!nick) throw new Error('缺少 agent 昵称（房间成员栏里的名字）')
    const value = String(text ?? '').trim()
    if (!value) throw new Error('任务内容不能为空')
    const expectFrom = externalPeerId(nick)
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 100000, 5000), 115000)
    const startedAt = Date.now()
    const promise = new Promise((resolve) => {
      const waiter = { since: startedAt, expectFrom, resolve: null }
      const timer = setTimeout(() => {
        this.waiters.delete(expectFrom)
        resolve({
          ok: false,
          error: `${nick} 在 ${Math.round(timeoutMs / 1000)}s 内没有回复：确认它的 bridge-agent 守护在运行（--mention @${nick.toLowerCase()}）`,
        })
      }, timeoutMs)
      waiter.resolve = (result) => {
        clearTimeout(timer)
        resolve(result)
      }
      waiter.timer = timer
      this.waiters.set(expectFrom, waiter)
    })
    try {
      await this.send(`@${nick} ${value}`, { toAgent: true })
    } catch (error) {
      const waiter = this.waiters.get(expectFrom)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.waiters.delete(expectFrom)
        waiter.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const result = await promise
    return { ...result, elapsedMs: Date.now() - startedAt }
  }

  /** 取消所有等待中的 chat_ask / chat_dispatch（插件卸载时）。 */
  cancelWaiters() {
    for (const [askId, waiter] of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve?.({ askId, ok: false, error: '插件已停用' })
    }
    this.waiters.clear()
  }

  /** 广播一次"正在输入"（不落盘、不产生未读）。 */
  async publishTyping() {
    if (!this.relay) return
    try {
      const { body } = this.encode({ kind: 'typing' })
      await this.relay.publish(body)
    } catch {
      /* 输入状态失败不影响聊天 */
    }
  }

  /** 当前房间的邀请码。 */
  inviteCode() {
    return encodeInvite({
      room: this.room,
      passphrase: this.config.passphrase,
      relayKind: this.config.relayKind,
      relayUrl: this.config.relayUrl,
    })
  }

  /**
   * 用邀请码加入房间（房间/口令/中继一起切换）。
   * @param {string} code
   */
  async join(code) {
    const invite = decodeInvite(code)
    return this.updateConfig({
      room: invite.room,
      passphrase: invite.passphrase,
      relayKind: invite.relayKind,
      relayUrl: invite.relayUrl || this.config.relayUrl,
    })
  }

  /** UI 轮询用的完整快照。 */
  getState() {
    const now = Date.now()
    return {
      ok: true,
      me: {
        id: this.me.id,
        agentId: this.me.agentId || String(this.config.agentId || ''),
        nick: this.nickname(),
        avatar: String(this.config.avatar || ''),
        status: String(this.config.status || ''),
      },
      room: this.room,
      relay: {
        kind: this.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        url: this.config.relayUrl,
        encrypted: this.encrypted,
      },
      connected: this.connected,
      lastError: this.lastError,
      peers: (() => {
        this.prunePeers(now)
        const duplicates = this.duplicateNicks()
        return [...this.peers.values()]
          .sort((a, b) => b.lastSeen - a.lastSeen)
          .map((peer) => ({
            ...peer,
            label: this.messageAuthor({ nick: peer.nick, from: peer.id }, duplicates),
            online: now - peer.lastSeen < PEER_ONLINE_MS,
          }))
      })(),
      messages: this.messages,
      latestSeq: this.seq,
      typing: [...this.typing.entries()]
        .filter(([, entry]) => now - entry.ts < TYPING_TTL_MS)
        .map(([id, entry]) => ({ id, nick: entry.nick })),
      unread: this.countUnread('human'),
      readReceipts: Object.fromEntries(this.readReceipts),
      reactions: this.reactionsForState(),
      peerReadSeq: this.readReceipts.size > 0 ? Math.max(...this.readReceipts.values()) : 0,
      agentUnread: this.countUnread('agent'),
      lastReadSeq: this.humanReadSeq,
      agent: {
        autoReply: this.config.agentAutoReply === true,
        busy: this.agentStatus?.busy === true,
        lastError: this.agentStatus?.lastError || null,
        replies: Number(this.agentStatus?.replies) || 0,
      },
      settings: {
        nickname: String(this.config.nickname || ''),
        status: String(this.config.status || ''),
        avatar: String(this.config.avatar || ''),
        agentId: String(this.config.agentId || ''),
        room: this.room,
        passphraseSet: Boolean(this.config.passphrase),
        relayKind: this.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        relayUrl: String(this.config.relayUrl || ''),
        enabled: this.config.enabled !== false,
        discoverable: this.config.discoverable === true,
        onboarded: this.config.onboarded === true,
        agentAutoReply: this.config.agentAutoReply === true,
        agentPreset: String(this.config.agentPreset || 'standard'),
      },
    }
  }

  /**
   * 更新配置并立即重连（换房间时清空当前视图，加载新房间的本地记录）。
   * @param {Record<string, unknown>} patch
   */
  async updateConfig(patch = {}) {
    const next = { ...this.config }
    if (typeof patch.nickname === 'string') next.nickname = patch.nickname.trim().slice(0, 40)
    if (typeof patch.status === 'string') next.status = patch.status.trim().slice(0, 80)
    // avatar 只允许是由 store.saveAvatar() 生成的文件名（/avatar 路由写入）。
    if (typeof patch.avatar === 'string') {
      next.avatar = patch.avatar.trim().replace(/[^\w.-]/g, '').slice(0, 80)
    }
    if (typeof patch.room === 'string' && patch.room.trim()) next.room = patch.room.trim().slice(0, 64)
    if (typeof patch.passphrase === 'string') next.passphrase = patch.passphrase
    if (typeof patch.relayKind === 'string') next.relayKind = patch.relayKind === 'custom' ? 'custom' : 'ntfy'
    if (typeof patch.relayUrl === 'string' && patch.relayUrl.trim()) {
      next.relayUrl = patch.relayUrl.trim().replace(/\/+$/, '')
    }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.agentAutoReply === 'boolean') next.agentAutoReply = patch.agentAutoReply
    if (typeof patch.agentPreset === 'string' && patch.agentPreset.trim()) {
      next.agentPreset = patch.agentPreset.trim().slice(0, 40)
    }
    if (typeof patch.agentModel === 'string' && patch.agentModel.trim()) next.agentModel = patch.agentModel.trim()
    if (typeof patch.agentProvider === 'string' && patch.agentProvider.trim()) next.agentProvider = patch.agentProvider.trim()
    if (typeof patch.discoverable === 'boolean') next.discoverable = patch.discoverable
    if (typeof patch.onboarded === 'boolean') next.onboarded = patch.onboarded

    const roomChanged = next.room !== this.config.room || next.passphrase !== this.config.passphrase
    this.config = next
    this.me = {
      id: next.peerId,
      agentId: next.agentId,
      nick: this.nickname(),
      avatar: String(next.avatar || ''),
      status: String(next.status || ''),
    }
    this.store.saveConfig(next)

    if (roomChanged) {
      this.messages = []
      this.peers.clear()
      this.seen.clear()
      this.seq = 0
      this.loadRoom()
    }
    this.startTransport()
    await this.announce()
    try {
      this.onConfigChanged?.()
    } catch (error) {
      this.logger?.warn?.('dsh-chat-plugin: onConfigChanged 失败', error)
    }
    return this.getState()
  }

  dispose() {
    try {
      this.stopTransport?.()
    } catch {
      /* ignore */
    }
    this.stopTransport = null
    this.relay = null
    this.connected = false
  }
}
