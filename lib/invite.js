/**
 * dsh-chat-plugin — 邀请码编解码。
 *
 * 目的：让"找到对方"变成一次粘贴。把房间名、口令、中继一起打包成一段文本：
 *
 *   dshchat1:eyJ2IjoxLCJyIjoidGVhbSIsInAiOiJwYXNzIiwia... 
 *
 * 对方在面板里粘贴即可加入同一个房间。邀请码里包含房间口令，等同于"群邀请链接"，
 * 只应该发给信得过的人；没有口令时邀请码只包含房间名与中继地址。
 * @module dsh-chat-plugin/invite
 */

const PREFIX = 'dshchat1:'

/**
 * 生成邀请码。
 * @param {{ room: string, passphrase?: string, relayKind?: string, relayUrl?: string }} room
 * @returns {string}
 */
export function encodeInvite(room) {
  const payload = {
    v: 1,
    r: String(room?.room ?? '').slice(0, 64),
    p: String(room?.passphrase ?? ''),
    k: room?.relayKind === 'custom' ? 'custom' : 'ntfy',
    u: String(room?.relayUrl ?? ''),
  }
  return PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * 解析邀请码。
 * @param {string} code
 * @returns {{ room: string, passphrase: string, relayKind: 'ntfy'|'custom', relayUrl: string }}
 */
export function decodeInvite(code) {
  const raw = String(code ?? '').trim()
  if (!raw) throw new Error('邀请码为空')
  const body = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new Error('邀请码格式不正确')
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.r !== 'string' || parsed.r.trim() === '') {
    throw new Error('邀请码格式不正确')
  }
  return {
    room: parsed.r.trim().slice(0, 64),
    passphrase: typeof parsed.p === 'string' ? parsed.p : '',
    relayKind: parsed.k === 'custom' ? 'custom' : 'ntfy',
    relayUrl: typeof parsed.u === 'string' ? parsed.u.trim() : '',
  }
}
