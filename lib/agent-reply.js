/**
 * dsh-chat-plugin — agent 自动回复（agent ⇄ agent 通信的核心）。
 *
 * 工作方式：
 *  1. 房间里收到别人发的、以 @chat / @agent / @ai / @bot 开头（或显式寻址 agent、
 *     或 peer agent 用 chat_ask 发来）的消息；
 *  2. 插件在后台创建一个专属 agent 会话（不打扰你正在进行的对话），把房间上下文
 *     和这条消息作为 user message 注入；
 *  3. 监听该会话的 assistant/message，把 agent 的最终回复发回房间（标记 via:"agent"）；
 *  4. 防刷屏：同一时间只处理一条、最小间隔、agent 发出的回复不会再触发回复
 *     （除非对方显式 @ 或 toAgent），所以两个 agent 不会无限互刷。
 *
 * 会话惰性创建，插件卸载时 dispose；所有失败只记录在 lastError，不影响收发消息。
 * @module dsh-chat-plugin/agent-reply
 */
import { randomUUID } from 'node:crypto'

/** 触发自动回复的称呼（行首 @chat / @agent / @ai / @bot）。 */
const MENTION_PATTERN = /^\s*@(chat|agent|ai|bot)\b/i

/** 自动回复会话最长等待时间（模型调用 + 工具调用的兜底上限）。 */
const REPLY_TIMEOUT_MS = 150000

/** 自动回复正文最大长度（中继单条上限）。 */
const MAX_REPLY_CHARS = 1000

/**
 * 组装注入给 agent 的 prompt。
 * @param {{nick: string, text: string}} msg
 * @param {import('./peerchat.js').PeerChat} app
 */
function buildPrompt(msg, app) {
  const recent = app.messages
    .slice(-6)
    .map((m) => `${m.mine ? '我' : m.nick}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
  return [
    `你是 dsh "${app.room}" 房间里的 agent。房间里有其他人/其他 dsh 的 agent，消息通过 dsh Chat 插件传递。`,
    '',
    '房间最近消息：',
    recent,
    '',
    `现在有人在房间里 @ 你（来自 ${msg.nick}）：`,
    msg.text,
    '',
    '请直接写出要发回房间的回复正文（会被自动发出去）：',
    '- 不要解释你在做什么，不要写"收到""好的我看看"之类的空话；',
    '- 不要使用 markdown 标题或代码围栏，最多 300 字；',
    '- 如果这条消息不需要回复，只输出单个字符 "-"。',
  ].join('\n')
}

export class AgentReplier {
  /**
   * @param {{ ctx: import('@deepseek-ai/cordis').Context, app: import('./peerchat.js').PeerChat }} options
   */
  constructor({ ctx, app }) {
    this.ctx = ctx
    this.app = app
    this.logger = ctx?.logger
    this.sessionId = ''
    this.handle = null
    this.pending = null
    this.timer = null
    this.lastReplyAt = 0
    this.lastError = null
    this.disposed = false
    /** UI/工具读取的运行时状态（由 app.getState 透出）。 */
    this.status = { autoReply: false, busy: false, lastError: null, replies: 0 }
    app.agentStatus = this.status
    // 由 PeerChat 在收到别人的消息后调用
    app.onPeerMessage = (msg) => {
      void this.onPeerMessage(msg)
    }
  }

  /** 订阅会话事件；返回清理函数。 */
  start() {
    const off = this.ctx.on?.('session/event', (session, event) => {
      try {
        this.onSessionEvent(session, event)
      } catch (error) {
        this.logger?.warn?.('dsh-chat: 处理会话事件失败', error)
      }
    })
    return () => {
      try {
        off?.()
      } catch {
        /* ignore */
      }
      this.dispose()
    }
  }

  enabled() {
    return this.app.config.agentAutoReply === true
  }

  dispose() {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = null
    const handle = this.handle
    this.handle = null
    if (handle) {
      void handle.dispose?.().catch(() => undefined)
    }
  }

  /**
   * 收到别人的消息：判断是否应该让本机 agent 回复。
   * @param {{id: string, nick: string, text: string, mine?: boolean, via?: string, toAgent?: boolean}} msg
   */
  async onPeerMessage(msg) {
    if (!msg || msg.mine || this.disposed) return
    this.status.autoReply = this.enabled()
    if (!this.enabled()) return
    // peer agent 的普通回复不再触发回复，避免两个 agent 无限互刷；
    // 显式寻址（toAgent）或带 @ 称呼才继续。
    const mentioned = MENTION_PATTERN.test(String(msg.text || ''))
    const addressedToAgent = msg.toAgent === true
    if (!mentioned && !addressedToAgent) return
    if (msg.via === 'agent' && !addressedToAgent) return
    if (this.pending) {
      this.logger?.info?.('dsh-chat: agent 正在回复上一条，跳过这条')
      return
    }
    const minInterval = Number(this.app.config.agentMinIntervalMs) || 4000
    if (Date.now() - this.lastReplyAt < minInterval) return
    try {
      await this.reply(msg, { addressedToAgent })
    } catch (error) {
      this.noteError(error instanceof Error ? error.message : String(error))
    }
  }

  async reply(msg, { addressedToAgent }) {
    const agents = this.ctx.get?.('agents')
    if (!agents) {
      this.noteError('agents 服务不可用，无法自动回复')
      return
    }
    const handle = await this.ensureAgent(agents)
    const prompt = buildPrompt({ nick: msg.nick, text: msg.text }, this.app)
    const userMessage = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }
    this.pending = {
      msgId: msg.id,
      nick: msg.nick,
      since: Date.now(),
      texts: [],
    }
    this.lastReplyAt = Date.now()
    this.status.busy = true
    this.timer = setTimeout(() => this.finish('timeout'), REPLY_TIMEOUT_MS)
    handle.agent.followup(userMessage)
    this.logger?.info?.(`dsh-chat: agent 开始回复 ${msg.nick} 的消息`)
  }

  /** 取或建本插件的专属 agent 会话（不挂到工作区，避免污染会话列表）。 */
  async ensureAgent(agents) {
    if (this.handle) return this.handle
    const selection = this.ctx.get?.('agentDefaultModel')?.currentSelection?.() || {}
    const agentOptions = {
      provider: this.app.config.agentProvider || selection.provider,
      model: this.app.config.agentModel || selection.model,
    }
    if (agentOptions.reasoningEffort === undefined && selection.reasoningEffort !== undefined) {
      agentOptions.reasoningEffort = selection.reasoningEffort
    }
    const preset = this.app.config.agentPreset || 'minimal'
    const cwd = this.app.config.agentCwd
      || this.ctx.get?.('workingDirectory')?.defaultDirectory
      || process.cwd()
    this.sessionId = this.sessionIdOf()
    const setup = async (agentCtx) => {
      const presets = this.ctx.get?.('agentPresets')
      if (presets) await presets.mount(agentCtx, preset)
    }
    let handle
    try {
      handle = await agents.create({
        sessionId: this.sessionId,
        meta: { cwd },
        agentOptions,
        setup,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 插件重载后这个隐藏会话还在持久化存储里：直接续上它，保持上下文。
      if (!/already exists|已存在|exists/i.test(message)) throw error
      try {
        handle = await agents.resume({
          resumeSessionId: this.sessionId,
          agentOptions,
          setup,
        })
        this.logger?.info?.(`dsh-chat: 已续上自动回复会话 ${this.sessionId}`)
      } catch (resumeError) {
        // 续不上就换一个全新会话，保证自动回复不因为旧会话损坏而彻底失效。
        this.sessionId = `${this.sessionIdOf()}:${Date.now()}`
        handle = await agents.create({
          sessionId: this.sessionId,
          meta: { cwd },
          agentOptions,
          setup,
        })
        this.logger?.warn?.(
          `dsh-chat: 续会话失败（${resumeError instanceof Error ? resumeError.message : String(resumeError)}），已新建 ${this.sessionId}`,
        )
      }
    }
    this.handle = handle
    this.logger?.info?.(`dsh-chat: 自动回复会话就绪 ${this.sessionId}（${agentOptions.provider}/${agentOptions.model}, preset=${preset}）`)
    return this.handle
  }

  sessionIdOf() {
    return `chat:${this.app.topic || 'room'}`
  }

  onSessionEvent(session, event) {
    if (!this.pending) return
    if (String(session?.id) !== String(this.sessionId)) return
    if (event.type === 'assistant/message') {
      const blocks = event.data?.message?.content
      if (!Array.isArray(blocks)) return
      const text = blocks
        .filter((block) => block && block.type === 'text')
        .map((block) => String(block.text || ''))
        .join('')
      if (text.trim()) this.pending.texts.push(text)
      return
    }
    if (event.type === 'turn/end') {
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        this.finish('error', reason?.error?.message)
      } else {
        this.finish('done')
      }
    }
  }

  async finish(why, detail) {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    this.status.busy = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (why === 'timeout') {
      this.noteError('自动回复超时（模型没有在 150s 内完成）')
      return
    }
    if (why === 'error') {
      this.noteError(`自动回复失败：${String(detail || '未知错误').slice(0, 200)}`)
      return
    }
    const text = pending.texts.join('\n').trim()
    if (!text || text === '-') return
    try {
      await this.app.send(text.slice(0, MAX_REPLY_CHARS), {
        via: 'agent',
        replyTo: pending.msgId,
      })
      this.status.replies += 1
      this.status.lastError = null
      this.logger?.info?.('dsh-chat: agent 回复已发回房间')
    } catch (error) {
      this.noteError(error instanceof Error ? error.message : String(error))
    }
  }

  noteError(message) {
    this.lastError = message
    this.status.lastError = message
    this.logger?.warn?.(`dsh-chat: ${message}`)
  }
}
