/**
 * dsh-hermes — 房间主题名派生 + 端到端加密。
 *
 * 设计：
 *  - 房间主题名 = "dshpc-" + sha256(room \0 passphrase)[0:24]
 *    → 口令不同主题就不同，公共中继（ntfy.sh）上连房间名都看不到。
 *  - 设置了口令时，消息体是 AES-256-GCM 密文（PBKDF2-SHA256 12 万次派生密钥），
 *    中继只能看到一段 base64url 乱码，看不到昵称/正文。
 *  - 没有口令时不加密（仅建议在自建中继上使用）。
 *
 * 纯 node:crypto，无第三方依赖。
 * @module dsh-hermes/crypto
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto'

/** 加密消息体的前缀，用来区分明文 JSON 信封。 */
const CIPHER_PREFIX = 'dshpc1:'

/** PBKDF2 迭代次数：约 50-100ms/次，只在建立连接/切换房间时算一次。 */
const KDF_ITERATIONS = 120000

/**
 * 由「房间名 + 口令」派生中继主题名。
 * 同一 room+passphrase 的两台机器得到同一主题；改任一项都会换房间。
 * @param {string} room
 * @param {string} [passphrase]
 * @returns {string} 形如 dshpc-1a2b3c4d5e6f7a8b9c0d1e2f
 */
export function deriveTopic(room, passphrase) {
  const material = `dsh-hermes\u0000${String(room ?? '')}\u0000${String(passphrase ?? '')}`
  return `dshpc-${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 24)}`
}

/**
 * 由口令派生 32 字节 AES-256 密钥。
 * @param {string} passphrase
 * @returns {Buffer}
 */
export function deriveKey(passphrase) {
  return pbkdf2Sync(String(passphrase), 'dsh-hermes-v1', KDF_ITERATIONS, 32, 'sha256')
}

/**
 * 加密（或明文序列化）一个信封对象。
 * @param {object} envelope
 * @param {Buffer|null} key deriveKey() 的结果，null 表示明文
 * @returns {string} 中继消息体
 */
export function seal(envelope, key) {
  const plain = JSON.stringify(envelope)
  if (!key) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return CIPHER_PREFIX
    + [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.')
}

/**
 * 解析中继消息体：解密并 JSON.parse，返回信封对象。
 * @param {string} raw 中继消息体
 * @param {Buffer|null} key
 * @returns {object}
 * @throws 当消息需要口令而当前房间没有口令，或密文损坏/被篡改时
 */
export function open(raw, key) {
  const text = String(raw ?? '')
  if (!text.startsWith(CIPHER_PREFIX)) {
    // 明文信封。若本房间有口令却收到明文，仍然接受：可能对方还没设置口令。
    return JSON.parse(text)
  }
  if (!key) throw new Error('收到的消息是加密的，但当前房间没有设置口令')
  const parts = text.slice(CIPHER_PREFIX.length).split('.')
  if (parts.length !== 3) throw new Error('加密消息格式不正确')
  const [ivB64, tagB64, bodyB64] = parts
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(bodyB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plain)
}
