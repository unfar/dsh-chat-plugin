/**
 * dsh-chat-plugin — 中继传输层。
 *
 * 两种后端实现同一个极小的接口（start / stop / publish）：
 *  1. "ntfy"   —— ntfy 协议：POST <base>/<topic> 发布，GET <base>/<topic>/json 订阅（NDJSON 长连接）。
 *                 默认 https://ntfy.sh，零部署、跨 NAT 可用；也可以指向自建 ntfy。
 *  2. "custom" —— 本仓库 relay/relay.mjs 的极简协议：
 *                 POST <base>/publish/<topic>，GET <base>/subscribe/<topic>（NDJSON 长连接）。
 *                 一条命令自建，适合长期 / 团队内使用。
 *
 * 两条链路都只传「一条消息体字符串」，加解密在 crypto.js，与传输无关。
 * @module dsh-chat-plugin/relay
 */

/** 公共 ntfy.sh 单条消息体上限（字节），留一点余量。 */
const NTFY_MAX_BODY_BYTES = 4000
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000

class Relay {
  /**
   * @param {object} opts
   * @param {'ntfy'|'custom'} opts.kind
   * @param {string} opts.url 中继根地址
   * @param {string} opts.topic 房间主题名
   * @param {(evt: {body: string, id?: string, ts?: number}) => void} opts.onEvent
   * @param {(status: 'connecting'|'connected'|'error', error?: string) => void} opts.onStatus
   */
  constructor(opts) {
    this.kind = opts.kind === 'custom' ? 'custom' : 'ntfy'
    this.base = String(opts.url || '').replace(/\/+$/, '')
    this.topic = opts.topic
    this.onEvent = opts.onEvent
    this.onStatus = opts.onStatus
    this.stopped = false
    this.abort = null
    this.backoff = RECONNECT_MIN_MS
    this.lastTs = 0
    this.decoder = new TextDecoder()
  }

  /** 订阅地址（首次拉全量 backlog，断线后从最后一条消息时间续传）。 */
  subscribeUrl() {
    if (this.kind === 'ntfy') {
      const since = this.lastTs > 0 ? Math.max(1, this.lastTs - 1) : 'all'
      return `${this.base}/${encodeURIComponent(this.topic)}/json?since=${since}`
    }
    const since = this.lastTs > 0 ? this.lastTs : 'all'
    return `${this.base}/subscribe/${encodeURIComponent(this.topic)}?since=${since}`
  }

  start() {
    this.stopped = false
    this.loop()
  }

  stop() {
    this.stopped = true
    try {
      this.abort?.abort()
    } catch {
      /* ignore */
    }
    this.abort = null
  }

  async loop() {
    while (!this.stopped) {
      const controller = new AbortController()
      this.abort = controller
      try {
        this.onStatus('connecting')
        const res = await fetch(this.subscribeUrl(), {
          signal: controller.signal,
          headers: { accept: 'application/x-ndjson, application/json' },
        })
        if (!res.ok || !res.body) throw new Error(`订阅失败 HTTP ${res.status}`)
        this.backoff = RECONNECT_MIN_MS
        this.onStatus('connected')
        let buffer = ''
        for await (const chunk of res.body) {
          if (this.stopped) break
          buffer += this.decoder.decode(chunk, { stream: true })
          let idx = buffer.indexOf('\n')
          while (idx >= 0) {
            const line = buffer.slice(0, idx).trim()
            buffer = buffer.slice(idx + 1)
            if (line) this.consumeLine(line)
            idx = buffer.indexOf('\n')
          }
        }
        if (!this.stopped) throw new Error('中继连接已断开')
      } catch (error) {
        if (this.stopped) return
        this.lastError = error instanceof Error ? error.message : String(error)
        this.onStatus('error', this.lastError)
        await new Promise((resolve) => setTimeout(resolve, this.backoff))
        this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS)
      }
    }
  }

  consumeLine(line) {
    let raw
    try {
      raw = JSON.parse(line)
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object') return
    // ntfy 的 NDJSON 流里混有 open / keepalive / poll_request 等事件。
    if (this.kind === 'ntfy' && raw.event !== 'message') return
    const body = typeof raw.message === 'string' ? raw.message : undefined
    if (!body) return
    const ts = Number(raw.time) > 0 ? Number(raw.time) * 1000 : Number(raw.ts) || 0
    if (ts > this.lastTs) this.lastTs = ts
    this.onEvent({ body, id: raw.id, ts })
  }

  /**
   * 发布一条消息体。
   * @param {string} body
   * @returns {Promise<unknown>}
   */
  async publish(body) {
    const text = String(body ?? '')
    if (this.kind === 'ntfy') {
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > NTFY_MAX_BODY_BYTES) {
        throw new Error(`消息太长（${bytes} 字节，公共 ntfy 单条上限约 ${NTFY_MAX_BODY_BYTES} 字节）`)
      }
      const res = await fetch(`${this.base}/${encodeURIComponent(this.topic)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
      })
      if (!res.ok) throw new Error(`发布失败 HTTP ${res.status}`)
      return res.json().catch(() => null)
    }
    const res = await fetch(`${this.base}/publish/${encodeURIComponent(this.topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    if (!res.ok) throw new Error(`发布失败 HTTP ${res.status}`)
    return res.json().catch(() => null)
  }
}

/**
 * 创建一个中继实例（未 start）。
 * @param {ConstructorParameters<typeof Relay>[0]} opts
 */
export function createRelay(opts) {
  return new Relay(opts)
}
