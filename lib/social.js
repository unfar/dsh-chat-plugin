/**
 * dsh-chat-plugin — 社交发现层（找好友）。
 *
 * 插件是去中心化的，没有账号服务器，所以"找到对方"靠两条路：
 *  1. 邀请码（点对点，最私密）；
 *  2. **公共发现目录**（本条）：开启后把「昵称 + 随机 peerId」周期性发布到一个
 *     公共 topic；装了插件的其他人能在「发现」里看到你，点一下就能建立连接。
 *
 * 连接流程：
 *  - A 在目录里看到 B → 点「连接」→ A 生成一个随机私密房间（room + 口令），
 *    把连接包加密后投递到 B 的收件箱 topic（topic 由 B 的随机 peerId 派生）；
 *  - A 立即切到新房间；B 的插件收到请求 → 面板提示「A 想和你聊天」→ 接受即加入同一房间；
 *  - 双方各自把房间存入通讯录，下次一键切换。
 *
 * 隐私：目录/收件箱内容都用确定性密钥加密（中继只看到密文）；但 peerId 一旦出现在
 * 公共目录就意味着"可被联系"，不想被打扰就别开启发现，改用邀请码。
 * @module dsh-chat-plugin/social
 */
import { createHash, randomBytes } from 'node:crypto'

import { formatAgentId, normalizeAgentId } from './agentid.js'
import { open, seal } from './crypto.js'
import { createRelay } from './relay.js'

const DIRECTORY_LABEL = 'dsh-chat:directory:v1'
const INBOX_LABEL_PREFIX = 'dsh-chat:inbox:v1:'
/** 目录里超过这个时间没心跳就不显示了（心跳默认 10 分钟）。 */
const DIRECTORY_TTL_MS = 25 * 60 * 1000
/** 同时展示的连接请求上限。 */
const MAX_INBOX = 20

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest()
const keyOf = (label) => sha256(`key:${label}`)
const topicOf = (label) => `dshpc-${sha256(label).toString('hex').slice(0, 24)}`

export const directoryTopic = () => topicOf(DIRECTORY_LABEL)
export const inboxTopic = (agentId) => topicOf(`${INBOX_LABEL_PREFIX}${agentId}`)

/** 目录名片（公开，但只对装插件的人可读）。 */
export function sealPresence({ id, agentId, nick }) {
  return seal({ v: 1, type: 'presence', id, agentId, nick, at: Date.now() }, keyOf(DIRECTORY_LABEL))
}

export function openPresence(body) {
  try {
    const packet = open(String(body || ''), keyOf(DIRECTORY_LABEL))
    if (!packet || packet.type !== 'presence' || !packet.id || !packet.agentId) return null
    return packet
  } catch {
    return null
  }
}

/** 连接请求：只有 target 的 Agent ID 收件箱密钥能解开。 */
export function sealConnect(targetAgentId, { from, room }) {
  return seal({ v: 1, type: 'connect', id: randomBytes(8).toString('hex'), from, room, at: Date.now() }, keyOf(`${INBOX_LABEL_PREFIX}${targetAgentId}`))
}

export function openConnect(selfAgentId, body) {
  try {
    const packet = open(String(body || ''), keyOf(`${INBOX_LABEL_PREFIX}${selfAgentId}`))
    if (!packet || packet.type !== 'connect' || !packet.room?.name) return null
    return packet
  } catch {
    return null
  }
}

export class Social {
  /**
   * @param {{ ctx: import('@deepseek-ai/cordis').Context, app: import('./peerchat.js').PeerChat, store: import('./store.js').ChatStore }} options
   */
  constructor({ ctx, app, store, chats }) {
    this.ctx = ctx
    this.app = app
    this.store = store
    this.chats = chats || null
    this.logger = ctx?.logger
    this.directory = new Map()
    this.contacts = store.loadContacts()
    this.inbox = store.loadInbox()
    this.relays = []
    this.timer = null
    this.stopped = false
  }

  get me() {
    return {
      id: this.app.config.peerId,
      agentId: this.app.config.agentId,
      nick: this.app.nickname(),
    }
  }

  start() {
    this.stopped = false
    this.connectRelays()
    this.publishPresence()
    const interval = Math.max(Number(this.app.config.discoverHeartbeatMs) || 600000, 120000)
    this.timer = setInterval(() => this.publishPresence(), interval)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    return () => this.stop()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const relay of this.relays.splice(0)) {
      try {
        relay.stop()
      } catch {
        /* ignore */
      }
    }
  }

  /** 中继设置变化时重连。 */
  restart() {
    this.stop()
    this.start()
  }

  connectRelays() {
    const relayOptions = {
      kind: this.app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
      url: this.app.config.relayUrl || 'https://ntfy.sh',
    }
    const selfAgentId = this.me.agentId
    const directory = createRelay({
      ...relayOptions,
      topic: directoryTopic(),
      onStatus: () => undefined,
      onEvent: (event) => {
        const packet = openPresence(event?.body)
        if (!packet) return
        if (packet.agentId === selfAgentId) return
        this.directory.set(packet.agentId, {
          agentId: packet.agentId,
          peerId: packet.id,
          nick: String(packet.nick || '?').slice(0, 40),
          at: Number(packet.at) || Date.now(),
        })
      },
    })
    const inbox = createRelay({
      ...relayOptions,
      topic: inboxTopic(selfAgentId),
      onStatus: () => undefined,
      onEvent: (event) => {
        const packet = openConnect(selfAgentId, event?.body)
        if (!packet) return
        if (this.inbox.some((item) => item.id === packet.id)) return
        this.inbox.unshift({
          id: packet.id,
          fromId: String(packet.from?.id || ''),
          fromAgentId: String(packet.from?.agentId || ''),
          fromNick: String(packet.from?.nick || '?').slice(0, 40),
          room: packet.room,
          at: Number(packet.at) || Date.now(),
        })
        this.inbox = this.inbox.slice(0, MAX_INBOX)
        this.store.saveInbox(this.inbox)
        this.logger?.info?.(`dsh-chat-plugin: 收到 ${packet.from?.nick || '?'} 的连接请求`)
      },
    })
    this.relays.push(directory, inbox)
    directory.start()
    inbox.start()
  }

  async publishPresence() {
    if (!this.app.config.discoverable) return
    if (!this.relays[0]) return
    try {
      const body = sealPresence(this.me)
      await this.relays[0].publish(body)
    } catch (error) {
      this.logger?.warn?.('dsh-chat-plugin: 发布发现目录失败', error)
    }
  }

  /** 目录条目（过滤过期与自己）。 */
  getDirectory(now = Date.now()) {
    return [...this.directory.values()]
      .filter((item) => item.agentId !== this.me.agentId && now - item.at < DIRECTORY_TTL_MS)
      .sort((left, right) => right.at - left.at)
  }

  getInbox() {
    return this.inbox
  }

  getContacts() {
    return this.contacts
  }

  /** 把当前房间的同伴加入通讯录。 */
  saveContact({ id, agentId, nick, room, passphrase, relayKind, relayUrl }) {
    if (!id || !room) return this.contacts
    const entry = {
      id,
      agentId: agentId || '',
      nick: String(nick || '?').slice(0, 40),
      room: String(room).slice(0, 64),
      passphrase: String(passphrase || ''),
      relayKind: relayKind === 'custom' ? 'custom' : 'ntfy',
      relayUrl: String(relayUrl || this.app.config.relayUrl || 'https://ntfy.sh'),
      addedAt: Date.now(),
    }
    this.contacts = [entry, ...this.contacts.filter((item) => item.id !== id)]
    this.store.saveContacts(this.contacts)
    return this.contacts
  }

  removeContact(id) {
    this.contacts = this.contacts.filter((item) => item.id !== id)
    this.store.saveContacts(this.contacts)
    return this.contacts
  }

  /**
   * 连接目录里的某个人：生成私密房间 → 切过去 → 把连接包投到对方收件箱。
   * @param {string} targetId
   */
  /**
   * 连接一个人：target 可以是目录里的 peerId，也可以直接是 Agent ID（无需对方开启发现）。
   * @param {string} targetInput
   */
  async connect(targetInput) {
    const input = String(targetInput || '').trim()
    if (!input) throw new Error('缺少目标')
    const directAgentId = normalizeAgentId(input)
    const directoryEntry = directAgentId
      ? this.directory.get(directAgentId) || null
      : this.getDirectory().find((item) => item.peerId === input) || null
    if (!directAgentId && !directoryEntry) throw new Error('找不到这个 Agent ID')
    const targetAgentId = directAgentId || directoryEntry.agentId
    const targetPeerId = directoryEntry?.peerId || ''
    const targetNick = directoryEntry?.nick || 'Agent ' + formatAgentId(targetAgentId)
    const room = {
      name: `dm-${randomBytes(3).toString('hex')}`,
      passphrase: randomBytes(9).toString('base64url'),
    }
    const packet = sealConnect(targetAgentId, { from: this.me, room })
    const relay = createRelay({
      kind: this.app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
      url: this.app.config.relayUrl || 'https://ntfy.sh',
      topic: inboxTopic(targetAgentId),
      onStatus: () => undefined,
      onEvent: () => undefined,
    })
    relay.start()
    try {
      await relay.publish(packet)
    } finally {
      setTimeout(() => relay.stop(), 1500)
    }
    await this.app.updateConfig({ room: room.name, passphrase: room.passphrase })
    const contactId = targetPeerId || 'agent:' + targetAgentId
    if (targetPeerId) {
      this.chats?.addDm({
        peerId: targetPeerId,
        nick: targetNick,
        room: room.name,
        passphrase: room.passphrase,
      })
    }
    this.saveContact({
      id: contactId,
      agentId: targetAgentId,
      nick: targetNick,
      room: room.name,
      passphrase: room.passphrase,
    })
    return { contact: this.contacts.find((item) => item.id === contactId), state: this.app.getState() }
  }

  /** 直接按 Agent ID 添加（不需要目录/发现）。 */
  async connectById(agentId) {
    const normalized = normalizeAgentId(agentId)
    if (!normalized) throw new Error('Agent ID 格式不正确（应为 8 位，如 K7M2-QX9T）')
    return this.connect(normalized)
  }

  async accept(requestId) {
    const request = this.inbox.find((item) => item.id === requestId)
    if (!request) throw new Error('请求不存在或已处理')
    await this.app.updateConfig({ room: request.room.name, passphrase: request.room.passphrase || '' })
    const fromId = request.fromId || (request.fromAgentId ? 'agent:' + request.fromAgentId : '')
    if (request.fromId) {
      this.chats?.addDm({
        peerId: request.fromId,
        nick: request.fromNick,
        room: request.room.name,
        passphrase: request.room.passphrase || '',
      })
    }
    this.saveContact({
      id: fromId,
      agentId: request.fromAgentId,
      nick: request.fromNick,
      room: request.room.name,
      passphrase: request.room.passphrase || '',
    })
    this.inbox = this.inbox.filter((item) => item.id !== requestId)
    this.store.saveInbox(this.inbox)
    return { state: this.app.getState() }
  }

  dismiss(requestId) {
    this.inbox = this.inbox.filter((item) => item.id !== requestId)
    this.store.saveInbox(this.inbox)
    return this.inbox
  }

  /** 从通讯录切回某个房间。 */
  async joinContact(contactId) {
    const contact = this.contacts.find((item) => item.id === contactId)
    if (!contact) throw new Error('联系人不存在')
    const state = await this.app.updateConfig({
      room: contact.room,
      passphrase: contact.passphrase || '',
      relayKind: contact.relayKind,
      relayUrl: contact.relayUrl,
    })
    return { state }
  }

  snapshot() {
    return {
      discoverable: this.app.config.discoverable === true,
      directory: this.getDirectory(),
      inbox: this.getInbox(),
      contacts: this.getContacts(),
      me: this.me,
    }
  }

  /** 规范化用户输入的 Agent ID（支持 K7M2-QX9T 大小写混写）。 */
  normalizeAgentId(input) {
    return normalizeAgentId(input)
  }
}
