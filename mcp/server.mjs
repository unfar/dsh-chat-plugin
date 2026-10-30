#!/usr/bin/env node
/**
 * dsh-chat MCP server（stdio，JSON-RPC 2.0）。
 *
 * 让支持 MCP 的 agent（CodeBuddy/WorkBuddy、Hermes、Claude Code、Cursor 等）
 * 直接获得 dsh Chat 房间工具，不用装 CLI：
 *
 *   chat_send    发消息到房间（可指定昵称）
 *   chat_read    读房间最近消息
 *   chat_status  看房间/成员/中继状态
 *   chat_dispatch 把任务派给房间里某个具名 agent 并等结果
 *
 * 使用（CodeBuddy 示例）：
 *   codebuddy --mcp-config '{"mcpServers":{"dsh-chat":{"command":"node","args":["<绝对路径>/mcp/server.mjs"],"env":{"DSH_CHAT_NICK":"WorkBuddy"}}}}'
 *
 * 依赖插件已运行并生成 $DSH_HOME/dsh-chat/bridge.json（或用 DSH_CHAT_BRIDGE 指定）。
 * @module dsh-chat-plugin/mcp/server
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BRIDGE_FILE = process.env.DSH_CHAT_BRIDGE
  || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-chat', 'bridge.json')
const NICK = process.env.DSH_CHAT_NICK || 'MCP Agent'

let bridgeCache = null
async function loadBridge() {
  if (bridgeCache) return bridgeCache
  const raw = JSON.parse(await readFile(BRIDGE_FILE, 'utf8'))
  if (!raw?.url || !raw?.token) throw new Error(`${BRIDGE_FILE} 缺少 url/token`)
  bridgeCache = raw
  return raw
}

async function api(path, options = {}) {
  const bridge = await loadBridge()
  const response = await fetch(bridge.url + path, {
    method: options.method || 'GET',
    headers: {
      'x-dsh-chat-token': bridge.token,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

const TOOLS = [
  {
    name: 'chat_send',
    description: 'Send a message into the dsh Chat room (shared with other dsh installations and bridged agents).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text (under 1000 characters).' },
        nick: { type: 'string', description: `Sender nick shown in the room. Defaults to ${NICK}.` },
      },
      required: ['text'],
    },
  },
  {
    name: 'chat_read',
    description: 'Read recent messages from the dsh Chat room.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number', description: 'Only messages with seq greater than this. Default 0 = latest window.' },
        limit: { type: 'number', description: 'Max messages to return, default 20.' },
      },
    },
  },
  {
    name: 'chat_status',
    description: 'Inspect the dsh Chat room: room name, relay, encryption, latest sequence.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'chat_dispatch',
    description: 'Assign a task to one named agent in the room (e.g. Hermes) and wait for its reply. The target must be a bridged agent with its bridge daemon running.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Exact nick of the target agent in the room.' },
        text: { type: 'string', description: 'Task to assign.' },
        timeoutSec: { type: 'number', description: 'Wait timeout, default 100s, max 115.' },
      },
      required: ['agent', 'text'],
    },
  },
]

function formatMessages(messages) {
  return messages.map((message) => `[${message.seq}] ${new Date(message.ts).toISOString().slice(11, 19)} ${message.nick}: ${message.text}`).join('\n')
}

async function callTool(name, args = {}) {
  if (name === 'chat_send') {
    const value = String(args.text ?? '').trim()
    if (!value) throw new Error('text is required')
    const data = await api('/bridge/send', { method: 'POST', body: { nick: String(args.nick || NICK), text: value } })
    return text(`sent seq=${data.message.seq} as ${data.message.nick}`)
  }
  if (name === 'chat_read') {
    const since = Number(args.since) || 0
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
    const data = await api(`/bridge/read?since=${since}&limit=${limit}`)
    return text(`room=${data.room} latestSeq=${data.latestSeq}\n${formatMessages(data.messages)}`)
  }
  if (name === 'chat_status') {
    const info = await api('/bridge/info')
    return text({ ...info, bridgeFile: BRIDGE_FILE, nick: NICK })
  }
  if (name === 'chat_dispatch') {
    const agent = String(args.agent ?? '').trim()
    const value = String(args.text ?? '').trim()
    if (!agent || !value) throw new Error('agent and text are required')
    const timeoutSec = Math.min(Math.max(Number(args.timeoutSec) || 100, 5), 115)
    const startedAt = Date.now()
    await api('/bridge/send', {
      method: 'POST',
      body: { nick: NICK, text: `@${agent} ${value}`, toAgent: true },
    })
    const deadline = startedAt + timeoutSec * 1000
    while (Date.now() < deadline) {
      const data = await api('/bridge/read?since=0&limit=100')
      const reply = data.messages.find(
        (message) => message.nick === agent && Number(message.ts) >= startedAt && message.via !== 'human',
      )
      if (reply) {
        return text({ ok: true, from: reply.nick, text: reply.text, elapsedMs: Date.now() - startedAt })
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return text({ ok: false, error: `${agent} 在 ${timeoutSec}s 内没有回复（它的 bridge daemon 是否在运行？）` })
  }
  throw new Error(`未知工具：${name}`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handle(request) {
  const { id, method, params } = request
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-chat', version: '0.7.0' },
      },
    })
  }
  if (method === 'notifications/initialized' || method === 'initialized') return undefined
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      return send({ jsonrpc: '2.0', id, result })
    } catch (error) {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `错误：${error instanceof Error ? error.message : String(error)}` }], isError: true },
      })
    }
  }
  if (id !== undefined) {
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
  return undefined
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        const request = JSON.parse(line)
        void handle(request).catch((error) => {
          if (request?.id !== undefined) {
            send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error?.message || error) } })
          }
        })
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
