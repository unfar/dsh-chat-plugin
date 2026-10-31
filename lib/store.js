/**
 * dsh-chat-plugin — 本地持久化。
 *
 * 目录：$DSH_HOME/dsh-chat/（默认 ~/.dsh/dsh-chat-plugin/）
 *  - config.json                 本机身份与房间设置（UI 保存，优先级高于 cordis.patch.yml）
 *  - messages-<topic>.jsonl      每个房间一份聊天记录（按行 append，重启后仍能往上翻）
 * @module dsh-chat-plugin/store
 */
import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 每个房间消息记录最多保留的条数（与 PeerChat 内存上限一致）。 */
const MAX_STORED_MESSAGES = 400

/** 头像允许的 MIME → 扩展名映射。 */
const AVATAR_EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

/** 运行期默认配置；peerId 由 ChatStore/PeerChat 首次运行时生成。 */
export const DEFAULT_CONFIG = {
  peerId: '',
  agentId: '',
  nickname: '',
  // 个人资料：头像文件名（存在 avatars/ 目录）与个性签名。
  avatar: '',
  status: '',
  room: 'lobby',
  passphrase: '',
  relayKind: 'ntfy',
  relayUrl: 'https://ntfy.sh',
  enabled: true,
  // agent 自动回复（agent ⇄ agent 通信）：默认关闭，收到 @chat 时由本机 agent 回复。
  agentAutoReply: false,
  agentPreset: 'minimal',
  agentModel: '',
  agentProvider: '',
  agentMinIntervalMs: 4000,
  // 社交发现：出现在公共目录，别人可以搜到你并直接发起连接。
  discoverable: false,
  discoverHeartbeatMs: 600000,
  // 是否已完成首次使用引导（引导只在全新安装时自动弹出）。
  onboarded: false,
}

/** 本插件的状态目录。 */
export function stateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-chat')
}

export class ChatStore {
  /** @param {string} [dir] */
  constructor(dir = stateDir()) {
    this.dir = dir
    mkdirSync(this.dir, { recursive: true })
    this.configPath = join(this.dir, 'config.json')
    this.filesDir = join(this.dir, 'files')
    mkdirSync(this.filesDir, { recursive: true })
    this.avatarsDir = join(this.dir, 'avatars')
    mkdirSync(this.avatarsDir, { recursive: true })
  }

  /** 附件本地缓存路径（发送方原文件 / 接收方解密后的缓存）。 */
  fileCachePath(id, name) {
    const safe = String(name || 'file')
      .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
      .slice(0, 80)
      .replace(/^_+|_+$/g, '') || 'file'
    return join(this.filesDir, `${String(id).replace(/[^\w-]/g, '')}-${safe}`)
  }

  /**
   * 读取保存的配置；文件不存在或损坏时返回 {}（由调用方与默认值/patch 合并）。
   * @returns {Partial<typeof DEFAULT_CONFIG>}
   */
  loadConfig() {
    try {
      if (!existsSync(this.configPath)) return {}
      const parsed = JSON.parse(readFileSync(this.configPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return {}
      return parsed
    } catch {
      return {}
    }
  }

  /** 原子写入配置（写临时文件再 rename）。 */
  saveConfig(config) {
    const tmp = `${this.configPath}.tmp`
    writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
    renameSync(tmp, this.configPath)
  }

  /** @param {string} topic */
  messagesPath(topic) {
    return join(this.dir, `messages-${topic}.jsonl`)
  }

  /**
   * 读取某个房间最近若干条消息，按 seq 升序返回。
   * @param {string} topic
   * @param {number} [limit]
   */
  loadMessages(topic, limit = 400) {
    const path = this.messagesPath(topic)
    try {
      if (!existsSync(path)) return []
      const lines = readFileSync(path, 'utf8').split('\n')
      const out = []
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const line = lines[i].trim()
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg && typeof msg.text === 'string' && typeof msg.id === 'string') out.push(msg)
        } catch {
          /* 跳过损坏行 */
        }
      }
      out.reverse()
      out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      return out
    } catch {
      return []
    }
  }

  /** 追加一条消息到房间记录。 */
  appendMessage(topic, msg) {
    try {
      appendFileSync(this.messagesPath(topic), `${JSON.stringify(msg)}\n`, 'utf8')
    } catch {
      /* 记录失败不应影响收发 */
    }
  }

  /**
   * 原子重写某个房间的消息记录（编辑/删除消息后用），只保留最近 400 条。
   * 先写临时文件再 rename，避免写到一半崩溃留下半截 JSONL。
   * @param {string} topic
   * @param {object[]} messages
   */
  saveMessages(topic, messages) {
    try {
      const list = Array.isArray(messages) ? messages.slice(-MAX_STORED_MESSAGES) : []
      const path = this.messagesPath(topic)
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${path}.tmp`
      const body = list.length > 0 ? `${list.map((msg) => JSON.stringify(msg)).join('\n')}\n` : ''
      writeFileSync(tmp, body, 'utf8')
      renameSync(tmp, path)
    } catch {
      /* 重写失败不应影响收发 */
    }
  }

  /**
   * 保存头像二进制，返回落盘的文件名（形如 avatar-1a2b3c4d.png）。
   * 只接受 png/jpg/webp/gif/svg，其余格式抛错。
   * @param {Buffer|Uint8Array} buffer
   * @param {string} mime
   * @returns {string}
   */
  saveAvatar(buffer, mime) {
    const key = String(mime || '').split(';')[0].trim().toLowerCase()
    const ext = AVATAR_EXT_BY_MIME[key]
    if (!ext) throw new Error('头像格式不支持（仅支持 png/jpg/webp/gif/svg）')
    const data = Buffer.from(buffer || [])
    if (data.length === 0) throw new Error('头像内容为空')
    mkdirSync(this.avatarsDir, { recursive: true })
    const file = `avatar-${randomBytes(4).toString('hex')}.${ext}`
    writeFileSync(join(this.avatarsDir, file), data)
    return file
  }

  /** 头像文件名 → 本地绝对路径。 */
  avatarPath(file) {
    return join(this.avatarsDir, String(file || '').replace(/[^\w.-]/g, ''))
  }

  /** 已读游标：{ "<topic>": { human: seq, agent: seq } }。 */
  readPath() {
    return join(this.dir, 'read.json')
  }

  loadReadState() {
    try {
      if (!existsSync(this.readPath())) return {}
      const parsed = JSON.parse(readFileSync(this.readPath(), 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  saveReadState(state) {
    try {
      const tmp = `${this.readPath()}.tmp`
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      renameSync(tmp, this.readPath())
    } catch {
      /* ignore */
    }
  }

  contactsPath() {
    return join(this.dir, 'contacts.json')
  }

  /** 通讯录：[{ id, nick, room, passphrase, relayKind, relayUrl, addedAt }]。 */
  loadContacts() {
    try {
      if (!existsSync(this.contactsPath())) return []
      const parsed = JSON.parse(readFileSync(this.contactsPath(), 'utf8'))
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.room === 'string') : []
    } catch {
      return []
    }
  }

  saveContacts(contacts) {
    try {
      const tmp = `${this.contactsPath()}.tmp`
      writeFileSync(tmp, JSON.stringify(contacts, null, 2), 'utf8')
      renameSync(tmp, this.contactsPath())
    } catch {
      /* ignore */
    }
  }

  reactionsPath(topic) {
    return join(this.dir, `reactions-${topic}.json`)
  }

  /** 表情回应：{ [messageId]: { [emoji]: [peerId, ...] } }。 */
  loadReactions(topic) {
    try {
      const path = this.reactionsPath(topic)
      if (!existsSync(path)) return {}
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  saveReactions(topic, reactions) {
    try {
      const path = this.reactionsPath(topic)
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(reactions), 'utf8')
      renameSync(tmp, path)
    } catch {
      /* ignore */
    }
  }

  chatsPath() {
    return join(this.dir, 'chats.json')
  }

  /** 会话列表（DM / 群聊）：[{ id, kind, title, room, passphrase, relayKind, relayUrl, peerId?, addedAt }]。 */
  loadChats() {
    try {
      if (!existsSync(this.chatsPath())) return []
      const parsed = JSON.parse(readFileSync(this.chatsPath(), 'utf8'))
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.room === 'string') : []
    } catch {
      return []
    }
  }

  saveChats(chats) {
    try {
      const tmp = `${this.chatsPath()}.tmp`
      writeFileSync(tmp, JSON.stringify(chats, null, 2), 'utf8')
      renameSync(tmp, this.chatsPath())
    } catch {
      /* ignore */
    }
  }

  inboxPath() {
    return join(this.dir, 'inbox.json')
  }

  /** 收到的连接请求：[{ id, fromId, fromNick, room, passphrase, at }]。 */
  loadInbox() {
    try {
      if (!existsSync(this.inboxPath())) return []
      const parsed = JSON.parse(readFileSync(this.inboxPath(), 'utf8'))
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.room?.name) : []
    } catch {
      return []
    }
  }

  saveInbox(items) {
    try {
      const tmp = `${this.inboxPath()}.tmp`
      writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8')
      renameSync(tmp, this.inboxPath())
    } catch {
      /* ignore */
    }
  }
}
