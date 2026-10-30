/**
 * dsh-chat-plugin — Host 入口。
 *
 * 一个插件行同时提供：
 *  - 传输与房间状态（lib/peerchat.js）
 *  - Web GUI 的 HTTP API（lib/routes.js，挂 /dsh-chat-plugin/api）
 *  - agent 工具 chat_send / chat_read / chat_ask / chat_status（lib/tools.js）
 *  - agent 自动回复（lib/agent-reply.js）：房间里有人 @chat 时，本机 agent 自动回应
 * 浏览器那一半在 client.js，通过同样的 API 渲染 IM 式聊天面板。
 *
 * 配置来自 cordis.patch.yml 的行 config（见 README）；UI 保存的设置会写到
 * $DSH_HOME/dsh-chat/config.json，并在下次启动时优先于行 config。
 */
import { AgentReplier } from './lib/agent-reply.js'
import { Chats } from './lib/chats.js'
import { PeerChat } from './lib/peerchat.js'
import { registerRoutes } from './lib/routes.js'
import { Social } from './lib/social.js'
import { registerTools } from './lib/tools.js'

// 只硬性依赖 tools；webServer 是可选服务（无 Web GUI 的 profile 里插件仍可提供工具）。
export const inject = ['tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config) {
  const app = new PeerChat({ ctx, config })
  const replier = new AgentReplier({ ctx, app })
  const chats = new Chats({ app, store: app.store })
  const social = new Social({ ctx, app, store: app.store, chats })
  app.onConfigChanged = () => social.restart()

  ctx.effect(() => app.start())
  ctx.effect(() => replier.start())
  ctx.effect(() => social.start())
  ctx.effect(() => {
    chats.ensureCurrent()
    return () => {}
  })

  // webServer 可能在插件激活时还没就绪（新进程启动竞态）：轮询等待，拿到再注册。
  let routeTimer = null
  let routeDispose = null
  const setupRoutes = () => {
    if (routeDispose) return
    const webServer = ctx.get?.('webServer')
    if (!webServer) {
      routeTimer = setTimeout(setupRoutes, 500)
      if (typeof routeTimer.unref === 'function') routeTimer.unref()
      return
    }
    routeDispose = registerRoutes(ctx, app, social, chats)
    if (routeDispose) ctx.effect(() => routeDispose)
    ctx.logger?.info?.('dsh-chat-plugin: Web API 已注册')
  }
  setupRoutes()
  ctx.effect(() => () => {
    if (routeTimer) clearTimeout(routeTimer)
  })

  ctx.effect(() => registerTools(ctx, app))

  // 让 agent 知道有未读消息：注册一个动态 system prompt 片段，没有未读时为空。
  const systemPrompt = ctx.get?.('systemPrompt')
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    try {
      ctx.effect(() => systemPrompt.section({
        name: 'dsh-chat-plugin',
        order: 850,
        text: () => app.promptText(),
      }))
    } catch (error) {
      ctx.logger?.warn?.('dsh-chat: 注册 system prompt 片段失败', error)
    }
  }

  ctx.effect(() => () => app.cancelWaiters())

  ctx.logger?.info?.('dsh-chat: 已启用（面板见侧边栏「dsh Chat」，工具见 chat_*，自动回复见设置）')
}
