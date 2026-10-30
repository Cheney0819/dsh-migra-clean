/**
 * 跨工作区迁移回归测试（只碰临时 DSH_HOME）。
 *
 *   node test/move.mjs
 *
 * 重点覆盖最危险的失败分支：
 *   1. 正常迁移（父 + 子会话、目录、header.cwd、registry 归属）
 *   2. 改完 cwd 后目录 rename 失败 → 文件与 header 都要回滚
 *   3. 目标 attach 失败 → 文件、registry header、源归属都要回滚
 *   4. 目标工作区目录不存在 → 拒绝迁移，不能自动创建空目录
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { __test } from "../lib/index.js";

const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const headerLine = (id, cwd, parent) =>
  JSON.stringify({
    type: "session",
    version: 4,
    id,
    createdAt: 1,
    delegationDepth: parent ? 1 : 0,
    isSeeded: false,
    cwd,
    ...(parent ? { parentSession: parent, origin: "subagent" } : {}),
  });

let failed = 0;
const log = (ok, msg) => {
  if (!ok) failed += 1;
  realLog(`${ok ? "PASS" : "FAIL"} ${msg}`);
};

const realLog = console.log;
const realWarn = console.warn;
const quiet = () => {
  console.log = () => {};
  console.warn = () => {};
};
const loud = () => {
  console.log = realLog;
  console.warn = realWarn;
};

function makeFixture({ child = true, chmodTarget = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-migra-clean-move-"));
  const sessionsRoot = path.join(home, "sessions");
  const projA = path.join(home, "proj-a");
  const projB = path.join(home, "proj-b");
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });
  fs.mkdirSync(path.join(home, "storages"), { recursive: true });

  const projectA = path.join(sessionsRoot, __test.projectKey(projA));
  const parentDir = path.join(projectA, "s1");
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(
    path.join(parentDir, "session.v4.jsonl.zstd"),
    zlib.zstdCompressSync(Buffer.from(`${headerLine("s1", projA)}\n`), CHECKSUM),
  );

  let childDir = null;
  if (child) {
    childDir = path.join(projectA, "s2");
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(
      path.join(childDir, "session.v4.jsonl.zstd"),
      zlib.zstdCompressSync(Buffer.from(`${headerLine("s2", projA, "s1")}\n`), CHECKSUM),
    );
  }

  fs.writeFileSync(
    path.join(home, "storages", "workspace.json"),
    `${JSON.stringify(
      {
        unit: { name: "workspace", version: 2 },
        global: { workspaceIds: ["wsA", "wsB"], archivedSessionIds: [], pinnedSessionIds: [] },
        tables: {
          workspaces: {
            wsA: { path: projA, title: "A", sessionIds: ["s1", ...(child ? ["s2"] : [])], createdAt: "x", updatedAt: "x" },
            wsB: { path: projB, title: "B", sessionIds: [], createdAt: "x", updatedAt: "x" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const targetProjectDir = path.join(sessionsRoot, __test.projectKey(projB));
  if (chmodTarget) {
    fs.mkdirSync(targetProjectDir, { recursive: true });
    fs.chmodSync(targetProjectDir, 0o555);
  }
  return {
    home,
    sessionsRoot,
    projA,
    projB,
    parentDir,
    childDir,
    projectA,
    targetProjectDir,
  };
}

function fakeContext(fixture, { targetAttachFails = false } = {}) {
  const headers = new Map();
  const source = {
    record: { path: fixture.projA, sessionIds: ["s1", ...(fixture.childDir ? ["s2"] : [])] },
    detachSession: async (id) => {
      source.record.sessionIds = source.record.sessionIds.filter((entry) => entry !== id);
    },
    attachSession: async (id) => {
      if (!source.record.sessionIds.includes(id)) source.record.sessionIds.push(id);
    },
  };
  const target = {
    record: { path: fixture.projB, sessionIds: [] },
    detachSession: async (id) => {
      target.record.sessionIds = target.record.sessionIds.filter((entry) => entry !== id);
    },
    attachSession: async (id) => {
      target.record.sessionIds.push(id);
      if (targetAttachFails) throw new Error("attach boom");
    },
  };
  const registry = {
    list: () => [source, target],
    get: (id) => (id === "wsA" ? source : id === "wsB" ? target : undefined),
    headers,
    sessionPaths: new Map(),
    invalidSessionPaths: new Map(),
    indexHeader: async (header) => {
      headers.set(header.id, header);
    },
    replaceHeaderIndex: async () => {},
    listStoredHeaders: async () => [],
  };
  const ctx = {
    get(name) {
      if (name === "workspaceRegistry") return registry;
      if (name === "sessions") return { get: () => undefined, list: () => [] };
      return false;
    },
    on: () => () => {},
    off: undefined,
    emit: () => {},
    parallel: async () => {},
  };
  return { ctx, source, target, headers };
}

function readDiskHeader(dir) {
  return __test.readSessionHeaderFromDir(dir);
}

async function runCase(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed += 1;
    realLog(`FAIL ${name} 抛出异常: ${err && err.stack ? err.stack : err}`);
  }
}

quiet();
try {
  // 0) 标题属于 DSH projection，不属于 SessionHeader
  const titleCtx = {
    get: (name) => name === "sessionProjections"
      ? { snapshot: () => ({ values: { title: "项目标题" } }) }
      : false,
  };
  log(__test.sessionTitleOf(titleCtx, { id: "s1" }, { id: "s1" }) === "项目标题", "标题从 projection 读取");

  // 1) 正常迁移：父 + 子目录、header、registry 归属全部到位
  await runCase("正常迁移", async () => {
    const fixture = makeFixture();
    const { ctx, source, target, headers } = fakeContext(fixture);
    process.env.DSH_HOME = fixture.home;
    __test.invalidateSessionCaches();
    let error = null;
    try {
      await __test.moveSession(ctx, "s1", "wsB");
    } catch (err) {
      error = err;
    }
    log(error === null, "正常迁移不抛异常");
    log(fs.existsSync(path.join(fixture.targetProjectDir, "s1")), "父会话目录已到目标项目");
    log(fs.existsSync(path.join(fixture.targetProjectDir, "s2")), "子会话目录已到目标项目");
    log(readDiskHeader(path.join(fixture.targetProjectDir, "s1"))?.cwd === fixture.projB, "父会话 header.cwd 已更新");
    log(headers.get("s1")?.cwd === fixture.projB && headers.get("s2")?.cwd === fixture.projB, "registry header 索引已更新");
    log(source.record.sessionIds.length === 0 && target.record.sessionIds.includes("s1") && target.record.sessionIds.includes("s2"), "工作区归属已迁移");
    fs.rmSync(fixture.home, { recursive: true, force: true });
  });

  // 2) cwd 已改、目录 rename 失败：两样都必须回滚
  await runCase("rename 失败回滚", async () => {
    if (process.platform === "win32") {
      log(true, "Windows 跳过 chmod 只读目录用例");
      return;
    }
    const fixture = makeFixture({ chmodTarget: true });
    const { ctx, source } = fakeContext(fixture);
    process.env.DSH_HOME = fixture.home;
    __test.invalidateSessionCaches();
    let error = null;
    try {
      await __test.moveSession(ctx, "s1", "wsB");
    } catch (err) {
      error = err;
    }
    log(Boolean(error), "rename 失败会抛异常");
    log(fs.existsSync(fixture.parentDir), "父会话目录回到源项目");
    log(readDiskHeader(fixture.parentDir)?.cwd === fixture.projA, "父会话 header.cwd 已回滚");
    log(source.record.sessionIds.includes("s1"), "源工作区仍持有父会话");
    fs.chmodSync(fixture.targetProjectDir, 0o755);
    fs.rmSync(fixture.home, { recursive: true, force: true });
  });

  // 3) attach 失败：文件、header、registry 索引、归属全部回滚
  await runCase("attach 失败回滚", async () => {
    const fixture = makeFixture();
    const { ctx, source, target, headers } = fakeContext(fixture, { targetAttachFails: true });
    process.env.DSH_HOME = fixture.home;
    __test.invalidateSessionCaches();
    let error = null;
    try {
      await __test.moveSession(ctx, "s1", "wsB");
    } catch (err) {
      error = err;
    }
    log(Boolean(error), "attach 失败会抛异常");
    log(fs.existsSync(fixture.parentDir) && fs.existsSync(fixture.childDir), "父/子目录都回到源项目");
    log(readDiskHeader(fixture.parentDir)?.cwd === fixture.projA, "磁盘 header.cwd 回到源路径");
    log(headers.get("s1")?.cwd === fixture.projA && headers.get("s2")?.cwd === fixture.projA, "registry header 索引回到源路径");
    log(source.record.sessionIds.includes("s1") && source.record.sessionIds.includes("s2"), "源工作区重新持有父/子会话");
    log(target.record.sessionIds.length === 0, "目标工作区没有残留归属");
    fs.rmSync(fixture.home, { recursive: true, force: true });
  });

  // 4) 目标目录不存在：拒绝，不自动创建
  await runCase("目标目录缺失", async () => {
    const fixture = makeFixture({ child: false });
    fs.rmSync(fixture.projB, { recursive: true, force: true });
    const { ctx } = fakeContext(fixture);
    process.env.DSH_HOME = fixture.home;
    __test.invalidateSessionCaches();
    let error = null;
    try {
      await __test.moveSession(ctx, "s1", "wsB");
    } catch (err) {
      error = err;
    }
    log(Boolean(error) && /不存在|不可用/.test(error.message), "目标目录缺失会拒绝迁移");
    log(fs.existsSync(fixture.parentDir), "源会话目录没有被移动");
    log(!fs.existsSync(fixture.projB), "没有自动创建目标目录");
    fs.rmSync(fixture.home, { recursive: true, force: true });
  });
} finally {
  loud();
}

console.log(failed === 0 ? "DONE" : `FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
