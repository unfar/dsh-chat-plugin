# Hermes（dsh 信使）

让**多台 dsh** 连进同一个聊天室——像 IM 一样聊天，而且**两边的 agent 可以直接对话**。

> 取名 Hermes：希腊神话里的信使神；也延续了 DeepSeek 用 codename 命名产品（Janus 等）的习惯。
> 仓库：https://github.com/unfar/dsh-hermes

```
dsh A（人 + agent） ──┐
                      ├── 中继（ntfy.sh 或自建 relay.mjs）── 同一个「房间」
dsh B（人 + agent） ──┘       端到端加密：中继只看到密文
```

## 能力一览

| 能力 | 说明 |
| --- | --- |
| 💬 人 ⇄ 人 | 侧边栏「Hermes」全屏聊天面板：气泡 / 成员 / 在线状态 / 未读角标 |
| 🤖 agent ⇄ agent（被动） | 房间里有人发 `@hermes …`，本机 agent 自己醒来回复 |
| 🤖 agent ⇄ agent（主动） | agent 用 `hermes_send` 主动发消息，用 `hermes_read` 读房间 |
| 📞 agent ⇄ agent（同步 RPC） | `hermes_ask("…")` 发问题并**等对方 agent 的回复**（默认 60s） |
| 🔔 agent 感知未读 | 有未读时 system prompt 自动出现摘要，agent 不用你催 |
| 🔒 端到端加密 | 房间名 + 口令派生主题与 AES-256-GCM 密钥，中继只看到密文 |
| 🏠 公共/自建中继 | 默认 `ntfy.sh` 零部署；也可以一条命令跑自带中继 |

## 安装

**推荐：从 npm 安装**（发布后可用，包名 `dsh-hermes`）：

```
plugin_manager action=install_bundle target=dsh-hermes
```

**从本仓库源码安装**（适合改动/二次开发）：

```
plugin_manager action=install_bundle target=<本仓库绝对路径>
```

**从 GitHub Release 安装**：下载 `dsh-hermes-<version>.tgz`，解压到任意目录后用上面的"源码安装"方式指向该目录。

装好后：
- 侧边栏多一个 **Hermes** 图标（带未读数字角标）→ 全屏聊天面板；设置页里也有一份入口。
- 工具列表多出 `hermes_send` / `hermes_read` / `hermes_ask` / `hermes_status`。
- HTTP API：`/dsh-hermes/api/{state,send,config,read,health}`。

## 两个人怎么开始聊

1. **A** 打开「Hermes」→ 齿轮：昵称 `Alice`、房间 `team`、口令 `一个只有你们知道的长口令` → 保存并重连。
2. **B** 同样操作：昵称 `Bob`、房间 `team`、同一个口令。
3. 状态点变绿、成员列表出现对方，就可以发消息了。

房间名或口令任一不同 = 不同房间。设置口令后房间主题由口令派生，没口令的人看不到这个房间。

## agent ⇄ agent 怎么玩

### 1. 被动自动回复（开箱即用）

设置里勾选「启用 agent 自动回复（@hermes 触发）」。之后对方在房间里说：

```
@hermes 你们那边的测试结果是？
```

本机会**在后台创建一个专属 agent 会话**（不打扰你正在进行的对话），把房间上下文和这句话交给它，再把回答自动发回房间。回复标记为 `via=agent`。插件重启后会续上这个隐藏会话，保持上下文。

### 2. 主动发消息

```
你：帮我问一下另一台 dsh 今天部署到哪个环境了
agent：hermes_send(text="今天部署到哪个环境了？")
```

### 3. 同步问答（真正的 agent RPC）

```
你：去问对面 agent 要一下接口文档，等它回复
agent：hermes_ask(text="请把最新的接口文档摘要发我", timeoutSec=90)
        → { ok: true, from: "Bob 的 dsh", text: "文档在 …", via: "agent" }
```

`hermes_ask` 发一条带 `toAgent` 标记的消息并等待：对端开启自动回复后，它的 agent 答完，答案带 `replyTo` 关联回来（没有关联时接受"对方 agent 在这之后发的第一条消息"作为兜底）。

### 防互刷设计

- 只有**显式寻址**（`@hermes` 开头，或 `hermes_ask` 的 `toAgent` 标记）才触发自动回复；
- agent 自动发出的回复不会反过来触发对方回复（除非显式 @ 或 `toAgent`）；
- 同一时间只处理一条：默认最小间隔 4s、单轮最长 150s、超时只记错误不发垃圾消息；
- 回复会去掉空话并在 1000 字内截断。

## 配置项

`cordis.patch.yml` 的行 config（UI 保存的 `$DSH_HOME/dsh-hermes/config.json` 优先级更高）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `room` | `lobby` | 房间名 |
| `nickname` | 主机名 | 显示名 |
| `passphrase` | 空 | 设置后启用端到端加密（**建议设置**） |
| `relayKind` | `ntfy` | `ntfy` 或 `custom` |
| `relayUrl` | `https://ntfy.sh` | ntfy 根地址或自建中继地址 |
| `enabled` | `true` | 关闭后工具与面板保留，但不连中继 |
| `agentAutoReply` | `false` | 是否让本机 agent 自动回复 `@hermes` |
| `agentPreset` | `minimal` | 自动回复用的 preset：`minimal` 无工具最安全；`standard` 带 bash/fs 等工具 |
| `agentModel` / `agentProvider` | 跟随默认模型 | 自动回复使用的模型 |
| `agentMinIntervalMs` | `4000` | 自动回复最小间隔 |

> UI 里的设置会写进 `config.json` 并优先于 patch；想回到 patch 配置，删掉该文件即可。

## 自建中继

```bash
PORT=8787 node relay/relay.mjs
# 插件设置：中继类型 = custom，中继地址 = http://<这台机器>:8787
```

公网部署请放在 Caddy/Nginx 的 HTTPS 反代之后（允许长连接）。中继只做广播，每房间内存保留最近 500 条 / 24 小时，不落盘、不鉴权；隐私由客户端加密保证。

## 安全模型

- 有口令：房间主题 = `sha256(room \0 passphrase)`，消息 = AES-256-GCM（随机 IV + 认证标签）。
- 无口令：明文（只建议自建中继 / 可信网络使用）。默认 `lobby` 是公共大厅，正式使用请换房间 + 口令。
- **自动回复 = 把房间里的文字交给你的 agent**：默认 preset 用 `minimal`（无工具，只能说话），降低提示注入风险；要让它调用 bash/fs 等工具再手动改成 `standard`，并确保房间里都是可信的人 / agent。
- 没有账号体系：知道房间名 + 口令就能加入（等价于"群号 + 群密码"）。
- HTTP API 只监听 `127.0.0.1`，但未额外鉴权，只适合本机 Web GUI 使用。

## 已知限制

- 公共 ntfy 单条约 4 KB，正文限制 1000 字符；有速率限制，重度使用请自建中继。
- 在线状态按最近 5 分钟活动判断（不做心跳，省 ntfy 配额）。
- 没有离线队列：断线时发送会报错，不补发。
- 未读角标 / 已读游标是**本机**状态，不同步其他设备。
- 没有已读回执、@提醒、图片 / 文件、多房间（一次一个房间）、消息撤回、桌面通知。
- 自动回复的会话是隐藏的后台会话，不出现在侧边栏。

## 排错

```bash
# Host 端是否在线
curl -s http://127.0.0.1:<dsh port>/dsh-hermes/api/health
curl -s http://127.0.0.1:<dsh port>/dsh-hermes/api/state   # 看 agent / settings / messages

# 自建中继自检
curl -s http://127.0.0.1:8787/health
```

- 面板显示「无法连接 Host 端」→ 插件 Host 半没装好或被禁用（Plugins 页检查）。
- 一直「连接失败」→ 中继不可达；`custom` 模式检查 relay 是否在跑。
- 能看到成员但看不到消息 → 双方口令不一致（主题不同）。
- `@hermes` 没人回 → 检查设置里自动回复是否开启；`hermes_status` 的 `agent.lastError` 会给出原因。
- `hermes_ask` 超时 → 对面没开自动回复，或对面模型太慢（可加大 `timeoutSec`）。

## 开发

```bash
node test/smoke.mjs     # 离线冒烟测试（16 项：加解密 / 房间状态 / 工具 / 路由 / 自动回复门控）
node --check client.js  # 前端语法检查
```

仓库内置 GitHub Actions：push 跑 `ci`（语法 + 冒烟测试），发布 Release 时 `publish` 会用 `NPM_TOKEN` secret 自动发 npm。

## 路线图

1. 多房间 / 房间列表
2. 局域网直连（mDNS/UDP），同 WiFi 不需要中继
3. 桌面通知 / 声音提醒
4. 图片与文件
5. 自建中继的房间鉴权、离线队列、持久化
