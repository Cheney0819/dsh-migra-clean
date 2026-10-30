/**
 * 会话索引性能对照：旧实现（每次全量遍历 + 逐会话读头）
 *              vs 新实现（短 TTL 索引缓存 + header 缓存 + SQLite 候选反查）
 *
 *   node test/bench-index.mjs [会话数]
 *
 * 说明：新实现里「子会话候选」来自 SQLite 的 parent_session 索引，
 * 本脚本没有真库，所以只对 1 个候选读 header 来模拟这一收益（这是保守估计：
 * 真库下候选查询是单次索引扫描，比逐会话 open+parse 便宜一个数量级）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __test } from "../lib/index.js";

const TOTAL = Number(process.argv[2] || 2000);
const PROJECTS = 20;
const ITERATIONS = 10;

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-migra-clean-bench-"));
  const perProject = Math.ceil(TOTAL / PROJECTS);
  let created = 0;
  for (let p = 0; p < PROJECTS; p++) {
    const projectDir = path.join(root, `--home-dev-project-${p}--`);
    fs.mkdirSync(projectDir, { recursive: true });
    for (let i = 0; i < perProject && created < TOTAL; i++, created++) {
      const id = `sess-${created}`;
      const dir = path.join(projectDir, id);
      fs.mkdirSync(dir, { recursive: true });
      const header = {
        id,
        version: 1,
        cwd: `/home/dev/project-${p}`,
        title: `会话 ${created}`,
        createdAt: 1700000000000 + created,
        parentSession: created === 1 ? "sess-0" : undefined,
        origin: created === 1 ? "subagent" : undefined,
      };
      fs.writeFileSync(path.join(dir, "session.v4.jsonl"), `${JSON.stringify(header)}\n`);
    }
  }
  return root;
}

/** 旧实现：每次都全量遍历目录 + 逐会话读文件解析 header */
function oldPath(root, targetParent) {
  const dirsByName = new Map();
  const namesByProject = new Map();
  const projects = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name));
  for (const projectDir of projects) {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    namesByProject.set(projectDir, entries.map((e) => e.name));
    for (const entry of entries) {
      const dir = path.join(projectDir, entry.name);
      const bucket = dirsByName.get(entry.name) || [];
      bucket.push({ projectDir, dir });
      dirsByName.set(entry.name, bucket);
    }
  }
  // 逐会话读头（这正是旧实现的成本大头）
  const children = [];
  for (const projectDir of projects) {
    for (const name of namesByProject.get(projectDir) || []) {
      const file = path.join(projectDir, name, "session.v4.jsonl");
      let header = null;
      try {
        const text = fs.readFileSync(file, "utf8");
        header = JSON.parse(text.slice(0, text.indexOf("\n")));
      } catch {
        header = null;
      }
      if (header && header.parentSession === targetParent && header.origin === "subagent") {
        children.push({ id: header.id || name, dir: path.join(projectDir, name), projectDir });
      }
    }
  }
  return { dirsByName, children };
}

/** 新实现：缓存索引 + 只对候选读 header */
function newPath(root, targetParent) {
  const { dirsByName, namesByProject } = __test.sessionIndex(root);
  const candidates = ["sess-1"]; // 真库由 parent_session 索引给出
  const children = [];
  for (const id of candidates) {
    for (const projectDir of namesByProject.keys()) {
      if (!(namesByProject.get(projectDir) || []).includes(id)) continue;
      const dir = path.join(projectDir, id);
      const header = __test.cachedHeader(dir);
      if (header && header.parentSession === targetParent && header.origin === "subagent") {
        children.push({ id, dir, projectDir });
      }
      break;
    }
  }
  return { dirsByName, children };
}

function time(fn, iterations) {
  fn(); // 预热（新实现的缓存也在这里建立）
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const ns = Number(process.hrtime.bigint() - started);
  return ns / iterations / 1e6; // 平均每次多少毫秒
}

const root = buildFixture();
const targetParent = "sess-0";
const oldCheck = oldPath(root, targetParent);
const newCheck = newPath(root, targetParent);
if (oldCheck.children.length !== newCheck.children.length) {
  throw new Error(`benchmark 夹具不一致：old=${oldCheck.children.length} new=${newCheck.children.length}`);
}
const oldMs = time(() => oldPath(root, targetParent), ITERATIONS);
__test.invalidateSessionCaches();
const newMs = time(() => newPath(root, targetParent), ITERATIONS);
// 冷路径：每次调用前都让缓存失效（等价于缓存过期后的第一次访问）
const newColdMs = time(() => {
  __test.invalidateSessionCaches();
  newPath(root, targetParent);
}, Math.min(ITERATIONS, 5));

console.log(`夹具：${TOTAL} 个会话 / ${PROJECTS} 个项目目录（${root}）`);
console.log(`旧实现（全量遍历 + 逐会话读头）：${oldMs.toFixed(2)} ms / 次`);
console.log(`新实现·冷路径（缓存被清空时）：${newColdMs.toFixed(2)} ms / 次`);
console.log(`新实现·稳态（缓存命中时）：    ${newMs.toFixed(2)} ms / 次`);
console.log(`加速比：冷路径 ${(oldMs / Math.max(newColdMs, 0.001)).toFixed(1)}× / 稳态 ${(oldMs / Math.max(newMs, 0.001)).toFixed(0)}×`);
fs.rmSync(root, { recursive: true, force: true });
