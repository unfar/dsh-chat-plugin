#!/usr/bin/env node
/**
 * dsh-chat-plugin 极简自建中继（可选）。
 *
 * 不开源服务也能用公共 ntfy.sh；想要不依赖第三方、长期稳定地给团队用，
 * 就把这个文件丢到任意一台有 Node 的机器上跑起来：
 *
 *   PORT=8787 node relay.mjs
 *
 * 然后在插件设置里把「中继类型」改成 custom，「中继地址」填 http://<这台机器>:8787
 * （公网使用请放在 Caddy/Nginx 的 HTTPS 后面，协议本身不需要 TLS，请用反代提供）。
 *
 * 协议（两条 HTTP 接口，数据只是字符串，端到端加密在客户端做）：
 *   POST /publish/:topic        body: {"message":"..."} → {"id","ts","message"}
 *   GET  /subscribe/:topic      ?since=all|<毫秒时间戳> → NDJSON 长连接，每行一条消息
 *   GET  /health                → {"ok":true,"topics":N}
 *
 * 内存里每个主题保留最近 500 条 / 24 小时；不落盘、不鉴权——口令/加密在客户端，
 * 所以中继本身看到的内容是不可读的密文（前提是设置了房间口令）。
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_BODY_BYTES = 64 * 1024
const MAX_MESSAGES_PER_TOPIC = 500
const TTL_MS = 24 * 60 * 60 * 1000
const HEARTBEAT_MS = 25 * 1000

/** @type {Map<string, { messages: Array<{id:string,ts:number,message:string}>, subscribers: Set<import('node:http').ServerResponse>, touched: number }>} */
const topics = new Map()

function topicEntry(name) {
  let entry = topics.get(name)
  if (!entry) {
    entry = { messages: [], subscribers: new Set(), touched: Date.now() }
    topics.set(name, entry)
  }
  entry.touched = Date.now()
  return entry
}

function trim(entry) {
  if (entry.messages.length > MAX_MESSAGES_PER_TOPIC) {
    entry.messages.splice(0, entry.messages.length - MAX_MESSAGES_PER_TOPIC)
  }
}

function broadcast(entry, payload) {
  const line = `${JSON.stringify(payload)}\n`
  for (const res of entry.subscribers) {
    try {
      res.write(line)
    } catch {
      entry.subscribers.delete(res)
    }
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && parts[0] === 'health') {
    return json(res, 200, { ok: true, topics: topics.size, uptime: process.uptime() })
  }

  if (req.method === 'POST' && parts[0] === 'publish' && parts[1]) {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const message = typeof parsed?.message === 'string' ? parsed.message : ''
      if (!message) return json(res, 400, { ok: false, error: 'message required' })
      const payload = { id: randomUUID(), ts: Date.now(), message }
      const entry = topicEntry(parts[1])
      entry.messages.push(payload)
      trim(entry)
      broadcast(entry, payload)
      return json(res, 200, payload)
    } catch (error) {
      return json(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad request' })
    }
  }

  if (req.method === 'GET' && parts[0] === 'subscribe' && parts[1]) {
    const entry = topicEntry(parts[1])
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    })
    const sinceParam = url.searchParams.get('since')
    const cutoff = sinceParam === 'all' || !sinceParam ? 0 : Number(sinceParam) || 0
    for (const msg of entry.messages) {
      if (msg.ts > cutoff) res.write(`${JSON.stringify(msg)}\n`)
    }
    entry.subscribers.add(res)
    const heartbeat = setInterval(() => {
      try {
        res.write('\n')
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      entry.subscribers.delete(res)
    })
    return undefined
  }

  return json(res, 404, { ok: false, error: 'not found' })
})

setInterval(() => {
  const now = Date.now()
  for (const [name, entry] of topics) {
    if (entry.subscribers.size === 0 && now - entry.touched > TTL_MS) topics.delete(name)
  }
}, 60 * 1000).unref?.()

server.listen(PORT, HOST, () => {
  console.log(`[dsh-chat-plugin] relay listening on http://${HOST}:${PORT}`)
  console.log('[dsh-chat-plugin] plugin setting: relayKind=custom, relayUrl=http://<host>:' + PORT)
})
