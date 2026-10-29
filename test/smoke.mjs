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
const { registerTools } = await import('../lib/tools.js')
const { registerRoutes } = await import('../lib/routes.js')
const { AgentReplier } = await import('../lib/agent-reply.js')
const { seal, open, deriveTopic } = await import('../lib/crypto.js')
const { encodeInvite, decodeInvite } = await import('../lib/invite.js')
const { externalPeerId } = await import('../lib/bridge.js')
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

// ---------- store ----------
const store = new ChatStore()
store.saveConfig({ peerId: 'abc', room: 'r' })
check(store.loadConfig().peerId === 'abc', 'config persists')

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
  tools.map((tool) => tool.name).join(',') === 'chat_send,chat_read,chat_ask,chat_status',
  'four chat_* tools register',
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
