/**
 * dsh-chat-plugin — 给 agent 用的三个工具。
 *
 * 这样不仅人能聊天，两台 dsh 里的 agent 也能互相传话：
 *   chat_send  发一条消息给房间里的其他 dsh
 *   chat_read  读房间里最近的消息（可按 seq 增量读）
 *   chat_status 看房间/连接/在线成员
 * @module dsh-chat-plugin/tools
 */

const textOutput = (schemaDescription) => ({
  schema: { type: 'object', additionalProperties: true, description: schemaDescription },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

function formatMessage(msg) {
  return {
    seq: msg.seq,
    time: new Date(msg.ts).toISOString(),
    from: msg.mine ? 'me' : msg.nick || String(msg.from || '').slice(0, 6),
    peerId: msg.mine ? null : String(msg.from || '').slice(0, 6),
    text: msg.text,
    mine: Boolean(msg.mine),
    via: msg.via === 'agent' ? 'agent' : 'human',
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./peerchat.js').PeerChat} app
 * @returns {() => void} disposer
 */
export function registerTools(ctx, app) {
  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'chat_send',
    description: [
      'Send a message into the dsh peer-chat room this installation has joined.',
      'The other dsh installations that installed the same plugin and configured the same room (and passphrase) receive it, and their agents can read it with chat_read.',
      'Use it when the user asks you to tell/notify/ask someone on another dsh, or to coordinate with a peer agent.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Message body. Keep it under 1000 characters and prefer short, self-contained text.',
        },
      },
      required: ['text'],
    },
    output: textOutput('Send result: { ok, message: { seq, ts, from, nick, text } }.'),
    async execute(args) {
      const message = await app.send(args?.text)
      return { ok: true, message: formatMessage(message) }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'chat_read',
    description: [
      'Read recent messages from the dsh peer-chat room (a chat shared by every dsh installation that joined the same room).',
      'Messages come from other people and from other dsh agents. Use sinceSeq with the latest seq you already saw to fetch only new messages, or omit it to get the most recent ones.',
      'Reading marks the messages as read for you, so they stop appearing as unread in your system prompt.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many recent messages to return, default 20, max 100.',
        },
        sinceSeq: {
          type: 'number',
          description: 'Only return messages with seq greater than this value (incremental read).',
        },
      },
    },
    output: textOutput('Room snapshot: { room, connected, peers: [{ id, nick, label, online, lastSeen }], messages: [{ seq, time, from, peerId, text, mine }], latestSeq }.'),
    async execute(args) {
      const state = app.getState()
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100)
      const since = Number(args?.sinceSeq)
      const pool = Number.isFinite(since)
        ? state.messages.filter((msg) => msg.seq > since)
        : state.messages.slice(-limit)
      // agent 读了就算已读，避免同一个未读提示在每轮 system prompt 里重复出现。
      app.markRead(state.latestSeq, 'agent')
      return {
        room: state.room,
        connected: state.connected,
        peers: state.peers.map((peer) => ({
          id: peer.id,
          nick: peer.nick,
          label: peer.label,
          online: peer.online,
          lastSeen: new Date(peer.lastSeen).toISOString(),
        })),
        messages: pool.map(formatMessage),
        latestSeq: state.latestSeq,
      }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'chat_ask',
    description: [
      'Ask another dsh agent in the dsh Chat room and wait for its reply (agent-to-agent RPC).',
      'The message is delivered to every dsh installation in the room; the peer that has agent auto-reply enabled wakes its agent and answers back.',
      'Use it when you need information or an action from the peer agent, then keep the returned answer in context. Returns { ok, from, text, via } or { ok:false, error } on timeout.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The question or request to send to the peer agent. Under 1000 characters.',
        },
        timeoutSec: {
          type: 'number',
          description: 'How long to wait for the reply in seconds. Default 60, max 140.',
        },
      },
      required: ['text'],
    },
    output: textOutput('Ask result: { askId, ok, from, text, via } or { askId, ok:false, error }.'),
    async execute(args) {
      const text = String(args?.text ?? '')
      if (!text.trim()) throw new Error('text is required')
      const timeoutSec = Math.min(Math.max(Number(args?.timeoutSec) || 60, 5), 140)
      return app.ask(text.trim(), { timeoutMs: timeoutSec * 1000 })
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'chat_status',
    description: 'Inspect the dsh peer-chat room: my nickname and peer id, room name, relay and encryption state, connection status, and who is online. Read-only.',
    parameters: { type: 'object', properties: {} },
    output: textOutput('Peer-chat status: { me, room, connected, encrypted, relay, peers, lastError }.'),
    async execute() {
      const state = app.getState()
      return {
        me: state.me,
        room: state.room,
        connected: state.connected,
        encrypted: state.relay.encrypted,
        relay: state.relay,
        peers: state.peers.map((peer) => ({
          id: peer.id,
          nick: peer.nick,
          label: peer.label,
          online: peer.online,
        })),
        unread: state.agentUnread,
        agent: state.agent,
        lastError: state.lastError,
      }
    },
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
  }
}
