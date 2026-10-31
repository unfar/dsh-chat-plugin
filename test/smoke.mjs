/**
 * dsh Chat — 离线冒烟测试（不联网、不需要 dsh 运行时）。
 *
 * 覆盖：房间状态机、AES-256-GCM 加解密、ask 等待者、工具 schema、HTTP 路由、
 * agent 自动回复的门控（mention / via=agent 防互刷）与回复回填。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-chat-plugin-smoke-'))

const { PeerChat } = await import('../lib/peerchat.js')
const { Chats } = await import('../lib/chats.js')
const { registerTools } = await import('../lib/tools.js')
const { registerRoutes, searchMessages } = await import('../lib/routes.js')
const { AgentReplier } = await import('../lib/agent-reply.js')
const { seal, open, deriveTopic, sealBuffer, openBuffer } = await import('../lib/crypto.js')
const { generateAgentId, normalizeAgentId, formatAgentId } = await import('../lib/agentid.js')
const { encodeInvite, decodeInvite } = await import('../lib/invite.js')
const { externalPeerId } = await import('../lib/bridge.js')
const { directoryTopic, inboxTopic, sealPresence, openPresence, sealConnect, openConnect } = await import('../lib/social.js')
const { ChatStore, DEFAULT_CONFIG } = await import('../lib/store.js')

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

// Agent ID
const agentIdA = generateAgentId()
check(/^[2-9A-HJ-NP-Z]{8}$/.test(agentIdA), 'generateAgentId produces 8 chars of Crockford Base32')
check(new Set(Array.from({ length: 50 }, generateAgentId)).size === 50, 'agent ids are random (50 unique)')
check(normalizeAgentId('k7m2-qx9t') === 'K7M2QX9T', 'normalizeAgentId handles dashes + lowercase')
check(normalizeAgentId('K7M2QX9T') === 'K7M2QX9T', 'normalizeAgentId accepts canonical form')
check(normalizeAgentId('K7M2QX9') === '' && normalizeAgentId('K7M2QX9O') === '', 'normalizeAgentId rejects wrong length/letters')
check(formatAgentId('K7M2QX9T') === 'K7M2-QX9T', 'formatAgentId groups 4+4')

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
const presenceBody = sealPresence({ id: selfId, agentId: 'K7M2QX9T', nick: 'Tester' })
const presence = openPresence(presenceBody)
check(presence?.id === selfId && presence?.agentId === 'K7M2QX9T' && presence?.nick === 'Tester', 'presence card round-trips')
const connectBody = sealConnect(otherId, { from: { id: selfId, nick: 'Tester' }, room: { name: 'dm-1', passphrase: 'pw' } })
check(openConnect(otherId, connectBody)?.room?.name === 'dm-1', 'connect packet opens only for the target inbox')
check(openConnect(selfId, connectBody) === null, 'connect packet is not readable by another peer id')

// ---------- store ----------
const store = new ChatStore()
store.saveConfig({ peerId: 'abc', room: 'r' })
check(store.loadConfig().peerId === 'abc', 'config persists')

// 个人资料默认值 + 头像落盘
check(DEFAULT_CONFIG.avatar === '' && DEFAULT_CONFIG.status === '', 'profile config defaults avatar/status to empty strings')
const avatarFile = store.saveAvatar(Buffer.from('fake-png-bytes'), 'image/png')
check(/^avatar-[0-9a-f]{8}\.png$/.test(avatarFile), 'saveAvatar names the file avatar-<8hex>.<ext>')
check(existsSync(store.avatarPath(avatarFile)), 'avatarPath resolves the saved avatar file')
assert.throws(() => store.saveAvatar(Buffer.from('x'), 'text/plain'), /头像格式/)
check(true, 'saveAvatar rejects unsupported mime types')

// 编辑/撤回依赖的「整文件原子重写」
const rewriteTopic = deriveTopic('rewrite-room', 'pw')
store.appendMessage(rewriteTopic, { id: 'stale-1', seq: 1, text: 'should be gone' })
store.saveMessages(rewriteTopic, [
  { id: 'rw-1', seq: 1, text: 'first' },
  { id: 'rw-2', seq: 2, text: 'second' },
])
let rewritten = store.loadMessages(rewriteTopic)
check(rewritten.map((msg) => msg.id).join(',') === 'rw-1,rw-2', 'saveMessages atomically rewrites the JSONL record')
store.saveMessages(rewriteTopic, Array.from({ length: 450 }, (_, i) => ({ id: 'cap-' + i, seq: i + 1, text: 'm' + i })))
rewritten = store.loadMessages(rewriteTopic, 500)
check(rewritten.length === 400 && rewritten[0].id === 'cap-50', 'saveMessages keeps only the last 400 messages')

// ---------- global search (pure helper used by GET /search) ----------
store.saveMessages(deriveTopic('room-a', 'pw'), [
  { id: 's1', seq: 1, ts: 1000, nick: 'Alice', text: 'Hello SEARCH world' },
  { id: 's2', seq: 2, ts: 2000, nick: 'Bob', text: '附件', file: { id: 'f1', name: 'Quarterly-Report.pdf', url: 'https://example.com/x' } },
])
const searchList = [{ id: 'room:room-a', title: 'Room A', room: 'room-a', passphrase: 'pw' }]
const textHits = searchMessages({ list: searchList, store, query: 'search' })
check(textHits.messages.length === 1 && textHits.messages[0].chatId === 'room:room-a', 'global search matches message text case-insensitively')
check(textHits.messages[0].text.includes('SEARCH') && textHits.messages[0].chatTitle === 'Room A', 'search hits carry chatId/chatTitle/text fields')
const fileHits = searchMessages({ list: searchList, store, query: 'report' })
check(fileHits.messages[0]?.file?.name === 'Quarterly-Report.pdf', 'global search matches attachment file names')
const titleHits = searchMessages({ list: searchList, store, query: 'room a' })
check(titleHits.chats.length === 1 && titleHits.chats[0].id === 'room:room-a', 'global search returns matching chat titles')
const emptyHits = searchMessages({ list: [], store, query: 'x' })
check(emptyHits.messages.length === 0 && emptyHits.chats.length === 0, 'global search survives an empty chat list')

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
chats.setMuted('dm:peer-x', true)
check(chats.snapshot().chats.find((chat) => chat.id === 'dm:peer-x')?.muted === true, 'setMuted exposes muted in the chat snapshot')
check(store.loadChats().find((chat) => chat.id === 'dm:peer-x')?.muted === true, 'mute is persisted on the chats entry')
assert.throws(() => chats.setMuted('nope', true), /会话不存在/)
check(true, 'setMuted rejects unknown chats')
chats.setMuted('dm:peer-x', false)


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

// ---------- message management: edit / delete / forward ----------
app.pushMessage({ id: 'own-1', ts: Date.now(), from: app.me.id, nick: app.me.nick, text: 'original', mine: true, via: 'human' })
const editedOwn = await app.editMessage('own-1', 'updated text')
check(editedOwn.text === 'updated text' && editedOwn.edited === true, 'editMessage updates own message text')
await assert.rejects(() => app.editMessage('inbound-1', 'hijack'), /只能编辑自己的消息/)
check(true, 'editMessage refuses to edit a peer message')
await assert.rejects(() => app.editMessage('own-1', '   '), /消息不能为空/)
check(true, 'editMessage rejects empty text')

const inboundEdit = seal(
  { v: 1, id: 'inbound-edit-1', from: 'peer-a', nick: 'Peer A', ts: Date.now(), kind: 'edit', to: 'inbound-1', text: 'edited remotely' },
  app.key,
)
app.onInbound({ body: inboundEdit })
const remoteEdited = app.messages.find((message) => message.id === 'inbound-1')
check(remoteEdited?.text === 'edited remotely' && remoteEdited?.edited === true, 'inbound edit envelope updates the sender\'s message')
const spoofEdit = seal(
  { v: 1, id: 'inbound-edit-2', from: 'peer-b', nick: 'Peer B', ts: Date.now(), kind: 'edit', to: 'inbound-1', text: 'spoofed' },
  app.key,
)
app.onInbound({ body: spoofEdit })
check(app.messages.find((message) => message.id === 'inbound-1')?.text === 'edited remotely', 'inbound edit from a different peer is ignored')

const inboundDelete = seal(
  { v: 1, id: 'inbound-delete-1', from: 'peer-a', nick: 'Peer A', ts: Date.now(), kind: 'delete', to: 'inbound-1' },
  app.key,
)
app.onInbound({ body: inboundDelete })
const remoteDeleted = app.messages.find((message) => message.id === 'inbound-1')
check(remoteDeleted?.deleted === true && remoteDeleted?.text === '', 'inbound delete envelope tombstones the sender\'s message')
check(store.loadMessages(app.topic).find((message) => message.id === 'inbound-1')?.deleted === true, 'inbound edit/delete are persisted via saveMessages')

const deletedOwn = await app.deleteMessage('own-1')
check(deletedOwn.deleted === true && deletedOwn.text === '', 'deleteMessage tombstones own message')
await assert.rejects(() => app.deleteMessage('inbound-1'), /只能删除自己的消息/)
check(true, 'deleteMessage refuses to delete a peer message')

// forwardedFrom：发送端带上去、接收端原样保留
app.relay = { publish: async () => {} }
const forwarded = await app.send('forwarded content', { forwardedFrom: 'Peer A' })
check(forwarded.forwardedFrom === 'Peer A', 'send() carries forwardedFrom')
const inboundForwarded = seal(
  { v: 1, id: 'inbound-forward-1', from: 'peer-c', nick: 'Peer C', ts: Date.now(), kind: 'message', text: 'fw', forwardedFrom: 'Peer A' },
  app.key,
)
app.onInbound({ body: inboundForwarded })
check(app.messages.find((message) => message.id === 'inbound-forward-1')?.forwardedFrom === 'Peer A', 'inbound forwardedFrom is stored on the message')
const managementState = app.getState()
check(managementState.messages.find((message) => message.id === 'own-1')?.deleted === true, 'getState exposes deleted/edited flags as stored')
app.relay = null

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
registerRoutes(ctx, app, undefined, chats)
check(route?.kind === 'prefix' && route?.path === '/dsh-chat-plugin/api', 'HTTP API route registered')

// 直接调用路由 handler，校验 v2.0 新增接口的请求/响应形状。
const callApi = async (method, apiPath, { json, bytes, headers } = {}) => {
  const payload = bytes !== undefined
    ? Buffer.from(bytes)
    : json !== undefined ? Buffer.from(JSON.stringify(json), 'utf8') : Buffer.alloc(0)
  const req = new Readable({ read() {} })
  req.method = method
  req.url = '/dsh-chat-plugin/api' + apiPath
  req.headers = { 'content-length': String(payload.length), ...(headers || {}) }
  if (payload.length > 0) req.push(payload)
  req.push(null)
  const res = {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value },
    end(chunk) { if (chunk !== undefined) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)) },
  }
  await route.handler(req, res)
  let data = null
  try { data = JSON.parse(res.body.toString('utf8')) } catch { data = null }
  return { status: res.statusCode, headers: res.headers, body: res.body, data }
}

const profileRoute = await callApi('GET', '/profile')
check(
  profileRoute.status === 200 && profileRoute.data?.ok === true
    && profileRoute.data.me?.nick && profileRoute.data.settings?.avatar === '',
  'GET /profile returns { ok, me, settings }',
)
const profileUpdate = await callApi('POST', '/profile', { json: { nickname: 'Smoke Nick', status: 'testing 123' } })
check(
  profileUpdate.data?.me?.nick === 'Smoke Nick' && profileUpdate.data?.me?.status === 'testing 123',
  'POST /profile updates nickname + status',
)

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const noAvatar = await callApi('GET', '/avatar')
check(noAvatar.status === 404 && noAvatar.data?.ok === false, 'GET /avatar 404s when no avatar is configured')
const avatarUpload = await callApi('POST', '/avatar', { bytes: pngBytes, headers: { 'x-file-type': 'image/png' } })
check(
  avatarUpload.status === 200 && /^avatar-[0-9a-f]{8}\.png$/.test(avatarUpload.data?.avatar || ''),
  'POST /avatar stores the file and returns { ok, avatar }',
)
const avatarServed = await callApi('GET', '/avatar')
check(
  avatarServed.status === 200 && avatarServed.headers['content-type'] === 'image/png'
    && avatarServed.headers['cache-control'] === 'private, max-age=3600'
    && avatarServed.body.equals(pngBytes),
  'GET /avatar serves the binary with the right Content-Type',
)
const avatarState = app.getState()
check(
  avatarState.me.avatar === avatarUpload.data.avatar && avatarState.settings.status === 'testing 123',
  'getState exposes avatar + status in me/settings',
)

const searchRoute = await callApi('GET', '/search?q=search')
check(
  searchRoute.status === 200 && searchRoute.data?.query === 'search'
    && searchRoute.data.messages.some((message) => message.chatId === 'room:room-a'),
  'GET /search returns cross-chat message hits',
)
const searchEmpty = await callApi('GET', '/search?q=zzz-nothing-matches')
check(searchEmpty.status === 200 && searchEmpty.data.messages.length === 0, 'GET /search handles zero matches')

app.pushMessage({ id: 'route-own', ts: Date.now(), from: app.me.id, nick: app.me.nick, text: 'route old', mine: true, via: 'human' })
const editRoute = await callApi('POST', '/edit', { json: { id: 'route-own', text: 'route new' } })
check(
  editRoute.status === 200 && editRoute.data?.message?.text === 'route new' && editRoute.data.message.edited === true,
  'POST /edit edits own message',
)
const forbiddenEditRoute = await callApi('POST', '/edit', { json: { id: 'inbound-forward-1', text: 'nope' } })
check(forbiddenEditRoute.status === 400 && forbiddenEditRoute.data?.ok === false, 'POST /edit rejects peer messages')
const deleteRoute = await callApi('POST', '/delete', { json: { id: 'route-own' } })
check(deleteRoute.status === 200 && deleteRoute.data?.message?.deleted === true, 'POST /delete tombstones own message')

const muteRoute = await callApi('POST', '/chats/mute', { json: { id: 'dm:peer-x', muted: true } })
check(
  muteRoute.status === 200 && muteRoute.data?.chats?.find((chat) => chat.id === 'dm:peer-x')?.muted === true,
  'POST /chats/mute returns { ok, ...snapshot } with muted',
)
await callApi('POST', '/chats/mute', { json: { id: 'dm:peer-x', muted: false } })

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
