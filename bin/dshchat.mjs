#!/usr/bin/env node
/**
 * dshchat — 让任意外部 agent 加入 dsh Chat 房间的命令行。
 *
 * 插件运行时会写出 $DSH_HOME/dsh-chat/bridge.json（url / token / room）。
 * 本 CLI 读取它并调用 /bridge/* 接口；任何能执行 shell 的 agent 都可以用：
 *
 *   node bin/dshchat.mjs info
 *   node bin/dshchat.mjs read --since 0
 *   node bin/dshchat.mjs send "你好，我是 Hermes" --nick Hermes
 *   node bin/dshchat.mjs wait --nick Hermes --mention @hermes --timeout 120
 *
 * 退出码：0 成功；1 出错；2 wait 超时。
 * @module dsh-chat-plugin/bin/dshchat
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-chat', 'bridge.json')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

async function loadBridge() {
  const file = process.env.DSH_CHAT_BRIDGE || DEFAULT_FILE
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`读不到 ${file}：dsh Chat 插件是否已启用、Web GUI 是否在运行？(${error.message})`)
  }
  if (!raw?.url || !raw?.token) throw new Error(`${file} 缺少 url/token`)
  return { ...raw, file }
}

async function api(bridge, path, options = {}) {
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
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  return data
}

function formatMessage(message) {
  const time = new Date(message.ts).toISOString().slice(11, 19)
  const mine = message.mine ? ' (我)' : ''
  return `[${String(message.seq).padStart(4, ' ')}] ${time} ${message.nick}${mine}: ${message.text}`
}

async function waitForMention(bridge, nick, mention, since, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000
  let cursor = since
  const mentionPattern = mention ? String(mention).toLowerCase() : ''
  while (Date.now() < deadline) {
    const data = await api(bridge, `/bridge/read?since=${cursor}&limit=50`)
    const messages = Array.isArray(data.messages) ? data.messages : []
    if (messages.length > 0) cursor = Math.max(cursor, ...messages.map((message) => Number(message.seq) || 0))
    for (const message of messages) {
      if (message.nick === nick) continue
      if (message.via === 'agent') continue
      const text = String(message.text || '')
      if (mentionPattern && !text.toLowerCase().includes(mentionPattern)) continue
      return { message, cursor }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  const bridge = await loadBridge()

  if (!command || command === 'info') {
    const info = await api(bridge, '/bridge/info')
    console.log(JSON.stringify({ ...info, bridgeFile: bridge.file }, null, 2))
    return 0
  }

  if (command === 'read') {
    const since = Number(args.since) || 0
    const limit = Number(args.limit) || 50
    const data = await api(bridge, `/bridge/read?since=${since}&limit=${limit}`)
    if (args.json) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      console.log(`room=${data.room} latestSeq=${data.latestSeq}`)
      for (const message of data.messages) console.log(formatMessage(message))
    }
    return 0
  }

  if (command === 'send') {
    const text = args._.slice(1).join(' ')
    if (!text.trim()) throw new Error('用法：dshchat send <text> --nick <name>')
    if (!args.nick) throw new Error('send 需要 --nick')
    const data = await api(bridge, '/bridge/send', {
      method: 'POST',
      body: {
        nick: args.nick,
        text,
        toAgent: args['to-agent'] === true,
        replyTo: typeof args['reply-to'] === 'string' ? args['reply-to'] : undefined,
      },
    })
    if (args.json) console.log(JSON.stringify(data, null, 2))
    else console.log(`sent seq=${data.message.seq}`)
    return 0
  }

  if (command === 'typing') {
    if (!args.nick) throw new Error('typing 需要 --nick')
    await api(bridge, '/bridge/typing', { method: 'POST', body: { nick: args.nick } })
    return 0
  }

  if (command === 'wait') {
    if (!args.nick) throw new Error('wait 需要 --nick')
    const since = Number(args.since) || 0
    const timeoutSec = Math.max(Number(args.timeout) || 120, 5)
    const mention = typeof args.mention === 'string' ? args.mention : ''
    const found = await waitForMention(bridge, args.nick, mention, since, timeoutSec)
    if (!found) {
      console.error(JSON.stringify({ ok: false, error: 'timeout', since }))
      return 2
    }
    console.log(JSON.stringify({ ok: true, room: bridge.room, ...found }, null, 2))
    return 0
  }

  console.error(`未知命令：${command}（可用：info / read / send / typing / wait）`)
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`dshchat: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
