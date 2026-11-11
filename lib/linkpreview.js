/**
 * 链接预览（Open Graph）：只抓取 http(s) 公网页面，限制大小/超时/跳转次数，拒绝内网地址。
 * 抓取失败或不是 HTML 时静默返回 null，不影响消息本身。
 *
 * @module dsh-chat-plugin/linkpreview
 */

const MAX_HTML_BYTES = 96 * 1024
const MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 2500
const MAX_TITLE = 120
const MAX_DESCRIPTION = 200
const MAX_IMAGE = 500

/** 从消息文本里取第一个 http(s) 链接（去掉尾部标点）。 */
export function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"'`]+/i)
  if (!match) return ''
  return match[0]
    .split(/[，。！？；：、）》】”’"']/u)[0]
    .replace(/[.,;:!?)\]}>]+$/g, '')
}

/** 是否是允许抓取的公网 http(s) 地址。 */
export function isSafePreviewUrl(raw) {
  let url
  try {
    url = new URL(String(raw || ''))
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number)
    if (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      parts[0] >= 224
    ) {
      return false
    }
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return false
  }
  return true
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function metaContent(html, names) {
  for (const name of names) {
    const pattern = new RegExp(
      '<meta[^>]+(?:property|name)=["\\\']' + name + '["\\\'][^>]*>',
      'i',
    )
    const tag = html.match(pattern)
    if (!tag) continue
    const content = tag[0].match(/content=["\\\']([^"\\\']*)["\\\']/i)
    if (content && content[1]) return decodeEntities(content[1])
  }
  return ''
}

/** 解析 HTML 里的 Open Graph / title。 */
export function parseLinkPreview(html, baseUrl) {
  const source = String(html || '')
  const url = String(baseUrl || '')
  if (!source) return null
  const title = (
    metaContent(source, ['og:title', 'twitter:title']) ||
    (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
    ''
  ).slice(0, MAX_TITLE)
  const description = metaContent(source, ['og:description', 'twitter:description', 'description']).slice(
    0,
    MAX_DESCRIPTION,
  )
  const site = metaContent(source, ['og:site_name']).slice(0, 60)
  let image = metaContent(source, ['og:image', 'twitter:image'])
  if (image && url) {
    try {
      image = new URL(image, url).href
    } catch {
      image = ''
    }
  }
  image = String(image || '').slice(0, MAX_IMAGE)
  if (!title && !description && !image) return null
  return { url, title, description, image, site }
}

/**
 * 抓取并解析一个链接的预览信息。
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function fetchLinkPreview(rawUrl, options = {}) {
  const initial = String(rawUrl || '')
  if (!isSafePreviewUrl(initial)) return null
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 800), 6000)
  let current = initial
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'dsh-chat/4.4 link-preview' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        if (!location) return null
        const next = new URL(location, current).href
        if (!isSafePreviewUrl(next)) return null
        current = next
        continue
      }
      if (!response.ok) return null
      const type = String(response.headers?.get?.('content-type') || '')
      if (!type.toLowerCase().includes('text/html')) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      return parseLinkPreview(buffer.subarray(0, MAX_HTML_BYTES).toString('utf8'), current)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
