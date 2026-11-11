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
/** 每个会话最多置顶多少条消息。 */
const MAX_PINNED_MESSAGES = 20

function titleOf(entry) {
  return String(entry.title || entry.room || '群聊').slice(0, 40)
}

/** 规范化 entry.pinnedMessageIds：去重、丢弃非法值、最多 20 条（保持加入顺序）。 */
function pinnedIdsOf(entry) {
  const seen = new Set()
  const ids = []
  const raw = Array.isArray(entry?.pinnedMessageIds) ? entry.pinnedMessageIds : []
  for (const item of raw) {
    const messageId = String(item || '').trim()
    if (!messageId || seen.has(messageId)) continue
    seen.add(messageId)
    ids.push(messageId)
    if (ids.length >= MAX_PINNED_MESSAGES) break
  }
  return ids
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

  setGroupInfo(id, patch = {}) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    if (typeof patch.title === 'string' && patch.title.trim()) {
      entry.title = patch.title.trim().slice(0, 40)
    }
    if (typeof patch.description === 'string') {
      entry.description = patch.description.slice(0, 200)
    }
    this.save()
    return this.snapshot()
  }

  /** 设置群头像（文件元数据：{id,url,name,mime,size,encrypted}）。 */
  setGroupAvatar(id, file) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    entry.avatar = file || null
    this.save()
    return this.snapshot()
  }

  /** 设置成员角色（advisory）：admin / member。群主不可被降级。 */
  setMemberRole(id, peerId, role) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    const target = String(peerId || '')
    if (!target) throw new Error('缺少成员 id')
    if (entry.ownerId && target === entry.ownerId) throw new Error('不能修改群主角色')
    const admins = new Set(Array.isArray(entry.admins) ? entry.admins : [])
    if (role === 'admin') admins.add(target)
    else admins.delete(target)
    entry.admins = [...admins]
    this.save()
    return this.snapshot()
  }

  /** 收到远端群资料变更（同房间），更新标题/公告/群主/管理员/头像。 */
  applyRemoteGroupInfo({ room, title, description, ownerId, admins, avatar } = {}) {
    const entry = this.list.find((item) => item.room === room)
    if (!entry) return
    if (title) entry.title = String(title).slice(0, 40)
    if (typeof description === 'string') entry.description = String(description).slice(0, 200)
    if (typeof ownerId === 'string' && ownerId) entry.ownerId = ownerId
    if (Array.isArray(admins)) entry.admins = admins.map(String).slice(0, 50)
    if (avatar && typeof avatar === 'object') entry.avatar = avatar
    this.save()
  }

  /** 收到远端群头像。 */
  applyRemoteGroupAvatar({ room, file } = {}) {
    const entry = this.list.find((item) => item.room === room)
    if (!entry || !file || !file.id) return
    entry.avatar = file
    this.save()
  }

  setPinned(id, pinned) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    entry.pinned = pinned === true
    this.save()
    return this.snapshot()
  }

  setArchived(id, archived) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    entry.archived = archived === true
    this.save()
    return this.snapshot()
  }

  /** 某个会话已置顶的消息 id 列表（最多 20 条，保持置顶顺序）。 */
  getPinnedIds(id) {
    const entry = this.get(id)
    return entry ? pinnedIdsOf(entry) : []
  }

  /**
   * 置顶/取消置顶一条消息（去重、可逆、每会话最多 20 条，超出时挤掉最旧的）。
   * @param {string} id 会话 id
   * @param {string} messageId 消息 id
   * @param {boolean} [pinned] true=置顶，false=取消；默认置顶
   */
  pinMessage(id, messageId, pinned = true) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    const target = String(messageId || '').trim()
    if (!target) throw new Error('缺少消息 id')
    const ids = pinnedIdsOf(entry).filter((item) => item !== target)
    if (pinned !== false) ids.push(target)
    entry.pinnedMessageIds = ids.slice(-MAX_PINNED_MESSAGES)
    this.save()
    return this.snapshot()
  }

  /** 清空本机会话历史（不动其他设备/其他成员）。 */
  clearHistory(id) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    const topic = deriveTopic(entry.room, entry.passphrase || '')
    this.store.clearMessages(topic)
    if (this.app.room === entry.room && typeof this.app.loadRoom === 'function') {
      this.app.loadRoom()
    }
    this.save()
    return this.snapshot()
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
      ownerId: this.app.me ? this.app.me.id : '',
      admins: [],
      avatar: null,
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

  /** 会话免打扰：只影响提示/红点，不影响消息收取。 */
  /** 通知模式：all / mentions / mute（mute 同时写 muted=true）。 */
  setNotifyMode(id, mode) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    const next = mode === 'mentions' || mode === 'mute' ? mode : 'all'
    entry.notifyMode = next
    entry.muted = next === 'mute'
    this.save()
    return entry
  }

  setMuted(id, muted) {
    const entry = this.get(id)
    if (!entry) throw new Error('会话不存在')
    entry.muted = muted === true
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
        muted: entry.muted === true,
        notifyMode: entry.notifyMode || (entry.muted === true ? 'mute' : 'all'),
        pinned: entry.pinned === true,
        pinnedMessageIds: pinnedIdsOf(entry),
        description: String(entry.description || ''),
        avatar: entry.avatar || null,
        ownerId: String(entry.ownerId || ''),
        admins: Array.isArray(entry.admins) ? entry.admins : [],
        archived: entry.archived === true,
        active: entry.room === this.app.room,
        ...this.previewOf(entry),
      })).sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        if (left.active !== right.active) return left.active ? -1 : 1
        return Number(right.lastTs || 0) - Number(left.lastTs || 0)
      }),
    }
  }
}
