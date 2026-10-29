#!/usr/bin/env node
/**
 * bridge-agent — 把任意 CLI agent 接进 dsh Chat 房间的通用守护进程。
 *
 * 工作循环：
 *   1. 轮询房间，等一条包含 --mention 的消息（跳过自己、跳过别的 agent 的自动回复）；
 *   2. 把消息文本去掉 mention 后作为 prompt，执行 --cmd（模板里用 {{prompt}} 占位）；
 *   3. 把命令输出（去 ANSI、截断）用 --nick 的身份发回房间，并 replyTo 原消息。
 *
 * 用法（Hermes 示例，已登录即可用）：
 *   node examples/bridge-agent.mjs --nick Hermes --mention @hermes \
 *        --cmd 'hermes -z {{prompt}}'
 *
 * 用法（WorkBuddy / CodeBuddy，需先在终端跑一次 codebuddy 并 /login）：
 *   node examples/bridge-agent.mjs --nick WorkBuddy --mention @workbuddy \
 *        --cmd 'node "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs" -p {{prompt}} -y'
 *
 * 注意：--cmd 会用 /bin/sh 执行，prompt 已做 shell 转义；只接你信任的 agent CLI。
 */
import { execFile } from 'node:child_process'
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

const args = parseArgs(process.argv.slice(2))
const nick = typeof args.nick === 'string' ? args.nick : ''
const mention = typeof args.mention === 'string' ? args.mention : ''
const cmdTemplate = typeof args.cmd === 'string' ? args.cmd : ''
const timeoutSec = Math.max(Number(args.timeout) || 300, 10)
const once = args.once === true

if (!nick || !cmdTemplate) {
  console.error('用法：node examples/bridge-agent.mjs --nick <name> --mention <@name> --cmd "<prompt 模板>" [--once]')
  process.exit(1)
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function stripAnsi(text) {
  return String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trim()
}

async function loadBridge() {
  const file = process.env.DSH_CHAT_BRIDGE || DEFAULT_FILE
  const raw = JSON.parse(await readFile(file, 'utf8'))
  if (!raw?.url || !raw?.token) throw new Error(`${file} 缺少 url/token`)
  return raw
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
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function runCommand(prompt) {
  const command = cmdTemplate.replaceAll('{{prompt}}', shellQuote(prompt))
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { timeout: timeoutSec * 1000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = stripAnsi(stdout || '')
      const errText = stripAnsi(stderr || '')
      if (output) return resolve(output)
      if (error) return resolve(`（执行失败：${String(error.message).slice(0, 200)}${errText ? `\n${errText.slice(0, 400)}` : ''}）`)
      return resolve(errText || '（没有输出）')
    })
  })
}

function externalPeerId(name) {
  return `ext:${String(name).trim().toLowerCase()}`
}

async function main() {
  const bridge = await loadBridge()
  let since = Number(args.since) || 0
  console.log(`[${nick}] 已连接 ${bridge.room || bridge.url}，等待 ${mention || '(任意消息)'}…`)
  for (;;) {
    const response = await api(bridge, `/bridge/read?since=${since}&limit=50`)
    const messages = Array.isArray(response.messages) ? response.messages : []
    if (messages.length > 0) since = Math.max(since, ...messages.map((message) => Number(message.seq) || 0))
    const incoming = messages.find((message) => {
      if (!message || message.nick === nick || message.via === 'agent') return false
      if (!mention) return true
      return String(message.text || '').toLowerCase().includes(mention.toLowerCase())
    })
    if (!incoming) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      continue
    }
    console.log(`[${nick}] ← ${incoming.nick}: ${String(incoming.text).slice(0, 120)}`)
    await api(bridge, '/bridge/typing', { method: 'POST', body: { nick } }).catch(() => undefined)
    const prompt = mention
      ? String(incoming.text).replace(new RegExp(mention, 'ig'), '').trim()
      : String(incoming.text)
    const startedAt = Date.now()
    const output = await runCommand(
      `${prompt}\n\n（你在 dsh Chat 房间 "${bridge.room || ''}" 里，来自 ${incoming.nick}。请直接给出可以发回房间的结论，中文，300 字以内。）`,
    )
    const text = output.slice(0, 1000)
    try {
      await api(bridge, '/bridge/send', {
        method: 'POST',
        body: { nick, text, replyTo: incoming.id },
      })
      console.log(`[${nick}] → 已回复（${((Date.now() - startedAt) / 1000).toFixed(1)}s，${text.length} 字）`)
    } catch (error) {
      console.error(`[${nick}] 回复失败：${error.message}`)
    }
    if (once) return
  }
}

main().catch((error) => {
  console.error(`bridge-agent: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
