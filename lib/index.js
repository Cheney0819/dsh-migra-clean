/**
 * dsh-migra-clean: DeepSeek Harness 会话管理与彻底删除/迁移插件（后端服务）
 *
 * 职责：
 * 1. 暴露 /api/dsh-migra-clean 会话删除接口；
 * 2. 暴露 /api/dsh-migra-clean/workspaces 工作区列表接口（可选带 sessionId，返回归属信息）；
 * 3. 暴露 /api/dsh-migra-clean/move 会话跨工作区迁移接口；
 * 4. 暴露 /api/dsh-migra-clean/info 会话体积/时间等只读元信息；
 * 5. 彻底物理清理或迁移磁盘日志、锁文件、投影缓存与 cwd 配置；
 * 6. 保持与 workspace.json 及内存注册表绝对一致；
 * 7. 严禁改动任何项目工作区内的已有产物。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";

export const name = "dsh-migra-clean";
export const inject = ["webServer"];

function getDshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(os.homedir(), ".dsh");
}

function sendJson(res, status, data) {
  try {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Cache-Control": "no-store",
    });
    res.end(payload);
  } catch (err) {
    console.error("[dsh-migra-clean] Failed to send JSON response:", err);
  }
}

const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start };
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) return { frames, tornStart: start };
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) return { frames, tornStart: start };
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/**
 * 计算 DSH 项目工作区在 ~/.dsh/sessions/ 下对应的文件夹名称
 */
function projectKey(cwd) {
  if (!cwd || cwd.length === 0) return "--root--";
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 256 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function readQuery(req) {
  try {
    const url = new URL(req.url || "/", "http://dsh.local");
    const out = {};
    for (const [k, v] of url.searchParams.entries()) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 只读取会话日志第一帧/第一行的 header（不加载整个文件，兼容多帧 zstd）
 */
function readSessionHeaderQuick(file) {
  try {
    if (file === null || file === undefined) return null;
    if (file.endsWith(".zstd")) {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        const { frames } = scanZstdFrames(buf.subarray(0, n));
        if (frames.length === 0) return null;
        const plain = zlib.zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end)).toString("utf8");
        const nl = plain.indexOf("\n");
        return JSON.parse(nl === -1 ? plain : plain.slice(0, nl));
      } finally {
        fs.closeSync(fd);
      }
    }
    const text = fs.readFileSync(file, "utf8");
    const nl = text.indexOf("\n");
    return JSON.parse(nl === -1 ? text : text.slice(0, nl));
  } catch {
    return null;
  }
}

function sessionLogFiles(dir) {
  const z = path.join(dir, "session.v4.jsonl.zstd");
  const plain = path.join(dir, "session.v4.jsonl");
  if (fs.existsSync(z)) return { file: z, compressed: true };
  if (fs.existsSync(plain)) return { file: plain, compressed: false };
  return null;
}

function readSessionHeaderFromDir(dir) {
  const found = sessionLogFiles(dir);
  if (!found) return null;
  return readSessionHeaderQuick(found.file);
}

/**
 * 原子写：先写同目录临时文件再 rename，避免崩溃留下半截会话日志。
 */
function writeFileAtomic(target, data) {
  const tmp = `${target}.dsh-migra-clean-${process.pid}-${Date.now()}.tmp`;
  let mode = null;
  try {
    mode = fs.statSync(target).mode;
  } catch {}
  try {
    fs.writeFileSync(tmp, data);
    if (mode !== null) {
      try {
        fs.chmodSync(tmp, mode);
      } catch {}
    }
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

/**
 * 把会话日志（帧 0 的 header.cwd）改写为目标路径，其余帧原封不动。
 * 写入前回读校验新帧，校验失败则完全不落盘。
 */
function rewriteSessionCwd(dir, newCwd) {
  const found = sessionLogFiles(dir);
  if (!found) return { updated: false, frames: 0 };

  if (!found.compressed) {
    const content = fs.readFileSync(found.file, "utf8");
    const nl = content.indexOf("\n");
    const firstLine = nl === -1 ? content : content.slice(0, nl);
    const header = JSON.parse(firstLine);
    if (header.cwd === newCwd) return { updated: false, frames: 1 };
    header.cwd = newCwd;
    const next = JSON.stringify(header) + (nl === -1 ? "" : content.slice(nl));
    writeFileAtomic(found.file, next);
    return { updated: true, frames: 1 };
  }

  const compressed = fs.readFileSync(found.file);
  const { frames } = scanZstdFrames(compressed);
  if (frames.length === 0) throw new Error("会话日志帧解析失败，已中止（未修改任何文件）");

  const frame0Plain = zlib.zstdDecompressSync(compressed.subarray(frames[0].start, frames[0].end)).toString("utf8");
  const nl = frame0Plain.indexOf("\n");
  const firstLine = nl === -1 ? frame0Plain : frame0Plain.slice(0, nl);
  const header = JSON.parse(firstLine);
  if (header.cwd === newCwd) return { updated: false, frames: frames.length };

  header.cwd = newCwd;
  const payload = Buffer.from(JSON.stringify(header) + "\n", "utf8");
  const newFrame0 = zlib.zstdCompressSync(payload, {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  });
  // 回读校验：新帧必须能还原出完全一致的 header 行，否则一字节也不写
  const roundTrip = zlib.zstdDecompressSync(newFrame0);
  if (!roundTrip.equals(payload)) throw new Error("会话头压缩校验失败，已中止（未修改任何文件）");

  writeFileAtomic(found.file, Buffer.concat([newFrame0, compressed.subarray(frames[0].end)]));
  return { updated: true, frames: frames.length };
}

/**
 * 会话目录索引（只做目录遍历，不读文件内容）：
 *   dirsByName: 会话 ID -> [{ projectDir, dir }]
 *   namesByProject: 项目目录 -> [会话 ID]
 */
function indexSessionDirs(sessionsRoot) {
  const dirsByName = new Map();
  const namesByProject = new Map();
  let projects = [];
  try {
    projects = fs
      .readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(sessionsRoot, entry.name));
  } catch {
    return { projects, dirsByName, namesByProject };
  }
  for (const projectDir of projects) {
    let entries = [];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(projectDir, entry.name);
      names.push(entry.name);
      const bucket = dirsByName.get(entry.name);
      if (bucket) bucket.push({ projectDir, dir });
      else dirsByName.set(entry.name, [{ projectDir, dir }]);
    }
    namesByProject.set(projectDir, names);
  }
  return { projects, dirsByName, namesByProject };
}

// ---------------------------------------------------------------------------
// 性能：会话目录索引 / header 读取的进程内缓存
//
// 原实现每次删除、迁移、读元信息都要完整遍历 sessions 目录并逐个 open+读头，
// 项目会话一多就是几百次磁盘 IO。这里用「短 TTL 索引缓存 + header 缓存 +
// SQLite 子会话反查」把重复扫描压掉，写操作后主动失效保证正确性。
// ---------------------------------------------------------------------------
const INDEX_TTL_MS = 2000;
const HEADER_CACHE_MAX = 4096;
let indexCache = { root: null, at: 0, value: null };
const headerCache = new Map();

function sessionIndex(sessionsRoot) {
  const now = Date.now();
  if (indexCache.value && indexCache.root === sessionsRoot && now - indexCache.at < INDEX_TTL_MS) {
    return indexCache.value;
  }
  const value = indexSessionDirs(sessionsRoot);
  indexCache = { root: sessionsRoot, at: now, value };
  return value;
}

/** 写操作（删除/迁移）之后必须调用：目录布局已变，缓存不可再信 */
function invalidateSessionCaches() {
  indexCache = { root: null, at: 0, value: null };
  headerCache.clear();
}

/** header 读取缓存：按日志文件的 mtime+size 判活，外部改写也不会读到旧值 */
function cachedHeader(dir) {
  const found = sessionLogFiles(dir);
  let st = null;
  if (found) {
    try {
      st = fs.statSync(found.file);
    } catch {}
  }
  const hit = headerCache.get(dir);
  if (hit && st && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.header;
  const header = readSessionHeaderFromDir(dir);
  if (st) {
    if (headerCache.size >= HEADER_CACHE_MAX) headerCache.clear();
    headerCache.set(dir, { mtimeMs: st.mtimeMs, size: st.size, header });
  }
  return header;
}

/**
 * 用 SQLite 的 parent_session 索引反查子会话候选（一次索引查询），
 * 再只对这几个候选读 header 校验 origin === "subagent"。
 * 没有 SQLite 时回退到目录遍历实现。
 */
function resolveSubagentChildren(ctx, parentDirs, namesByProject, parentSessionId) {
  let candidateIds = null;
  const sessionQuery = ctx.get("sessionQuery", false);
  if (sessionQuery && typeof sessionQuery._requireDb === "function") {
    try {
      const db = sessionQuery._requireDb();
      candidateIds = db
        .prepare("SELECT id FROM persisted_sessions WHERE parent_session = ?")
        .all(parentSessionId)
        .map((row) => row.id);
    } catch {
      candidateIds = null;
    }
  }
  if (!candidateIds) return findSubagentChildren(parentDirs, namesByProject, parentSessionId);

  const projectDirs = [...new Set(parentDirs.map((d) => d.projectDir))];
  const children = [];
  for (const id of candidateIds) {
    for (const projectDir of projectDirs) {
      const names = namesByProject.get(projectDir) || [];
      if (!names.includes(id)) continue;
      const dir = path.join(projectDir, id);
      const header = cachedHeader(dir);
      if (header && header.parentSession === parentSessionId && header.origin === "subagent") {
        children.push({ id: header.id || id, dir, projectDir });
      }
      break;
    }
  }
  return children;
}

/**
 * 找出某会话的隐藏子智能体会话（origin === "subagent"）。
 * 只在父会话所在的那些项目目录里读 header，避免全库扫描。
 */
function findSubagentChildren(parentDirs, namesByProject, parentSessionId) {
  const children = [];
  const seenProjects = new Set();
  for (const { projectDir } of parentDirs) {
    if (seenProjects.has(projectDir)) continue;
    seenProjects.add(projectDir);
    for (const name of namesByProject.get(projectDir) || []) {
      if (name === parentSessionId) continue;
      const header = cachedHeader(path.join(projectDir, name));
      // 分叉会话（origin 为空、isSeeded=true）是独立可见会话，绝不级联
      if (header && header.parentSession === parentSessionId && header.origin === "subagent") {
        children.push({ id: header.id || name, dir: path.join(projectDir, name), projectDir });
      }
    }
  }
  return children;
}

/** 同一会话的操作串行化，避免双击/并发请求互相踩踏 */
const inflight = new Set();
async function withSessionLock(sessionId, task) {
  if (inflight.has(sessionId)) throw new Error("该会话正在处理中，请稍候片刻再试");
  inflight.add(sessionId);
  try {
    return await task();
  } finally {
    inflight.delete(sessionId);
  }
}

/**
 * 阻断并释放一个会话的全部运行态（移动/删除其文件之前必须先调用）。
 *
 * DSH 的会话头对象是 deepFreeze 的（原地改 header.cwd 必抛
 * "Cannot assign to read only property 'cwd'"），所以正确做法不是改它，
 * 而是沿 DSH 原生通路把会话整体释放掉，之后磁盘上的新 header 就是唯一事实：
 *
 *   停任务(workspace/session-stop) → 取消轮次(agent.cancel)
 *   → flush 持久化屏障(sessions.flush) → 关写句柄(tracker.openHandles.close)
 *   → 从 SessionStore 摘除(sessions.detachEntered → emit session/disposed)
 *   → 从 Agent 注册表摘除(agents.detachEntered → emit agent/disposed)
 */
async function quiesceSessionForFileOps(ctx, sessionId) {
  try {
    if (typeof ctx.parallel === "function") await ctx.parallel("workspace/session-stop", { sessionId });
  } catch {}

  const sessions = ctx.get("sessions", false);
  if (!sessions || typeof sessions.get !== "function") return { wasLive: false };
  const live = sessions.get(sessionId);
  if (!live) return { wasLive: false };

  const agents = ctx.get("agents", false);
  if (agents && typeof agents.get === "function") {
    try {
      const agent = agents.get(sessionId);
      // DSH 的原生取消 API 是 cancel(...)；abort 根本不存在
      if (agent && typeof agent.cancel === "function") {
        agent.cancel({ kind: "user" }, { keepInbox: true });
        for (let i = 0; i < 15 && agent.status === "running"; i++) await sleep(100);
      }
    } catch {}
  }

  if (typeof sessions.flush === "function") {
    try {
      await sessions.flush(live);
    } catch {}
  }

  const persistence = ctx.get("sessionPersistence", false);
  const openHandles = persistence?.tracker?.openHandles;
  if (openHandles) {
    for (const h of [...openHandles]) {
      if (h && h.id === sessionId && typeof h.close === "function") {
        try {
          await h.close();
        } catch {}
      }
    }
  }

  const sEntry = sessions.store?.get?.(sessionId);
  if (sEntry && typeof sessions.detachEntered === "function") {
    for (let i = 0; i < 6 && (sEntry.appending || sEntry.announcing); i++) await sleep(100);
    if (sEntry.appending || sEntry.announcing) {
      throw new Error("会话正在写入发布中，已安全中止（未修改任何文件），请稍后重试");
    }
    sessions.detachEntered(sEntry);
  }

  if (agents && typeof agents.store?.get === "function" && typeof agents.detachEntered === "function") {
    try {
      const aEntry = agents.store.get(sessionId);
      if (aEntry) agents.detachEntered(aEntry);
    } catch {}
  }

  if (sessions.get(sessionId) !== undefined) {
    throw new Error("无法释放该会话（仍被占用），已中止且未修改任何文件，请稍后重试");
  }
  return { wasLive: true };
}

/** 读取 workspace.json，返回解析结果与路径 */
function readWorkspaceData() {
  const file = path.join(getDshHome(), "storages", "workspace.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, data };
}

function workspaceListPayload(data, sessionId) {
  const order = data.global?.workspaceIds || [];
  const tables = data.tables?.workspaces || {};
  const ids = [...order];
  for (const id of Object.keys(tables)) if (!ids.includes(id)) ids.push(id);

  const list = [];
  let currentWorkspaceId = null;
  for (const id of ids) {
    const w = tables[id];
    if (!w) continue;
    const sessionIds = Array.isArray(w.sessionIds) ? w.sessionIds : [];
    const containsSession = Boolean(sessionId && sessionIds.includes(sessionId));
    if (containsSession) currentWorkspaceId = id;
    list.push({
      id,
      title: w.title || path.basename(w.path || ""),
      path: w.path,
      isDefault: id === data.global?.defaultWorkspaceId,
      sessionCount: sessionIds.length,
      containsSession,
    });
  }
  return { list, currentWorkspaceId };
}

export function apply(ctx) {
  ctx.effect(() => {
    // 1. 彻底删除会话接口
    const unregDel = ctx.webServer.register({
      kind: "exact",
      path: "/api/dsh-migra-clean",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
          return;
        }

        let payload;
        try {
          payload = await readRequestBody(req);
        } catch {
          sendJson(res, 400, { ok: false, error: "JSON 解析失败" });
          return;
        }

        const { sessionId } = payload;
        if (!sessionId || typeof sessionId !== "string") {
          sendJson(res, 400, { ok: false, error: "缺少有效的 sessionId" });
          return;
        }

        if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\") || sessionId.length > 200) {
          sendJson(res, 400, { ok: false, error: "非法的 sessionId 格式" });
          return;
        }

        try {
          await withSessionLock(sessionId, () => destroySession(ctx, sessionId));
          sendJson(res, 200, { ok: true, sessionId, message: "会话已彻底删除并清理完毕" });
        } catch (err) {
          console.error(`[dsh-migra-clean] 删除会话 ${sessionId} 失败:`, err);
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // 2. 工作区列表接口（?sessionId= 时附带该会话的归属信息）
    const unregWorkspaces = ctx.webServer.register({
      kind: "exact",
      path: "/api/dsh-migra-clean/workspaces",
      handler: async (req, res) => {
        try {
          const { sessionId } = readQuery(req);
          const { data } = readWorkspaceData();
          const { list, currentWorkspaceId } = workspaceListPayload(data, sessionId);
          let session = null;
          if (sessionId) {
            session = sessionBrief(ctx, sessionId, currentWorkspaceId);
          }
          sendJson(res, 200, { ok: true, workspaces: list, currentWorkspaceId, session });
        } catch (err) {
          console.error("[dsh-migra-clean] 获取工作区列表失败:", err);
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // 3. 会话只读元信息（体积、最后活动时间、是否在运行）
    const unregInfo = ctx.webServer.register({
      kind: "exact",
      path: "/api/dsh-migra-clean/info",
      handler: async (req, res) => {
        try {
          const { sessionId } = readQuery(req);
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "缺少 sessionId" });
            return;
          }
          const sessionsRoot = path.join(getDshHome(), "sessions");
          const { dirsByName } = sessionIndex(sessionsRoot);
          const dirs = dirsByName.get(sessionId) || [];
          let bytes = 0;
          let updatedAt = null;
          let logKind = null;
          for (const { dir } of dirs) {
            const found = sessionLogFiles(dir);
            if (!found) continue;
            try {
              const stat = fs.statSync(found.file);
              bytes += stat.size;
              if (updatedAt === null || stat.mtimeMs > updatedAt) updatedAt = stat.mtimeMs;
              logKind = found.compressed ? "zstd" : "plain";
            } catch {}
          }
          const header = dirs.length ? cachedHeader(dirs[0].dir) : null;
          sendJson(res, 200, {
            ok: true,
            sessionId,
            title: header?.title || null,
            cwd: header?.cwd || null,
            bytes,
            updatedAt,
            logKind,
            persisted: dirs.length > 0,
            live: isSessionLive(ctx, sessionId),
            running: isSessionRunning(ctx, sessionId),
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // 4. 移动会话到指定工作区接口
    const unregMove = ctx.webServer.register({
      kind: "exact",
      path: "/api/dsh-migra-clean/move",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
          return;
        }

        let payload;
        try {
          payload = await readRequestBody(req);
        } catch {
          sendJson(res, 400, { ok: false, error: "JSON 解析失败" });
          return;
        }

        const { sessionId, targetWorkspaceId } = payload;
        if (!sessionId || !targetWorkspaceId) {
          sendJson(res, 400, { ok: false, error: "缺少 sessionId 或 targetWorkspaceId" });
          return;
        }

        try {
          const result = await withSessionLock(sessionId, () => moveSession(ctx, sessionId, targetWorkspaceId));
          sendJson(res, 200, result);
        } catch (err) {
          console.error(`[dsh-migra-clean] 移动会话 ${sessionId} 失败:`, err);
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    return () => {
      unregDel();
      unregWorkspaces();
      unregInfo();
      unregMove();
    };
  }, "dsh-migra-clean: http-routes");
}

function isSessionLive(ctx, sessionId) {
  try {
    const sessions = ctx.get("sessions", false);
    return Boolean(sessions && typeof sessions.get === "function" && sessions.get(sessionId));
  } catch {
    return false;
  }
}

function isSessionRunning(ctx, sessionId) {
  try {
    const agents = ctx.get("agents", false);
    const agent = agents && typeof agents.get === "function" ? agents.get(sessionId) : null;
    return agent?.status === "running";
  } catch {
    return false;
  }
}

function sessionBrief(ctx, sessionId, currentWorkspaceId) {
  try {
    const sessions = ctx.get("sessions", false);
    const live = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : null;
    const header = live?.header || null;
    return {
      id: sessionId,
      title: header?.title || null,
      cwd: header?.cwd || null,
      currentWorkspaceId: currentWorkspaceId || null,
      live: Boolean(live),
      running: isSessionRunning(ctx, sessionId),
    };
  } catch {
    return { id: sessionId, title: null, cwd: null, currentWorkspaceId: currentWorkspaceId || null, live: false, running: false };
  }
}

/**
 * 彻底销毁指定会话
 */
async function destroySession(ctx, sessionId) {
  console.log(`[dsh-migra-clean] 开始彻底清理会话: ${sessionId}`);

  const dshHome = getDshHome();
  const sessionsRoot = path.join(dshHome, "sessions");
  const { dirsByName, namesByProject } = sessionIndex(sessionsRoot);
  const parentDirs = dirsByName.get(sessionId) || [];

  // 1. 找出需要一并清理的隐藏子智能体会话：
  //    只认 origin === "subagent"。分叉会话（origin 为空、isSeeded=true）是
  //    用户独立创建的可见会话，绝不能被级联删除。
  const childIds = new Set();
  const liveStore = ctx.get("sessions", false);
  if (liveStore && typeof liveStore.list === "function") {
    for (const s of liveStore.list()) {
      if (s?.header?.parentSession === sessionId && s?.header?.origin === "subagent") {
        childIds.add(s.id);
      }
    }
  }
  for (const child of resolveSubagentChildren(ctx, parentDirs, namesByProject, sessionId)) {
    childIds.add(child.id);
  }

  // 2. 阻断并释放运行态：父会话 + 全部子会话
  await quiesceSessionForFileOps(ctx, sessionId);
  for (const childId of childIds) {
    try {
      await quiesceSessionForFileOps(ctx, childId);
    } catch (err) {
      console.warn(`[dsh-migra-clean] 释放子会话 ${childId} 警告:`, err);
    }
  }
  const purgeIds = new Set([sessionId, ...childIds]);

  // 3. 物理清理：父会话目录 + 子会话目录（零残留）
  for (const purgeId of purgeIds) {
    for (const { dir } of dirsByName.get(purgeId) || []) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`[dsh-migra-clean] 已物理删除会话目录: ${dir}`);
      } catch (err) {
        console.warn(`[dsh-migra-clean] 删除会话目录失败 ${dir}:`, err);
      }
    }
  }

  // 4. 清理投影缓存（父会话 + 全部子会话）：
  //    文件与内存表记录都必须删——只删文件的话，write-behind 会拿内存里的
  //    旧记录把文件重新写回。
  const projCacheSvc = ctx.get("sessionProjectionCache", false);
  for (const purgeId of purgeIds) {
    if (projCacheSvc?.table && typeof projCacheSvc.table.delete === "function") {
      try {
        await projCacheSvc.table.delete(purgeId);
      } catch {}
    }
    const projCacheFile = path.join(dshHome, "storages", "session_projcache", "sessions", `${purgeId}.json`);
    if (fs.existsSync(projCacheFile)) {
      try {
        fs.unlinkSync(projCacheFile);
        console.log(`[dsh-migra-clean] 已删除投影缓存: ${projCacheFile}`);
      } catch (err) {
        console.warn(`[dsh-migra-clean] 删除投影缓存警告:`, err);
      }
    }
  }

  // 5. 清理 workspace.json（父会话与子会话 ID 一并除名）
  try {
    const { file, data } = readWorkspaceData();
    let modified = false;
    for (const key of ["archivedSessionIds", "pinnedSessionIds"]) {
      const list = data.global?.[key];
      if (Array.isArray(list)) {
        const next = list.filter((id) => !purgeIds.has(id));
        if (next.length !== list.length) {
          data.global[key] = next;
          modified = true;
        }
      }
    }
    for (const w of Object.values(data.tables?.workspaces || {})) {
      if (!Array.isArray(w.sessionIds)) continue;
      const next = w.sessionIds.filter((id) => !purgeIds.has(id));
      if (next.length !== w.sessionIds.length) {
        w.sessionIds = next;
        w.updatedAt = new Date().toISOString();
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      console.log(`[dsh-migra-clean] 已从 workspace.json 彻底抹除会话 ID 索引`);
    }
  } catch (err) {
    console.error(`[dsh-migra-clean] 更新 workspace.json 失败:`, err);
  }

  // 6. 同步内存中的 workspaceRegistry —— 走原生 WorkspaceEntity 通路
  const registry = ctx.get("workspaceRegistry", false);
  if (registry) {
    try {
      const entities = typeof registry.list === "function" ? registry.list() : [];
      for (const entity of entities) {
        for (const purgeId of purgeIds) {
          if (entity?.record?.sessionIds?.includes(purgeId)) {
            try {
              await entity.detachSession(purgeId);
            } catch (err) {
              console.warn(`[dsh-migra-clean] 实体脱离会话警告:`, err);
            }
          }
        }
      }
      for (const purgeId of purgeIds) {
        try {
          await registry.unarchiveSession?.(purgeId);
        } catch {}
        try {
          await registry.unpinSession?.(purgeId);
        } catch {}
      }
    } catch (err) {
      console.warn(`[dsh-migra-clean] 内存 workspaceRegistry 同步警告:`, err);
    }
    try {
      for (const purgeId of purgeIds) {
        registry.headers?.delete(purgeId);
        registry.sessionPaths?.delete(purgeId);
        registry.invalidSessionPaths?.delete(purgeId);
      }
    } catch {}
  }

  // 7. 清理全文搜索 / SQLite 索引中的残余
  const sessionQuery = ctx.get("sessionQuery", false);
  if (sessionQuery) {
    try {
      for (const purgeId of purgeIds) {
        sessionQuery._deleteSession?.("persisted", purgeId);
        sessionQuery._deleteSession?.("live", purgeId);
      }
    } catch (err) {
      console.warn(`[dsh-migra-clean] sessionQuery 索引清理警告:`, err);
    }
  }

  // 8. 通知客户端把这行从列表里摘掉
  //    注意：不要伪造 session/disposed —— 那是宿主自己的生命周期事件，参数是真实 Session
  //    对象，伪造成 {id} 会让其它监听方拿到半截对象；要的是 api-session/removed。
  for (const purgeId of purgeIds) {
    try {
      ctx.emit("api-session/removed", purgeId);
    } catch {}
  }

  console.log(`[dsh-migra-clean] 会话 ${sessionId} 销毁流程全部执行完毕（含子会话 ${childIds.size} 个）`);

  // 目录布局已变：索引/header 缓存必须失效，否则下一次操作会读到过期视图
  invalidateSessionCaches();
}

/**
 * 跨工作区彻底迁移会话（父会话 + 隐藏子智能体会话一起搬）
 */
async function moveSession(ctx, sessionId, targetWorkspaceId) {
  console.log(`[dsh-migra-clean] 开始跨工作区迁移会话: ${sessionId} -> 目标工作区: ${targetWorkspaceId}`);

  const dshHome = getDshHome();
  const { file: workspaceJsonPath, data } = readWorkspaceData();
  const workspaces = data.tables?.workspaces || {};
  const targetWorkspace = workspaces[targetWorkspaceId];
  if (!targetWorkspace) {
    throw new Error(`目标工作区不存在 (ID: ${targetWorkspaceId})`);
  }
  let targetPath = targetWorkspace.path;
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error("目标工作区缺少项目路径，无法迁移");
  }

  // 归属迁移必须走原生 WorkspaceEntity.attachSession，而它会拿 header.cwd 的 realpath
  // 和 entity.record.path 做严格比较。所以先确认实体可用、并用实体自己的 path 作为新 cwd，
  // 避免「文件搬完了才发现挂不上去」这种把会话扔成孤儿的情况。
  const registry = ctx.get("workspaceRegistry", false);
  const targetEntity = registry && typeof registry.get === "function" ? registry.get(targetWorkspaceId) : undefined;
  if (!targetEntity || typeof targetEntity.attachSession !== "function") {
    throw new Error("工作区归属服务尚未就绪，暂时无法迁移（请稍后重试）");
  }
  if (typeof targetEntity.path === "string" && targetEntity.path) targetPath = targetEntity.path;

  const sessionsRoot = path.join(dshHome, "sessions");
  const { dirsByName, namesByProject } = sessionIndex(sessionsRoot);
  const parentDirs = dirsByName.get(sessionId) || [];
  if (parentDirs.length === 0) {
    throw new Error("未找到该会话的磁盘日志（会话可能尚未落盘），无法迁移");
  }

  // 隐藏子智能体会话一起搬，避免父会话迁移后子会话残留旧项目
  const children = resolveSubagentChildren(ctx, parentDirs, namesByProject, sessionId);
  const plan = [
    { id: sessionId, dir: parentDirs[0].dir, isParent: true },
    ...children.map((child) => ({ id: child.id, dir: child.dir, isParent: false })),
  ];

  for (const item of plan) {
    try {
      item.originalCwd = cachedHeader(item.dir)?.cwd ?? null;
    } catch {
      item.originalCwd = null;
    }
  }

  const targetProjectKey = projectKey(targetPath);
  const targetProjectDir = path.join(sessionsRoot, targetProjectKey);
  const { currentWorkspaceId } = workspaceListPayload(data, sessionId);
  const sourceKey = path.basename(parentDirs[0].projectDir);
  const alreadyPlaced =
    sourceKey === targetProjectKey &&
    plan.every((item) => path.resolve(item.dir) === path.resolve(path.join(targetProjectDir, item.id)));
  if (alreadyPlaced && currentWorkspaceId === targetWorkspaceId) {
    return {
      ok: true,
      noop: true,
      sessionId,
      targetWorkspaceId,
      targetWorkspaceTitle: targetWorkspace.title || path.basename(targetPath),
      message: "该会话已在此工作区",
    };
  }

  // 目标项目目录：不存在就建出来，否则迁移后的 cwd 指向空路径
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch (err) {
    throw new Error(`目标项目目录不可用：${err instanceof Error ? err.message : String(err)}`);
  }
  fs.mkdirSync(targetProjectDir, { recursive: true });

  // 0. 关键：quiesce 会触发 session/disposed，宿主随即广播 api-session/removed，
  // 客户端侧边栏会把这一行直接删掉后再也加不回来 —— 这就是「移动后会话消失」。
  // 所以在释放运行态之前先抓一份完整摘要（含标题等 projections），迁移完成后原样补发。
  let reassertSummary = null;
  try {
    const controller = ctx.get("sessionController", false);
    const live = ctx.get("sessions", false)?.get?.(sessionId);
    if (controller?.listState?.summaryFor && live !== undefined) {
      reassertSummary = controller.listState.summaryFor(live);
    }
  } catch {}
  const reassert = () => {
    if (reassertSummary === null) return;
    try {
      ctx.emit("api-session/added", {
        ...reassertSummary,
        cwd: targetPath,
        updatedAt: Math.max(Number(reassertSummary.updatedAt) || 0, Date.now()),
      });
    } catch {}
  };
  const movedIds = new Set(plan.map((item) => item.id));
  const onDisposed = (session) => {
    if (!session || !movedIds.has(session.id)) return;
    // 宿主的 removed 广播与本监听同属一个事件；setImmediate 保证我们的 added 落在它之后
    setImmediate(reassert);
  };
  try {
    ctx.on("session/disposed", onDisposed);
  } catch {}
  let watcherClosed = false;
  const stopWatching = () => {
    if (watcherClosed) return;
    watcherClosed = true;
    try {
      ctx.off?.("session/disposed", onDisposed);
    } catch {}
  };
  setTimeout(stopWatching, 6000);

  // 1. 阻断活动、关写句柄、把会话从内存注册表整体释放
  const { wasLive } = await quiesceSessionForFileOps(ctx, sessionId);
  if (wasLive) {
    console.log(`[dsh-migra-clean] 会话 ${sessionId} 运行态已安全释放`);
  }
  for (const child of plan.filter((item) => !item.isParent)) {
    try {
      await quiesceSessionForFileOps(ctx, child.id);
    } catch (err) {
      console.warn(`[dsh-migra-clean] 释放子会话 ${child.id} 警告:`, err);
    }
  }

  // 2. 改写 header.cwd + 物理搬移目录
  let movedChildren = 0;
  for (const item of plan) {
    try {
      const res = rewriteSessionCwd(item.dir, targetPath);
      if (res.updated) {
        console.log(`[dsh-migra-clean] 已更新 ${item.id} header.cwd -> ${targetPath}（保留其余 ${res.frames - 1} 帧历史）`);
      }
    } catch (err) {
      console.warn(`[dsh-migra-clean] 改写会话 ${item.id} cwd 失败:`, err);
      throw new Error(`改写会话头失败，已中止迁移：${err instanceof Error ? err.message : String(err)}`);
    }
    const dest = path.join(targetProjectDir, item.id);
    if (path.resolve(item.dir) !== path.resolve(dest)) {
      try {
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(item.dir, dest);
        if (!item.isParent) movedChildren += 1;
        console.log(`[dsh-migra-clean] 已物理迁移会话目录至: ${dest}`);
      } catch (err) {
        throw new Error(`迁移会话目录失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const planIds = plan.map((item) => item.id);

  // 目录已改名：索引与 header 缓存立即失效，后面的步骤要按新路径重新读
  invalidateSessionCaches();

  // 3. 同步更新投影缓存（内存表 + 文件）
  const projCache = ctx.get("sessionProjectionCache", false);
  for (const id of planIds) {
    if (projCache?.table) {
      try {
        if (projCache.table.get(id) !== undefined) {
          await projCache.table.update(id, (rec) => ({
            ...rec,
            identity: { ...rec.identity, cwd: targetPath },
          }));
        }
      } catch {}
    }
    const projCacheFile = path.join(dshHome, "storages", "session_projcache", "sessions", `${id}.json`);
    if (fs.existsSync(projCacheFile)) {
      try {
        const pcData = JSON.parse(fs.readFileSync(projCacheFile, "utf8"));
        if (pcData?.record?.identity) {
          pcData.record.identity.cwd = targetPath;
          fs.writeFileSync(projCacheFile, JSON.stringify(pcData, null, 2), "utf8");
        }
      } catch {}
    }
  }

  // 4. 内存态缓存同步：coldLogMemo 丢弃旧解析
  const persistence = ctx.get("sessionPersistence", false);
  if (persistence?.coldLogMemo) {
    for (const id of planIds) persistence.coldLogMemo.delete(id);
  }

  // 5. 更新 workspace.json 映射（记录哪些 ID 原本是被列在某个工作区里的）
  const previouslyListed = new Set();
  for (const w of Object.values(workspaces)) {
    if (!Array.isArray(w.sessionIds)) continue;
    for (const id of planIds) if (w.sessionIds.includes(id)) previouslyListed.add(id);
    const next = w.sessionIds.filter((id) => !planIds.includes(id));
    if (next.length !== w.sessionIds.length) {
      w.sessionIds = next;
      w.updatedAt = new Date().toISOString();
    }
  }
  if (!Array.isArray(targetWorkspace.sessionIds)) targetWorkspace.sessionIds = [];
  for (const id of planIds) {
    if (!previouslyListed.has(id)) continue;
    if (!targetWorkspace.sessionIds.includes(id)) targetWorkspace.sessionIds.unshift(id);
  }
  if (!previouslyListed.has(sessionId) && !targetWorkspace.sessionIds.includes(sessionId)) {
    targetWorkspace.sessionIds.unshift(sessionId);
  }
  targetWorkspace.updatedAt = new Date().toISOString();
  fs.writeFileSync(workspaceJsonPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`[dsh-migra-clean] 已在 workspace.json 中将会话挂载到目标工作区 ${targetWorkspace.title}`);

  // 6. 归属迁移 —— 必须走原生 WorkspaceEntity.detachSession/attachSession
  const entities = typeof registry.list === "function" ? registry.list() : [];
  const syncHeaderIndex = async () => {
    try {
      if (typeof registry.replaceHeaderIndex === "function" && typeof registry.listStoredHeaders === "function") {
        await registry.replaceHeaderIndex(await registry.listStoredHeaders());
        return true;
      }
    } catch (err) {
      console.warn("[dsh-migra-clean] 重建会话头索引失败，退回逐条失效:", err);
    }
    for (const id of planIds) {
      try {
        registry.headers?.delete?.(id);
        registry.sessionPaths?.delete?.(id);
      } catch {}
    }
    return false;
  };

  try {
    // header.cwd 已经在磁盘上改过了，索引里还是旧值，必须先失效再 attach
    await syncHeaderIndex();
    for (const entity of entities) {
      if (entity === targetEntity) continue;
      for (const id of planIds) {
        if (!entity?.record?.sessionIds?.includes(id)) continue;
        try {
          await entity.detachSession(id);
        } catch (err) {
          console.warn(`[dsh-migra-clean] 从旧工作区摘除 ${id} 警告:`, err);
        }
      }
    }
    await targetEntity.attachSession(sessionId);
    for (const id of planIds) {
      if (id === sessionId) continue;
      try {
        await targetEntity.attachSession(id);
      } catch (err) {
        console.warn(`[dsh-migra-clean] 子会话 ${id} 归属同步警告:`, err);
      }
    }
    console.log(`[dsh-migra-clean] 已经由原生实体通路迁移归属 -> ${targetWorkspace.title}`);
  } catch (attachError) {
    const message = attachError instanceof Error ? attachError.message : String(attachError);
    console.warn("[dsh-migra-clean] 归属迁移失败，开始把文件搬回原处:", message);
    for (const item of plan) {
      const dest = path.join(targetProjectDir, item.id);
      if (path.resolve(dest) === path.resolve(item.dir)) continue;
      try {
        if (fs.existsSync(dest) && !fs.existsSync(item.dir)) {
          if (item.originalCwd) {
            try {
              rewriteSessionCwd(dest, item.originalCwd);
            } catch {}
          }
          fs.mkdirSync(path.dirname(item.dir), { recursive: true });
          fs.renameSync(dest, item.dir);
        }
      } catch (err) {
        console.warn(`[dsh-migra-clean] 回滚会话目录 ${item.id} 失败:`, err);
      }
    }
    try {
      await syncHeaderIndex();
      const sourceEntity = registry.get?.(currentWorkspaceId);
      if (sourceEntity?.attachSession) {
        try {
          await sourceEntity.attachSession(sessionId);
        } catch {}
      }
      const sessionQueryRollback = ctx.get("sessionQuery", false);
      if (sessionQueryRollback?._requireDb) {
        const db = sessionQueryRollback._requireDb();
        for (const item of plan) {
          if (!item.originalCwd) continue;
          db.prepare("UPDATE persisted_sessions SET cwd = ? WHERE id = ?").run(item.originalCwd, item.id);
          db.prepare("UPDATE temp.live_sessions SET cwd = ? WHERE id = ?").run(item.originalCwd, item.id);
        }
      }
    } catch (err) {
      console.warn("[dsh-migra-clean] 回滚索引/数据库警告:", err);
    }
    stopWatching();
    throw new Error(`迁移后无法把会话挂到目标工作区，文件已搬回原处：${message}`);
  }

  // 7. 若有 SQLite 索引，更新 persisted_sessions 与 temp.live_sessions 中的 cwd
  const sessionQuery = ctx.get("sessionQuery", false);
  if (sessionQuery?._requireDb) {
    try {
      const db = sessionQuery._requireDb();
      for (const id of planIds) {
        db.prepare("UPDATE persisted_sessions SET cwd = ? WHERE id = ?").run(targetPath, id);
        db.prepare("UPDATE temp.live_sessions SET cwd = ? WHERE id = ?").run(targetPath, id);
      }
    } catch {}
  }

  // 8. 补发会话摘要：立即一次 + 延迟一次（覆盖 dispose 级联较晚完成的情况），
  // 保证侧边栏最终一定还有这一行，且 cwd 指向新工作区。
  reassert();
  setTimeout(reassert, 400);

  invalidateSessionCaches();

  return {
    ok: true,
    sessionId,
    targetWorkspaceId,
    targetWorkspaceTitle: targetWorkspace.title || path.basename(targetPath),
    cwd: targetPath,
    wasLive,
    movedChildren,
  };
}

// ---------------------------------------------------------------------------
// 仅供本地性能 / 回归脚本使用的导出（不参与插件运行时，宿主只消费 apply）
//   node test/bench-index.mjs
// ---------------------------------------------------------------------------
export const __test = {
  indexSessionDirs,
  sessionIndex,
  invalidateSessionCaches,
  cachedHeader,
  findSubagentChildren,
  readSessionHeaderFromDir,
};
