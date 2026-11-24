/**
 * 宿主装载冒烟：用最小 ctx 模拟 DSH 0.2.2-rc.5 的装配契约，验证插件
 * 能被加载、把 4 条路由挂到 `webServer.register({kind,path,handler})` 上、
 * handler 拿到的是原生 `(req, res)`，以及卸载时路由被注销。
 *
 *   node test/host-smoke.mjs
 *
 * 全程只碰临时 DSH_HOME，不读不写真实 ~/.dsh。
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { apply, inject, name } from '../lib/index.js'

const CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

let failed = 0
function check(label, ok, detail) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-host-'))
const sessionsRoot = path.join(home, 'sessions')
const projA = path.join(home, 'proj-a')
const projB = path.join(home, 'proj-b')
fs.mkdirSync(projA, { recursive: true })
fs.mkdirSync(projB, { recursive: true })
fs.mkdirSync(path.join(home, 'storages'), { recursive: true })

const headerLine = (id, cwd, extra = {}) =>
  JSON.stringify({
    type: 'session',
    version: 4,
    id,
    createdAt: 1,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
    ...extra,
  })

// 当前代（v4）会话
const projectADir = path.join(sessionsRoot, String(projA).replace(/[\\/:]/g, '-'))
function writeSession(projectDirName, id, line, filename) {
  const dir = path.join(sessionsRoot, projectDirName, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), zlib.zstdCompressSync(Buffer.from(`${line}\n`), CHECKSUM_OPTS))
  return dir
}

// 直接用插件自己的 projectKey 规则构造目录名，避免在测试里重复实现
const { __test } = await import('../lib/index.js')
const keyA = __test.projectKey(projA)
const keyB = __test.projectKey(projB)

const sessionV4 = 'session-v4'
const sessionV3 = 'session-v3'
writeSession(keyA, sessionV4, headerLine(sessionV4, projA), 'session.v4.jsonl.zstd')
// 历史代会话：宿主升级后常见，插件必须也能认出来
writeSession(keyA, sessionV3, JSON.stringify({ type: 'session', version: 3, id: sessionV3, createdAt: 1, cwd: projA, isSeeded: false, delegationDepth: 0 }), 'session.v3.jsonl.zstd')

fs.writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['wsA', 'wsB'], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: 'wsA' },
    tables: {
      workspaces: {
        wsA: { path: projA, title: 'A', sessionIds: [sessionV4, sessionV3], createdAt: 'x', updatedAt: 'x' },
        wsB: { path: projB, title: 'B', sessionIds: [], createdAt: 'x', updatedAt: 'x' },
      },
    },
  }, null, 2)}\n`,
)

process.env.DSH_HOME = home

// ---- 最小 ctx：只实现插件真正用到的面和 DSH 0.2.2-rc.5 的签名 ----
const routes = new Map()
const effects = []
const emitted = []
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return () => dispose?.()
  },
  get(service) {
    // 0.2.2-rc.5 的宿主服务在本测试里一律缺席：插件必须优雅降级而不是崩
    if (service === 'workspaceRegistry') {
      return {
        list: () => [],
        get: () => undefined,
        headers: new Map(),
        sessionPaths: new Map(),
        invalidSessionPaths: new Map(),
      }
    }
    return undefined
  },
  on: () => () => {},
  emit: (event, payload) => emitted.push([event, payload]),
  parallel: async () => {},
  webServer: {
    register(route) {
      if (typeof route.handler !== 'function') throw new Error('handler must be a function')
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
}

check('host module name', name === 'dsh-migra-clean', name)
check('host inject declares webServer', Array.isArray(inject) && inject.includes('webServer'), JSON.stringify(inject))

apply(ctx)

const expectedPaths = [
  '/api/dsh-migra-clean',
  '/api/dsh-migra-clean/workspaces',
  '/api/dsh-migra-clean/info',
  '/api/dsh-migra-clean/move',
]
check('registers 4 exact routes', routes.size === expectedPaths.length, `got ${routes.size}: ${[...routes.keys()].join(',')}`)
for (const expected of expectedPaths) {
  const route = routes.get(expected)
  check(`route ${expected}`, route !== undefined && route.kind === 'exact', route === undefined ? 'missing' : `kind=${route.kind}`)
}

// ---- 用真 HTTP 跑一遍 handler，确认原生 req/res 契约 ----
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  const route = routes.get(pathname)
  if (route === undefined) {
    res.writeHead(404).end('no route')
    return
  }
  void route.handler(req, res)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const getJson = async (url) => {
  const response = await fetch(base + url)
  return { status: response.status, body: await response.json() }
}
const postJson = async (url, body) => {
  const response = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

console.log('--- HTTP 契约 ---')
{
  const result = await getJson(`/api/dsh-migra-clean/workspaces?sessionId=${sessionV4}`)
  check('GET /workspaces 200', result.status === 200, `status=${result.status}`)
  check('GET /workspaces ok=true', result.body.ok === true)
  check('GET /workspaces lists both workspaces', Array.isArray(result.body.workspaces) && result.body.workspaces.length === 2, `n=${result.body.workspaces?.length}`)
  check('GET /workspaces resolves current workspace', result.body.currentWorkspaceId === 'wsA', String(result.body.currentWorkspaceId))
  check('GET /workspaces carries session brief', result.body.session?.cwd === projA, JSON.stringify(result.body.session?.cwd))
}
{
  const result = await getJson(`/api/dsh-migra-clean/info?sessionId=${sessionV4}`)
  check('GET /info 200', result.status === 200, `status=${result.status}`)
  check('GET /info persisted=true for v4', result.body.persisted === true, String(result.body.persisted))
  check('GET /info logKind=zstd', result.body.logKind === 'zstd', String(result.body.logKind))
  check('GET /info reports bytes', typeof result.body.bytes === 'number' && result.body.bytes > 0, String(result.body.bytes))
}
{
  const result = await getJson(`/api/dsh-migra-clean/info?sessionId=${sessionV3}`)
  check('GET /info persisted=true for historical v3', result.body.persisted === true, String(result.body.persisted))
  check('GET /info historical cwd resolves', result.body.cwd === projA, String(result.body.cwd))
}
{
  const result = await getJson('/api/dsh-migra-clean/info')
  check('GET /info without sessionId → 400', result.status === 400, `status=${result.status}`)
}
{
  const result = await getJson('/api/dsh-migra-clean')
  check('GET delete route → 405', result.status === 405, `status=${result.status}`)
}
{
  const result = await postJson('/api/dsh-migra-clean/move', { sessionId: sessionV4, targetWorkspaceId: '' })
  check('POST /move with empty target → 400', result.status === 400, `status=${result.status}`)
}

await new Promise((resolve) => server.close(resolve))

// ---- 卸载：effect disposer 必须注销全部路由 ----
const useful = effects.filter((entry) => typeof entry.dispose === 'function')
check('apply registered effects with disposers', useful.length > 0, `${useful.length} effects`)
for (const entry of useful) entry.dispose()
check('routes removed on dispose', routes.size === 0, `remaining ${routes.size}`)

fs.rmSync(home, { recursive: true, force: true })
console.log(failed === 0 ? 'DONE' : `FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
