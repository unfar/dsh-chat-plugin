/**
 * i18n sanity check：中英文案 key 必须一一对应，且不允许重复 key。
 * 纯静态解析 client.js，无需依赖。
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function keysOf(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`${name} not found in client.js`)
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const block = source.slice(open + 1, end)
  const keys = []
  const pattern = /^\s{6}([a-zA-Z0-9_]+):/gm
  let match
  while ((match = pattern.exec(block)) !== null) keys.push(match[1])
  return keys
}

const zh = keysOf('STRINGS_ZH')
const en = keysOf('STRINGS_EN')
const problems = []

for (const [name, keys] of [['STRINGS_ZH', zh], ['STRINGS_EN', en]]) {
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) problems.push(`${name}: duplicate key "${key}"`)
    seen.add(key)
  }
}

const zhSet = new Set(zh)
const enSet = new Set(en)
for (const key of zhSet) if (!enSet.has(key)) problems.push(`missing in STRINGS_EN: ${key}`)
for (const key of enSet) if (!zhSet.has(key)) problems.push(`missing in STRINGS_ZH: ${key}`)

if (problems.length > 0) {
  console.error('i18n check failed:')
  for (const problem of problems) console.error(' - ' + problem)
  process.exit(1)
}

console.log(`i18n check passed: ${zhSet.size} keys in zh/en, no duplicates.`)
