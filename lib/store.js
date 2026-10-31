/**
 * dsh-chat-plugin — 本地持久化。
 *
 * 目录：$DSH_HOME/dsh-chat/（默认 ~/.dsh/dsh-chat-plugin/）
 *  - config.json                 本机身份与房间设置（UI 保存，优先级高于 cordis.patch.yml）
 *  - messages-<topic>.jsonl      每个房间一份聊天记录（按行 append，重启后仍能往上翻）
 * @module dsh-chat-plugin/store
 */
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

/** 运行期默认配置；peerId 由 ChatStore/PeerChat 首次运行时生成。 */
export const DEFAULT_CONFIG = {
  peerId: '',
  agentId: '',
  nickname: '',
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
