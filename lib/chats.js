/**
 * dsh-chat-plugin — 会话列表（DM / 群聊）管理。
 *
 * 一个「会话」= 一个房间（room + 口令）+ 展示标题。DM 会话绑定对方 peerId，
 * 群聊会话只有标题。列表持久化在 $DSH_HOME/dsh-chat/chats.json。
 *
 * 侧边栏从这里渲染：标题、最后一条消息预览、未读数、当前会话高亮。
 * 未读/预览直接读本地 messages-<topic>.jsonl，无需额外网络订阅。
 * @module dsh-chat-plugin/chats
 */
import { randomBytes } from 'node:crypto'

import { deriveTopic } from './crypto.js'

const MAX_CHATS = 40

function titleOf(entry) {
  return String(entry.title || entry.room || '群聊').slice(0, 40)
}

export class Chats {
  /**
   * @param {{ app: import('./peerchat.js').PeerChat, store: import('./store.js').ChatStore }} options
   */
  constructor({ app, store }) {
    this.app = app
    this.store = store
    this.list = this.load()
  }

  load() {
    let list = this.store.loadChats()
    if (list.length === 0) {
      // 从旧版通讯录迁移（联系人本来就是 DM 会话）。
      list = this.store.loadContacts().map((contact) => ({
        id: 'dm:' + contact.id,
        kind: 'dm',
        peerId: contact.id,
        title: contact.nick,
        room: contact.room,
        passphrase: contact.passphrase || '',
        relayKind: contact.relayKind === 'custom' ? 'custom' : 'ntfy',
        relayUrl: contact.relayUrl || 'https://ntfy.sh',
        addedAt: contact.addedAt || Date.now(),
      }))
    }
    return Array.isArray(list) ? list.slice(0, MAX_CHATS) : []
  }

  save() {
    this.list = this.list.slice(0, MAX_CHATS)
    this.store.saveChats(this.list)
  }

  get(id) {
    return this.list.find((entry) => entry.id === id)
  }

  findRoom(room) {
    return this.list.find((entry) => entry.room === room)
  }

  /** 当前房间没有对应会话时自动补一条（手动改配置、邀请码加入等场景）。 */
  ensureCurrent() {
    const room = this.app.room
    if (!room) return this.list
    const passphrase = this.app.config.passphrase || ''
    const relayKind = this.app.config.relayKind === 'custom' ? 'custom' : 'ntfy'
    const relayUrl = this.app.config.relayUrl || 'https://ntfy.sh'
    const existing = this.findRoom(room)
    if (existing) {
      // 只允许用"当前房间的配置"补全当前这条会话；绝不用当前口令去覆盖别的会话，
      // 也绝不用空口令覆盖已有口令（否则会把历史房间的主题改掉、丢消息）。
      if (passphrase) existing.passphrase = passphrase
      existing.relayKind = relayKind
      existing.relayUrl = relayUrl
      this.save()
      return this.list
    }
    const entry = {
      id: 'room:' + room,
      kind: 'group',
      title: room,
      room,
      passphrase,
      relayKind,
      relayUrl,
      addedAt: Date.now(),
    }
    this.list.unshift(entry)
    this.save()
    return this.list
  }

  /** 新建群聊：随机房间名 + 口令，创建后立刻切换过去。 */
  async createGroup(title) {
    const room = 'grp-' + randomBytes(3).toString('hex')
    const passphrase = randomBytes(9).toString('base64url')
    const name = String(title || '').trim().slice(0, 40) || '新群聊'
    await this.app.updateConfig({ room, passphrase })
    const entry = {
      id: 'group:' + room,
      kind: 'group',
      title: name,
      room,
      passphrase,
      relayKind: this.app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
      relayUrl: this.app.config.relayUrl || 'https://ntfy.sh',
      addedAt: Date.now(),
    }
    this.list.unshift(entry)
    this.save()
    return entry
  }

  /** 发现/接受连接后登记一个 DM 会话。 */
  addDm({ peerId, nick, room, passphrase }) {
    if (!peerId || !room) return undefined
    const id = 'dm:' + peerId
    const existing = this.get(id)
    const entry = {
      id,
      kind: 'dm',
      peerId,
      title: String(nick || existing?.title || '对方').slice(0, 40),
      room,
      passphrase: String(passphrase || ''),
      relayKind: this.app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
      relayUrl: this.app.config.relayUrl || 'https://ntfy.sh',
      addedAt: existing?.addedAt || Date.now(),
    }
    this.list = [entry, ...this.list.filter((item) => item.id !== id)]
    this.save()
    return entry
  }

  /** 切到某个会话。 */
  async switchTo(id) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    await this.app.updateConfig({
      room: entry.room,
      passphrase: entry.passphrase || '',
      relayKind: entry.relayKind,
      relayUrl: entry.relayUrl,
    })
    return entry
  }

  rename(id, title) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    entry.title = String(title || '').trim().slice(0, 40) || titleOf(entry)
    this.save()
    return entry
  }

  /** 退出会话：从列表移除；若退出的是当前会话，尽量切到下一个，否则新建一个群聊。 */
  async leave(id) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    this.list = this.list.filter((item) => item.id !== id)
    this.save()
    if (this.app.room !== entry.room) return undefined
    const next = this.list[0]
    if (next) return this.switchTo(next.id)
    return this.createGroup('新群聊')
  }

  /** 本地预览：最后一条消息 + 未读数（不联网）。 */
  previewOf(entry) {
    const topic = deriveTopic(entry.room, entry.passphrase || '')
    const messages = this.store.loadMessages(topic, 60)
    const last = messages.length > 0 ? messages[messages.length - 1] : null
    const read = this.store.loadReadState()[topic] || {}
    const cursor = Number(read.human) || 0
    let unread = 0
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.seq <= cursor) break
      if (!message.mine) unread += 1
    }
    return {
      lastText: last ? String(last.text || '').replace(/\s+/g, ' ').slice(0, 60) : '',
      lastTs: last ? Number(last.ts) || 0 : 0,
      lastNick: last ? String(last.nick || '') : '',
      lastMine: last ? last.mine === true : false,
      unread,
    }
  }

  snapshot() {
    this.ensureCurrent()
    return {
      currentRoom: this.app.room,
      chats: this.list.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: titleOf(entry),
        room: entry.room,
        peerId: entry.peerId,
        active: entry.room === this.app.room,
        ...this.previewOf(entry),
      })),
    }
  }
}
