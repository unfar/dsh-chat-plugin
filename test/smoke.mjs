/**
 * dsh Chat — 离线冒烟测试（不联网、不需要 dsh 运行时）。
 *
 * 覆盖：房间状态机、AES-256-GCM 加解密、ask 等待者、工具 schema、HTTP 路由、
 * agent 自动回复的门控（mention / via=agent 防互刷）与回复回填。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-chat-plugin-smoke-'))

const { PeerChat } = await import('../lib/peerchat.js')
const { Chats } = await import('../lib/chats.js')
const { registerTools } = await import('../lib/tools.js')
const { registerRoutes } = await import('../lib/routes.js')
const { AgentReplier } = await import('../lib/agent-reply.js')
const { seal, open, deriveTopic, sealBuffer, openBuffer } = await import('../lib/crypto.js')
const { encodeInvite, decodeInvite } = await import('../lib/invite.js')
const { externalPeerId } = await import('../lib/bridge.js')
const { directoryTopic, inboxTopic, sealPresence, openPresence, sealConnect, openConnect } = await import('../lib/social.js')
const { ChatStore } = await import('../lib/store.js')

const logger = { info() {}, warn() {}, error() {}, debug() {} }
let passed = 0
const check = (condition, label) => {
  assert.ok(condition, label)
  passed += 1
  console.log('ok -', label)
}

// ---------- crypto ----------
const key = Buffer.alloc(32, 7)
const sealed = seal({ v: 1, text: '你好 dsh Chat' }, key)
check(sealed.startsWith('dshpc1:'), 'seal() produces v1 ciphertext envelope')
check(open(sealed, key).text === '你好 dsh Chat', 'open() round-trips payload')
check(deriveTopic('room', 'pw') === deriveTopic('room', 'pw'), 'topic derivation is deterministic')
check(deriveTopic('room', 'pw') !== deriveTopic('room', 'other'), 'different passphrase → different topic')

// 附件二进制加解密
const rawBytes = Buffer.from('attachment-bytes-你好')
const sealedBytes = sealBuffer(rawBytes, key)
check(!sealedBytes.equals(rawBytes) && sealedBytes.length === rawBytes.length + 28, 'sealBuffer adds iv+tag')
check(openBuffer(sealedBytes, key).equals(rawBytes), 'openBuffer round-trips attachment bytes')
assert.throws(() => openBuffer(sealedBytes, Buffer.alloc(32, 9)), /附件|unable|auth/i)
check(true, 'openBuffer rejects a wrong key')

// ---------- invite code ----------
const invite = encodeInvite({ room: 'team', passphrase: 'pw', relayKind: 'ntfy', relayUrl: 'https://ntfy.sh' })
check(invite.startsWith('dshchat1:'), 'invite code carries dshchat1: prefix')
const decodedInvite = decodeInvite(invite)
check(decodedInvite.room === 'team' && decodedInvite.passphrase === 'pw', 'invite code round-trips room + passphrase')
assert.throws(() => decodeInvite('dshchat1:not-base64!!!'), /邀请码/)
check(true, 'malformed invite code is rejected')

// ---------- external agent bridge ----------
check(externalPeerId('Hermes') === externalPeerId(' hermes '), 'external peer id is stable and case-insensitive')
check(externalPeerId('Hermes') !== externalPeerId('WorkBuddy'), 'different external agents get different ids')
check(externalPeerId('Hermes').startsWith('ext-'), 'external peer id has ext- prefix')

// ---------- social discovery ----------
const selfId = 'abc12345'
const otherId = 'zzz99999'
check(directoryTopic() === directoryTopic(), 'directory topic is deterministic')
check(inboxTopic(selfId) !== inboxTopic(otherId), 'each peer id gets its own inbox topic')
const presenceBody = sealPresence({ id: selfId, nick: 'Tester' })
const presence = openPresence(presenceBody)
check(presence?.id === selfId && presence?.nick === 'Tester', 'presence card round-trips')
const connectBody = sealConnect(otherId, { from: { id: selfId, nick: 'Tester' }, room: { name: 'dm-1', passphrase: 'pw' } })
check(openConnect(otherId, connectBody)?.room?.name === 'dm-1', 'connect packet opens only for the target inbox')
check(openConnect(selfId, connectBody) === null, 'connect packet is not readable by another peer id')

// ---------- store ----------
const store = new ChatStore()
store.saveConfig({ peerId: 'abc', room: 'r' })
check(store.loadConfig().peerId === 'abc', 'config persists')

// ---------- chats ----------
const chatsApp = {
  room: 'room-a',
  config: { passphrase: 'pw', relayKind: 'ntfy', relayUrl: 'https://ntfy.sh' },
  async updateConfig(patch) {
    Object.assign(this.config, patch)
    this.room = patch.room || this.room
    return this.getState ? this.getState() : {}
  },
}
const chats = new Chats({ app: chatsApp, store })
chats.ensureCurrent()
let snapshotChats = chats.snapshot()
check(snapshotChats.chats.length === 1 && snapshotChats.chats[0].room === 'room-a', 'ensureCurrent registers the active room')
const created = await chats.createGroup('测试群')
check(created.kind === 'group' && created.room.startsWith('grp-'), 'createGroup makes a random group room')
check(chatsApp.room === created.room, 'createGroup switches the active room')
chats.addDm({ peerId: 'peer-x', nick: 'Alice', room: 'dm-1', passphrase: 'pw' })
check(chats.snapshot().chats.some((chat) => chat.id === 'dm:peer-x'), 'addDm registers a DM chat')
chats.rename(created.id, '改名群')
check(chats.get(created.id).title === '改名群', 'rename updates chat title')
await chats.leave(created.id)
check(!chats.get(created.id), 'leave removes the chat from the list')


// ---------- room state machine ----------
const app = new PeerChat({
  ctx: { logger },
  config: { room: 'smoke-' + Date.now(), passphrase: 'pw', nickname: 'Tester', enabled: false },
})
app.start()
check(app.encrypted === true, 'room is encrypted when passphrase is set')

const hooks = []
app.onPeerMessage = (message) => hooks.push(message)
const inbound = seal({
  v: 1,
  id: 'inbound-1',
  from: 'peer-a',
  nick: 'Peer A',
  ts: Date.now(),
  kind: 'message',
  text: 'hello from peer',
}, app.key)
app.onInbound({ body: inbound })
check(hooks.length === 1 && hooks[0].text === 'hello from peer', 'inbound message reaches onPeerMessage hook')
check(app.countUnread('human') === 1, 'unread counter increments')
app.markRead(app.seq, 'human')
check(app.countUnread('human') === 0, 'human read cursor advances')
check(app.countUnread('agent') === 1, 'agent read cursor is independent')

// ---------- read receipts ----------
const receiptBody = seal(
  { v: 1, id: 'receipt-1', from: 'peer-a', nick: 'Peer A', ts: Date.now(), kind: 'read', seq: 2 },
  app.key,
)
app.onInbound({ body: receiptBody })
check(app.getState().readReceipts['peer-a'] === 2, 'read receipt updates peer cursor')

// ---------- reactions ----------
app.applyReaction({ messageId: 'msg-x', emoji: '👍', from: 'peer-a' })
app.applyReaction({ messageId: 'msg-x', emoji: '👍', from: app.me.id })
let chips = app.getState().reactions['msg-x']
check(chips.length === 1 && chips[0].count === 2 && chips[0].mine === true, 'reactions aggregate + mine flag')
app.applyReaction({ messageId: 'msg-x', emoji: '👍', from: 'peer-a', add: false })
chips = app.getState().reactions['msg-x']
check(chips[0].count === 1, 'reaction removal updates count')
const reactionBody = seal({ v: 1, id: 'react-1', from: 'peer-b', nick: 'Peer B', ts: Date.now(), kind: 'reaction', to: 'msg-y', emoji: '🎉', add: true }, app.key)
app.onInbound({ body: reactionBody })
check(app.getState().reactions['msg-y']?.[0]?.emoji === '🎉', 'inbound reaction envelope is applied')

// typing 是瞬时状态：不产生消息、不进未读
const typingBody = seal({ v: 1, id: 'typing-1', from: 'peer-a', nick: 'Peer A', ts: Date.now(), kind: 'typing' }, app.key)
const beforeCount = app.messages.length
app.onInbound({ body: typingBody })
const typingState = app.getState()
check(app.messages.length === beforeCount, 'typing event does not create a message')
check(typingState.typing.length === 1 && typingState.typing[0].nick === 'Peer A', 'typing state is exposed to the UI')

// 邀请码来自当前房间
check(decodeInvite(app.inviteCode()).room === app.room, 'inviteCode() encodes the current room')

// ---------- tools ----------
const tools = []
registerTools({ logger, tools: { register: (definition) => { tools.push(definition); return () => {} } } }, app)
check(
  tools.map((tool) => tool.name).join(',') === 'chat_send,chat_read,chat_ask,chat_dispatch,chat_status',
  'five chat_* tools register',
)
for (const tool of tools) {
  assert.equal(tool.parameters.type, 'object')
  assert.ok(tool.output?.schema && typeof tool.output.render === 'function')
}
check(true, 'tool schemas carry output schema + render')

// ---------- HTTP routes ----------
let route
const ctx = {
  logger,
  get: (name) => (name === 'webServer' ? { register: (registered) => { route = registered; return () => {} } } : undefined),
}
registerRoutes(ctx, app)
check(route?.kind === 'prefix' && route?.path === '/dsh-chat-plugin/api', 'HTTP API route registered')

// ---------- agent auto-reply gating ----------
const fakeApp = {
  config: { agentAutoReply: true, agentMinIntervalMs: 0 },
  messages: [],
  room: 'smoke',
  topic: 'smoke',
  agentStatus: null,
  sent: [],
  async send(text, options) { this.sent.push({ text, options }); return { text } },
}
const replier = new AgentReplier({ ctx: { logger, get: () => undefined, on: () => () => {} }, app: fakeApp })
replier.start()
await replier.onPeerMessage({ id: 'm1', nick: 'B', text: 'no mention', mine: false, via: 'human' })
check(replier.pending === null && replier.lastReplyAt === 0, 'non-mention message does not trigger a reply')
replier.sessionId = 'chat:smoke'
replier.pending = { msgId: 'm2', nick: 'B', since: Date.now(), texts: [] }
replier.onSessionEvent({ id: 'chat:smoke' }, {
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text: 'pong' }] } },
})
replier.onSessionEvent({ id: 'chat:smoke' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
await new Promise((resolve) => setTimeout(resolve, 20))
check(fakeApp.sent.length === 1 && fakeApp.sent[0].text === 'pong', 'agent reply is posted back to the room')
check(fakeApp.sent[0].options.via === 'agent' && fakeApp.sent[0].options.replyTo === 'm2', 'reply marked via=agent with replyTo')

app.dispose()
console.log(`\n${passed} checks passed — dsh Chat smoke test OK`)
