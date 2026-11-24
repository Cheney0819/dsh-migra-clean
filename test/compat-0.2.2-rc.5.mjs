import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { __test } from '../lib/index.js'

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const sessionsRoot = path.join(home, 'sessions')

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// 1. projectKey 与真实磁盘目录名逐字节一致
const projects = fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
let keyMatches = 0
for (const project of projects) {
  const firstSession = fs
    .readdirSync(path.join(sessionsRoot, project.name), { withFileTypes: true })
    .find((e) => e.isDirectory())
  if (firstSession === undefined) continue
  const header = __test.readSessionHeaderFromDir(path.join(sessionsRoot, project.name, firstSession.name))
  if (header === null) {
    // 尝试用 indexSessionDirs 定位
    const dirs = sessionsRoot
    if (path.basename(project.name).startsWith('--')) {
      // projectKey 只能从 header 推导，先用磁盘断言：目录名必须以 -- 包裹
      check(`project dir shape ${project.name}`, project.name.endsWith('--'))
    }
    continue
  }
  const derived = __test.projectKey(header.cwd)
  check(`projectKey(${header.cwd})`, derived === project.name, `derived=${derived} disk=${project.name}`)
  keyMatches += 1
}
check('at least one real header parsed', keyMatches > 0, `${keyMatches} sessions`)

// 2. 历史代文件名识别
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-gen-'))
const checksum = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
function writeGeneration(dir, version, cwd) {
  const header = {
    type: 'session',
    version,
    id: 'session-gen-test',
    createdAt: Date.now(),
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  }
  const line = JSON.stringify(header)
  const name = version === 0 ? 'session.jsonl' : `session.v${version}.jsonl`
  fs.writeFileSync(path.join(dir, `${name}.zstd`), zlib.zstdCompressSync(Buffer.from(`${line}\n`), checksum))
}
for (const version of [0, 1, 2, 3, 4]) {
  const dir = path.join(tmp, `case-v${version}`)
  fs.mkdirSync(dir, { recursive: true })
  writeGeneration(dir, version, 'C:/gen-test')
  const header = __test.readSessionHeaderFromDir(dir)
  check(`generation v${version} header`, header !== null && header.cwd === 'C:/gen-test', header === null ? 'null' : `cwd=${header.cwd}`)
}

// 3. 同目录多代并存时选最高代
{
  const dir = path.join(tmp, 'multi')
  fs.mkdirSync(dir, { recursive: true })
  for (const version of [1, 2, 3, 4]) writeGeneration(dir, version, `C:/multi-v${version}`)
  const header = __test.readSessionHeaderFromDir(dir)
  check('multi-generation picks highest', header !== null && header.cwd === 'C:/multi-v4', header === null ? 'null' : `cwd=${header.cwd}`)
}

// 4. 明文与未知未来代
{
  const dir = path.join(tmp, 'future')
  fs.mkdirSync(dir, { recursive: true })
  const header = { type: 'session', version: 9, id: 'session-future', createdAt: Date.now(), cwd: 'C:/future', isSeeded: false, delegationDepth: 0 }
  fs.writeFileSync(path.join(dir, 'session.v9.jsonl'), `${JSON.stringify(header)}\n`)
  const parsed = __test.readSessionHeaderFromDir(dir)
  check('future generation (v9, plain)', parsed !== null && parsed.cwd === 'C:/future', parsed === null ? 'null' : `cwd=${parsed.cwd}`)
}

// 5. 非规范名必须忽略
{
  const dir = path.join(tmp, 'noncanonical')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.V4.jsonl'), '{}\n')
  const parsed = __test.readSessionHeaderFromDir(dir)
  check('uppercase generation ignored', parsed === null, parsed === null ? 'null' : 'parsed')
}

// 6. 空 cwd 项目目录名与宿主一致
check('projectKey(empty) === _no-cwd', __test.projectKey('') === '_no-cwd', __test.projectKey(''))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
