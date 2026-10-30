/**
 * 「彻底删除会话」回归测试（只碰临时 DSH_HOME）。
 *
 *   node test/delete.mjs
 *
 * 重点覆盖历史上会导致「删了又复活」的那条路径：删除时若读到 TTL 内的旧目录索引，
 * 会话目录会被漏删，宿主下次启动又从磁盘把它索引回来。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { __test } from "../lib/index.js";

const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
let failed = 0;
const log = (ok, msg) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-migra-clean-delete-"));
const prevHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;

// 静音插件日志，只留断言输出
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
const quiet = () => {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
};
const loud = () => {
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;
};

const SID = "session-abc";
const sessionsRoot = path.join(home, "sessions");
const projectDir = path.join(sessionsRoot, "--proj-a--");
const sessionDir = path.join(projectDir, SID);
const projCacheFile = path.join(home, "storages", "session_projcache", "sessions", `${SID}.json`);
const workspaceJson = path.join(home, "storages", "workspace.json");

try {
  fs.mkdirSync(path.join(home, "storages", "session_projcache", "sessions"), { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    workspaceJson,
    `${JSON.stringify(
      {
        unit: { name: "workspace", version: 1 },
        global: { workspaceIds: ["ws1"], archivedSessionIds: [SID], pinnedSessionIds: [SID] },
        tables: { workspaces: { ws1: { path: "/tmp/proj-a", title: "A", sessionIds: [SID, "session-keep"], createdAt: "x", updatedAt: "x" } } },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(projCacheFile, "{}");

  // 关键铺垫：先让索引缓存「看不到」这个会话目录
  quiet();
  __test.invalidateSessionCaches();
  const stale = __test.sessionIndex(sessionsRoot);
  loud();
  log(stale.dirsByName.has(SID) === false, "索引缓存里暂时没有该会话（模拟删除前刚创建/刚写入）");

  // 目录在上一次扫描之后才出现
  fs.mkdirSync(sessionDir, { recursive: true });
  const header = JSON.stringify({ type: "session", version: 4, id: SID, createdAt: 1, delegationDepth: 0, isSeeded: false, cwd: "/tmp/proj-a" });
  fs.writeFileSync(path.join(sessionDir, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(`${header}\n`), CHECKSUM));

  const emitted = [];
  const ctx = {
    get: (name) => (name === "sessions" ? { list: () => [], get: () => undefined } : false),
    emit: (event, id) => emitted.push([event, id]),
  };

  quiet();
  await __test.destroySession(ctx, SID);
  loud();

  log(fs.existsSync(sessionDir) === false, "会话目录已被物理删除（旧实现会因缓存漏删）");
  log(fs.existsSync(projectDir) === false, "搬空的项目目录被一并清理");
  log(fs.existsSync(projCacheFile) === false, "投影缓存文件已删除");
  log(
    emitted.some(([event, id]) => event === "api-session/removed" && id === SID),
    "已向客户端广播 api-session/removed",
  );
  log(
    emitted.some(([event]) => event === "session/disposed") === false,
    "没有伪造宿主的 session/disposed 生命周期事件",
  );

  const data = JSON.parse(fs.readFileSync(workspaceJson, "utf8"));
  log(data.tables.workspaces.ws1.sessionIds.includes(SID) === false, "workspace.json 里的会话归属已除名");
  log(data.tables.workspaces.ws1.sessionIds.includes("session-keep") === true, "同工作区的其它会话不受影响");
  log(data.global.archivedSessionIds.includes(SID) === false, "归档集合里的 ID 已除名");
  log(data.global.pinnedSessionIds.includes(SID) === false, "置顶集合里的 ID 已除名");
  log(fs.readFileSync(workspaceJson, "utf8").endsWith("\n"), "workspace.json 保留宿主 serialize() 的尾部换行");

  // 再删一次：不该抛异常（幂等）
  let secondOk = true;
  quiet();
  try {
    await __test.destroySession(ctx, SID);
  } catch {
    secondOk = false;
  }
  loud();
  log(secondOk, "重复删除同一个会话不会抛异常");

  // 自定义 ID 必须按宿主 encodeSegment 规则找到目录，不能静默漏删
  const customId = "a~b";
  const customProject = path.join(sessionsRoot, "--custom-project--");
  const customDir = path.join(customProject, __test.encodeSegment(customId));
  fs.mkdirSync(customDir, { recursive: true });
  fs.writeFileSync(
    path.join(customDir, "session.v4.jsonl.zstd"),
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify({ type: "session", version: 4, id: customId, createdAt: 1, delegationDepth: 0, isSeeded: false, cwd: "/tmp/custom" })}\n`), CHECKSUM),
  );
  quiet();
  await __test.destroySession(ctx, customId);
  loud();
  log(fs.existsSync(customDir) === false, "自定义 ID（含 ~）的会话目录也被删除");

  // 物理删除失败必须向上抛错，不能返回“彻底删除成功”
  if (process.platform !== "win32") {
    const readonlyProject = path.join(sessionsRoot, "--readonly-project--");
    const readonlyDir = path.join(readonlyProject, "session-readonly");
    fs.mkdirSync(readonlyDir, { recursive: true });
    fs.writeFileSync(
      path.join(readonlyDir, "session.v4.jsonl.zstd"),
      zlib.zstdCompressSync(Buffer.from(`${JSON.stringify({ type: "session", version: 4, id: "session-readonly", createdAt: 1, delegationDepth: 0, isSeeded: false, cwd: "/tmp/readonly" })}\n`), CHECKSUM),
    );
    fs.chmodSync(readonlyProject, 0o555);
    let deleteThrew = false;
    quiet();
    try {
      await __test.destroySession(ctx, "session-readonly");
    } catch {
      deleteThrew = true;
    }
    loud();
    log(deleteThrew, "目录不可写时删除会抛错而不是伪装成功");
    log(fs.existsSync(readonlyDir), "删除失败时目录保持原样");
    fs.chmodSync(readonlyProject, 0o755);
  }
} finally {
  loud();
  process.env.DSH_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(failed === 0 ? "DONE" : `FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
