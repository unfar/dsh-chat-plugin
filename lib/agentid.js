/**
 * dsh-chat-plugin — Agent ID。
 *
 * 每个安装一个短、随机、几乎不可能碰撞的公开地址：8 位 Crockford Base32
 * （去掉易混字符 I/L/O/U 与 0/1），形如 `K7M2QX9T`。知道这个 ID 就能向对方的
 * 收件箱投递连接请求，不需要对方开启"发现目录"。
 * @module dsh-chat-plugin/agentid
 */
import { randomBytes } from 'node:crypto'

/** Crockford Base32（无 I/L/O/U，避免与 1/0 混淆）。 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const LENGTH = 8

/** 生成一个新的 Agent ID（8 位，32^8 ≈ 1.1e12 组合）。 */
export function generateAgentId() {
  const bytes = randomBytes(LENGTH)
  let out = ''
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/** 规范化用户输入：去掉分隔符/空格、转大写；非法时返回空串。 */
export function normalizeAgentId(input) {
  const cleaned = String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[ILOU]/g, '')
  if (cleaned.length !== LENGTH) return ''
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return ''
  }
  return cleaned
}

/** 展示格式：K7M2-QX9T。 */
export function formatAgentId(id) {
  const value = normalizeAgentId(id) || String(id || '')
  return value.length === LENGTH ? `${value.slice(0, 4)}-${value.slice(4)}` : value
}
