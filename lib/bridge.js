/**
 * dsh-chat-plugin — 外部 agent 桥接层。
 *
 * 目的：让 **任何能执行 shell 命令的 agent**（Hermes、WorkBuddy/CodeBuddy、
 * Cursor Agent、Claude Code、Codex…）以**自己的身份**加入 dsh Chat 房间。
 *
 * 机制：
 *  - 插件启动时把 `{url, token, room}` 写到 $DSH_HOME/dsh-chat/bridge.json（0600）；
 *  - 外部 agent 用 `bin/dshchat.mjs`（或直接 curl）带 token 调 /bridge/* 接口；
 *  - /bridge/send 用外部 agent 的昵称派生稳定 peerId（ext-<hash>），
 *    消息与 dsh 内的 agent/人同房间可见，UI 里就是一个成员。
 *
 * 这是"兼容层"：不要求对方是 dsh，也不改对方，只要能跑命令/HTTP。
 * @module dsh-chat-plugin/bridge
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { stateDir } from './store.js'

/** 外部 agent 的稳定 peer id：同一个昵称永远映射到同一个成员。 */
export function externalPeerId(nick) {
  const name = String(nick ?? '').trim().toLowerCase()
  return `ext-${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 10)}`
}

export function bridgeFilePath(dir = stateDir()) {
  return join(dir, 'bridge.json')
}

/**
 * 创建桥接上下文：token、落盘、鉴权。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./peerchat.js').PeerChat} app
 */
export function createBridge(ctx, app) {
  const token = randomBytes(24).toString('hex')
  const dir = stateDir()
  const filePath = bridgeFilePath(dir)
  let written = false

  const writeFile = () => {
    try {
      const origin = ctx.get?.('webServer')?.getOrigin?.()
      if (!origin) return false
      const url = `${origin}/dsh-chat-plugin/api`
      mkdirSync(dir, { recursive: true })
      const tmp = `${filePath}.tmp`
      writeFileSync(tmp, JSON.stringify({
        url,
        token,
        room: app.room,
        relay: app.config.relayKind === 'custom' ? 'custom' : 'ntfy',
        encrypted: app.encrypted,
        updatedAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 })
      renameSync(tmp, filePath)
      try {
        chmodSync(filePath, 0o600)
      } catch {
        /* ignore */
      }
      written = true
      return true
    } catch {
      return false
    }
  }

  // 服务刚启动时端口可能还没 listen：重试几秒，成功后停。
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (writeFile() || attempts > 30) clearInterval(timer)
  }, 1000)
  if (typeof timer.unref === 'function') timer.unref()
  ctx.effect?.(() => () => clearInterval(timer))
  writeFile()

  /** 每次请求要带 x-dsh-chat-token；也接受 ?token=（方便 curl 调试）。 */
  const authorized = (req, url) => {
    const header = req.headers?.['x-dsh-chat-token']
    const query = url.searchParams.get('token')
    return header === token || query === token
  }

  return {
    token,
    filePath,
    written: () => written,
    authorized,
    externalPeerId,
  }
}
