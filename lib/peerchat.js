/**
 * dsh-chat-plugin — Host 侧核心：房间状态 + 收发 + 成员。
 *
 * 生命周期：new PeerChat({ctx, config}) → start()（返回 disposer）。
 * 所有网络/文件写入都围在 try/catch 里：插件出错不能拖垮整个 dsh。
 * @module dsh-chat-plugin/peerchat
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import { deriveKey, deriveTopic, open, seal } from './crypto.js'
import { externalPeerId } from './bridge.js'
import { decodeInvite, encodeInvite } from './invite.js'
import { createRelay } from './relay.js'
import { ChatStore, DEFAULT_CONFIG } from './store.js'

/** 单条消息最大字符数（再受中继字节上限二次约束）。 */
const MAX_TEXT = 1000
/** 超过这个时间没活动就算离线。 */
const PEER_ONLINE_MS = 5 * 60 * 1000
/** 内存里保留的消息条数。 */
const MAX_MEMORY = 400
/** 内存里去重用的 id 集合上限。 */
const MAX_SEEN = 4000
/** "正在输入"的存活时间：超过这个时间没有新的 typing 就当作停止输入。 */
const TYPING_TTL_MS = 6000

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
    this.store.saveConfig(this.config)

    this.me = { id: this.config.peerId, nick: this.nickname() }
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

    const stored = this.store.loadMessages(this.topic, MAX_MEMORY)
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

  /**
   * 推进已读游标并持久化。
   * @param {number} [seq] 已读到的消息 seq，默认最新
   * @param {'human'|'agent'} [who]
   */
  markRead(seq = this.seq, who = 'human') {
    const value = Math.min(Math.max(0, Number(seq) || 0), this.seq)
    if (who === 'agent') {
      if (value > this.agentReadSeq) this.agentReadSeq = value
    } else if (value > this.humanReadSeq) {
      this.humanReadSeq = value
    }
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
    const preview = this.messages
      .filter((msg) => !msg.mine && msg.seq > this.agentReadSeq)
      .slice(-3)
      .map((msg) => `- ${msg.nick}: ${String(msg.text).replace(/\s+/g, ' ').slice(0, 160)}`)
      .join('\n')
    return [
      '## dsh Chat (dsh peer chat — instant messaging between dsh installations)',
      `You are in room "${this.room}" with ${this.peers.size} other peer(s). There are ${unread} unread message(s):`,
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
    if (payload.kind === 'typing') {
      // 输入状态是瞬时的：只更新内存，不进消息列表、不落盘。
      this.typing.set(from, { nick: String(payload.nick || shortId(from)).slice(0, 40), ts })
      return
    }
    if (payload.kind === 'hello') return

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
    const previous = this.peers.get(from)
    this.peers.set(from, {
      id: from,
      nick: (nick && String(nick).slice(0, 40)) || previous?.nick || shortId(from),
      lastSeen: Math.max(Number(ts) || 0, previous?.lastSeen || 0, Date.now() - 1),
    })
  }

  pushMessage(msg) {
    this.seq += 1
    const stored = { ...msg, seq: this.seq }
    this.messages.push(stored)
    if (this.messages.length > MAX_MEMORY) this.messages.splice(0, this.messages.length - MAX_MEMORY)
    this.store.appendMessage(this.topic, stored)
    return stored
  }

  /**
   * 发送一条消息：先发布到中继，成功后再落本地。
   * @param {string} text
   * @param {{ via?: 'human'|'agent', replyTo?: string, toAgent?: boolean, askId?: string }} [options]
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
    await this.relay.publish(body)
    this.seen.add(envelope.id)
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
      me: { id: this.me.id, nick: this.me.nick },
      room: this.room,
      relay: {
        kind: this.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        url: this.config.relayUrl,
        encrypted: this.encrypted,
      },
      connected: this.connected,
      lastError: this.lastError,
      peers: [...this.peers.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((peer) => ({ ...peer, online: now - peer.lastSeen < PEER_ONLINE_MS })),
      messages: this.messages,
      latestSeq: this.seq,
      typing: [...this.typing.entries()]
        .filter(([, entry]) => now - entry.ts < TYPING_TTL_MS)
        .map(([id, entry]) => ({ id, nick: entry.nick })),
      unread: this.countUnread('human'),
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
        room: this.room,
        passphraseSet: Boolean(this.config.passphrase),
        relayKind: this.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        relayUrl: String(this.config.relayUrl || ''),
        enabled: this.config.enabled !== false,
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

    const roomChanged = next.room !== this.config.room || next.passphrase !== this.config.passphrase
    this.config = next
    this.me = { id: next.peerId, nick: this.nickname() }
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
