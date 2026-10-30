/**
 * dsh-chat MCP server 的离线冒烟测试。
 *
 * 起一个假的 bridge HTTP 服务 → 写临时 bridge.json → 用 stdio 启动 MCP server
 * → 依次验证 initialize / tools/list / tools/call(chat_send|chat_status)。
 *
 * 运行：node test/mcp-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const requests = []
const fake = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    requests.push({ method: req.method, path: url.pathname, body })
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname.endsWith('/info')) {
      return send({ ok: true, room: 'smoke-room', relay: 'ntfy', encrypted: true, latestSeq: 3 })
    }
    if (url.pathname.endsWith('/read')) {
      return send({
        ok: true,
        room: 'smoke-room',
        latestSeq: 3,
        messages: [
          { seq: 1, ts: 1000, nick: 'Alice', text: 'hello', via: 'human' },
          { seq: 2, ts: 2000, nick: 'MCP Agent', text: 'hi', via: 'bridge' },
        ],
        peers: [],
      })
    }
    if (url.pathname.endsWith('/send')) {
      return send({ ok: true, message: { seq: 4, ts: 3000, nick: 'MCP Agent', text: 'ok' } })
    }
    send({ ok: false, error: 'not found' })
  })
})
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const port = fake.address().port

const dir = mkdtempSync(join(tmpdir(), 'dsh-chat-mcp-'))
const bridgeFile = join(dir, 'bridge.json')
writeFileSync(bridgeFile, JSON.stringify({
  url: `http://127.0.0.1:${port}`,
  token: 'smoke-token',
  room: 'smoke-room',
}))

const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'mcp', 'server.mjs')], {
  env: { ...process.env, DSH_CHAT_BRIDGE: bridgeFile, DSH_CHAT_NICK: 'MCP Agent' },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const pending = new Map()
const lines = createInterface({ input: child.stdout })
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})

let nextId = 1
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 8000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
assert.equal(init.result.serverInfo.name, 'dsh-chat')
console.log('ok - initialize handshake')
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

const list = await rpc('tools/list', {})
const names = list.result.tools.map((tool) => tool.name)
assert.deepEqual(names.sort(), ['chat_dispatch', 'chat_read', 'chat_send', 'chat_status'])
console.log('ok - tools/list exposes 4 room tools')

const sent = await rpc('tools/call', { name: 'chat_send', arguments: { text: '来自 MCP 的测试消息' } })
assert.match(sent.result.content[0].text, /sent seq=4/)
assert.equal(requests.filter((r) => r.path.endsWith('/send')).length, 1)
assert.match(requests.find((r) => r.path.endsWith('/send')).body, /MCP 的测试消息/)
console.log('ok - tools/call chat_send forwards to the bridge API')

const status = await rpc('tools/call', { name: 'chat_status', arguments: {} })
assert.match(status.result.content[0].text, /smoke-room/)
console.log('ok - tools/call chat_status reads room info')

const read = await rpc('tools/call', { name: 'chat_read', arguments: { limit: 10 } })
assert.match(read.result.content[0].text, /Alice: hello/)
console.log('ok - tools/call chat_read formats room messages')

const unknown = await rpc('nope/method', {})
assert.equal(unknown.error.code, -32601)
console.log('ok - unknown method returns JSON-RPC error')

child.kill()
fake.close()
console.log('\nMCP smoke test passed')
